import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const CORE_EXPORT_MANIFEST = {
  '.': [
    'BaseService',
    'PaginatedResponse',
    'MutationOptions',
    'CrudOrderDirection',
    'CrudQuery',
    'ApplicationException',
    'ApplicationError',
    'ApplicationErrorCategory',
    'Principal',
    'RequestContext',
    'RequestContextStore',
    'QuerySchema',
    'QueryParserOptions',
    'ParsedListQuery',
    'QueryStringParser',
    'DEFAULT_PARSER_OPTIONS',
  ],
  './services': ['BaseService', 'PaginatedResponse', 'MutationOptions'],
  './query': [
    'QuerySchema',
    'QueryParserOptions',
    'ParsedListQuery',
    'QueryStringParser',
    'DEFAULT_PARSER_OPTIONS',
  ],
  './application': [
    'ApplicationException',
    'ApplicationError',
    'ApplicationErrorCategory',
    'Principal',
  ],
  './context': ['RequestContext', 'RequestContextStore'],
} as const;

export const CORE_CANONICAL_SOURCE_MAP = {
  BaseService: 'src/common/services/base.service.ts',
  PaginatedResponse: 'src/common/application/crud.contracts.ts',
  MutationOptions: 'src/common/application/crud.contracts.ts',
  CrudOrderDirection: 'src/common/application/crud.contracts.ts',
  CrudQuery: 'src/common/application/crud.contracts.ts',
  ApplicationException: 'src/common/application/application-error.ts',
  ApplicationError: 'src/common/application/application-error.ts',
  ApplicationErrorCategory: 'src/common/application/application-error.ts',
  Principal: 'src/common/application/principal.ts',
  RequestContext: 'src/common/context/request-context.ts',
  RequestContextStore: 'src/common/context/request-context.ts',
  QuerySchema: 'src/common/query/query-string-parser.ts',
  QueryParserOptions: 'src/common/query/query-string-parser.ts',
  ParsedListQuery: 'src/common/query/query-string-parser.ts',
  QueryStringParser: 'src/common/query/query-string-parser.ts',
  DEFAULT_PARSER_OPTIONS: 'src/common/query/query-string-parser.ts',
} as const;

export const CORE_READINESS_SCOPE = {
  acceptedChangedFiles: [
    '.gitignore',
    '.prettierignore',
    'README.md',
    'docs/framework-boundaries.md',
    'docs/create-nest-base.md',
    'docs/npm-package-platform.md',
    'bun.lock',
    'eslint.config.mjs',
    'package.json',
    'src/common/controller/crud-controller.factory.ts',
    'test/architecture/core-readiness.fixture.ts',
    'test/architecture/core-readiness.spec.ts',
    'packages/create-nest-base/artifact-gate.ts',
    'packages/create-nest-base/cli.ts',
    'packages/create-nest-base/index.ts',
    'packages/create-nest-base/install.ts',
    'packages/create-nest-base/metadata.ts',
    'packages/create-nest-base/preflight.ts',
    'packages/create-nest-base/registry.ts',
    'packages/create-nest-base/scaffold.ts',
    'packages/create-nest-base/types.ts',
    'packages/create-nest-base/ux.ts',
    'test/packages/create-nest-base/artifact-gate.spec.ts',
    'test/packages/create-nest-base/ci.spec.ts',
    'test/packages/create-nest-base/pipeline.spec.ts',
    'test/packages/create-nest-base/preflight.spec.ts',
    'test/packages/create-nest-base/registry.spec.ts',
    'test/packages/create-nest-base/scaffold-install.spec.ts',
    'test/packages/create-nest-base/metadata.spec.ts',
    'test/packages/create-nest-base/ux.spec.ts',
    'test/packages/create-nest-base/integration.spec.ts',
    'test/packages/core/promotion-contract.spec.ts',
    'test/packages/core/promotion-sequence.spec.ts',
    'tools/verify-consumer.ts',
    'tools/core-run-context.ts',
    'tools/promotion-gates.ts',
  ],
  deferredChangedFiles: [],
} as const;

