import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  evaluateManagerAcceptance,
  type ManagerAcceptanceEvidence,
} from '../packages/create-nest-base/manager-evidence';
import type { PackageManager } from '../packages/create-nest-base/types';

export interface FreshReleaseGateInput {
  generatedAt: string;
  headCommit: string;
  releaseCommit: string;
  managerAcceptance: Partial<Record<PackageManager, ManagerAcceptanceEvidence>>;
  corePackedConsumer: boolean;
  httpCorePackedConsumer: boolean;
  promotionAudit: boolean;
  packedWizardMatrix: boolean;
  releaseAuthentication: boolean;
}

export interface FreshReleaseGateContext {
  now: string;
  headCommit: string;
  releaseCommit: string;
  maxAgeMs?: number;
}

export function evaluateFreshReleaseGate(
  input: FreshReleaseGateInput,
  context: FreshReleaseGateContext,
) {
  const managerGate = evaluateManagerAcceptance(input.managerAcceptance);
  const blockers = [...managerGate.blockers];
  const generatedTime = Date.parse(input.generatedAt);
  const currentTime = Date.parse(context.now);
  const maxAgeMs = context.maxAgeMs ?? 5 * 60_000;

  if (!Number.isFinite(generatedTime) || !Number.isFinite(currentTime))
    blockers.push('release evidence timestamp is invalid');
  else if (
    generatedTime > currentTime ||
    currentTime - generatedTime > maxAgeMs
  )
    blockers.push('release evidence is stale');
  if (input.headCommit !== context.headCommit)
    blockers.push('release evidence HEAD does not match current HEAD');
  if (input.releaseCommit !== context.releaseCommit)
    blockers.push(
      'release evidence release commit does not match requested release commit',
    );
  if (!input.corePackedConsumer)
    blockers.push('core packed consumer evidence incomplete');
  if (!input.httpCorePackedConsumer)
    blockers.push('http-core packed consumer evidence incomplete');
  if (!input.promotionAudit)
    blockers.push('promotion audit evidence incomplete');
  if (!input.packedWizardMatrix)
    blockers.push('packed wizard matrix evidence incomplete');
  if (!input.releaseAuthentication)
    blockers.push('release authentication incomplete');

  return {
    managerAvailability: managerGate.publicationAllowed,
    packedWizardMatrix:
      managerGate.matrixPassed &&
      input.packedWizardMatrix &&
      input.corePackedConsumer &&
      input.httpCorePackedConsumer,
    releaseAuthentication: input.releaseAuthentication,
    publicationAllowed: blockers.length === 0,
    blockers,
  };
}

type CommandResult = { exitCode: number; output: string };

function run(
  command: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): CommandResult {
  try {
    const result = execFileSync(command[0], command.slice(1), {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { exitCode: 0, output: result };
  } catch (error) {
    const child = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      exitCode: child.status ?? 1,
      output: `${child.stdout ?? ''}${child.stderr ?? ''}`,
    };
  }
}

function currentHead(root: string): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

function authenticated(env: NodeJS.ProcessEnv): boolean {
  return (
    env.NEST_BASE_RELEASE_AUTHENTICATED === '1' &&
    Boolean(env.NEST_BASE_RELEASE_AUTH_IDENTITY?.trim())
  );
}

export function runReleaseGate(
  options: {
    root?: string;
    releaseCommit?: string;
    now?: string;
    snapshotPath?: string;
  } = {},
) {
  const root = resolve(options.root ?? process.cwd());
  const env = { ...process.env };
  const releaseCommit = options.releaseCommit ?? env.NEST_BASE_RELEASE_COMMIT;
  if (!releaseCommit)
    throw new Error('NEST_BASE_RELEASE_COMMIT is required; refusing to guess.');

  const outputPath = resolve(root, '.release-manager-acceptance.json');
  const packed = run(
    ['bun', 'test', 'test/packages/create-nest-base/packed-consumer.spec.ts'],
    root,
    { ...env, NEST_BASE_RELEASE_MANAGER_OUTPUT: outputPath },
  );
  let managerAcceptance: FreshReleaseGateInput['managerAcceptance'] = {};
  try {
    managerAcceptance = JSON.parse(
      readFileSync(outputPath, 'utf8'),
    ) as FreshReleaseGateInput['managerAcceptance'];
  } catch {
    // Missing output is represented by missing records and therefore fails closed.
  }

  const coreConsumer = run(['bun', 'run', 'verify:consumer'], root, env);
  const httpCoreConsumer = run(
    ['bun', 'run', 'verify:http-core:consumer'],
    root,
    env,
  );
  const promotionAudit = run(['bun', 'run', 'audit:promotion'], root, env);
  const generatedAt = options.now ?? new Date().toISOString();
  const input: FreshReleaseGateInput = {
    generatedAt,
    headCommit: currentHead(root),
    releaseCommit,
    managerAcceptance,
    corePackedConsumer: coreConsumer.exitCode === 0,
    httpCorePackedConsumer: httpCoreConsumer.exitCode === 0,
    promotionAudit: promotionAudit.exitCode === 0,
    packedWizardMatrix: packed.exitCode === 0,
    releaseAuthentication: authenticated(env),
  };
  const gate = evaluateFreshReleaseGate(input, {
    now: generatedAt,
    headCommit: input.headCommit,
    releaseCommit,
  });
  let previous: Record<string, unknown> = {};
  try {
    previous = JSON.parse(
      readFileSync(resolve(root, 'docs/create-nest-base-release.json'), 'utf8'),
    ) as Record<string, unknown>;
  } catch {
    // A descriptive snapshot is optional; the gate never reads it as input.
  }
  const snapshot = {
    ...previous,
    evidenceSnapshot: {
      generated: true,
      staleSafe: true,
      source: 'release-gate',
      note: 'Descriptive release evidence only; publication consumes fresh evaluated results.',
      generatedAt,
      headCommit: input.headCommit,
      releaseCommit,
    },
    managerAcceptance,
    releaseBlockers: gate.blockers,
    evidence: {
      ...(previous.evidence as Record<string, boolean> | undefined),
      managerAvailability: gate.managerAvailability,
      packedWizardMatrix: gate.packedWizardMatrix,
      promotionAudit: input.promotionAudit,
      releaseAuthentication: gate.releaseAuthentication,
    },
    publication: {
      allowed: gate.publicationAllowed,
      rule: 'Publication is prohibited until fresh release-gate evidence is generated for the exact release commit and every required flag is true.',
    },
  };
  writeFileSync(
    options.snapshotPath ?? resolve(root, 'docs/create-nest-base-release.json'),
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
  return { input, ...gate };
}
