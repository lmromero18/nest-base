import { createHash } from 'node:crypto';
import type { ArtifactRecord } from './artifact-gate.js';
import type {
  IndependentConsumerGate,
  PackedArtifactIdentity,
} from './artifact-gate.js';
import { assertSha512Integrity } from './artifact-gate.js';
import type { HttpCoreReleaseEvidence } from './types.js';
import {
  DEFAULT_CORE_INTEGRITY,
  DEFAULT_CORE_TARBALL,
  DEFAULT_CORE_VERSION,
} from './registry-constants.js';

export type RegistryFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface ReleaseEvidenceDependencies {
  fetcher: RegistryFetch;
  consumerGate: IndependentConsumerGate;
  inspect: (artifact: ArtifactRecord) => PackedArtifactIdentity;
}

export async function createHttpCoreReleaseEvidenceWithDependencies(
  input: { coreArtifact: ArtifactRecord },
  dependencies: ReleaseEvidenceDependencies,
): Promise<HttpCoreReleaseEvidence> {
  const release = await fetchCanonicalPackageRelease(
    dependencies.fetcher,
    '@nest-base/http-core',
    '0.1.0',
  );
  const coreRelease = await fetchCanonicalPackageRelease(
    dependencies.fetcher,
    '@nest-base/core',
    DEFAULT_CORE_VERSION,
  );
  const identity = dependencies.inspect(release.artifact);
  if (
    identity.package !== '@nest-base/http-core' ||
    identity.version !== '0.1.0'
  )
    throw new Error('HTTP-core release artifact identity mismatch.');
  auditHttpCoreReleaseArtifact(release.artifact, identity);
  const coreIdentity = dependencies.inspect(input.coreArtifact);
  if (
    coreIdentity.package !== '@nest-base/core' ||
    coreIdentity.version !== DEFAULT_CORE_VERSION
  )
    throw new Error('HTTP-core release core dependency identity mismatch.');
  if (coreRelease.integrity !== DEFAULT_CORE_INTEGRITY)
    throw new Error(
      'Supplied core artifact integrity/provenance is not canonical.',
    );
  if (digestArtifact(input.coreArtifact) !== DEFAULT_CORE_INTEGRITY)
    throw new Error(
      'Supplied core artifact integrity/provenance is not canonical.',
    );
  if (!bytesEqual(coreRelease.artifact.bytes, input.coreArtifact.bytes))
    throw new Error('Supplied core artifact bytes are not canonical.');
  await dependencies.consumerGate.verify(
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
    core: {
      package: '@nest-base/core' as const,
      version: DEFAULT_CORE_VERSION as '0.1.0',
      integrity: DEFAULT_CORE_INTEGRITY,
      tarball: DEFAULT_CORE_TARBALL,
    },
  };
  const evidence = {
    ...payload,
    evidenceDigest: digestEvidence(payload),
  } satisfies HttpCoreReleaseEvidence;
  return deepFreeze(evidence);
}

async function fetchCanonicalPackageRelease(
  fetcher: RegistryFetch,
  packageName: string,
  version: string,
): Promise<{
  artifact: ArtifactRecord;
  tarball: string;
  integrity: `sha512-${string}`;
}> {
  const encodedPackage = encodeURIComponent(packageName);
  const metadataResponse = await fetcher(
    `https://registry.npmjs.org/${encodedPackage}`,
    { redirect: 'manual' },
  );
  if (!metadataResponse.ok || isRedirect(metadataResponse))
    throw new Error('HTTP-core registry release metadata is unavailable.');
  const metadata: unknown = await metadataResponse.json();
  const versionMetadata = readVersionMetadata(metadata, packageName, version);
  if (!versionMetadata || !versionMetadata.integrity)
    throw new Error(`${packageName} registry release metadata is incomplete.`);
  const tarballName = packageName.slice(packageName.lastIndexOf('/') + 1);
  const canonicalTarball =
    `https://registry.npmjs.org/${packageName}/-/` +
    `${tarballName}-${version}.tgz`;
  if (versionMetadata.tarball !== canonicalTarball)
    throw new Error(`${packageName} registry release URL is not canonical.`);
  assertSha512Integrity(versionMetadata.integrity);
  const tarballResponse = await fetcher(canonicalTarball, {
    redirect: 'manual',
  });
  if (!tarballResponse.ok || isRedirect(tarballResponse))
    throw new Error(`${packageName} registry release tarball is unavailable.`);
  const bytes = new Uint8Array(await tarballResponse.arrayBuffer());
  const actual = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  if (actual !== versionMetadata.integrity)
    throw new Error(`${packageName} release tarball digest mismatch.`);
  return { artifact: { bytes }, tarball: canonicalTarball, integrity: actual };
}

function digestArtifact(artifact: ArtifactRecord): `sha512-${string}` {
  return `sha512-${createHash('sha512').update(artifact.bytes).digest('base64')}`;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.length === right.length &&
    left.every((byte, index) => byte === right[index])
  );
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

function digestEvidence(payload: unknown): `sha256-${string}` {
  return `sha256-${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}`;
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
  const distRecord = dist as Record<string, unknown>;
  const tarball = distRecord.tarball;
  const integrity = distRecord.integrity;
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
