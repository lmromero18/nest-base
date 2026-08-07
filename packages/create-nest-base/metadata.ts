import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { getCapability } from './registry';
import type { ArtifactRecord } from './artifact-gate';
import type { NormalizedPlan, ResolvedCapability } from './types';

const MANIFEST_PATH = '.nest-base/manifest.json';
const MAX_COMPENSATION_WRITES = 32;
const MIRROR_KEYS = [
  'schemaVersion',
  'wizardVersion',
  'manifestPath',
  'capabilities',
];
// The manifest hash is calculated from the canonical manifest with its own
// hash entry omitted. This explicit rule prevents circular self-hashing.
const MANIFEST_HASH_RULE = 'manifest-with-self-hash-entry-omitted';
type JsonObject = Record<string, unknown>;

export interface MetadataFileSystem {
  readFile(path: string): string | undefined;
  writeFile(path: string, content: string): void;
  renameFile?(path: string, destination: string): void;
  renameFileIfAbsent?(path: string, destination: string): void;
  exists(path: string): boolean;
  mkdir(path: string): void;
  removeFile(path: string): void;
  writeBytes?(path: string, content: Uint8Array): void;
  writeBytesIfAbsent?(path: string, content: Uint8Array): void;
  readBytes?(path: string): Uint8Array | undefined;
}

export interface OwnedWrite {
  path: string;
  content: string;
  bytes?: Uint8Array;
  expectedSha256?: string;
  previousContent?: string;
}

export interface MetadataPreview {
  writes: OwnedWrite[];
  manifest: CanonicalManifest;
  mirror: NestBaseMirror;
}

export type VerifiedArtifacts = ReadonlyMap<string, ArtifactRecord>;

export interface NestBaseMirror {
  schemaVersion: 1;
  wizardVersion: string;
  manifestPath: '.nest-base/manifest.json';
  capabilities: ResolvedCapability[];
}

export interface CanonicalManifest {
  schemaVersion: 1;
  wizardVersion: string;
  target: string;
  registryRevision: string;
  resolvedEntries: ResolvedCapability[];
  dependencySections: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  ownedPaths: string[];
  hashes: Record<string, string>;
  hashRule: string;
}

export const createMetadataFileSystem = (): MetadataFileSystem => ({
  readFile: (path) =>
    existsSync(path) ? readFileSync(path, 'utf8') : undefined,
  writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
  exists: existsSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  renameFile: (path, destination) => renameSync(path, destination),
  renameFileIfAbsent: (path, destination) => {
    linkSync(path, destination);
    rmSync(path);
  },
  removeFile: (path) => rmSync(path, { force: true }),
  writeBytes: (path, content) => writeFileSync(path, content),
  writeBytesIfAbsent: (path, content) =>
    writeFileSync(path, content, { flag: 'wx' }),
  readBytes: (path) => {
    try {
      return new Uint8Array(readFileSync(path));
    } catch {
      return undefined;
    }
  },
});

