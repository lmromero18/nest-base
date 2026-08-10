import { describe, expect, it } from 'bun:test';
import {
  evaluateFreshReleaseGate,
  type FreshReleaseGateInput,
} from '../../tools/release-gate';

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
    });

    expect(result.publicationAllowed).toBe(false);
    expect(result.blockers).toContain(
      'release evidence HEAD changed during generation',
    );
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
