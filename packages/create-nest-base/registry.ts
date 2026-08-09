import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import type {
  CapabilityDescriptor,
  ResolvedCapability,
  Source,
  SourceKind,
  HttpCoreReleaseEvidence,
} from './types.js';
import type { ArtifactLoaders, ArtifactRecord } from './artifact-gate.js';
import type {
  IndependentConsumerGate,
  PackedArtifactIdentity,
} from './artifact-gate.js';
import { assertSha512Integrity } from './artifact-gate.js';

export const REGISTRY_REVISION = '2026-07-27';
export const DEFAULT_WIZARD_VERSION = '0.1.0';
const DEFAULT_CORE_VERSION = '0.1.0';
const DEFAULT_LOGGER_VERSION = '1.0.0';
export const DEFAULT_CORE_INTEGRITY =
  'sha512-wjDf/s0C9qVaXHhtwJV38Dr9rZuxLWFxuqT1gPgK5WJ33zJw2TEixpV22EcPn1iY8YI3ErgGOzktv8ywtqty/g==';
export interface HttpCoreReleaseEvidenceInput {
  /** A source of registry metadata and the canonical release tarball. */
  registry?: RegistryFetch;
  /** The packed core artifact that the independent HTTP-core consumer must use. */
  coreArtifact: ArtifactRecord;
  /** The real independent consumer gate; claims are never accepted as evidence. */
  independentConsumerGate: IndependentConsumerGate;
  inspect?: (artifact: ArtifactRecord) => PackedArtifactIdentity;
}

export async function createHttpCoreReleaseEvidence(
  input: HttpCoreReleaseEvidenceInput,
): Promise<HttpCoreReleaseEvidence> {
  const release = await fetchCanonicalHttpCoreRelease(input.registry ?? fetch);
  const inspect = input.inspect ?? inspectPackedArtifact;
  const identity = inspect(release.artifact);
  if (
    identity.package !== '@nest-base/http-core' ||
    identity.version !== '0.1.0'
  )
    throw new Error('HTTP-core release artifact identity mismatch.');
  auditHttpCoreReleaseArtifact(release.artifact, identity);
  const coreIdentity = inspect(input.coreArtifact);
  if (
    coreIdentity.package !== '@nest-base/core' ||
    coreIdentity.version !== '0.1.0'
  )
    throw new Error('HTTP-core release core dependency identity mismatch.');
  await input.independentConsumerGate.verify(
    release.artifact,
    identity,
    'http-core',
    new Map([['core-crud', input.coreArtifact]]),
  );
  const artifactDigest = release.integrity;
  const payload = {
    schema: 'http-core-release-evidence/v1' as const,
    package: '@nest-base/http-core' as const,
    version: '0.1.0',
    integrity: release.integrity,
    published: {
      package: '@nest-base/http-core' as const,
      version: '0.1.0',
      integrity: release.integrity,
      tarball: release.tarball,
    },
    artifactDigest,
    audit: {
      tool: 'http-core-tarball-audit' as const,
      package: '@nest-base/http-core' as const,
      version: '0.1.0',
      artifactDigest,
      status: 'passed' as const,
    },
    consumer: {
      tool: 'http-core-independent-consumer' as const,
      package: '@nest-base/http-core' as const,
      version: '0.1.0',
      artifactDigest,
      status: 'passed' as const,
      modes: ['esm', 'cjs'] as const,
    },
  };
  const evidence = {
    ...payload,
    evidenceDigest: digestEvidence(payload),
  } satisfies HttpCoreReleaseEvidence;
  boundEvidence.add(evidence);
  return deepFreeze(evidence);
}

const boundEvidence = new WeakSet<object>();

async function fetchCanonicalHttpCoreRelease(fetcher: RegistryFetch): Promise<{
  artifact: ArtifactRecord;
  tarball: string;
  integrity: `sha512-${string}`;
}> {
  const metadataResponse = await fetcher(
    'https://registry.npmjs.org/%40nest-base%2Fhttp-core',
    { redirect: 'manual' },
  );
  if (!metadataResponse.ok || isRedirect(metadataResponse))
    throw new Error('HTTP-core registry release metadata is unavailable.');
  const metadata: unknown = await metadataResponse.json();
  const versionMetadata = readVersionMetadata(
    metadata,
    '@nest-base/http-core',
    '0.1.0',
  );
  if (!versionMetadata || !versionMetadata.integrity)
    throw new Error('HTTP-core registry release metadata is incomplete.');
  const canonicalTarball =
    'https://registry.npmjs.org/@nest-base/http-core/-/http-core-0.1.0.tgz';
  if (versionMetadata.tarball !== canonicalTarball)
    throw new Error('HTTP-core registry release URL is not canonical.');
  assertSha512Integrity(versionMetadata.integrity);
  const tarballResponse = await fetcher(canonicalTarball, {
    redirect: 'manual',
  });
  if (!tarballResponse.ok || isRedirect(tarballResponse))
    throw new Error('HTTP-core registry release tarball is unavailable.');
  const bytes = new Uint8Array(await tarballResponse.arrayBuffer());
  const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (actual !== versionMetadata.integrity)
    throw new Error('HTTP-core release tarball digest mismatch.');
  return {
    artifact: { bytes },
    tarball: canonicalTarball,
    integrity: actual,
  };
}