export function buildMetadataPreview(
  plan: NormalizedPlan,
  fileSystem: MetadataFileSystem,
  verifiedArtifacts?: VerifiedArtifacts,
): MetadataPreview {
  const packagePath = join(plan.target, 'package.json');
  const manifestPath = join(plan.target, MANIFEST_PATH);
  const packageBefore = readJson(
    fileSystem.readFile(packagePath),
    'package.json',
  );
  validateExistingMirror(packageBefore.nestBase);
  const existingManifest = fileSystem.readFile(manifestPath);
  if (existingManifest !== undefined) {
    const parsed = readJson(existingManifest, MANIFEST_PATH);
    validateManifest(parsed);
    validateCapabilityOwnedOutputs(parsed, plan, fileSystem);
    if (
      parsed.registryRevision !== plan.registryRevision ||
      !sameJson(parsed.resolvedEntries, plan.capabilities)
    )
      throw new Error('Metadata drift detected in manifest.');
  }

  const sections: CanonicalManifest['dependencySections'] = {
    dependencies: {},
    devDependencies: {},
  };
  for (const capability of plan.capabilities) {
    const section =
      plan.dependencySections[capability.id] ??
      plan.dependencySections[capability.package];
    if (!section)
      throw new Error(`Missing dependency section for ${capability.id}.`);
    const current = readSection(packageBefore[section], section);
    const pinnedSpec = current[capability.package];
    const expectedSpec =
      artifactPath(capability, verifiedArtifacts) ??
      (isPinnedArtifactSpec(pinnedSpec, capability.id)
        ? pinnedSpec
        : dependencySpec(capability));
    for (const otherSection of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'peerDependencies',
    ]) {
      if (
        otherSection !== section &&
        readSection(packageBefore[otherSection], otherSection)[
          capability.package
        ] !== undefined
      )
        throw new Error(`Dependency conflict for ${capability.package}.`);
    }
    if (
      current[capability.package] !== undefined &&
      current[capability.package] !== expectedSpec
    )
      throw new Error(`Dependency conflict for ${capability.package}.`);
    sections[section][capability.package] = expectedSpec;
  }

  const mirror: NestBaseMirror = {
    schemaVersion: 1,
    wizardVersion: plan.wizardVersion,
    manifestPath: '.nest-base/manifest.json',
    capabilities: plan.capabilities,
  };
  const packageAfter = {
    ...packageBefore,
    dependencies: {
      ...readSection(packageBefore.dependencies, 'dependencies'),
      ...sections.dependencies,
    },
    ...(Object.keys(sections.devDependencies).length > 0
      ? {
          devDependencies: {
            ...readSection(packageBefore.devDependencies, 'devDependencies'),
            ...sections.devDependencies,
          },
        }
      : {}),
    nestBase: mirror,
  };
  const packageContent = formatJson(packageAfter);
  const ownedPaths = [
    ...new Set([
      'package.json',
      MANIFEST_PATH,
      'package.json.nestBase',
      ...plan.capabilities.flatMap(
        (entry) => getCapability(entry.id).ownedPaths,
      ),
    ]),
  ];
  const capabilityOutputs = Object.fromEntries(
    plan.capabilities
      .flatMap((entry) => getCapability(entry.id).ownedPaths)
      .filter(
        (path) => ![MANIFEST_PATH, 'package.json.nestBase'].includes(path),
      )
      .map((path) => [
        path,
        formatJson({
          schemaVersion: 1,
          capability: plan.capabilities.find((entry) =>
            getCapability(entry.id).ownedPaths.includes(path),
          )?.id,
        }),
      ]),
  );
  const hashes: Record<string, string> = {
    'package.json': sha256(packageContent),
    'package.json.nestBase': sha256(formatJson(mirror)),
    ...Object.fromEntries(
      Object.entries(capabilityOutputs).map(([path, content]) => [
        path,
        sha256(content),
      ]),
    ),
  };
  const manifest: CanonicalManifest = {
    schemaVersion: 1,
    wizardVersion: plan.wizardVersion,
    target: plan.target,
    registryRevision: plan.registryRevision,
    resolvedEntries: plan.capabilities,
    dependencySections: sections,
    ownedPaths,
    hashes,
    hashRule: MANIFEST_HASH_RULE,
  };
  manifest.hashes[MANIFEST_PATH] = sha256(
    formatJson({
      ...manifest,
      hashes: Object.fromEntries(
        Object.entries(manifest.hashes).filter(
          ([path]) => path !== MANIFEST_PATH,
        ),
      ),
      hashRule: MANIFEST_HASH_RULE,
    }),
  );
  const manifestContent = formatJson(manifest);
  if (existingManifest !== undefined) {
    const parsed = readJson(existingManifest, MANIFEST_PATH);
    validateManifest(parsed);
    if (!sameJson(parsed, manifest))
      throw new Error('Metadata drift detected in manifest.');
  }
  if (
    packageBefore.nestBase !== undefined &&
    !sameJson(packageBefore.nestBase, mirror)
  )
    throw new Error('Metadata mirror mismatch detected.');

  const packageExpected = sha256(packageBeforeContent(fileSystem, packagePath));
  const writes: OwnedWrite[] = [];
  if (fileSystem.readFile(packagePath) !== packageContent)
    writes.push({
      path: packagePath,
      content: packageContent,
      expectedSha256: packageExpected,
      previousContent: fileSystem.readFile(packagePath),
    });
  if (existingManifest !== manifestContent)
    writes.push({
      path: manifestPath,
      content: manifestContent,
      expectedSha256:
        existingManifest === undefined ? undefined : sha256(existingManifest),
      previousContent: existingManifest,
    });
  for (const [relativePath, content] of Object.entries(capabilityOutputs)) {
    const outputPath = join(plan.target, relativePath);
    const previousContent = fileSystem.readFile(outputPath);
    if (previousContent !== content)
      writes.push({
        path: outputPath,
        content,
        expectedSha256:
          previousContent === undefined ? undefined : sha256(previousContent),
        previousContent,
      });
  }
  for (const capability of plan.capabilities) {
    const artifact = verifiedArtifacts?.get(capability.id);
    if (!artifact) continue;
    const relativePath = artifactPath(capability, verifiedArtifacts);
    if (!relativePath) continue;
    const path = join(plan.target, relativePath);
    if (fileSystem.exists(path))
      throw new Error(`Verified artifact path is already occupied: ${path}.`);
    writes.push({ path, content: '', bytes: artifact.bytes });
  }
  return { writes, manifest, mirror };
}

