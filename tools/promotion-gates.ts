import { execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  acquireCoreOutputLock,
  createCorePackageWorkspace,
  createCoreRunContext,
  getCoreOutputLockPath,
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
  ) => void | Promise<void>;
  createContext?: typeof createCoreRunContext;
  cleanOutputs?: (packageRoot?: string) => boolean;
  cleanHttpCoreOutputs?: () => boolean;
  cleanCoreRepositoryOutputs?: () => boolean;
  removeRunRoot?: (runRoot: string, ownershipToken?: string) => void;
}

export type ProcessIdentity = {
  pid: number;
  commandLine: string;
  startTime: string;
  owner: string;
};

type CleanupFailure = {
  operation: string;
  path: string;
  error: unknown;
};

type PromotionCommand = readonly [string, readonly string[]];

const gates: readonly PromotionCommand[] = [
  ['C0', ['bun', 'test', 'test/architecture/core-readiness.spec.ts']],
  ['C1', ['bun', 'test', 'test/packages/core/context-audit.spec.ts']],
  ['C2-build', ['bun', 'run', 'build:core']],
  ['C2-artifacts', ['bun', '-e', 'assertCompleteArtifactInventory()']],
  ['C2', ['bun', 'run', 'audit:core']],
  ['C2-tarball', ['bun', 'run', 'audit:tarball']],
  ['C3', ['bun', 'run', 'verify:consumer']],
  ['C4', ['bun', 'test', 'test/packages/core/promotion-contract.spec.ts']],
  ['http-core-build', ['bun', 'run', 'build:http-core']],
  ['http-core-audit', ['bun', 'run', 'audit:http-core']],
  ['http-core-tarball', ['bun', 'run', 'audit:http-core:tarball']],
  ['http-core-consumer', ['bun', 'run', 'verify:http-core:consumer']],
];

const frozenInstall: PromotionCommand = [
  'install',
  ['bun', 'install', '--frozen-lockfile'],
];

export function getPromotionCommands(): readonly PromotionCommand[] {
  return [frozenInstall, ...gates];
}

export function getPromotionCheckpointEvidence(checkpoint: string): {
  packageName: '@nest-base/core' | '@nest-base/http-core';
  checkpoint: string;
} {
  return {
    packageName: checkpoint.startsWith('http-core')
      ? '@nest-base/http-core'
      : '@nest-base/core',
    checkpoint,
  };
}

const repositoryRoot = resolve(process.cwd());
const childTimeoutMs = 120_000;
const cleanupMaxRetries = 3;
const staleRunRootAgeMs = 5 * 60_000;
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
    for (const path of getPackageCleanupPaths(packageRoot))
      removeOwnedPath(path);
    for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith('.build-types-'))
        removeOwnedPath(resolve(packageRoot, entry.name));
    }
    return getPromotionResidue(packageRoot, runRoot).length === 0;
  } catch {
    return false;
  }
}

export function getPromotionResidue(
  packageRoot: string,
  runRoot: string,
): string[] {
  if (!arePromotionPathsEqual(packageRoot, resolve(runRoot, 'package')))
    return [resolve(packageRoot)];

  const residue = new Set<string>();
  for (const path of getPackageCleanupPaths(packageRoot))
    if (existsSync(path)) residue.add(path);
  if (existsSync(packageRoot)) {
    try {
      for (const entry of readdirSync(packageRoot, { withFileTypes: true }))
        if (
          (entry.isDirectory() && entry.name.startsWith('.build-types-')) ||
          (entry.isFile() && entry.name.endsWith('.tgz'))
        )
          residue.add(resolve(packageRoot, entry.name));
    } catch {
      residue.add(resolve(packageRoot));
    }
  }
  if (existsSync(runRoot)) {
    try {
      for (const entry of readdirSync(runRoot, { withFileTypes: true }))
        if (
          entry.name !== ownershipMarker &&
          entry.name !== 'promotion-build-id' &&
          entry.name !== 'package'
        )
          residue.add(resolve(runRoot, entry.name));
    } catch {
      residue.add(resolve(runRoot));
    }
  }
  return [...residue].sort();
}