function auditHttpCoreReleaseArtifact(
  artifact: ArtifactRecord,
  identity: PackedArtifactIdentity,
): void {
  try {
    const tar = Bun.gunzipSync(new Uint8Array(artifact.bytes).buffer);
    if (tar.byteLength < 1024) throw new Error('archive is incomplete');
    if (identity.package !== '@nest-base/http-core')
      throw new Error('package identity is invalid');
  } catch {
    throw new Error('HTTP-core release tarball audit failed.');
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const nested of Object.values(value as Record<string, unknown>))
      deepFreeze(nested);
  }
  return value;
}

export function bindHttpCoreReleaseEvidence(
  evidence: HttpCoreReleaseEvidence,
): HttpCoreReleaseEvidence {
  if (!boundEvidence.has(evidence))
    throw new Error('HTTP-core release evidence is not independently bound.');
  assertSha512Integrity(evidence.integrity);
  assertSha512Integrity(evidence.published.integrity);
  assertSha512Integrity(evidence.artifactDigest);
  if (
    evidence.schema !== 'http-core-release-evidence/v1' ||
    evidence.package !== evidence.published.package ||
    evidence.version !== evidence.published.version ||
    evidence.integrity !== evidence.published.integrity ||
    evidence.integrity !== evidence.artifactDigest ||
    evidence.published.package !== '@nest-base/http-core' ||
    !/^https:\/\/registry\.npmjs\.org\/@nest-base\/http-core\/-\/http-core-[^/]+\.tgz$/.test(
      evidence.published.tarball,
    )
  )
    throw new Error('HTTP-core release evidence identity mismatch.');
  if (
    evidence.audit.tool !== 'http-core-tarball-audit' ||
    evidence.audit.status !== 'passed' ||
    evidence.audit.package !== evidence.package ||
    evidence.audit.version !== evidence.version ||
    evidence.audit.artifactDigest !== evidence.artifactDigest ||
    evidence.consumer.tool !== 'http-core-independent-consumer' ||
    evidence.consumer.status !== 'passed' ||
    evidence.consumer.package !== evidence.package ||
    evidence.consumer.version !== evidence.version ||
    evidence.consumer.artifactDigest !== evidence.artifactDigest ||
    evidence.consumer.modes.join(',') !== 'esm,cjs' ||
    evidence.consumer.modes.length !== 2
  )
    throw new Error(
      'HTTP-core release evidence audit/consumer proof is incomplete.',
    );
  if (evidence.evidenceDigest !== digestEvidence(stripDigest(evidence)))
    throw new Error('HTTP-core release evidence digest mismatch.');
  return evidence;
}

export function assertHttpCoreReleaseEvidence(
  evidence: HttpCoreReleaseEvidence,
): HttpCoreReleaseEvidence {
  return bindHttpCoreReleaseEvidence(evidence);
}

function stripDigest(evidence: HttpCoreReleaseEvidence) {
  return Object.fromEntries(
    Object.entries(evidence).filter(([key]) => key !== 'evidenceDigest'),
  );
}

