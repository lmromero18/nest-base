import { PACKAGE_MANAGERS, type PackageManager } from './types.js';

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

export interface ReleaseGateInput {
  corePackedConsumer: boolean;
  httpCorePackedConsumer: boolean;
  releaseAuthentication: boolean;
}

export interface ReleaseGateSummary {
  managerAvailability: boolean;
  packedWizardMatrix: boolean;
  releaseAuthentication: boolean;
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
  evidence: Partial<Record<PackageManager, ManagerAcceptanceEvidence>>,
): ManagerAcceptanceSummary {
  const blockers = PACKAGE_MANAGERS.flatMap((manager) => {
    const result = evidence[manager];
    if (!result) return [`${manager}: result record missing`];
    if (result.status === 'passed') return [];
    return [`${manager}: ${result.reason || result.status}`];
  });
  const passed = blockers.length === 0;
  return {
    matrixPassed: passed,
    releaseEvidence: passed,
    publicationAllowed: passed,
    blockers,
  };
}

export function evaluateReleaseGate(
  managerAcceptance: Partial<Record<PackageManager, ManagerAcceptanceEvidence>>,
  evidence: ReleaseGateInput,
): ReleaseGateSummary {
  const managerSummary = evaluateManagerAcceptance(managerAcceptance);
  const blockers = [...managerSummary.blockers];
  if (!evidence.corePackedConsumer)
    blockers.push('core packed consumer evidence incomplete');
  if (!evidence.httpCorePackedConsumer)
    blockers.push('http-core packed consumer evidence incomplete');
  if (!evidence.releaseAuthentication)
    blockers.push('release authentication incomplete');

  const managerAvailability = managerSummary.publicationAllowed;
  const packedWizardMatrix =
    managerSummary.matrixPassed &&
    evidence.corePackedConsumer &&
    evidence.httpCorePackedConsumer;
  const publicationAllowed =
    packedWizardMatrix && evidence.releaseAuthentication;

  return {
    managerAvailability,
    packedWizardMatrix,
    releaseAuthentication: evidence.releaseAuthentication,
    publicationAllowed,
    blockers,
  };
}
