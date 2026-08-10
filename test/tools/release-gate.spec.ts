import { describe, expect, it } from 'bun:test';
import {
  evaluateFreshReleaseGate,
  runReleaseGate,
  type FreshReleaseGateInput,
} from '../../tools/release-gate';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const current = '2026-08-10T12:00:00.000Z';
const passingManagers = {
  bun: { status: 'passed' as const },
  npm: { status: 'passed' as const },
  pnpm: { status: 'passed' as const },
  yarn: { status: 'passed' as const },
};

function passingInput(
  overrides: Partial<FreshReleaseGateInput> = {},
): FreshReleaseGateInput {
  return {
    generatedAt: current,
    headCommit: 'abc123',
    headVersionToken: 'reflog-1',
    releaseCommit: 'abc123',
    managerAcceptance: passingManagers,
    corePackedConsumer: true,
    httpCorePackedConsumer: true,
    promotionAudit: true,
    packedWizardMatrix: true,
    releaseAuthentication: true,
    ...overrides,
  };
}

describe('fresh release gate', () => {
  it('allows publication only for current evidence bound to the exact release commit', () => {
    expect(
      evaluateFreshReleaseGate(passingInput(), {
        now: current,
        actualHeadCommit: 'abc123',
      }),
    ).toMatchObject({ publicationAllowed: true, blockers: [] });
  });

  it('rejects stale evidence even when every recorded flag is true', () => {
    const result = evaluateFreshReleaseGate(
      passingInput({ generatedAt: '2026-08-10T11:59:00.000Z' }),
      {
        now: current,
        actualHeadCommit: 'abc123',
        maxAgeMs: 30_000,
      },
    );

    expect(result.publicationAllowed).toBe(false);
    expect(result.blockers).toContain('release evidence is stale');
  });

  it('rejects evidence generated for a different HEAD or release commit', () => {
    const result = evaluateFreshReleaseGate(
      passingInput({ headCommit: 'old-head', releaseCommit: 'old-release' }),
      { now: current, actualHeadCommit: 'abc123' },
    );

    expect(result.publicationAllowed).toBe(false);
    expect(result.blockers).toEqual([
      'release evidence HEAD does not match current HEAD',
      'release evidence release commit does not match current HEAD',
    ]);
  });

  it('rejects evidence when Git HEAD changes during generation', () => {
    const result = evaluateFreshReleaseGate(passingInput(), {
      now: '2026-08-10T12:00:01.000Z',
      actualHeadCommit: 'new-head',
      generationStartedHeadCommit: 'abc123',
      generationStartedHeadVersionToken: 'reflog-1',
      actualHeadVersionToken: 'reflog-2',
    });

    expect(result.publicationAllowed).toBe(false);
    expect(result.blockers).toContain(
      'release evidence HEAD changed during generation',
    );
  });

  it('accepts a normal orchestration run whose timestamps surround evidence generation', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-gate-'));
    const snapshotPath = join(root, 'snapshot.json');
    const state = { headCommit: 'abc123', headVersionToken: 'reflog-1' };
    const timestamps = [
      '2026-08-10T12:00:00.000Z',
      '2026-08-10T12:00:01.000Z',
      '2026-08-10T12:00:02.000Z',
    ];
    const previousAuth = process.env.NEST_BASE_RELEASE_AUTHENTICATED;
    const previousIdentity = process.env.NEST_BASE_RELEASE_AUTH_IDENTITY;
    process.env.NEST_BASE_RELEASE_AUTHENTICATED = '1';
    process.env.NEST_BASE_RELEASE_AUTH_IDENTITY = 'orchestration-test';

    try {
      const result = runReleaseGate({
        root,
        releaseCommit: 'abc123',
        snapshotPath,
        gitAdapter: { readState: () => state },
        clock: () => new Date(timestamps.shift() as string),
        runCommand: (_command, _cwd, env) => {
          if (env.NEST_BASE_RELEASE_MANAGER_OUTPUT)
            writeFileSync(
              env.NEST_BASE_RELEASE_MANAGER_OUTPUT,
              JSON.stringify(passingManagers),
            );
          return { exitCode: 0, output: '' };
        },
      });

      expect(result.publicationAllowed).toBe(true);
      expect(result.input.generatedAt).toBe('2026-08-10T12:00:00.000Z');
      expect(
        (
          JSON.parse(readFileSync(snapshotPath, 'utf8')) as {
            evidenceSnapshot: { generationEndedAt: string };
          }
        ).evidenceSnapshot.generationEndedAt,
      ).toBe('2026-08-10T12:00:01.000Z');
    } finally {
      if (previousAuth === undefined)
        delete process.env.NEST_BASE_RELEASE_AUTHENTICATED;
      else process.env.NEST_BASE_RELEASE_AUTHENTICATED = previousAuth;
      if (previousIdentity === undefined)
        delete process.env.NEST_BASE_RELEASE_AUTH_IDENTITY;
      else process.env.NEST_BASE_RELEASE_AUTH_IDENTITY = previousIdentity;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects an A-to-B-to-A HEAD mutation using the reflog version token', () => {
    const root = mkdtempSync(join(tmpdir(), 'release-gate-'));
    const snapshotPath = join(root, 'snapshot.json');
    let state = { headCommit: 'abc123', headVersionToken: 'reflog-1' };
    let evidenceCommands = 0;

    try {
      const result = runReleaseGate({
        root,
        releaseCommit: 'abc123',
        snapshotPath,
        gitAdapter: { readState: () => state },
        clock: () => new Date(current),
        runCommand: (_command, _cwd, env) => {
          evidenceCommands += 1;
          if (env.NEST_BASE_RELEASE_MANAGER_OUTPUT)
            writeFileSync(
              env.NEST_BASE_RELEASE_MANAGER_OUTPUT,
              JSON.stringify(passingManagers),
            );
          if (evidenceCommands === 1)
            state = { headCommit: 'def456', headVersionToken: 'reflog-2' };
          if (evidenceCommands === 2)
            state = { headCommit: 'abc123', headVersionToken: 'reflog-3' };
          return { exitCode: 0, output: '' };
        },
      });

      expect(result.publicationAllowed).toBe(false);
      expect(result.blockers).toContain(
        'release evidence HEAD changed during generation',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('fails closed when a required evidence flag is missing or false', () => {
    const result = evaluateFreshReleaseGate(
      passingInput({
        promotionAudit: false,
        packedWizardMatrix: false,
        releaseAuthentication: false,
      }),
      { now: current, actualHeadCommit: 'abc123' },
    );

    expect(result.publicationAllowed).toBe(false);
    expect(result.blockers).toEqual([
      'promotion audit evidence incomplete',
      'packed wizard matrix evidence incomplete',
      'release authentication incomplete',
    ]);
  });

  it('rejects an arbitrary old requested release commit against the actual HEAD', () => {
    const result = evaluateFreshReleaseGate(
      passingInput({ releaseCommit: 'old-release' }),
      { now: current, actualHeadCommit: 'abc123' },
    );

    expect(result.publicationAllowed).toBe(false);
    expect(result.blockers).toContain(
      'release evidence release commit does not match current HEAD',
    );
  });

  it('rejects future evidence instead of treating it as fresh', () => {
    const result = evaluateFreshReleaseGate(
      passingInput({ generatedAt: '2026-08-10T12:00:01.000Z' }),
      { now: current, actualHeadCommit: 'abc123' },
    );

    expect(result.publicationAllowed).toBe(false);
    expect(result.blockers).toContain('release evidence is from the future');
  });

  it('rejects evidence from a gate run that exceeded the freshness window', () => {
    const result = evaluateFreshReleaseGate(passingInput(), {
      now: current,
      actualHeadCommit: 'abc123',
      generationStartedAt: '2026-08-10T11:54:00.000Z',
      generationEndedAt: current,
      maxAgeMs: 5 * 60_000,
    });

    expect(result.publicationAllowed).toBe(false);
    expect(result.blockers).toContain(
      'release evidence generation exceeded freshness window',
    );
  });

  it('allows evidence exactly at the freshness boundary', () => {
    const result = evaluateFreshReleaseGate(
      passingInput({ generatedAt: '2026-08-10T11:59:30.000Z' }),
      {
        now: current,
        actualHeadCommit: 'abc123',
        maxAgeMs: 30_000,
      },
    );

    expect(result.publicationAllowed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('rejects evidence one millisecond beyond the freshness boundary', () => {
    const result = evaluateFreshReleaseGate(
      passingInput({ generatedAt: '2026-08-10T11:59:29.999Z' }),
      {
        now: current,
        actualHeadCommit: 'abc123',
        maxAgeMs: 30_000,
      },
    );

    expect(result.publicationAllowed).toBe(false);
    expect(result.blockers).toContain('release evidence is stale');
  });
});
