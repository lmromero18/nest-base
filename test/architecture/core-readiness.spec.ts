import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BASELINE_COMMIT,
  CORE_CANONICAL_SOURCE_MAP,
  CORE_EXPORT_MANIFEST,
  CORE_PROMOTION_GATE,
  CORE_READINESS_SCOPE,
  classifyReadinessPaths,
  collectBaselineRelativePaths,
  collectBaselineRelativePathsFromGit,
  hasCoreConsumerUsage,
  inspectCompleteWorktree,
  isPromotionEligible,
  LOCKFILE_TYPEORM_VERSION,
  POSTGRESQL_READINESS_DIAGNOSTIC,
  READINESS_ROLLBACK_ARTIFACTS,
  validateRollbackChangedSet,
} from './core-readiness.fixture';

describe('baseline-relative readiness classifier', () => {
  it('uses the committed baseline and normalizes/deduplicates paths', () => {
    const report = classifyReadinessPaths([
      'docs\\framework-boundaries.md',
      'docs/framework-boundaries.md',
      'tools/module-generator/cli.ts',
      'packages/core/src/index.ts',
    ]);

    expect(BASELINE_COMMIT).toBe('5d3f865');
    expect(report.baselineCommit).toBe(BASELINE_COMMIT);
    expect(report.changedPaths).toEqual([
      'docs/framework-boundaries.md',
      'packages/core/src/index.ts',
      'tools/module-generator/cli.ts',
    ]);
    expect(report.byCategory['rollback-owned']).toEqual([
      'docs/framework-boundaries.md',
    ]);
    expect(report.byCategory.accepted).toEqual([]);
    expect(report.byCategory.forbidden).toEqual([
      'packages/core/src/index.ts',
      'tools/module-generator/cli.ts',
    ]);
    expect(report.byCategory.deferred).toEqual([]);
  });

  it('excludes unchanged committed generator and core files from baseline delta', () => {
    const changedPaths = collectBaselineRelativePaths({
      tracked: ['README.md', 'tools/module-generator/cli.ts'],
      untracked: ['packages/create-nest-base/cli.ts'],
      baselineFiles: [
        'tools/module-generator/cli.ts',
        'packages/core/src/index.ts',
      ],
    });

    expect(changedPaths).toEqual([
      'README.md',
      'packages/create-nest-base/cli.ts',
    ]);
  });

  it('reports contradictory membership without assigning multiple categories', () => {
    const report = classifyReadinessPaths(['bun.lock'], {
      accepted: ['bun.lock'],
      deferred: ['bun.lock'],
    });

    expect(report.diagnostics).toHaveLength(1);
    expect(report.diagnostics[0]).toMatchObject({
      path: 'bun.lock',
      category: 'forbidden',
    });
    expect(report.diagnostics[0].reason).toContain('Contradictory');
    expect(report.byCategory.deferred).toEqual([]);
    expect(report.byCategory.forbidden).toEqual(['bun.lock']);
    expect(report.promotion).toBe('blocked');
  });

  it('preserves deferred category and blocks promotion for deferred overrides', () => {
    const report = classifyReadinessPaths(['custom-readiness.md'], {
      deferred: ['custom-readiness.md'],
    });

    expect(report.diagnostics[0]).toMatchObject({
      path: 'custom-readiness.md',
      category: 'deferred',
    });
    expect(report.byCategory.deferred).toEqual(['custom-readiness.md']);
    expect(report.promotionBlockers).toEqual(report.diagnostics);
    expect(report.promotion).toBe('blocked');
  });

  it('collects tracked baseline-relative changes and non-ignored untracked paths', () => {
    const paths = collectBaselineRelativePathsFromGit();

    expect(paths).toContain('bun.lock');
    expect(paths).toContain('test/architecture/core-readiness.spec.ts');
    expect(paths).not.toContain('packages/core/src/index.ts');
    expect(paths).toEqual([...new Set(paths)].sort());
  });
});

