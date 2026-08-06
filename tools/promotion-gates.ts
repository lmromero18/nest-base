import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import {
  acquireCoreOutputLock,
  createCorePackageWorkspace,
  createCoreRunContext,
  releaseCoreOutputLock,
} from './core-run-context';

type ChildExecutionOptions = NonNullable<Parameters<typeof execFileSync>[2]>;

export interface PromotionGateOptions {
  acquireLock?: (
    options?: Parameters<typeof acquireCoreOutputLock>[0],
  ) => string;
  releaseLock?: (token: string, lockPath?: string) => void;
  cleanupLock?: () => void;
  execute?: (
    command: readonly string[],
    options: ChildExecutionOptions,
  ) => void;
  createContext?: typeof createCoreRunContext;
  cleanOutputs?: (packageRoot?: string) => boolean;
  removeRunRoot?: (runRoot: string, ownershipToken?: string) => void;
}

type CleanupFailure = {
  operation: string;
  path: string;
  error: unknown;
};

const gates = [
  ['C0', ['bun', 'test', 'test/architecture/core-readiness.spec.ts']],
  ['C1', ['bun', 'test', 'test/packages/core/context-audit.spec.ts']],
  ['C2-build', ['bun', 'run', 'build:core']],
  ['C2-artifacts', ['bun', '-e', 'assertCompleteArtifactInventory()']],
  ['C2', ['bun', 'run', 'audit:core']],
  ['C2-tarball', ['bun', 'run', 'audit:tarball']],
  ['C3', ['bun', 'run', 'verify:consumer']],
  ['C4', ['bun', 'test', 'test/packages/core/promotion-contract.spec.ts']],
] as const;

const repositoryRoot = resolve(process.cwd());
const childTimeoutMs = 120_000;
const ownershipMarker = '.promotion-owner';
const requiredArtifacts = [
  'dist/esm/index.js',
  'dist/esm/index.js.map',
  'dist/cjs/index.js',
  'dist/cjs/index.js.map',
  'dist/types/index.d.ts',
  'dist/cjs/package.json',
  ...['services', 'query', 'application', 'context'].flatMap((subpath) => [
    `dist/esm/${subpath}/index.js`,
    `dist/esm/${subpath}/index.js.map`,
    `dist/cjs/${subpath}/index.js`,
    `dist/cjs/${subpath}/index.js.map`,
    `dist/types/${subpath}/index.d.ts`,
  ]),
];

function assertCompleteArtifactInventory(
  packageRoot: string,
  runRoot: string,
  buildId: string,
): void {
  const missing = requiredArtifacts.filter(
    (relative) => !existsSync(resolve(packageRoot, relative)),
  );
  if (missing.length > 0)
    throw new Error(
      `Incomplete core artifact inventory:\n${missing.join('\n')}`,
    );
  const marker = resolve(runRoot, 'promotion-build-id');
  if (!existsSync(marker) || readFileSync(marker, 'utf8') !== buildId)
    throw new Error(
      'Core artifact inventory was not produced by this promotion run',
    );
  console.log(`C2-artifacts complete (${requiredArtifacts.length} files)`);
}

export function cleanPromotionOutputs(
  packageRoot: string,
  runRoot: string,
): boolean {
  const ownedPackageRoot = resolve(runRoot, 'package');
  if (!arePromotionPathsEqual(packageRoot, ownedPackageRoot)) return false;
  if (!existsSync(packageRoot)) return true;
  try {
    rmSync(resolve(packageRoot, 'dist'), { recursive: true, force: true });
    rmSync(resolve(packageRoot, '.dist-backup'), {
      recursive: true,
      force: true,
    });
    rmSync(resolve(packageRoot, '.build-types'), {
      recursive: true,
      force: true,
    });
    for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('.build-types-'))
        rmSync(resolve(packageRoot, entry.name), {
          recursive: true,
          force: true,
        });
    }
    return (
      !existsSync(resolve(packageRoot, 'dist')) &&
      !existsSync(resolve(packageRoot, '.dist-backup')) &&
      !existsSync(resolve(packageRoot, '.build-types')) &&
      !readdirSync(packageRoot).some((name) => name.startsWith('.build-types-'))
    );
  } catch {
    return false;
  }
}

