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
  headVersionToken: string;
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
  actualHeadCommit: string;
  generationStartedHeadCommit?: string;
  generationStartedHeadVersionToken?: string;
  actualHeadVersionToken?: string;
  generationStartedAt?: string;
  generationEndedAt?: string;
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
  else if (generatedTime > currentTime)
    blockers.push('release evidence is from the future');
  else if (currentTime - generatedTime > maxAgeMs)
    blockers.push('release evidence is stale');

  const generationStart = context.generationStartedAt
    ? Date.parse(context.generationStartedAt)
    : undefined;
  const generationEnd = context.generationEndedAt
    ? Date.parse(context.generationEndedAt)
    : undefined;
  if (
    generationStart !== undefined &&
    generationEnd !== undefined &&
    (!Number.isFinite(generationStart) || !Number.isFinite(generationEnd))
  )
    blockers.push('release generation timestamps are invalid');
  else if (
    generationStart !== undefined &&
    generationEnd !== undefined &&
    (generatedTime < generationStart || generatedTime > generationEnd)
  )
    blockers.push('release evidence timestamp is outside generation window');
  else if (
    generationStart !== undefined &&
    generationEnd !== undefined &&
    generationEnd - generationStart > maxAgeMs
  )
    blockers.push('release evidence generation exceeded freshness window');

  if (input.headCommit !== context.actualHeadCommit)
    blockers.push('release evidence HEAD does not match current HEAD');
  const headChangedDuringGeneration =
    (context.generationStartedHeadCommit !== undefined &&
      context.generationStartedHeadCommit !== context.actualHeadCommit) ||
    (context.generationStartedHeadVersionToken !== undefined &&
      context.actualHeadVersionToken !== undefined &&
      context.generationStartedHeadVersionToken !==
        context.actualHeadVersionToken);
  if (headChangedDuringGeneration)
    blockers.push('release evidence HEAD changed during generation');
  if (
    context.generationStartedHeadVersionToken !== undefined &&
    input.headVersionToken !== context.generationStartedHeadVersionToken
  )
    blockers.push(
      'release evidence HEAD version does not match generation start',
    );
  if (input.releaseCommit !== context.actualHeadCommit)
    blockers.push(
      'release evidence release commit does not match current HEAD',
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

export type CommandResult = { exitCode: number; output: string };

export interface GitState {
  headCommit: string;
  headVersionToken: string;
}

export interface GitAdapter {
  readState(root: string): GitState;
}

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

function readGitValue(root: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  }).trim();
}

export const gitAdapter: GitAdapter = {
  readState(root) {
    return {
      headCommit: readGitValue(root, ['rev-parse', 'HEAD']),
      headVersionToken: readGitValue(root, [
        'reflog',
        '-1',
        '--format=%H:%gd',
        'HEAD',
      ]),
    };
  },
};

export function readCurrentHead(root: string): string {
  return gitAdapter.readState(root).headCommit;
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
    snapshotPath?: string;
    gitAdapter?: GitAdapter;
    runCommand?: (
      command: string[],
      cwd: string,
      env: NodeJS.ProcessEnv,
    ) => CommandResult;
    clock?: () => Date;
  } = {},
) {
  const root = resolve(options.root ?? process.cwd());
  const env = { ...process.env };
  const releaseCommit = options.releaseCommit ?? env.NEST_BASE_RELEASE_COMMIT;
  if (!releaseCommit)
    throw new Error('NEST_BASE_RELEASE_COMMIT is required; refusing to guess.');

  const outputPath = resolve(root, '.release-manager-acceptance.json');
  const adapter = options.gitAdapter ?? gitAdapter;
  const runCommand = options.runCommand ?? run;
  const clock = options.clock ?? (() => new Date());
  const generationStartedHead = adapter.readState(root);
  const generationStartedAt = clock().toISOString();
  const generatedAt = generationStartedAt;
  const packed = runCommand(
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

  const coreConsumer = runCommand(['bun', 'run', 'verify:consumer'], root, env);
  const httpCoreConsumer = runCommand(
    ['bun', 'run', 'verify:http-core:consumer'],
    root,
    env,
  );
  const promotionAudit = runCommand(
    ['bun', 'run', 'audit:promotion'],
    root,
    env,
  );
  const generationEndedAt = clock().toISOString();
  const evaluationNow = clock().toISOString();
  const actualHead = adapter.readState(root);
  const input: FreshReleaseGateInput = {
    generatedAt,
    headCommit: generationStartedHead.headCommit,
    headVersionToken: generationStartedHead.headVersionToken,
    releaseCommit,
    managerAcceptance,
    corePackedConsumer: coreConsumer.exitCode === 0,
    httpCorePackedConsumer: httpCoreConsumer.exitCode === 0,
    promotionAudit: promotionAudit.exitCode === 0,
    packedWizardMatrix: packed.exitCode === 0,
    releaseAuthentication: authenticated(env),
  };
  const gate = evaluateFreshReleaseGate(input, {
    now: evaluationNow,
    actualHeadCommit: actualHead.headCommit,
    generationStartedHeadCommit: generationStartedHead.headCommit,
    generationStartedHeadVersionToken: generationStartedHead.headVersionToken,
    actualHeadVersionToken: actualHead.headVersionToken,
    generationStartedAt,
    generationEndedAt,
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
      generationStartedAt,
      generationEndedAt,
      headCommit: input.headCommit,
      headVersionToken: input.headVersionToken,
      releaseCommit,
    },
    managerAcceptance,
    releaseBlockers: gate.blockers,
    evidence: {
      managerAvailability: gate.managerAvailability,
      packedWizardMatrix: gate.packedWizardMatrix,
      corePackedConsumer: input.corePackedConsumer,
      httpCorePackedConsumer: input.httpCorePackedConsumer,
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