function digestEvidence(payload: unknown): `sha256-${string}` {
  return `sha256-${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
}

export type RegistryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createRegistryArtifactLoader(
  fetcher: RegistryFetch = fetch,
): NonNullable<ArtifactLoaders['registry']> {
  return async (spec): Promise<ArtifactRecord | undefined> => {
    const separator = spec.lastIndexOf('@');
    if (separator <= 0 || separator === spec.length - 1) return undefined;
    const packageName = spec.slice(0, separator);
    const version = spec.slice(separator + 1);
    const metadataResponse = await fetcher(
      `https://registry.npmjs.org/${encodeURIComponent(packageName)}`,
      { redirect: 'manual' },
    );
    if (isRedirect(metadataResponse))
      return { bytes: new Uint8Array(), redirected: true };
    if (!metadataResponse.ok) return undefined;

    const metadata: unknown = await metadataResponse.json();
    const versionMetadata = readVersionMetadata(metadata, packageName, version);
    if (!versionMetadata) return undefined;
    const tarballResponse = await fetcher(versionMetadata.tarball, {
      redirect: 'manual',
    });
    if (isRedirect(tarballResponse))
      return { bytes: new Uint8Array(), redirected: true };
    if (!tarballResponse.ok) return undefined;
    return { bytes: new Uint8Array(await tarballResponse.arrayBuffer()) };
  };
}

export function inspectPackedArtifact(artifact: ArtifactRecord): {
  package: string;
  version: string;
} {
  const tar = Bun.gunzipSync(new Uint8Array(artifact.bytes).buffer);
  const packageJson = readTarPackageJson(tar);
  if (
    packageJson === undefined ||
    typeof packageJson.name !== 'string' ||
    typeof packageJson.version !== 'string'
  )
    throw new Error('Packed artifact package identity is unavailable.');
  return { package: packageJson.name, version: packageJson.version };
}