function cleanDeclaredPackageOutputs(packageRoot: string): boolean {
  try {
    for (const path of getPackageCleanupPaths(packageRoot))
      removeOwnedPath(path);
    for (const entry of readdirSync(packageRoot, { withFileTypes: true }))
      if (entry.isFile() && entry.name.endsWith('.tgz'))
        removeOwnedPath(resolve(packageRoot, entry.name));
    return getDeclaredPackageResidue(packageRoot).length === 0;
  } catch {
    return false;
  }
}

function getDeclaredPackageResidue(packageRoot: string): string[] {
  const residue: string[] = [];
  for (const path of getPackageCleanupPaths(packageRoot))
    if (existsSync(path)) residue.push(path);
  try {
    for (const entry of readdirSync(packageRoot, { withFileTypes: true }))
      if (entry.isFile() && entry.name.endsWith('.tgz'))
        residue.push(resolve(packageRoot, entry.name));
  } catch {
    residue.push(resolve(packageRoot));
  }
  return residue.sort();
}

export function isStalePromotionRunRoot(
  runRoot: string,
  now = Date.now(),
  lockPath = getCoreOutputLockPath(),
  lockToken?: string,
): boolean {
  const resolvedRunRoot = resolve(runRoot);
  const marker = resolve(resolvedRunRoot, ownershipMarker);
  if (
    resolve(resolvedRunRoot, '..') !== resolve(tmpdir()) ||
    !basename(resolvedRunRoot).startsWith('nest-base-core-run-') ||
    !existsSync(marker)
  )
    return false;
  if (isPromotionLockActive(lockPath, lockToken)) return false;
  try {
    const markerAge = now - statSync(marker).mtimeMs;
    return markerAge >= staleRunRootAgeMs;
  } catch {
    return false;
  }
}

export function cleanStalePromotionRunRoots(
  except?: string,
  lockPath?: string,
  lockToken?: string,
): void {
  for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runRoot = resolve(tmpdir(), entry.name);
    if (
      (!except || !arePromotionPathsEqual(runRoot, except)) &&
      isStalePromotionRunRoot(runRoot, Date.now(), lockPath, lockToken)
    )
      removeOwnedPath(runRoot);
  }
}

function isPromotionLockActive(lockPath: string, lockToken?: string): boolean {
  try {
    const owner = JSON.parse(
      readFileSync(resolve(lockPath, 'owner.json'), 'utf8'),
    ) as { pid?: number };
    if (
      lockToken &&
      owner.pid === process.pid &&
      (owner as { token?: string }).token === lockToken
    )
      return false;
    const pid = owner.pid;
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0)
      return true;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'EPERM' || error.code === 'EACCES')
    )
      return true;
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
      return false;
    return true;
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
  removeOwnedPath(resolvedRunRoot);
}

function removeOwnedPath(path: string): void {
  rmSync(path, {
    recursive: true,
    force: true,
    maxRetries: cleanupMaxRetries,
    retryDelay: 100,
  });
}

