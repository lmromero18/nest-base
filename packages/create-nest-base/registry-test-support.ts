import {
  createHttpCoreReleaseEvidenceWithDependencies,
  type RegistryFetch,
} from './registry-internal.js';
import { inspectPackedArtifact } from './registry.js';
import type {
  IndependentConsumerGate,
  PackedArtifactIdentity,
} from './artifact-gate.js';
import type { ArtifactRecord } from './artifact-gate.js';
import type { HttpCoreReleaseEvidence } from './types.js';

export interface HttpCoreReleaseEvidenceTestInput {
  coreArtifact: ArtifactRecord;
  registry: RegistryFetch;
  independentConsumerGate: IndependentConsumerGate;
  inspect?: (artifact: ArtifactRecord) => PackedArtifactIdentity;
}

export function createHttpCoreReleaseEvidenceForTest(
  input: HttpCoreReleaseEvidenceTestInput,
): Promise<HttpCoreReleaseEvidence> {
  return createHttpCoreReleaseEvidenceWithDependencies(input, {
    fetcher: input.registry,
    consumerGate: input.independentConsumerGate,
    inspect: input.inspect ?? inspectPackedArtifact,
  });
}
