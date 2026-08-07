import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const defaultLockRoot = resolve(tmpdir(), 'nest-base-core-output.lock');
const lockWaitTimeoutMs = 30_000;

export interface CoreLockOptions {
  lockPath?: string;
  timeoutMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => void;
  beforePublish?: () => void;
}

export interface CoreRunContext {
  buildId: string;
  lockPath: string;
  packageRoot: string;
  runRoot: string;
}

interface LockOwner {
  pid: number;
  token: string;
  createdAt?: number;
}

export function createCoreRunContext(): CoreRunContext {
  const runRoot =
    process.env.NEST_BASE_CORE_RUN_ROOT ??
    join(tmpdir(), `nest-base-core-run-${randomUUID()}`);
  return {
    buildId: process.env.NEST_BASE_PROMOTION_BUILD_ID ?? randomUUID(),
    lockPath: process.env.NEST_BASE_CORE_LOCK_PATH ?? defaultLockRoot,
    packageRoot:
      process.env.NEST_BASE_CORE_PACKAGE_ROOT ?? join(runRoot, 'package'),
    runRoot,
  };
}

export function getCoreRunContext(): CoreRunContext {
  const buildId = process.env.NEST_BASE_PROMOTION_BUILD_ID ?? randomUUID();
  const runRoot =
    process.env.NEST_BASE_CORE_RUN_ROOT ??
    join(tmpdir(), `nest-base-core-run-${randomUUID()}`);
  return {
    buildId,
    lockPath: process.env.NEST_BASE_CORE_LOCK_PATH ?? defaultLockRoot,
    packageRoot:
      process.env.NEST_BASE_CORE_PACKAGE_ROOT ?? join(runRoot, 'package'),
    runRoot,
  };
}

export function createCorePackageWorkspace(
  repositoryRoot: string,
  packageRoot: string,
): void {
  const sourcePackageRoot = resolve(repositoryRoot, 'packages/core');
  mkdirSync(resolve(packageRoot, '..'), { recursive: true });
  cpSync(sourcePackageRoot, packageRoot, {
    recursive: true,
    filter: (path) => {
      const relative = path.slice(sourcePackageRoot.length);
      return !/(^|[\\/])(dist|\.build-types(?:-[^\\/]*)?)([\\/]|$)/.test(
        relative,
      );
    },
  });
  cpSync(
    resolve(repositoryRoot, 'src/common'),
    resolve(packageRoot, 'src/common'),
    { recursive: true },
  );
}

