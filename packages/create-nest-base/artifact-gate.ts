import { createHash } from 'node:crypto';

export interface ArtifactSpec {
  kind: 'registry' | 'file' | 'url';
  spec: string;
  package: string;
  version: string;
  integrity: string;
}

export interface ArtifactRecord {
  bytes: Uint8Array;
  redirected?: boolean;
}

export interface PackedArtifactIdentity {
  package: string;
  version: string;
}

export interface IndependentConsumerGate {
  verify(
    artifact: ArtifactRecord,
    identity: PackedArtifactIdentity,
    capabilityId?: string,
    dependencies?: ReadonlyMap<string, ArtifactRecord>,
  ): Promise<void>;
}

export interface ArtifactLoaders {
  registry?: (spec: string) => Promise<ArtifactRecord | undefined>;
  file?: (spec: string) => Promise<ArtifactRecord | undefined>;
  url?: (spec: string) => Promise<ArtifactRecord | undefined>;
  inspect?: (artifact: ArtifactRecord) => PackedArtifactIdentity;
}

export async function resolveArtifact(
  expected: ArtifactSpec,
  loaders: ArtifactLoaders,
  independentConsumerGate?: IndependentConsumerGate,
  capabilityId = expected.package === '@nest-base/core'
    ? 'core-crud'
    : expected.package,
  verifiedArtifacts?: ReadonlyMap<string, ArtifactRecord>,
): Promise<ArtifactRecord> {
  assertSha512Integrity(expected.integrity);
  assertSourceIdentity(expected);
  const record = await loaders[expected.kind]?.(expected.spec);
  if (!record)
    throw new Error(`Artifact is unavailable for ${expected.package}.`);
  if (record.redirected)
    throw new Error('Artifact URL redirects are not allowed.');
  const identity = loaders.inspect?.(record);
  if (!identity)
    throw new Error(
      `A packed ${expected.package} artifact inspector is unavailable.`,
    );
  if (
    identity.package !== expected.package ||
    identity.version !== expected.version
  ) {
    throw new Error('Artifact identity or version mismatch.');
  }
  const actual = `sha512-${createHash('sha512').update(record.bytes).digest('base64')}`;
  if (actual !== expected.integrity)
    throw new Error('Artifact integrity mismatch.');
  if (capabilityId === 'core-crud' || capabilityId === 'http-core')
    await requireIndependentConsumerGate(
      independentConsumerGate,
      record,
      identity,
      capabilityId,
      verifiedArtifacts,
    );
  return record;
}

export async function requireIndependentConsumerGate(
  gate: IndependentConsumerGate | undefined,
  artifact?: ArtifactRecord,
  identity?: PackedArtifactIdentity,
  capabilityId?: string,
  dependencies?: ReadonlyMap<string, ArtifactRecord>,
): Promise<void> {
  if (!gate)
    throw new Error(
      'The genuine independent consumer compile/run gate is unavailable; refusing to continue.',
    );
  if (!artifact || !identity)
    throw new Error(
      'The independent consumer gate requires a packed artifact.',
    );
  await gate.verify(artifact, identity, capabilityId, dependencies);
}

export function assertSha512Integrity(
  integrity: string,
): asserts integrity is `sha512-${string}` {
  const encoded = integrity.startsWith('sha512-') ? integrity.slice(7) : '';
  if (
    !/^sha512-(?:[A-Za-z0-9+/]{86}==|[A-Za-z0-9+/]{87}=)$/.test(integrity) ||
    integrity === 'sha512-pending' ||
    Buffer.from(encoded, 'base64').length !== 64 ||
    Buffer.from(encoded, 'base64').toString('base64') !== encoded
  ) {
    throw new Error('Artifact requires a verified sha512 integrity.');
  }
}

function assertSourceIdentity(expected: ArtifactSpec): void {
  if (expected.kind === 'registry') {
    const expectedSpec = `${expected.package}@${expected.version}`;
    if (expected.spec !== expectedSpec)
      throw new Error('Registry artifact identity mismatch.');
  }
  if (expected.kind === 'url' && !/^https?:\/\/[^\s]+$/.test(expected.spec)) {
    throw new Error('Artifact URL is invalid.');
  }
}