function cleanOutputs(
  packageRoot: string | undefined,
  runRoot: string,
): boolean {
  return packageRoot ? cleanPromotionOutputs(packageRoot, runRoot) : true;
}

function removeOwnedRunRoot(runRoot: string, ownershipToken?: string): void {
  const resolvedRunRoot = resolve(runRoot);
  const marker = resolve(resolvedRunRoot, ownershipMarker);
  if (
    !ownershipToken ||
    !existsSync(marker) ||
    readFileSync(marker, 'utf8') !== ownershipToken
  )
    throw new Error('Promotion run root ownership was not established');
  rmSync(resolvedRunRoot, { recursive: true, force: true });
}

function assertPromotionContext(packageRoot: string, runRoot: string): void {
  if (!arePromotionPathsEqual(packageRoot, resolve(runRoot, 'package')))
    throw new Error('Promotion package root must belong to the run root');
  if (isPromotionPathWithinOrEqual(runRoot, repositoryRoot))
    throw new Error('Promotion run root cannot be inside the repository');
}

export function isPromotionPathWithinOrEqual(
  candidate: string,
  parent: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const candidatePath = resolve(candidate);
  const parentPath = resolve(parent);
  const normalizedCandidate =
    platform === 'win32' ? candidatePath.toLowerCase() : candidatePath;
  const normalizedParent =
    platform === 'win32' ? parentPath.toLowerCase() : parentPath;
  return (
    normalizedCandidate === normalizedParent ||
    normalizedCandidate.startsWith(
      `${normalizedParent}${platform === 'win32' ? '\\' : '/'}`,
    )
  );
}

function arePromotionPathsEqual(left: string, right: string): boolean {
  return (
    isPromotionPathWithinOrEqual(left, right) &&
    isPromotionPathWithinOrEqual(right, left)
  );
}

function establishRunRootOwnership(runRoot: string, buildId: string): void {
  const resolvedRunRoot = resolve(runRoot);
  if (existsSync(resolvedRunRoot)) {
    if (readdirSync(resolvedRunRoot).length > 0)
      throw new Error('Promotion run root must be a new, empty directory');
  } else {
    // The run root is intentionally created only after its boundary is validated.
    // Its marker makes later recursive cleanup attributable to this run.
    mkdirSync(resolvedRunRoot, { recursive: true });
  }
  writeFileSync(resolve(resolvedRunRoot, ownershipMarker), buildId, {
    flag: 'wx',
  });
}

function describeCleanupFailure(failure: CleanupFailure): string {
  return `${failure.operation} at ${failure.path}: ${
    failure.error instanceof Error
      ? failure.error.message
      : String(failure.error)
  }`;
}

