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
): Promise<ArtifactRecord> {
  assertIntegrity(expected.integrity);
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
  if (expected.package === '@nest-base/core')
    await requireIndependentConsumerGate(
      independentConsumerGate,
      record,
      identity,
    );
  return record;
}

export async function requireIndependentConsumerGate(
  gate: IndependentConsumerGate | undefined,
  artifact?: ArtifactRecord,
  identity?: PackedArtifactIdentity,
): Promise<void> {
  if (!gate)
    throw new Error(
      'The genuine independent consumer compile/run gate is unavailable; refusing to continue.',
    );
  if (!artifact || !identity)
    throw new Error(
      'The independent consumer gate requires a packed artifact.',
    );
  await gate.verify(artifact, identity);
}

function assertIntegrity(integrity: string): void {
  if (
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity) ||
    integrity === 'sha512-pending'
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
