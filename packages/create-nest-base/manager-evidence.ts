import type { PackageManager } from './types.js';

export type ManagerAcceptanceStatus =
  'unavailable' | 'environment-blocked' | 'passed' | 'failed';

export interface ManagerAcceptanceEvidence {
  status: ManagerAcceptanceStatus;
  reason?: string;
}

export interface ManagerAcceptanceSummary {
  matrixPassed: boolean;
  releaseEvidence: boolean;
  publicationAllowed: boolean;
  blockers: string[];
}

export function classifyManagerAcceptance(input: {
  available: boolean;
  exitCode: number;
  output?: string;
}): ManagerAcceptanceEvidence {
  if (!input.available)
    return { status: 'unavailable', reason: 'executable not found on PATH' };
  if (input.exitCode === 0) return { status: 'passed' };

  if (/node:sqlite/i.test(input.output ?? ''))
    return { status: 'environment-blocked', reason: 'node:sqlite unavailable' };
  return {
    status: 'failed',
    reason: input.output || 'manager execution failed',
  };
}

export function evaluateManagerAcceptance(
  evidence: Record<PackageManager, ManagerAcceptanceEvidence>,
): ManagerAcceptanceSummary {
  const entries = Object.entries(evidence) as [
    PackageManager,
    ManagerAcceptanceEvidence,
  ][];
  const blockers = entries
    .filter(([, result]) => result.status !== 'passed')
    .map(([manager, result]) =>
      result.reason
        ? `${manager}: ${result.reason}`
        : `${manager}: ${result.status}`,
    );
  return {
    matrixPassed: entries.length > 0 && blockers.length === 0,
    releaseEvidence: entries.length > 0 && blockers.length === 0,
    publicationAllowed: entries.length > 0 && blockers.length === 0,
    blockers,
  };
}