export function runPromotionGates(options: PromotionGateOptions = {}): void {
  let stage = 'startup cleanup';
  const context = (options.createContext ?? createCoreRunContext)();
  let lockToken: string | undefined;
  let ownsRunRoot = false;
  const clean =
    options.cleanOutputs ??
    ((packageRoot?: string) => cleanOutputs(packageRoot, context.runRoot));
  const removeRunRoot = options.removeRunRoot ?? removeOwnedRunRoot;
  const execute =
    options.execute ??
    ((command, childOptions) => {
      execFileSync(command[0], command.slice(1), childOptions);
    });
  let promotionError: unknown;
  try {
    assertPromotionContext(context.packageRoot, context.runRoot);
    establishRunRootOwnership(context.runRoot, context.buildId);
    ownsRunRoot = true;
    createCorePackageWorkspace(repositoryRoot, context.packageRoot);
    lockToken = (options.acquireLock ?? acquireCoreOutputLock)({
      lockPath: context.lockPath,
    });
    if (!clean(context.packageRoot))
      throw new Error('Could not clean generated outputs');
    for (const [checkpoint, command] of gates) {
      stage = checkpoint;
      console.log(`${checkpoint} starting: ${command.join(' ')}`);
      if (checkpoint === 'C2-artifacts') {
        assertCompleteArtifactInventory(
          context.packageRoot,
          context.runRoot,
          context.buildId,
        );
      } else {
        execute(command, {
          stdio: 'inherit',
          timeout: childTimeoutMs,
          killSignal: 'SIGTERM',
          env: {
            ...process.env,
            NEST_BASE_PROMOTION_BUILD_ID: context.buildId,
            NEST_BASE_CORE_RUN_ROOT: context.runRoot,
            NEST_BASE_CORE_PACKAGE_ROOT: context.packageRoot,
            NEST_BASE_CORE_LOCK_PATH: context.lockPath,
            NEST_BASE_CORE_SOURCE_ROOT: resolve(
              context.packageRoot,
              'src/common',
            ),
            NEST_BASE_REPOSITORY_ROOT: repositoryRoot,
            NEST_BASE_CORE_LOCK_TOKEN: lockToken,
            ...(checkpoint === 'C3'
              ? {
                  NEST_BASE_CONSUMER_USE_EXISTING_BUILD: '1',
                  NEST_BASE_CONSUMER_PRESERVE_CORE_OUTPUTS: '1',
                }
              : {}),
          },
        });
      }
      console.log(`${checkpoint} passed`);
    }
  } catch (error) {
    console.error(`Promotion failed at ${stage}; cleanup pending.`);
    console.error(formatChildFailure(error));
    promotionError = error;
  } finally {
    const cleanupFailures: CleanupFailure[] = [];
    let cleaned = !ownsRunRoot;
    if (ownsRunRoot) {
      try {
        cleaned = clean(context.packageRoot);
        if (!cleaned)
          cleanupFailures.push({
            operation: 'clean package outputs',
            path: context.packageRoot,
            error: new Error('cleanup returned false'),
          });
      } catch (error) {
        cleanupFailures.push({
          operation: 'clean package outputs',
          path: context.packageRoot,
          error,
        });
      }
    }
    try {
      if (ownsRunRoot) removeRunRoot(context.runRoot, context.buildId);
    } catch (error) {
      cleanupFailures.push({
        operation: 'remove run root',
        path: context.runRoot,
        error,
      });
    }
    if (lockToken)
      (options.releaseLock ?? releaseCoreOutputLock)(
        lockToken,
        context.lockPath,
      );
    else options.cleanupLock?.();
    for (const failure of cleanupFailures)
      console.error(
        `Promotion cleanup failure: ${describeCleanupFailure(failure)}`,
      );
    console.log(
      `Promotion cleanup ${cleanupFailures.length === 0 && cleaned ? 'passed' : 'failed'}`,
    );
    if (!promotionError && cleanupFailures.length > 0)
      promotionError = new Error(
        `Promotion cleanup failed: ${cleanupFailures.map(describeCleanupFailure).join('; ')}`,
      );
  }

  if (promotionError) {
    if (promotionError instanceof Error) throw promotionError;
    throw new Error(String(promotionError));
  }

  console.log(
    'C4 bounded adapter evidence: executable compatibility contract passed.',
  );
  console.log(
    'Promotion gates passed; no data or migration rollback claim is made.',
  );
}

export function formatChildFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details = error as Error & {
    code?: string;
    signal?: string;
    cmd?: string;
  };
  return `Child execution failed: ${details.message}; code=${details.code ?? 'unknown'}; signal=${details.signal ?? 'none'}; command=${details.cmd ?? 'unknown'}`;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename))
  runPromotionGates();