function getPackageCleanupPaths(packageRoot: string): string[] {
  return [
    resolve(packageRoot, 'dist'),
    resolve(packageRoot, '.dist-backup'),
    resolve(packageRoot, '.build-work'),
    resolve(packageRoot, '.build-types'),
  ];
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

function removeUnownedEmptyRunRoot(runRoot: string): void {
  const quarantine = `${resolve(runRoot)}.quarantine-${randomUUID()}`;
  try {
    if (!existsSync(runRoot) || readdirSync(runRoot).length !== 0) return;
    renameSync(runRoot, quarantine);
    if (readdirSync(quarantine).length === 0) rmdirSync(quarantine);
    else if (!existsSync(runRoot)) {
      try {
        renameSync(quarantine, runRoot);
      } catch {
        // A new owner may have acquired the original path; retain the quarantine.
      }
    }
  } catch {
    // An unowned or concurrently changed waiter root must never be deleted.
  }
}

function describeCleanupFailure(failure: CleanupFailure): string {
  return `${failure.operation} at ${failure.path}: ${
    failure.error instanceof Error
      ? failure.error.message
      : String(failure.error)
  }`;
}

function promotionFailureStatus(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const details = error as Error & { status?: number; code?: string };
  return String(details.status ?? details.code ?? 'unknown');
}

export function validateFrozenInstallSnapshot(
  lockfileBefore: string,
  lockfileAfter: string,
  declaredCoreVersion: string,
  lockfileCoreResolution: string,
): void {
  if (lockfileAfter !== lockfileBefore)
    throw new Error('Frozen install mutated bun.lock');
  if (declaredCoreVersion !== '0.1.0')
    throw new Error(
      'Root package must retain the authoritative @nest-base/core@0.1.0 development resolution',
    );
  let lockfile: {
    workspaces?: {
      '': { devDependencies?: Record<string, string> };
    };
    packages?: Record<string, unknown>;
  };
  try {
    lockfile = JSON.parse(
      lockfileCoreResolution.replace(/,\s*([}\]])/g, '$1'),
    ) as typeof lockfile;
  } catch {
    throw new Error(
      'bun.lock must retain the authoritative @nest-base/core@0.1.0 resolution',
    );
  }
  const rootResolution =
    lockfile.workspaces?.['']?.devDependencies?.['@nest-base/core'];
  const packageResolution = lockfile.packages?.['@nest-base/core'];
  if (
    rootResolution !== '0.1.0' ||
    !Array.isArray(packageResolution) ||
    packageResolution[0] !== '@nest-base/core@0.1.0'
  )
    throw new Error(
      'bun.lock must retain the authoritative @nest-base/core@0.1.0 resolution',
    );
}

function assertFrozenInstallContract(lockfileBefore: string): void {
  const lockfileAfter = readFileSync(
    resolve(repositoryRoot, 'bun.lock'),
    'utf8',
  );
  const manifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
  ) as { devDependencies?: Record<string, string> };
  validateFrozenInstallSnapshot(
    lockfileBefore,
    lockfileAfter,
    manifest.devDependencies?.['@nest-base/core'] ?? '',
    lockfileAfter,
  );
}