function readTarPackageJson(
  tar: Uint8Array,
): Record<string, unknown> | undefined {
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = readTarString(tar, offset, 100);
    if (!name) return undefined;
    const size = Number.parseInt(readTarString(tar, offset + 124, 12), 8);
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      offset + 512 + size > tar.length
    )
      return undefined;
    if (name === 'package/package.json') {
      try {
        const content = new TextDecoder().decode(
          tar.slice(offset + 512, offset + 512 + size),
        );
        const parsed: unknown = JSON.parse(content);
        return parsed !== null && typeof parsed === 'object'
          ? (parsed as Record<string, unknown>)
          : undefined;
      } catch {
        return undefined;
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return undefined;
}

function readTarString(
  bytes: Uint8Array,
  offset: number,
  length: number,
): string {
  return new TextDecoder()
    .decode(bytes.slice(offset, offset + length))
    .replace(/\0.*$/, '')
    .trim();
}

function readVersionMetadata(
  metadata: unknown,
  packageName: string,
  version: string,
): { tarball: string; integrity?: string } | undefined {
  if (metadata === null || typeof metadata !== 'object') return undefined;
  const record = metadata as Record<string, unknown>;
  const versions = record.versions;
  if (versions === null || typeof versions !== 'object') return undefined;
  const entry = (versions as Record<string, unknown>)[version];
  if (entry === null || typeof entry !== 'object') return undefined;
  const versionRecord = entry as Record<string, unknown>;
  if (versionRecord.name !== packageName || versionRecord.version !== version)
    return undefined;
  const dist = versionRecord.dist;
  if (dist === null || typeof dist !== 'object') return undefined;
  const tarball = (dist as Record<string, unknown>).tarball;
  const integrity = (dist as Record<string, unknown>).integrity;
  return typeof tarball === 'string' && /^https?:\/\/[^\s]+$/.test(tarball)
    ? {
        tarball,
        integrity: typeof integrity === 'string' ? integrity : undefined,
      }
    : undefined;
}

function isRedirect(response: Response): boolean {
  return (
    response.redirected || (response.status >= 300 && response.status < 400)
  );
}

const futureReason =
  'Reserved for a later integration slice; no installable artifact or compatibility gate exists yet.';

export const CAPABILITY_REGISTRY: readonly CapabilityDescriptor[] = [
  {
    id: 'core-crud',
    description: 'The mandatory Nest Base CRUD foundation.',
    status: 'available',
    requiredness: 'locked',
    recommended: false,
    defaultSelectedInteractive: true,
    package: '@nest-base/core',
    defaultVersion: DEFAULT_CORE_VERSION,
    defaultSource: { kind: 'registry', spec: '@nest-base/core@0.1.0' },
    defaultIntegrity: DEFAULT_CORE_INTEGRITY,
    dependencySection: 'dependencies',
    compatibility: 'NestJS 11 and Bun 1.3.14 or newer.',
    conflicts: [
      'Cannot be deselected.',
      'Cannot be replaced by a future profile.',
    ],
    ownedPaths: ['.nest-base/manifest.json', 'package.json.nestBase'],
    manualSteps: [
      'Review the generated CRUD package after the artifact gate passes.',
    ],
  },
  {
    id: 'logger',
    description:
      'Structured logging integration for the generated application.',
    status: 'available',
    requiredness: 'optional',
    recommended: false,
    defaultSelectedInteractive: false,
    package: '@nest-base/logger',
    defaultVersion: DEFAULT_LOGGER_VERSION,
    defaultSource: { kind: 'registry', spec: '@nest-base/logger@1.0.0' },
    dependencySection: 'dependencies',
    compatibility: 'NestJS 11 and Bun 1.3.14 or newer.',
    conflicts: ['Cannot overwrite an existing logger configuration.'],
    ownedPaths: ['.nest-base/logger.json'],
    manualSteps: [
      'Review logger configuration and connect it to the application logger.',
    ],
  },
  {
    id: 'http-core',
    description: 'HTTP controller and response helpers for Nest applications.',
    status: 'available',
    requiredness: 'optional',
    recommended: true,
    defaultSelectedInteractive: true,
    package: '@nest-base/http-core',
    defaultVersion: '0.1.0',
    defaultSource: {
      kind: 'registry',
      spec: '@nest-base/http-core@0.1.0',
    },
    dependencySection: 'dependencies',
    compatibility: 'NestJS 11, @nest-base/core 0.1.x, and Bun 1.3.14 or newer.',
    conflicts: ['Cannot be selected without an exact verified artifact.'],
    ownedPaths: ['.nest-base/http-core.json'],
    manualSteps: ['Review the generated HTTP controller integration.'],
  },
  ...(
    ['websocket', 'events', 'kafka', 'pubsub', 'queues', 'generator'] as const
  ).map((id): CapabilityDescriptor => ({
    id,
    description: `Future ${id} capability (shown for roadmap visibility).`,
    status: 'unavailable',
    unavailableReason: futureReason,
    requiredness: 'future',
    package: `@nest-base/${id}`,
    defaultVersion: '0.0.0',
    defaultSource: { kind: 'registry', spec: `@nest-base/${id}@0.0.0` },
    recommended: false,
    defaultSelectedInteractive: false,
    dependencySection: 'dependencies',
    compatibility: 'Compatibility matrix is not published for this capability.',
    conflicts: ['Selection is rejected until the capability is promoted.'],
    ownedPaths: [`.nest-base/${id}.json`],
    manualSteps: ['Wait for a future wizard release and its artifact gate.'],
  })),
];

const registryById = new Map(
  CAPABILITY_REGISTRY.map((entry) => [entry.id, entry]),
);

export function getCapability(id: string): CapabilityDescriptor {
  const entry = registryById.get(id);
  if (!entry) {
    throw new Error(`Unknown capability "${id}".`);
  }
  return entry;
}

export function resolveCapabilities(
  selected: readonly string[],
): CapabilityDescriptor[] {
  const requested = selected.length > 0 ? [...selected] : ['core-crud'];
  if (!requested.includes('core-crud')) requested.unshift('core-crud');

  const unique = [...new Set(requested)];
  return unique.map((id) => {
    const entry = getCapability(id);
    if (entry.status === 'unavailable') {
      throw new Error(
        `Capability "${id}" is unavailable: ${entry.unavailableReason}`,
      );
    }
    return entry;
  });
}

export function resolveSource(kind: SourceKind, spec: string): Source {
  const trimmed = spec.trim();
  if (!trimmed) throw new Error('A non-empty source spec is required.');
  if (kind === 'file') {
    return { kind, spec: isAbsolute(trimmed) ? trimmed : resolve(trimmed) };
  }
  if (kind === 'url' && !/^https?:\/\//.test(trimmed)) {
    throw new Error('URL sources must use http:// or https://.');
  }
  return { kind, spec: trimmed };
}

export function inferSource(spec: string): Source {
  if (/^https?:\/\//.test(spec)) return resolveSource('url', spec);
  if (
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    /^[A-Za-z]:[\\/]/.test(spec)
  ) {
    return resolveSource('file', spec);
  }
  return resolveSource('registry', spec);
}

export function makeResolvedCapability(
  descriptor: CapabilityDescriptor,
  version: string,
  source: Source,
  integrity = 'sha512-pending',
): ResolvedCapability {
  if (!version.trim()) throw new Error(`${descriptor.id} version is required.`);
  return {
    id: descriptor.id,
    status: 'enabled',
    package: descriptor.package,
    version: version.trim(),
    source,
    integrity: integrity as `sha512-${string}`,
    ...(descriptor.id === 'generator' ? { model: 'table-crud' as const } : {}),
  };
}