export const READINESS_ROLLBACK_ARTIFACTS = [
  '.gitignore',
  'docs/framework-boundaries.md',
  'test/architecture/core-readiness.fixture.ts',
  'test/architecture/core-readiness.spec.ts',
] as const;

export const BASELINE_COMMIT = '5d3f865';

export type ReadinessCategory =
  'accepted' | 'deferred' | 'forbidden' | 'rollback-owned';

export type ReadinessDiagnostic = {
  path: string;
  category: ReadinessCategory;
  reason: string;
  observed?: string;
  expected?: string;
  blocking?: boolean;
};

export type ReadinessReport = {
  baselineCommit: string;
  changedPaths: readonly string[];
  diagnostics: readonly ReadinessDiagnostic[];
  byCategory: Record<ReadinessCategory, readonly string[]>;
  promotion: 'eligible' | 'blocked';
  promotionBlockers: readonly ReadinessDiagnostic[];
};

export const POSTGRESQL_READINESS_DIAGNOSTIC = {
  typeormVersion: '0.3.31',
  database: 'PostgreSQL',
  liveDatabaseAvailable: false,
  diagnostic: 'PostgreSQL-unavailable health diagnostic',
} as const;

const lockfileTypeormMatch = readFileSync('bun.lock', 'utf8').match(
  /"typeorm": \["typeorm@([^"]+)"/,
);

if (!lockfileTypeormMatch) {
  throw new Error('Unable to resolve TypeORM from bun.lock');
}

export const LOCKFILE_TYPEORM_VERSION = lockfileTypeormMatch[1];

const ELIGIBLE_CONSUMER_ROOTS = ['src/common/controller', 'src/modules'];
const EXCLUDED_CONSUMER_SEGMENTS = ['/login/', '/notification/', '/test/'];

type ConsumerKind = 'consumer' | 'adapter';

type EligibleConsumer = {
  path: string;
  kind: ConsumerKind;
};

function listRepositorySourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '--cached', '--', 'src/**/*.ts'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean);
}

function enumerateEligibleConsumers(): EligibleConsumer[] {
  return listRepositorySourceFiles()
    .filter((file) =>
      ELIGIBLE_CONSUMER_ROOTS.some((root) => file.startsWith(`${root}/`)),
    )
    .filter(
      (file) =>
        !EXCLUDED_CONSUMER_SEGMENTS.some((segment) =>
          `/${file}/`.includes(segment),
        ),
    )
    .filter((file) => hasCoreConsumerUsage(readFileSync(file, 'utf8')))
    .map((file) => ({
      path: file,
      kind: file.startsWith('src/common/controller/') ? 'adapter' : 'consumer',
    }));
}

function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g, '')
    .replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '');
}

export function hasCoreConsumerUsage(source: string): boolean {
  const importedBindings = new Set<string>();
  const coreImports =
    /\bimport\s+(?:type\s+)?\{([\s\S]*?)\}\s+from\s+['"]([^'"]+)['"]/g;

  for (const match of source.matchAll(coreImports)) {
    const [, importedNames, modulePath] = match;
    if (
      !/(?:base\.service|crud-controller\.factory)(?:\.ts)?$/.test(modulePath)
    ) {
      continue;
    }

    for (const specifier of importedNames.split(',')) {
      const [importedName, localName] = specifier
        .trim()
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/);
      if (
        (importedName === 'BaseService' ||
          importedName === 'CrudControllerFactory') &&
        localName
      ) {
        importedBindings.add(localName.trim());
      } else if (
        importedName === 'BaseService' ||
        importedName === 'CrudControllerFactory'
      ) {
        importedBindings.add(importedName);
      }
    }
  }

  if (importedBindings.size === 0) {
    return false;
  }

  const code = stripCommentsAndStrings(source);
  const bindingPattern = [...importedBindings]
    .sort((left, right) => right.length - left.length)
    .map((binding) => binding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  const usage = new RegExp(
    `\\b(?:extends\\s+(?:${bindingPattern})\\b|constructor\\s*\\([\\s\\S]*?\\b(?:${bindingPattern})\\b|(?:${bindingPattern})\\s*(?:<[^>{}]*>)?\\s*\\()`,
  );

  return usage.test(code);
}