export function runCoreBuildInWorkspace(repositoryRoot: string): string {
  const root = join(tmpdir(), `nest-base-direct-build-${randomUUID()}`);
  const packageRoot = join(root, 'package');
  const runRoot = join(root, 'run');
  createCorePackageWorkspace(repositoryRoot, packageRoot);
  try {
    symlinkSync(
      resolve(repositoryRoot, 'node_modules'),
      join(packageRoot, 'node_modules'),
      'junction',
    );
    execFileSync('bun', [resolve(repositoryRoot, 'packages/core/build.ts')], {
      cwd: repositoryRoot,
      stdio: 'ignore',
      env: {
        ...process.env,
        NEST_BASE_PROMOTION_BUILD_ID: randomUUID(),
        NEST_BASE_CORE_RUN_ROOT: runRoot,
        NEST_BASE_CORE_PACKAGE_ROOT: packageRoot,
        NEST_BASE_CORE_SOURCE_ROOT: join(packageRoot, 'src/common'),
        NEST_BASE_CORE_LOCK_PATH: defaultLockRoot,
        NEST_BASE_REPOSITORY_ROOT: repositoryRoot,
      },
    });
    return packageRoot;
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

export function cleanupCoreBuildWorkspace(packageRoot: string): void {
  rmSync(resolve(packageRoot, '..'), { recursive: true, force: true });
}

export function withCoreOutputLock<T>(
  operation: () => T,
  options: CoreLockOptions = {},
): T {
  const inheritedToken = process.env.NEST_BASE_CORE_LOCK_TOKEN;
  if (inheritedToken && lockTokenMatches(inheritedToken)) return operation();

  const token = acquireLock(options);
  const previousToken = process.env.NEST_BASE_CORE_LOCK_TOKEN;
  process.env.NEST_BASE_CORE_LOCK_TOKEN = token;
  try {
    return operation();
  } finally {
    if (previousToken) process.env.NEST_BASE_CORE_LOCK_TOKEN = previousToken;
    else delete process.env.NEST_BASE_CORE_LOCK_TOKEN;
    releaseLock(token, options.lockPath);
  }
}

export function acquireCoreOutputLock(options: CoreLockOptions = {}): string {
  const inheritedToken = process.env.NEST_BASE_CORE_LOCK_TOKEN;
  if (inheritedToken && lockTokenMatches(inheritedToken)) return inheritedToken;

  const token = acquireLock(options);
  process.env.NEST_BASE_CORE_LOCK_TOKEN = token;
  return token;
}

export function releaseCoreOutputLock(token: string, lockPath?: string): void {
  if (ownsLock(token, lockPath)) releaseLock(token, lockPath);
}

export function getCoreOutputLockPath(lockPath?: string): string {
  return resolve(
    lockPath ?? process.env.NEST_BASE_CORE_LOCK_PATH ?? defaultLockRoot,
  );
}

function acquireLock(options: CoreLockOptions): string {
  const lockRoot = getCoreOutputLockPath(options.lockPath);
  const publishingRoot = `${lockRoot}.publishing-${randomUUID()}`;
  const token = randomUUID();
  const now = options.now ?? Date.now;
  const wait =
    options.wait ??
    ((milliseconds: number) => {
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        milliseconds,
      );
    });
  const timeoutMs = options.timeoutMs ?? lockWaitTimeoutMs;
  const deadline = now() + timeoutMs;
  for (;;) {
    let attemptedPublish = false;
    try {
      mkdirSync(publishingRoot);
      writeFileSync(
        resolve(publishingRoot, 'owner.json'),
        JSON.stringify({
          pid: process.pid,
          token,
          createdAt: Date.now(),
        } satisfies LockOwner),
      );
      options.beforePublish?.();
      attemptedPublish = true;
      renameSync(publishingRoot, lockRoot);
      return token;
    } catch (error) {
      rmSync(publishingRoot, { recursive: true, force: true });
      const isPublishContention =
        attemptedPublish &&
        error instanceof Error &&
        'code' in error &&
        error.code === 'EPERM';
      if (
        (!isPublishContention && !(error instanceof Error)) ||
        !('code' in error) ||
        (!isPublishContention && error.code !== 'EEXIST')
      ) {
        throw error;
      }
      if (removeDeadLock(lockRoot)) continue;
      if (now() >= deadline) {
        throw new Error(
          `Timed out after ${timeoutMs}ms waiting for core output lock ${lockRoot}; ${describeLockOwner(lockRoot)}`,
        );
      }
      wait(50);
    }
  }
}

function removeDeadLock(lockRoot: string): boolean {
  let owner: LockOwner | undefined;
  let ownerContent: string | undefined;
  try {
    ownerContent = readFileSync(resolve(lockRoot, 'owner.json'), 'utf8');
    const parsedOwner: unknown = JSON.parse(ownerContent);
    if (!isLockOwner(parsedOwner))
      return quarantineMalformedLock(lockRoot, ownerContent);
    owner = parsedOwner;
    process.kill(owner.pid, 0);
    return false;
  } catch (error) {
    if (ownerContent !== undefined && owner === undefined)
      return quarantineMalformedLock(lockRoot, ownerContent);
    if (
      error instanceof Error &&
      'code' in error &&
      (error.code === 'EPERM' || error.code === 'ENOENT')
    )
      return false;

    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ESRCH'
    )
      return false;

    try {
      if (!owner) return false;
      const currentOwnerContent = readFileSync(
        resolve(lockRoot, 'owner.json'),
        'utf8',
      );
      const currentOwner = JSON.parse(currentOwnerContent) as LockOwner;
      if (
        currentOwnerContent !== ownerContent ||
        currentOwner.pid !== owner.pid ||
        currentOwner.token !== owner.token
      )
        return false;
      const quarantine = `${lockRoot}.quarantine-${randomUUID()}`;
      renameSync(lockRoot, quarantine);
      const quarantinedOwnerPath = resolve(quarantine, 'owner.json');
      if (
        readFileSync(quarantinedOwnerPath, 'utf8') !== currentOwnerContent ||
        readdirSync(quarantine).length !== 1
      )
        return false;
      rmSync(quarantinedOwnerPath, { force: true });
      rmdirSync(quarantine);
      return true;
    } catch {
      return false;
    }
  }
}

function isLockOwner(value: unknown): value is LockOwner {
  if (!value || typeof value !== 'object') return false;
  const owner = value as Partial<LockOwner>;
  const pid = owner.pid;
  return (
    typeof pid === 'number' &&
    Number.isInteger(pid) &&
    pid > 0 &&
    typeof owner.token === 'string'
  );
}

function quarantineMalformedLock(
  lockRoot: string,
  expectedOwnerContent: string,
): boolean {
  const quarantine = `${lockRoot}.quarantine-${randomUUID()}`;
  try {
    renameSync(lockRoot, quarantine);
    const quarantinedOwnerPath = resolve(quarantine, 'owner.json');
    if (
      readFileSync(quarantinedOwnerPath, 'utf8') !== expectedOwnerContent ||
      readdirSync(quarantine).length !== 1
    ) {
      if (!existsSync(lockRoot)) {
        try {
          renameSync(quarantine, lockRoot);
        } catch {
          // Keep the quarantine when the original path changed concurrently.
        }
      }
      return false;
    }
    rmSync(quarantinedOwnerPath, { force: true });
    rmdirSync(quarantine);
    return true;
  } catch {
    return false;
  }
}

function ownsLock(token: string, lockPath?: string): boolean {
  const lockRoot = getCoreOutputLockPath(lockPath);
  try {
    const owner = JSON.parse(
      readFileSync(resolve(lockRoot, 'owner.json'), 'utf8'),
    ) as LockOwner;
    return owner.pid === process.pid && owner.token === token;
  } catch {
    return false;
  }
}

function lockTokenMatches(token: string): boolean {
  const lockRoot = getCoreOutputLockPath();
  try {
    const owner = JSON.parse(
      readFileSync(resolve(lockRoot, 'owner.json'), 'utf8'),
    ) as LockOwner;
    return owner.token === token;
  } catch {
    return false;
  }
}

function describeLockOwner(lockPath?: string): string {
  const lockRoot = getCoreOutputLockPath(lockPath);
  try {
    return `owner=${readFileSync(resolve(lockRoot, 'owner.json'), 'utf8')}`;
  } catch {
    return 'owner metadata unavailable';
  }
}

function releaseLock(token: string, lockPath?: string): void {
  const lockRoot = getCoreOutputLockPath(lockPath);
  if (ownsLock(token, lockPath))
    rmSync(lockRoot, { recursive: true, force: true });
}