describe('readiness boundary categories and promotion', () => {
  it('accepts an explicit non-rollback manifest path without forbidden or rollback ownership', () => {
    const report = classifyReadinessPaths(['README.md']);

    expect(report.byCategory.accepted).toEqual(['README.md']);
    expect(report.byCategory.forbidden).toEqual([]);
    expect(report.byCategory['rollback-owned']).toEqual([]);
    expect(report.promotion).toBe('eligible');
    expect(isPromotionEligible(report)).toBe(true);
  });

  it('accepts the reconciled lockfile evidence without a stale mismatch blocker', () => {
    const report = classifyReadinessPaths(['bun.lock']);

    expect(report.byCategory.accepted).toEqual(['bun.lock']);
    expect(report.byCategory.deferred).toEqual([]);
    expect(report.diagnostics[0]).toEqual({
      path: 'bun.lock',
      category: 'accepted',
      reason:
        'Lockfile resolves the authoritative @nest-base/core@0.1.0 dependency.',
      observed: '@nest-base/core@0.1.0',
    });
    expect(report.promotion).toBe('eligible');
    expect(report.promotionBlockers).toEqual([]);
  });

  it('blocks lockfile evidence when the authoritative core resolution is missing', () => {
    const report = classifyReadinessPaths(['bun.lock'], {
      lockfileContent: '"@nest-base/core": ["@nest-base/core@1.0.0", ""]',
    });

    expect(report.byCategory.accepted).toEqual(['bun.lock']);
    expect(report.diagnostics[0]).toMatchObject({
      path: 'bun.lock',
      category: 'accepted',
      blocking: true,
      expected: '@nest-base/core@0.1.0',
    });
    expect(report.diagnostics[0].reason).toContain('Regenerate bun.lock');
    expect(report.promotionBlockers).toEqual(report.diagnostics);
    expect(report.promotion).toBe('blocked');
    expect(isPromotionEligible(report)).toBe(false);
  });

  it('forbids unexpected paths and blocks promotion with actionable diagnostics', () => {
    const report = classifyReadinessPaths(['unexpected.txt']);

    expect(report.byCategory.forbidden).toEqual(['unexpected.txt']);
    expect(report.diagnostics[0]).toMatchObject({
      path: 'unexpected.txt',
      category: 'forbidden',
    });
    expect(report.diagnostics[0].reason).toContain(
      'explicit readiness manifest',
    );
    expect(report.promotionBlockers[0]).toMatchObject({
      path: 'unexpected.txt',
      category: 'forbidden',
    });
    expect(isPromotionEligible(report)).toBe(false);
  });

  it('keeps rollback ownership exact and informational for rollback-only changes', () => {
    const report = classifyReadinessPaths([...READINESS_ROLLBACK_ARTIFACTS]);

    expect(report.byCategory['rollback-owned']).toEqual(
      [...READINESS_ROLLBACK_ARTIFACTS].sort(),
    );
    expect(report.diagnostics).toHaveLength(4);
    expect(report.promotion).toBe('eligible');
    expect(isPromotionEligible(report)).toBe(true);
    expect(validateRollbackChangedSet(report)).toBe(true);
  });

  it('blocks incomplete reports even when no forbidden path is present', () => {
    const report = classifyReadinessPaths(['README.md']);
    const incomplete = { ...report, diagnostics: [] };

    expect(isPromotionEligible(incomplete)).toBe(false);
  });

  it('does not block the real rollout delta because the lockfile is reconciled', () => {
    const report = inspectCompleteWorktree();

    expect(report.baselineCommit).toBe(BASELINE_COMMIT);
    expect(report.byCategory.deferred).toEqual([]);
    expect(report.promotion).toBe('blocked');
    expect(report.byCategory.accepted).toContain('bun.lock');
  });
});

describe('existing core boundary evidence', () => {
  it('keeps the export manifest mapped to canonical declarations', () => {
    const manifestNames = Object.values(CORE_EXPORT_MANIFEST).flat();
    expect(Object.keys(CORE_CANONICAL_SOURCE_MAP).sort()).toEqual(
      [...new Set(manifestNames)].sort(),
    );

    for (const [name, file] of Object.entries(CORE_CANONICAL_SOURCE_MAP)) {
      expect(readFileSync(resolve(file), 'utf8')).toMatch(
        new RegExp(
          `(?:export\\s+)?(?:abstract\\s+)?(?:class|interface|type|const)\\s+${name}\\b`,
        ),
      );
    }
  });

  it('preserves promotion and environment diagnostics', () => {
    expect(CORE_PROMOTION_GATE).toMatchObject({
      requiredConsumers: 2,
      stablePromotion: 'blocked',
    });
    expect(LOCKFILE_TYPEORM_VERSION).toBe(
      POSTGRESQL_READINESS_DIAGNOSTIC.typeormVersion,
    );
    expect(POSTGRESQL_READINESS_DIAGNOSTIC.liveDatabaseAvailable).toBe(false);
    expect(existsSync(resolve('docs/framework-boundaries.md'))).toBe(true);
  });

  it('uses syntax-aware consumer detection', () => {
    expect(hasCoreConsumerUsage('const text = "BaseService";')).toBe(false);
    expect(
      hasCoreConsumerUsage(`
        import { BaseService as Service } from '../services/base.service';
        export class ExampleService extends Service<Entity> {}
      `),
    ).toBe(true);
  });

  it('defines the exact accepted and rollback-owned readiness inventories', () => {
    expect(CORE_READINESS_SCOPE.deferredChangedFiles).toEqual([]);
    expect(READINESS_ROLLBACK_ARTIFACTS).toEqual([
      '.gitignore',
      'docs/framework-boundaries.md',
      'test/architecture/core-readiness.fixture.ts',
      'test/architecture/core-readiness.spec.ts',
    ]);
  });

  it('documents the fixed baseline, deferred version caveat, and exclusions', () => {
    const documentation = readFileSync(
      resolve('docs/framework-boundaries.md'),
      'utf8',
    );

    expect(documentation).toContain('baseline `5d3f865`');
    expect(documentation).toContain('`bun.lock`');
    expect(documentation).toContain('@nest-base/core@0.1.0');
    expect(documentation).not.toContain('@nest-base/core@1.0.0');
    expect(documentation).toContain('wizard behavior');
    expect(documentation).toContain('Windows promotion cleanup');
  });
});