const eligibleConsumers = enumerateEligibleConsumers();

export const CORE_PROMOTION_GATE = {
  eligibleConsumers,
  currentConsumers: eligibleConsumers.length,
  requiredConsumers: 2,
  stablePromotion: 'blocked',
  reason: 'A genuine second consumer or adapter is required.',
} as const;

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function collectBaselineRelativePaths(input: {
  tracked: readonly string[];
  untracked: readonly string[];
  baselineFiles: readonly string[];
}): string[] {
  const baseline = new Set(input.baselineFiles.map(normalizePath));
  return [...new Set([...input.tracked, ...input.untracked].map(normalizePath))]
    .filter((path) => !baseline.has(path))
    .sort();
}

function resolveBaseline(): void {
  try {
    execFileSync(
      'git',
      ['rev-parse', '--verify', `${BASELINE_COMMIT}^{commit}`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  } catch {
    throw new Error(`Unable to resolve readiness baseline ${BASELINE_COMMIT}`);
  }
}

function readBaselineRelativeTrackedPaths(): string[] {
  resolveBaseline();
  return execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=ACDMRTUXB', BASELINE_COMMIT, '--'],
    { encoding: 'utf8' },
  )
    .split(/\r?\n/)
    .filter(Boolean)
    .map(normalizePath);
}

function readNonIgnoredUntrackedPaths(): string[] {
  return execFileSync('git', ['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map(normalizePath);
}

export function collectBaselineRelativePathsFromGit(): string[] {
  return [
    ...new Set([
      ...readBaselineRelativeTrackedPaths(),
      ...readNonIgnoredUntrackedPaths(),
    ]),
  ].sort();
}

const CATEGORY_ORDER: ReadinessCategory[] = [
  'rollback-owned',
  'deferred',
  'accepted',
  'forbidden',
];

const LOCKFILE_DIAGNOSTIC: ReadinessDiagnostic = {
  path: 'bun.lock',
  category: 'accepted',
  reason:
    'Lockfile resolves the authoritative @nest-base/core@0.1.0 dependency.',
  observed: '@nest-base/core@0.1.0',
};

const AUTHORITATIVE_CORE_LOCKFILE_PATTERN =
  /"@nest-base\/core": \["@nest-base\/core@0\.1\.0"(?:,|\s)/;

function hasAuthoritativeCoreLockfileResolution(content: string): boolean {
  return AUTHORITATIVE_CORE_LOCKFILE_PATTERN.test(content);
}

function emptyCategories(): Record<ReadinessCategory, string[]> {
  return {
    accepted: [],
    deferred: [],
    forbidden: [],
    'rollback-owned': [],
  };
}

export function classifyReadinessPaths(
  paths: readonly string[],
  overrides: {
    accepted?: readonly string[];
    deferred?: readonly string[];
    lockfileContent?: string;
  } = {},
): ReadinessReport {
  const changedPaths = [...new Set(paths.map(normalizePath))].sort();
  const accepted = new Set<string>(
    [
      ...CORE_READINESS_SCOPE.acceptedChangedFiles,
      ...(overrides.accepted ?? []),
    ].map(normalizePath),
  );
  const deferred = new Set<string>(
    [
      ...CORE_READINESS_SCOPE.deferredChangedFiles,
      ...(overrides.deferred ?? []),
    ].map(normalizePath),
  );
  const rollbackOwned = new Set<string>(READINESS_ROLLBACK_ARTIFACTS);
  const byCategory = emptyCategories();
  const diagnostics: ReadinessDiagnostic[] = [];
  const lockfileContent =
    overrides.lockfileContent ?? readFileSync('bun.lock', 'utf8');

  for (const path of changedPaths) {
    const memberships = [
      rollbackOwned.has(path) ? 'rollback-owned' : undefined,
      deferred.has(path) ? 'deferred' : undefined,
      accepted.has(path) ? 'accepted' : undefined,
    ].filter((category): category is ReadinessCategory => Boolean(category));
    const hasContradiction =
      memberships.includes('deferred') && memberships.includes('accepted');
    const category = hasContradiction
      ? 'forbidden'
      : (CATEGORY_ORDER.find((candidate) => memberships.includes(candidate)) ??
        'forbidden');

    byCategory[category].push(path);
    if (hasContradiction) {
      diagnostics.push({
        path,
        category,
        reason: 'Contradictory deferred and accepted manifest membership.',
      });
    } else if (category === 'deferred') {
      diagnostics.push({
        path,
        category,
        reason: 'Path is explicitly deferred from promotion readiness.',
      });
    } else if (category === 'forbidden') {
      diagnostics.push({
        path,
        category,
        reason: 'Path is absent from every explicit readiness manifest.',
      });
    } else {
      diagnostics.push(
        path === 'bun.lock'
          ? hasAuthoritativeCoreLockfileResolution(lockfileContent)
            ? { ...LOCKFILE_DIAGNOSTIC }
            : {
                path,
                category,
                blocking: true,
                reason:
                  'Lockfile does not resolve the authoritative @nest-base/core@0.1.0 dependency. Regenerate bun.lock with @nest-base/core@0.1.0 before promotion.',
                observed: 'Missing @nest-base/core@0.1.0 resolution',
                expected: '@nest-base/core@0.1.0',
              }
          : {
              path,
              category,
              reason:
                category === 'rollback-owned'
                  ? 'Readiness-owned rollback artifact; informational for promotion.'
                  : 'Path is part of the explicit accepted rollout manifest.',
            },
      );
    }
  }

  const complete =
    changedPaths.length ===
    Object.values(byCategory).reduce(
      (count, categoryPaths) => count + categoryPaths.length,
      0,
    );
  const promotionBlockers = diagnostics.filter(
    (diagnostic) =>
      diagnostic.blocking === true ||
      diagnostic.category === 'deferred' ||
      diagnostic.category === 'forbidden',
  );
  const promotion =
    complete && promotionBlockers.length === 0 ? 'eligible' : 'blocked';

  return {
    baselineCommit: BASELINE_COMMIT,
    changedPaths,
    diagnostics,
    byCategory,
    promotion,
    promotionBlockers,
  };
}

export function isPromotionEligible(report: ReadinessReport): boolean {
  const classifiedPaths = Object.values(report.byCategory).reduce(
    (count, paths) => count + paths.length,
    0,
  );
  return (
    report.baselineCommit === BASELINE_COMMIT &&
    classifiedPaths === report.changedPaths.length &&
    report.diagnostics.length === report.changedPaths.length &&
    report.promotion === 'eligible' &&
    report.promotionBlockers.length === 0
  );
}

export function validateRollbackChangedSet(report: ReadinessReport): boolean {
  return (
    [...report.changedPaths].sort().join('\n') ===
      [...READINESS_ROLLBACK_ARTIFACTS].sort().join('\n') &&
    [...report.byCategory['rollback-owned']].sort().join('\n') ===
      [...READINESS_ROLLBACK_ARTIFACTS].sort().join('\n')
  );
}

export function inspectCompleteWorktree(): ReadinessReport {
  return classifyReadinessPaths(collectBaselineRelativePathsFromGit());
}

export type WorktreeClassification = ReadinessReport;

export function classifyWorktreePaths(
  paths: readonly string[],
): ReadinessReport {
  return classifyReadinessPaths(paths);
}
