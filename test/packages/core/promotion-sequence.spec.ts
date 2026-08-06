import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  acquireCoreOutputLock,
  getCoreOutputLockPath,
  releaseCoreOutputLock,
} from '../../../tools/core-run-context';
import {
  cleanPromotionOutputs,
  formatChildFailure,
  isPromotionPathWithinOrEqual,
  runPromotionGates,
} from '../../../tools/promotion-gates';
import {
  runConsumerCommand,
  runConsumerVerification,
} from '../../../tools/verify-consumer';

const repositoryRoot = resolve(process.cwd());
const packageRoot = resolve(repositoryRoot, 'packages/core');

describe.serial('promotion sequence', () => {
  it('runs the complete promotion twice serially with clean output state', () => {
    for (let run = 1; run <= 2; run += 1) {
      const output = execFileSync('bun', ['run', 'audit:promotion'], {
        cwd: repositoryRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
      expect(output).toContain('C0 passed');
      expect(output).toContain('C1 passed');
      expect(output).toContain('C2-build passed');
      expect(output).toContain('C2-artifacts passed');
      expect(output).toContain('C2-artifacts complete (26 files)');
      expect(output).toContain('C2 passed');
      expect(output).toContain('C2-tarball passed');
      expect(output).toContain('C3 passed');
      expect(output).toContain('C4 passed');
      expect(output).toContain('Promotion gates passed');
      expect(output).toContain('Promotion cleanup passed');
      console.log(`serial promotion run ${run} passed`);
    }
    assertNoResidualPromotionState();
  }, 120_000);

  it('isolates concurrent complete promotions', async () => {
    const runRoots = [1, 2].map(() =>
      temporaryDirectory('concurrent-promotion'),
    );
    const runs = runRoots.map((runRoot) =>
      Bun.spawn(['bun', 'run', 'audit:promotion'], {
        cwd: repositoryRoot,
        stdout: 'inherit',
        stderr: 'inherit',
        env: {
          ...process.env,
          NEST_BASE_CORE_RUN_ROOT: runRoot,
          NEST_BASE_CORE_PACKAGE_ROOT: resolve(runRoot, 'package'),
        },
      }),
    );

    try {
      for (let index = 0; index < runs.length; index += 1) {
        expect(await runs[index].exited).toBe(0);
        expect(existsSync(runRoots[index])).toBe(false);
        expect(existsSync(resolve(runRoots[index], 'core-output.lock'))).toBe(
          false,
        );
      }
      assertNoResidualPromotionState();
    } finally {
      for (const runRoot of runRoots)
        rmSync(runRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it('coordinates a direct repository build with a concurrent promotion', async () => {
    const promotion = Bun.spawn(['bun', 'run', 'audit:promotion'], {
      cwd: repositoryRoot,
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const directBuild = Bun.spawn(['bun', 'run', 'build:core'], {
      cwd: repositoryRoot,
      stdout: 'inherit',
      stderr: 'inherit',
    });

    expect(await promotion.exited).toBe(0);
    expect(await directBuild.exited).toBe(0);
    const token = acquireCoreOutputLock();
    try {
      rmSync(resolve(packageRoot, 'dist'), { recursive: true, force: true });
    } finally {
      releaseCoreOutputLock(token);
    }
    assertNoResidualPromotionState();
  }, 120_000);

  it('bounds lock waits and reports the lock owner', () => {
    const lockPath = getCoreOutputLockPath();
    rmSync(lockPath, { recursive: true, force: true });
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      resolve(lockPath, 'owner.json'),
      JSON.stringify({
        pid: process.pid,
        token: 'other-token',
        createdAt: Date.now(),
      }),
    );

    try {
      expect(() =>
        acquireCoreOutputLock({
          timeoutMs: 1,
          now: (() => {
            let calls = 0;
            return () => (calls++ === 0 ? 0 : 2);
          })(),
          wait: () => undefined,
        }),
      ).toThrow(/Timed out after 1ms.*owner=.*other-token/);
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('bounds child execution and retains command diagnostics', () => {
    let receivedTimeout: number | undefined;
    const childError = Object.assign(new Error('child timed out'), {
      code: 'ETIMEDOUT',
      signal: 'SIGTERM',
      cmd: 'bun run build:core',
    });

    expect(() =>
      runConsumerCommand(['bun', 'run', 'build:core'], process.cwd(), {
        timeoutMs: 5,
        exec: ((
          _executable: string,
          _args: readonly string[] | undefined,
          options?: { timeout?: number },
        ) => {
          receivedTimeout = options?.timeout;
          throw childError;
        }) as unknown as typeof import('node:child_process').execFileSync,
      }),
    ).toThrow('child timed out');
    expect(receivedTimeout).toBe(5);
    expect(formatChildFailure(childError)).toContain(
      'code=ETIMEDOUT; signal=SIGTERM; command=bun run build:core',
    );
  });

  it('cleans consumer roots, outputs, and locks after child failure', () => {
    const root = temporaryDirectory('consumer-failure');
    const packageRoot = temporaryDirectory('consumer-package');
    mkdirSync(resolve(packageRoot, 'dist'), { recursive: true });
    const lockPath = getCoreOutputLockPath();
    rmSync(lockPath, { recursive: true, force: true });

    try {
      expect(() =>
        runConsumerVerification({
          root,
          packageRoot,
          run: () => {
            throw new Error('forced consumer failure');
          },
        }),
      ).toThrow('forced consumer failure');
      expect(existsSync(root)).toBe(false);
      expect(existsSync(resolve(packageRoot, 'dist'))).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(packageRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('cleans run roots and locks when acquisition fails', () => {
    const runRoot = temporaryDirectory('lock-failure-run');
    const lockPath = getCoreOutputLockPath();
    rmSync(lockPath, { recursive: true, force: true });

    try {
      expect(() =>
        runPromotionGates({
          createContext: () => ({
            buildId: 'test-build',
            lockPath,
            packageRoot: resolve(runRoot, 'package'),
            runRoot,
          }),
          acquireLock: () => {
            mkdirSync(lockPath, { recursive: true });
            throw new Error('forced lock acquisition failure');
          },
          cleanOutputs: () => true,
          cleanupLock: () => rmSync(lockPath, { recursive: true, force: true }),
        }),
      ).toThrow('forced lock acquisition failure');
      expect(existsSync(runRoot)).toBe(false);
      assertNoResidualPromotionState();
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('cleans forced promotion failures after lock acquisition', () => {
    const runRoot = temporaryDirectory('promotion-failure-run');
    const lockPath = getCoreOutputLockPath();
    rmSync(lockPath, { recursive: true, force: true });

    try {
      expect(() =>
        runPromotionGates({
          createContext: () => ({
            buildId: 'test-build',
            lockPath,
            packageRoot: resolve(runRoot, 'package'),
            runRoot,
          }),
          cleanOutputs: () => true,
          execute: () => {
            throw Object.assign(new Error('forced promotion timeout'), {
              code: 'ETIMEDOUT',
              cmd: 'bun test readiness',
            });
          },
        }),
      ).toThrow('forced promotion timeout');
      expect(existsSync(runRoot)).toBe(false);
      assertNoResidualPromotionState();
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('cleans owned promotion residue without touching a neighboring run root', () => {
    const runRoot = temporaryDirectory('owned-cleanup-run');
    const neighboringRoot = temporaryDirectory('neighbor-run');
    const packageRoot = resolve(runRoot, 'package');
    mkdirSync(resolve(packageRoot, 'dist'), { recursive: true });
    mkdirSync(resolve(packageRoot, '.dist-backup'), { recursive: true });
    mkdirSync(resolve(packageRoot, '.build-types-123'), { recursive: true });
    writeFileSync(resolve(neighboringRoot, 'keep.txt'), 'keep');

    try {
      expect(cleanPromotionOutputs(packageRoot, runRoot)).toBe(true);
      expect(existsSync(resolve(packageRoot, 'dist'))).toBe(false);
      expect(existsSync(resolve(packageRoot, '.dist-backup'))).toBe(false);
      expect(existsSync(resolve(packageRoot, '.build-types-123'))).toBe(false);
      expect(existsSync(resolve(neighboringRoot, 'keep.txt'))).toBe(true);
      expect(cleanPromotionOutputs(packageRoot, runRoot)).toBe(true);
      expect(existsSync(resolve(neighboringRoot, 'keep.txt'))).toBe(true);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(neighboringRoot, { recursive: true, force: true });
    }
  });

  it('cleans owned promotion residue with Windows-equivalent path casing', () => {
    if (process.platform !== 'win32') return;

    const runRoot = temporaryDirectory('case-insensitive-cleanup-run');
    const packageRoot = resolve(runRoot, 'package');
    const differentlyCasedPackageRoot = resolve(
      runRoot.toUpperCase(),
      'PACKAGE',
    );
    mkdirSync(resolve(packageRoot, 'dist'), { recursive: true });

    try {
      expect(cleanPromotionOutputs(differentlyCasedPackageRoot, runRoot)).toBe(
        true,
      );
      expect(existsSync(resolve(packageRoot, 'dist'))).toBe(false);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('reports independent cleanup failures with the owned operation and path', () => {
    const runRoot = temporaryDirectory('cleanup-diagnostics-run');
    const packageRoot = resolve(runRoot, 'package');
    let removedRunRoot = false;
    let cleanCalls = 0;
    const errors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));

    try {
      expect(() =>
        runPromotionGates({
          createContext: () => ({
            buildId: 'test-build',
            lockPath: resolve(runRoot, 'lock'),
            packageRoot,
            runRoot,
          }),
          acquireLock: () => 'test-token',
          releaseLock: () => undefined,
          cleanOutputs: () => {
            cleanCalls += 1;
            return cleanCalls === 1;
          },
          execute: () => {
            throw new Error('forced gate failure');
          },
          removeRunRoot: () => {
            removedRunRoot = true;
            throw new Error('run root handle');
          },
        }),
      ).toThrow('forced gate failure');
      expect(removedRunRoot).toBe(true);
      expect(errors.join('\n')).toContain('clean package outputs');
      expect(errors.join('\n')).toContain('remove run root');
    } finally {
      console.error = originalConsoleError;
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('refuses cleanup outside the owned run root', () => {
    const runRoot = temporaryDirectory('ownership-run');
    const outsideRoot = temporaryDirectory('outside-run');
    mkdirSync(resolve(outsideRoot, 'dist'), { recursive: true });

    try {
      expect(cleanPromotionOutputs(outsideRoot, runRoot)).toBe(false);
      expect(existsSync(resolve(outsideRoot, 'dist'))).toBe(true);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });

  it('does not remove repository state when the run root is misconfigured', () => {
    const lockPath = temporaryDirectory('misconfigured-lock');
    const repositoryRunRoot = resolve(repositoryRoot, 'packages/core');
    const packageRoot = resolve(repositoryRoot, 'promotion-package');

    try {
      expect(() =>
        runPromotionGates({
          createContext: () => ({
            buildId: 'test-build',
            lockPath,
            packageRoot,
            runRoot: repositoryRunRoot,
          }),
          acquireLock: () => 'test-token',
          releaseLock: () => undefined,
          execute: () => {
            throw new Error('forced misconfigured run');
          },
        }),
      ).toThrow('Promotion package root must belong to the run root');
      expect(existsSync(packageRoot)).toBe(false);
      expect(existsSync(repositoryRunRoot)).toBe(true);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('rejects a pre-existing external run root without deleting it', () => {
    const runRoot = temporaryDirectory('pre-existing-run');
    const packageRoot = resolve(runRoot, 'package');
    writeFileSync(resolve(runRoot, 'keep.txt'), 'keep');

    try {
      expect(() =>
        runPromotionGates({
          createContext: () => ({
            buildId: 'test-build',
            lockPath: resolve(runRoot, 'lock'),
            packageRoot,
            runRoot,
          }),
          acquireLock: () => 'test-token',
          releaseLock: () => undefined,
        }),
      ).toThrow('Promotion run root must be a new, empty directory');
      expect(existsSync(resolve(runRoot, 'keep.txt'))).toBe(true);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('does not delete a run root owned by another invocation', () => {
    const runRoot = temporaryDirectory('active-run');
    const packageRoot = resolve(runRoot, 'package');
    writeFileSync(resolve(runRoot, '.promotion-owner'), 'other-build');
    mkdirSync(resolve(packageRoot, 'dist'), { recursive: true });

    try {
      expect(() =>
        runPromotionGates({
          createContext: () => ({
            buildId: 'current-build',
            lockPath: resolve(runRoot, 'lock'),
            packageRoot,
            runRoot,
          }),
          acquireLock: () => 'test-token',
          releaseLock: () => undefined,
        }),
      ).toThrow('Promotion run root must be a new, empty directory');
      expect(existsSync(resolve(runRoot, '.promotion-owner'))).toBe(true);
      expect(existsSync(resolve(packageRoot, 'dist'))).toBe(true);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('uses case-insensitive containment for Windows repository paths', () => {
    const repositoryRoot = resolve(process.cwd(), 'packages');
    const differentlyCasedRunRoot = resolve(process.cwd(), 'PACKAGES', 'run');

    expect(
      isPromotionPathWithinOrEqual(
        differentlyCasedRunRoot,
        repositoryRoot,
        'win32',
      ),
    ).toBe(true);
  });
});

function temporaryDirectory(name: string): string {
  const directory = resolve(tmpdir(), `nest-base-${name}-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function matchingCoreRunRoots(): string[] {
  return readdirSync(tmpdir(), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith('nest-base-core-run-'),
    )
    .map((entry) => entry.name)
    .sort();
}

function matchingIndependentConsumerRoots(): string[] {
  return readdirSync(tmpdir(), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith('nest-base-independent-'),
    )
    .map((entry) => entry.name)
    .sort();
}

function assertNoResidualPromotionState(): void {
  const token = acquireCoreOutputLock();
  try {
    expect(existsSync(resolve(packageRoot, 'dist'))).toBe(false);
    expect(existsSync(resolve(packageRoot, '.build-types'))).toBe(false);
    expect(existsSync(resolve(packageRoot, 'tsconfig.json'))).toBe(false);
    expect(readdirSync(packageRoot).some((name) => name.endsWith('.tgz'))).toBe(
      false,
    );
    expect(matchingCoreRunRoots()).toEqual([]);
    expect(matchingIndependentConsumerRoots()).toEqual([]);
    expect(readdirSync(tmpdir()).some((name) => name.endsWith('.tgz'))).toBe(
      false,
    );
  } finally {
    releaseCoreOutputLock(token);
  }
  expect(existsSync(getCoreOutputLockPath())).toBe(false);
}