export async function runPromotionGates(
  options: PromotionGateOptions = {},
): Promise<void> {
  let stage = 'startup cleanup';
  const context = (options.createContext ?? createCoreRunContext)();
  let lockToken: string | undefined;
  let ownsRunRoot = false;
  const clean =
    options.cleanOutputs ??
    ((packageRoot?: string) => cleanOutputs(packageRoot, context.runRoot));
  const cleanHttpCore =
    options.cleanHttpCoreOutputs ??
    (() =>
      cleanDeclaredPackageOutputs(
        resolve(repositoryRoot, 'packages/http-core'),
      ));
  const cleanCoreRepository =
    options.cleanCoreRepositoryOutputs ??
    (() =>
      cleanDeclaredPackageOutputs(resolve(repositoryRoot, 'packages/core')));
  const removeRunRoot = options.removeRunRoot ?? removeOwnedRunRoot;
  const execute =
    options.execute ??
    ((command, childOptions) => {
      return executeBoundedCommand(command, childOptions);
    });
  let promotionError: unknown;
  const lockfileBefore = readFileSync(
    resolve(repositoryRoot, 'bun.lock'),
    'utf8',
  );
  try {
    assertPromotionContext(context.packageRoot, context.runRoot);
    lockToken = (options.acquireLock ?? acquireCoreOutputLock)({
      lockPath: context.lockPath,
      timeoutMs: childTimeoutMs,
    });
    establishRunRootOwnership(context.runRoot, context.buildId);
    ownsRunRoot = true;
    cleanStalePromotionRunRoots(context.runRoot, context.lockPath, lockToken);
    createCorePackageWorkspace(repositoryRoot, context.packageRoot);
    if (!clean(context.packageRoot))
      throw new Error('Could not clean generated outputs');
    if (!cleanHttpCore())
      throw new Error('Could not clean HTTP-core generated outputs');
    if (!cleanCoreRepository())
      throw new Error('Could not clean core repository generated outputs');
    for (const [checkpoint, command] of getPromotionCommands()) {
      stage = checkpoint;
      console.log(`${checkpoint} starting: ${command.join(' ')}`);
      if (checkpoint === 'install') {
        await execute(command, {
          stdio: 'inherit',
          timeout: childTimeoutMs,
          killSignal: 'SIGTERM',
          env: { ...process.env, NEST_BASE_REPOSITORY_ROOT: repositoryRoot },
        });
        assertFrozenInstallContract(lockfileBefore);
      } else if (checkpoint === 'C2-artifacts') {
        assertCompleteArtifactInventory(
          context.packageRoot,
          context.runRoot,
          context.buildId,
        );
      } else {
        await execute(command, {
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
            NEST_BASE_PROMOTION_RUN_ROOT: context.runRoot,
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
    const evidence = getPromotionCheckpointEvidence(stage);
    console.error(
      `Promotion failed at ${evidence.checkpoint} for ${evidence.packageName}; status=${promotionFailureStatus(error)}; cleanup pending.`,
    );
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
      for (const path of getPromotionResidue(
        context.packageRoot,
        context.runRoot,
      ))
        cleanupFailures.push({
          operation: 'residual artifact',
          path,
          error: new Error('cleanup could not prove absence'),
        });
      if (!cleanHttpCore())
        cleanupFailures.push({
          operation: 'clean HTTP-core outputs',
          path: resolve(repositoryRoot, 'packages/http-core'),
          error: new Error('cleanup returned false'),
        });
      if (!cleanCoreRepository())
        cleanupFailures.push({
          operation: 'clean core repository outputs',
          path: resolve(repositoryRoot, 'packages/core'),
          error: new Error('cleanup returned false'),
        });
      for (const path of getDeclaredPackageResidue(
        resolve(repositoryRoot, 'packages/http-core'),
      ))
        cleanupFailures.push({
          operation: 'HTTP-core residual artifact',
          path,
          error: new Error('cleanup could not prove absence'),
        });
      for (const path of getDeclaredPackageResidue(
        resolve(repositoryRoot, 'packages/core'),
      ))
        cleanupFailures.push({
          operation: 'core repository residual artifact',
          path,
          error: new Error('cleanup could not prove absence'),
        });
    }
    try {
      if (ownsRunRoot) removeRunRoot(context.runRoot, context.buildId);
      else removeUnownedEmptyRunRoot(context.runRoot);
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

export function executeBoundedCommand(
  command: readonly string[],
  childOptions: ChildExecutionOptions,
  dependencies: {
    exec?: (
      file: string,
      args: readonly string[],
      options: ChildExecutionOptions,
      callback: (error: Error | null) => void,
    ) => ChildProcess;
    capture?: typeof captureProcessIdentity;
    terminate?: typeof terminateProcessTree;
  } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = childOptions.timeout;
    const executionOptions = {
      ...childOptions,
      timeout: undefined,
      detached: true,
      killSignal: undefined,
    } as unknown as ChildExecutionOptions;
    let baseline: ProcessIdentity | null = null;
    let child: ChildProcess;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const settleReject = (error: unknown) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    try {
      child = (dependencies.exec ?? execFile)(
        command[0],
        command.slice(1),
        executionOptions,
        (error) => {
          if (!error) {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            resolve();
            return;
          }
          const details = error as Error & {
            code?: string;
            signal?: string;
          };
          if (
            (details.code === 'ETIMEDOUT' || details.signal === 'SIGTERM') &&
            baseline &&
            typeof child.pid === 'number'
          ) {
            const current = (dependencies.capture ?? captureProcessIdentity)(
              child.pid,
            );
            if (
              current &&
              isExpectedProcess(current, command) &&
              isSameProcessIdentity(current, baseline)
            )
              (dependencies.terminate ?? terminateProcessTree)(baseline);
          }
          settleReject(error);
        },
      );
    } catch (error) {
      settleReject(error);
      return;
    }

    baseline = child.pid
      ? captureIdentityBaseline(child.pid, dependencies)
      : null;
    if (typeof timeout === 'number')
      timer = setTimeout(() => {
        const expected = baseline;
        const current =
          typeof child.pid === 'number'
            ? (dependencies.capture ?? captureProcessIdentity)(child.pid)
            : null;
        if (
          current &&
          expected &&
          isExpectedProcess(current, command) &&
          isSameProcessIdentity(current, expected)
        )
          (dependencies.terminate ?? terminateProcessTree)(expected);
        settleReject(
          Object.assign(new Error('Child execution timed out'), {
            code: 'ETIMEDOUT',
            pid: child.pid,
            signal: 'SIGTERM',
            cmd: command.join(' '),
          }),
        );
      }, timeout);
  });
}

export function captureProcessIdentity(pid: number): ProcessIdentity | null {
  try {
    if (process.platform === 'win32') {
      const output = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { $o=$p.GetOwner(); [pscustomobject]@{CommandLine=$p.CommandLine; CreationDate=$p.CreationDate.ToUniversalTime().ToString('o'); Owner="$($o.Domain)\\$($o.User)"} | ConvertTo-Json -Compress }`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
      if (!output) return null;
      const processInfo = JSON.parse(output) as {
        CommandLine?: string;
        CreationDate?: string;
        Owner?: string;
      };
      if (
        !processInfo.CommandLine ||
        !processInfo.CreationDate ||
        !processInfo.Owner
      )
        return null;
      return {
        pid,
        commandLine: processInfo.CommandLine,
        startTime: processInfo.CreationDate,
        owner: processInfo.Owner,
      };
    }
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const statFields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const commandLine = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
      .replaceAll('\0', ' ')
      .trim();
    const owner = String(statSync(`/proc/${pid}`).uid);
    const startTime = statFields[19];
    if (!commandLine || !startTime) return null;
    return { pid, commandLine, startTime, owner };
  } catch {
    return null;
  }
}

function captureIdentityBaseline(
  pid: number,
  dependencies: { capture?: typeof captureProcessIdentity },
): ProcessIdentity | null {
  const capture = dependencies.capture ?? captureProcessIdentity;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const identity = capture(pid);
    if (identity) return identity;
    if (attempt < 4)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  return null;
}

export function isExpectedProcess(
  identity: ProcessIdentity,
  command: readonly string[],
): boolean {
  const expectedCommand = command.join(' ');
  return (
    identity.commandLine.includes(expectedCommand) ||
    command.every((part) => identity.commandLine.includes(part))
  );
}

export function terminateProcessTree(identity: ProcessIdentity): void {
  try {
    const current = captureProcessIdentity(identity.pid);
    if (!current || !isSameProcessIdentity(current, identity)) return;
    if (process.platform === 'win32')
      execFileSync('taskkill', ['/PID', String(identity.pid), '/T', '/F'], {
        stdio: 'ignore',
      });
    else {
      try {
        process.kill(-identity.pid, 'SIGTERM');
      } catch {
        // The process group may have exited between validation and cleanup.
      }
    }
  } catch {
    // The process tree may have exited between timeout detection and cleanup.
  }
}

export function isSameProcessIdentity(
  current: ProcessIdentity,
  expected: ProcessIdentity,
): boolean {
  return (
    current.pid === expected.pid &&
    current.commandLine === expected.commandLine &&
    current.startTime === expected.startTime &&
    current.owner === expected.owner
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename))
  runPromotionGates().catch((error: unknown) => {
    console.error(formatChildFailure(error));
    process.exitCode = 1;
  });