export function applyOwnedWrites(
  preview: MetadataPreview,
  fileSystem: MetadataFileSystem,
): void {
  if (preview.writes.length > MAX_COMPENSATION_WRITES)
    throw new Error('Owned write set exceeds the bounded rollback limit.');
  const applied: OwnedWrite[] = [];
  try {
    for (const write of preview.writes) {
      // Re-read immediately before every mutation. Earlier preflight checks
      // cannot protect a later file from a concurrent mutation.
      const current = fileSystem.readFile(write.path);
      if (write.expectedSha256 !== undefined) {
        if (current === undefined)
          throw new Error(`Owned file deleted before write: ${write.path}.`);
        if (sha256(current) !== write.expectedSha256)
          throw new Error(`Owned file changed before write: ${write.path}.`);
      }
      if (write.expectedSha256 === undefined && current !== undefined)
        throw new Error(`Owned file appeared before write: ${write.path}.`);
      fileSystem.mkdir(dirname(write.path));
      if (write.bytes) {
        if (!fileSystem.writeBytes)
          throw new Error(
            `Binary metadata writes are unavailable: ${write.path}.`,
          );
        fileSystem.writeBytes(write.path, write.bytes);
      } else fileSystem.writeFile(write.path, write.content);
      applied.push(write);
    }
  } catch (error) {
    const leftovers: string[] = [];
    for (const write of applied.reverse()) {
      try {
        if (write.bytes) {
          const removal = removeOwnedBytes(fileSystem, write.path, write.bytes);
          if (!removal.success)
            leftovers.push(removal.residualPath ?? write.path);
        } else if (write.previousContent === undefined) {
          fileSystem.removeFile(write.path);
        } else if (
          sha256(fileSystem.readFile(write.path) ?? '') ===
          sha256(write.content)
        )
          fileSystem.writeFile(write.path, write.previousContent);
        else leftovers.push(write.path);
      } catch {
        leftovers.push(write.path);
      }
    }
    const detail =
      leftovers.length > 0
        ? ` Leftovers: ${leftovers.join(', ')}. Recovery: restore them from the recorded previous content.`
        : ' Rollback completed.';
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} Rollback:${detail}`,
    );
  }
}

export function rollbackOwnedWrites(
  preview: MetadataPreview,
  fileSystem: MetadataFileSystem,
): { leftovers: string[] } {
  const leftovers: string[] = [];
  for (const write of preview.writes.slice().reverse()) {
    try {
      const current = fileSystem.readFile(write.path);
      if (write.bytes) {
        const removal = removeOwnedBytes(fileSystem, write.path, write.bytes);
        if (!removal.success)
          leftovers.push(removal.residualPath ?? write.path);
      } else if (sha256(current ?? '') !== sha256(write.content)) {
        leftovers.push(write.path);
      } else if (write.previousContent === undefined) {
        fileSystem.removeFile(write.path);
      } else {
        fileSystem.writeFile(write.path, write.previousContent);
      }
    } catch {
      leftovers.push(write.path);
    }
  }
  return { leftovers };
}

function removeOwnedBytes(
  fileSystem: MetadataFileSystem,
  path: string,
  expectedBytes: Uint8Array,
): { success: boolean; residualPath?: string } {
  if (!fileSystem.renameFile) return { success: false };
  const quarantinePath = `${path}.nest-base-rollback-${randomUUID()}`;
  let quarantined = false;
  try {
    fileSystem.renameFile(path, quarantinePath);
    quarantined = true;
    const quarantinedBytes = fileSystem.readBytes?.(quarantinePath);
    if (
      quarantinedBytes &&
      sha256Bytes(quarantinedBytes) === sha256Bytes(expectedBytes)
    ) {
      fileSystem.removeFile(quarantinePath);
      return { success: true };
    }
  } catch {
    // Recover the quarantine below before reporting the failed rollback.
  }
  if (!quarantined) return { success: false };

  try {
    if (fileSystem.exists(path))
      return { success: false, residualPath: quarantinePath };
  } catch {
    return { success: false, residualPath: quarantinePath };
  }
  try {
    if (!fileSystem.renameFileIfAbsent)
      return { success: false, residualPath: quarantinePath };
    fileSystem.renameFileIfAbsent(quarantinePath, path);
    return { success: false };
  } catch {
    try {
      if (!fileSystem.exists(quarantinePath)) return { success: false };
    } catch {
      // Keep the quarantine path in diagnostics when its state is unknowable.
    }
    return { success: false, residualPath: quarantinePath };
  }
}

function readJson(content: string | undefined, path: string): JsonObject {
  if (!content) throw new Error(`Owned metadata file ${path} is missing.`);
  try {
    const value: unknown = JSON.parse(content);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error();
    return value as JsonObject;
  } catch {
    throw new Error(`Owned metadata file ${path} is invalid.`);
  }
}

function validateExistingMirror(value: unknown): void {
  if (value === undefined) return;
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Metadata mirror is invalid.');
  const keys = Object.keys(value);
  if (keys.some((key) => !MIRROR_KEYS.includes(key)))
    throw new Error('Metadata mirror contains unknown fields.');
  if (keys.length !== MIRROR_KEYS.length)
    throw new Error('Metadata mirror is incomplete.');
}

function validateManifest(value: JsonObject): void {
  const keys = [
    'schemaVersion',
    'wizardVersion',
    'target',
    'registryRevision',
    'resolvedEntries',
    'dependencySections',
    'ownedPaths',
    'hashes',
    'hashRule',
  ];
  if (Object.keys(value).some((key) => !keys.includes(key)))
    throw new Error('Manifest contains unknown fields.');
  if (
    value.schemaVersion !== 1 ||
    !Array.isArray(value.resolvedEntries) ||
    !value.hashes ||
    value.hashRule !== MANIFEST_HASH_RULE ||
    !Array.isArray(value.ownedPaths) ||
    !isRecord(value.hashes) ||
    Object.keys(value.hashes).sort().join('|') !==
      (value.ownedPaths as string[]).slice().sort().join('|')
  )
    throw new Error('Manifest schema is invalid.');
}

function readSection(value: unknown, section: string): Record<string, string> {
  if (value === undefined) return {};
  if (!isRecord(value))
    throw new Error(`Dependency section ${section} is invalid.`);
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string')
      throw new Error(`Dependency section ${section} is invalid.`);
    result[key] = entry;
  }
  return result;
}

function validateCapabilityOwnedOutputs(
  manifest: JsonObject,
  plan: NormalizedPlan,
  fileSystem: MetadataFileSystem,
): void {
  const hashes = manifest.hashes as Record<string, string>;
  for (const capability of plan.capabilities) {
    for (const relativePath of getCapability(capability.id).ownedPaths) {
      if (
        relativePath === MANIFEST_PATH ||
        relativePath === 'package.json.nestBase'
      )
        continue;
      const path = join(plan.target, relativePath);
      const current = fileSystem.readFile(path);
      if (current === undefined)
        throw new Error(`Capability-owned file deleted: ${path}.`);
      if (sha256(current) !== hashes[relativePath])
        throw new Error(`Capability-owned file changed: ${path}.`);
    }
  }
}

function packageBeforeContent(
  fileSystem: MetadataFileSystem,
  packagePath: string,
): string {
  const content = fileSystem.readFile(packagePath);
  if (content === undefined)
    throw new Error(`Owned metadata file package.json is missing.`);
  return content;
}

function isRecord(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function dependencySpec(
  capability: ResolvedCapability,
  verifiedPath?: string,
): string {
  if (verifiedPath) return verifiedPath;
  return capability.source.kind === 'registry'
    ? capability.version
    : capability.source.spec;
}

function artifactPath(
  capability: ResolvedCapability,
  verifiedArtifacts?: VerifiedArtifacts,
): string | undefined {
  const artifact = verifiedArtifacts?.get(capability.id);
  if (!artifact || capability.source.kind === 'registry') return undefined;
  return `.nest-base/artifacts/${capability.id}-${sha256Bytes(artifact.bytes)}.tgz`;
}

function isPinnedArtifactSpec(
  spec: string | undefined,
  capabilityId: string,
): spec is string {
  return (
    spec !== undefined &&
    new RegExp(
      `^\\.nest-base/artifacts/${capabilityId}-[a-f0-9]{64}\\.tgz$`,
    ).test(spec)
  );
}

function sha256Bytes(value: Uint8Array | undefined): string {
  return createHash('sha256')
    .update(value ?? new Uint8Array())
    .digest('hex');
}
