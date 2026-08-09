import { execFileSync } from 'node:child_process';
/* eslint-disable @typescript-eslint/await-thenable */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
  utimesSync,
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
  cleanStalePromotionRunRoots,
  captureProcessIdentity,
  executeBoundedCommand,
  formatChildFailure,
  getPromotionResidue,
  getPromotionCommands,
  isPromotionPathWithinOrEqual,
  isSameProcessIdentity,
  isStalePromotionRunRoot,
  runPromotionGates,
  terminateProcessTree,
  validateFrozenInstallSnapshot,
} from '../../../tools/promotion-gates';
import {
  runConsumerCommand,
  runConsumerVerification,
} from '../../../tools/verify-consumer';

const repositoryRoot = resolve(process.cwd());
const packageRoot = resolve(repositoryRoot, 'packages/core');

describe.serial('promotion sequence', () => {
  it('defines the frozen-install-first combined core and HTTP-core contract', () => {
    expect(getPromotionCommands()).toEqual([
      ['install', ['bun', 'install', '--frozen-lockfile']],
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
    ]);
  });

  it('stops at the first failed checkpoint and reports its contract boundary', async () => {
    const runRoot = temporaryDirectory('combined-failure-run');
    const commands: string[] = [];

    try {
      await expect(
        runPromotionGates({
          createContext: () => ({
            buildId: 'test-build',
            lockPath: resolve(runRoot, 'lock'),
            packageRoot: resolve(runRoot, 'package'),
            runRoot,
          }),
          acquireLock: () => 'test-token',
          releaseLock: () => undefined,
          cleanOutputs: () => true,
          execute: (command) => {
            commands.push(command.join(' '));
            if (commands.length === 2)
              throw Object.assign(new Error('core readiness failed'), {
                code: 7,
                cmd: command.join(' '),
              });
          },
        }),
      ).rejects.toThrow(/core readiness failed/);

      expect(commands).toEqual([
        'bun install --frozen-lockfile',
        'bun test test/architecture/core-readiness.spec.ts',
      ]);
      expect(commands).not.toContain('bun run build:http-core');
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('fails closed with package, checkpoint, status, and child diagnostics', async () => {
    const runRoot = temporaryDirectory('diagnostic-failure-run');
    const errors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));

    try {
      await expect(
        runPromotionGates({
          createContext: () => ({
            buildId: 'diagnostic-build',
            lockPath: resolve(runRoot, 'lock'),
            packageRoot: resolve(runRoot, 'package'),
            runRoot,
          }),
          acquireLock: () => 'diagnostic-token',
          releaseLock: () => undefined,
          cleanOutputs: () => true,
          execute: (command) => {
            if (command[0] === 'bun' && command[1] === 'test')
              throw Object.assign(new Error('readiness child failed'), {
                code: 17,
                cmd: command.join(' '),
              });
          },
        }),
      ).rejects.toThrow('readiness child failed');

      const diagnostics = errors.join('\n');
      expect(diagnostics).toContain('@nest-base/core');
      expect(diagnostics).toContain('C0');
      expect(diagnostics).toContain('status=17');
      expect(diagnostics).toContain(
        'Child execution failed: readiness child failed; code=17; signal=none; command=bun test test/architecture/core-readiness.spec.ts',
      );
    } finally {
      console.error = originalConsoleError;
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('blocks a changed lockfile or non-authoritative core resolution', () => {
    expect(() =>
      validateFrozenInstallSnapshot('before', 'after', '0.1.0', '0.1.0'),
    ).toThrow('Frozen install mutated bun.lock');
    expect(() =>
      validateFrozenInstallSnapshot(
        'same',
        'same',
        '1.0.0',
        '"@nest-base/core@0.1.0"',
      ),
    ).toThrow('authoritative @nest-base/core@0.1.0');
  });

  it('rejects invalid lock content when the declared core version is authoritative', () => {
    expect(() =>
      validateFrozenInstallSnapshot(
        'lock-before',
        'lock-before',
        '0.1.0',
        JSON.stringify({
          workspaces: {
            '': { devDependencies: { '@nest-base/core': '1.0.0' } },
          },
          packages: { decoy: ['@nest-base/core@0.1.0'] },
        }),
      ),
    ).toThrow(
      'bun.lock must retain the authoritative @nest-base/core@0.1.0 resolution',
    );
  });

  it('requires the authoritative root lock resolution instead of a decoy occurrence', () => {
    expect(() =>
      validateFrozenInstallSnapshot(
        'lock-before',
        'lock-before',
        '0.1.0',
        JSON.stringify({
          workspaces: {
            '': { devDependencies: { '@nest-base/core': '1.0.0' } },
          },
          packages: { '@nest-base/core': ['@nest-base/core@0.1.0'] },
        }),
      ),
    ).toThrow(
      'bun.lock must retain the authoritative @nest-base/core@0.1.0 resolution',
    );
  });

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
        expect(await waitForChildExit(runs[index])).toBe(0);
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

    expect(await waitForChildExit(promotion)).toBe(0);
    expect(await waitForChildExit(directBuild)).toBe(0);
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

  it('never exposes a partially published lock owner', async () => {
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-publication-${randomUUID()}`,
    );
    const child = Bun.spawn(
      [
        'bun',
        '-e',
        `import { acquireCoreOutputLock, releaseCoreOutputLock } from './tools/core-run-context.ts'; const token = acquireCoreOutputLock({ lockPath: ${JSON.stringify(lockPath)}, beforePublish: () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200) }); await Bun.sleep(200); releaseCoreOutputLock(token, ${JSON.stringify(lockPath)});`,
      ],
      { cwd: repositoryRoot, stdout: 'ignore', stderr: 'ignore' },
    );

    try {
      let observedPublishedOwner = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (existsSync(lockPath)) {
          const owner = JSON.parse(
            await Bun.file(resolve(lockPath, 'owner.json')).text(),
          ) as { pid?: number; token?: string };
          expect(owner.pid).toEqual(child.pid);
          expect(typeof owner.token).toBe('string');
          observedPublishedOwner = true;
          break;
        }
        await Bun.sleep(5);
      }
      expect(observedPublishedOwner).toBe(true);
      expect(await waitForChildExit(child)).toBe(0);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      const identity = captureProcessIdentity(child.pid);
      if (identity) terminateProcessTree(identity);
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('reclaims a hard-killed lock immediately before rerunning', async () => {
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-killed-${randomUUID()}`,
    );
    const child = Bun.spawn(
      [
        'bun',
        '-e',
        `import { acquireCoreOutputLock } from './tools/core-run-context.ts'; acquireCoreOutputLock({ lockPath: ${JSON.stringify(lockPath)} }); await new Promise(() => {});`,
      ],
      { cwd: repositoryRoot, stdout: 'ignore', stderr: 'ignore' },
    );

    try {
      for (
        let attempt = 0;
        attempt < 100 && !existsSync(lockPath);
        attempt += 1
      )
        await Bun.sleep(10);
      expect(existsSync(resolve(lockPath, 'owner.json'))).toBe(true);
      process.kill(child.pid, 'SIGKILL');
      await child.exited;

      const token = acquireCoreOutputLock({
        lockPath,
        timeoutMs: 120_000,
        wait: () => undefined,
      });
      releaseCoreOutputLock(token, lockPath);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      try {
        process.kill(child.pid, 'SIGKILL');
      } catch {
        // The child may already have exited.
      }
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('recovers a malformed lock without deleting a replacement owner', async () => {
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-malformed-recovery-${randomUUID()}`,
    );
    const firstReadyPath = `${lockPath}.first-ready`;
    const firstDonePath = `${lockPath}.first-done`;
    const secondDonePath = `${lockPath}.second-done`;
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(resolve(lockPath, 'owner.json'), '{not-json');

    const firstOwner = Bun.spawn(
      [
        'bun',
        '-e',
        `import { writeFileSync } from 'node:fs'; import { acquireCoreOutputLock, releaseCoreOutputLock } from './tools/core-run-context.ts'; const token = acquireCoreOutputLock({ lockPath: ${JSON.stringify(lockPath)}, timeoutMs: 5000 }); writeFileSync(${JSON.stringify(firstReadyPath)}, 'ready'); await Bun.sleep(300); releaseCoreOutputLock(token, ${JSON.stringify(lockPath)}); writeFileSync(${JSON.stringify(firstDonePath)}, 'done');`,
      ],
      { cwd: repositoryRoot, stdout: 'ignore', stderr: 'ignore' },
    );

    try {
      for (
        let attempt = 0;
        attempt < 100 && !existsSync(firstReadyPath);
        attempt += 1
      )
        await Bun.sleep(10);
      expect(existsSync(firstReadyPath)).toBe(true);

      const secondOwner = Bun.spawn(
        [
          'bun',
          '-e',
          `import { writeFileSync } from 'node:fs'; import { acquireCoreOutputLock, releaseCoreOutputLock } from './tools/core-run-context.ts'; const token = acquireCoreOutputLock({ lockPath: ${JSON.stringify(lockPath)}, timeoutMs: 5000 }); releaseCoreOutputLock(token, ${JSON.stringify(lockPath)}); writeFileSync(${JSON.stringify(secondDonePath)}, 'done');`,
        ],
        { cwd: repositoryRoot, stdout: 'ignore', stderr: 'ignore' },
      );

      await Bun.sleep(100);
      expect(existsSync(secondDonePath)).toBe(false);
      expect(await firstOwner.exited).toBe(0);
      expect(await secondOwner.exited).toBe(0);
      expect(existsSync(firstDonePath)).toBe(true);
      expect(existsSync(secondDonePath)).toBe(true);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      try {
        process.kill(firstOwner.pid, 'SIGKILL');
      } catch {
        // The child may already have exited.
      }
      rmSync(lockPath, { recursive: true, force: true });
      rmSync(firstReadyPath, { force: true });
      rmSync(firstDonePath, { force: true });
      rmSync(secondDonePath, { force: true });
    }
  });

  it('does not clobber a waiter root recreated during stale-root quarantine', async () => {
    const runRoot = resolve(
      tmpdir(),
      `nest-base-core-run-quarantine-${randomUUID()}`,
    );
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-quarantine-${randomUUID()}`,
    );
    const readyPath = `${runRoot}.ready`;
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(resolve(runRoot, '.promotion-owner'), 'stale-build');
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(resolve(runRoot, '.promotion-owner'), old, old);
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      resolve(lockPath, 'owner.json'),
      JSON.stringify({ pid: 2_147_483_647, token: 'dead-owner' }),
    );
    const waiter = Bun.spawn(
      [
        'bun',
        '-e',
        `import { existsSync, mkdirSync, writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(readyPath)}, 'ready'); while (existsSync(${JSON.stringify(runRoot)})) await Bun.sleep(1); mkdirSync(${JSON.stringify(runRoot)}); writeFileSync(${JSON.stringify(resolve(runRoot, 'waiter-owner'))}, 'waiter');`,
      ],
      { cwd: repositoryRoot, stdout: 'ignore', stderr: 'ignore' },
    );

    try {
      for (
        let attempt = 0;
        attempt < 100 && !existsSync(readyPath);
        attempt += 1
      )
        await Bun.sleep(10);
      cleanStalePromotionRunRoots(undefined, lockPath);
      expect(await waiter.exited).toBe(0);
      expect(existsSync(resolve(runRoot, 'waiter-owner'))).toBe(true);
    } finally {
      try {
        process.kill(waiter.pid, 'SIGKILL');
      } catch {
        // The waiter may already have exited.
      }
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
      rmSync(readyPath, { force: true });
    }
  });

  it('serializes concurrent reclamation of the same dead lock without clobbering the new owner', async () => {
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-reclaim-race-${randomUUID()}`,
    );
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      resolve(lockPath, 'owner.json'),
      JSON.stringify({ pid: 2_147_483_647, token: 'dead-owner' }),
    );
    const workers = [1, 2].map(() =>
      Bun.spawn(
        [
          'bun',
          '-e',
          `import { acquireCoreOutputLock, releaseCoreOutputLock } from './tools/core-run-context.ts'; const token = acquireCoreOutputLock({ lockPath: ${JSON.stringify(lockPath)}, timeoutMs: 5000 }); await Bun.sleep(100); releaseCoreOutputLock(token, ${JSON.stringify(lockPath)});`,
        ],
        { cwd: repositoryRoot, stdout: 'ignore', stderr: 'ignore' },
      ),
    );

    try {
      for (const worker of workers) expect(await worker.exited).toBe(0);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('retries when Linux reports a non-empty lock target during publication', () => {
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-enotempty-${randomUUID()}`,
    );
    let publicationAttempts = 0;

    try {
      const token = acquireCoreOutputLock({
        lockPath,
        wait: () => undefined,
        beforePublish: () => {
          if (publicationAttempts++ > 0) return;
          mkdirSync(lockPath, { recursive: true });
          writeFileSync(
            resolve(lockPath, 'owner.json'),
            JSON.stringify({ pid: 2_147_483_647, token: 'dead-owner' }),
          );
        },
      });

      releaseCoreOutputLock(token, lockPath);
      expect(publicationAttempts).toBe(2);
      expect(existsSync(lockPath)).toBe(false);
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

  it('cleans timed-out descendants only after validating the child identity', async () => {
    const identity = {
      pid: 7412,
      commandLine: 'bun run build:core',
      startTime: 'start-1',
      owner: '1000',
    };
    let terminated: typeof identity | undefined;

    await expect(
      executeBoundedCommand(
        ['bun', 'run', 'build:core'],
        { timeout: 5 },
        {
          exec: (_file, _args, _options, callback) => {
            queueMicrotask(() =>
              callback(
                Object.assign(new Error('timed out'), {
                  pid: identity.pid,
                  signal: 'SIGTERM',
                }),
              ),
            );
            return { pid: identity.pid } as never;
          },
          capture: () => identity,
          terminate: (current) => {
            terminated = current;
          },
        },
      ),
    ).rejects.toThrow('timed out');
    expect(terminated).toEqual(identity);
  });

  it('fails closed when the observed process identity does not match the command', async () => {
    const identity = {
      pid: 7412,
      commandLine: 'unrelated-process',
      startTime: 'start-1',
      owner: '1000',
    };
    let terminated = false;

    await expect(
      executeBoundedCommand(
        ['bun', 'run', 'build:core'],
        { timeout: 5 },
        {
          exec: (_file, _args, _options, callback) => {
            queueMicrotask(() =>
              callback(
                Object.assign(new Error('timed out'), {
                  pid: identity.pid,
                  signal: 'SIGTERM',
                }),
              ),
            );
            return { pid: identity.pid } as never;
          },
          capture: () => identity,
          terminate: () => {
            terminated = true;
          },
        },
      ),
    ).rejects.toThrow('timed out');
    expect(terminated).toBe(false);
  });

  it('rejects a reused PID when its start time or owner changes', () => {
    const expected = {
      pid: 7412,
      commandLine: 'bun run build:core',
      startTime: 'start-1',
      owner: '1000',
    };

    expect(
      isSameProcessIdentity({ ...expected, startTime: 'start-2' }, expected),
    ).toBe(false);
    expect(
      isSameProcessIdentity({ ...expected, owner: '1001' }, expected),
    ).toBe(false);
  });

  it('does not terminate a same-command process when the PID is reused after timeout', async () => {
    const original = {
      pid: 7412,
      commandLine: 'bun run build:core',
      startTime: 'start-1',
      owner: '1000',
    };
    const replacement = { ...original, startTime: 'start-2' };
    let captures = 0;
    let terminated = false;

    await expect(
      executeBoundedCommand(
        ['bun', 'run', 'build:core'],
        { timeout: 5 },
        {
          exec: (_file, _args, _options, callback) => {
            queueMicrotask(() =>
              callback(
                Object.assign(new Error('timed out'), {
                  pid: original.pid,
                  signal: 'SIGTERM',
                }),
              ),
            );
            return { pid: original.pid } as never;
          },
          capture: () => {
            captures += 1;
            return captures === 1 ? original : replacement;
          },
          terminate: () => {
            terminated = true;
          },
        },
      ),
    ).rejects.toThrow('timed out');
    expect(captures).toBe(2);
    expect(terminated).toBe(false);
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

  it('cleans run roots and locks when acquisition fails', async () => {
    const runRoot = temporaryDirectory('lock-failure-run');
    const lockPath = getCoreOutputLockPath();
    rmSync(lockPath, { recursive: true, force: true });

    try {
      await expect(
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
      ).rejects.toThrow('forced lock acquisition failure');
      expect(existsSync(runRoot)).toBe(false);
      assertNoResidualPromotionState();
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('cleans forced promotion failures after lock acquisition', async () => {
    const runRoot = temporaryDirectory('promotion-failure-run');
    const lockPath = getCoreOutputLockPath();
    rmSync(lockPath, { recursive: true, force: true });

    try {
      await expect(
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
      ).rejects.toThrow('forced promotion timeout');
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

  it('reports independent cleanup failures with the owned operation and path', async () => {
    const runRoot = temporaryDirectory('cleanup-diagnostics-run');
    const packageRoot = resolve(runRoot, 'package');
    let removedRunRoot = false;
    let cleanCalls = 0;
    const errors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));

    try {
      await expect(
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
      ).rejects.toThrow('forced gate failure');
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

  it('does not remove repository state when the run root is misconfigured', async () => {
    const lockPath = temporaryDirectory('misconfigured-lock');
    const repositoryRunRoot = resolve(repositoryRoot, 'packages/core');
    const packageRoot = resolve(repositoryRoot, 'promotion-package');

    try {
      await expect(
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
      ).rejects.toThrow('Promotion package root must belong to the run root');
      expect(existsSync(packageRoot)).toBe(false);
      expect(existsSync(repositoryRunRoot)).toBe(true);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('rejects a pre-existing external run root without deleting it', async () => {
    const runRoot = temporaryDirectory('pre-existing-run');
    const packageRoot = resolve(runRoot, 'package');
    writeFileSync(resolve(runRoot, 'keep.txt'), 'keep');

    try {
      await expect(
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
      ).rejects.toThrow('Promotion run root must be a new, empty directory');
      expect(existsSync(resolve(runRoot, 'keep.txt'))).toBe(true);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('enumerates owned residual artifacts instead of treating cleanup as a boolean', () => {
    const runRoot = temporaryDirectory('residue-diagnostics-run');
    const packageRoot = resolve(runRoot, 'package');
    mkdirSync(resolve(packageRoot, 'dist'), { recursive: true });
    mkdirSync(resolve(packageRoot, '.build-work'), { recursive: true });
    writeFileSync(resolve(packageRoot, 'artifact.tgz'), 'artifact');
    mkdirSync(resolve(runRoot, 'consumer'), { recursive: true });

    try {
      expect(getPromotionResidue(packageRoot, runRoot)).toEqual(
        [
          resolve(packageRoot, '.build-work'),
          resolve(packageRoot, 'artifact.tgz'),
          resolve(packageRoot, 'dist'),
          resolve(runRoot, 'consumer'),
        ].sort(),
      );
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('recognizes only aged, marker-owned run roots as stale', () => {
    const staleRoot = resolve(
      tmpdir(),
      `nest-base-core-run-stale-${randomUUID()}`,
    );
    const activeRoot = resolve(
      tmpdir(),
      `nest-base-core-run-active-${randomUUID()}`,
    );
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-stale-${randomUUID()}`,
    );
    mkdirSync(staleRoot, { recursive: true });
    mkdirSync(activeRoot, { recursive: true });
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(resolve(staleRoot, '.promotion-owner'), 'stale-build');
    writeFileSync(resolve(activeRoot, '.promotion-owner'), 'active-build');
    writeFileSync(
      resolve(lockPath, 'owner.json'),
      JSON.stringify({ pid: 2_147_483_647 }),
    );
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(resolve(staleRoot, '.promotion-owner'), old, old);

    try {
      expect(isStalePromotionRunRoot(staleRoot, Date.now(), lockPath)).toBe(
        true,
      );
      expect(isStalePromotionRunRoot(activeRoot, Date.now(), lockPath)).toBe(
        false,
      );
      expect(
        isStalePromotionRunRoot(
          resolve(tmpdir(), 'unrelated'),
          Date.now(),
          lockPath,
        ),
      ).toBe(false);
      cleanStalePromotionRunRoots(undefined, lockPath);
      expect(existsSync(staleRoot)).toBe(false);
      expect(existsSync(activeRoot)).toBe(true);
    } finally {
      rmSync(staleRoot, { recursive: true, force: true });
      rmSync(activeRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('protects aged run roots when lock owner metadata is malformed', () => {
    const runRoot = resolve(
      tmpdir(),
      `nest-base-core-run-malformed-lock-${randomUUID()}`,
    );
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-malformed-${randomUUID()}`,
    );
    mkdirSync(runRoot, { recursive: true });
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(resolve(runRoot, '.promotion-owner'), 'owned-build');
    writeFileSync(resolve(lockPath, 'owner.json'), '{not-json');
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(resolve(runRoot, '.promotion-owner'), old, old);

    try {
      expect(isStalePromotionRunRoot(runRoot, Date.now(), lockPath)).toBe(
        false,
      );
      cleanStalePromotionRunRoots(undefined, lockPath);
      expect(existsSync(runRoot)).toBe(true);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('sweeps stale roots while retaining ownership of the current promotion lock', async () => {
    const runRoot = temporaryDirectory('current-lock-run');
    const staleRoot = resolve(
      tmpdir(),
      `nest-base-core-run-stale-during-lock-${randomUUID()}`,
    );
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-current-${randomUUID()}`,
    );
    mkdirSync(staleRoot, { recursive: true });
    writeFileSync(resolve(staleRoot, '.promotion-owner'), 'stale-build');
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(resolve(staleRoot, '.promotion-owner'), old, old);

    try {
      await expect(
        runPromotionGates({
          createContext: () => ({
            buildId: 'current-build',
            lockPath,
            packageRoot: resolve(runRoot, 'package'),
            runRoot,
          }),
          acquireLock: (options) => acquireCoreOutputLock(options),
          releaseLock: (token, path) => releaseCoreOutputLock(token, path),
          cleanOutputs: () => true,
          cleanHttpCoreOutputs: () => true,
          cleanCoreRepositoryOutputs: () => true,
          execute: () => {
            throw new Error('stop after stale-root sweep');
          },
        }),
      ).rejects.toThrow('stop after stale-root sweep');
      expect(existsSync(staleRoot)).toBe(false);
    } finally {
      rmSync(staleRoot, { recursive: true, force: true });
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('does not sweep an aged concurrent waiter before it acquires the lock', async () => {
    const runRoot = resolve(
      tmpdir(),
      `nest-base-core-run-waiter-${randomUUID()}`,
    );
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-waiter-${randomUUID()}`,
    );
    mkdirSync(runRoot, { recursive: true });
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(runRoot, old, old);
    let waiterSurvivedSweep = false;

    try {
      await expect(
        runPromotionGates({
          createContext: () => ({
            buildId: 'waiter-build',
            lockPath,
            packageRoot: resolve(runRoot, 'package'),
            runRoot,
          }),
          acquireLock: () => {
            mkdirSync(lockPath, { recursive: true });
            writeFileSync(
              resolve(lockPath, 'owner.json'),
              JSON.stringify({ pid: 2_147_483_647, token: 'holder-token' }),
            );
            cleanStalePromotionRunRoots(undefined, lockPath);
            waiterSurvivedSweep = existsSync(runRoot);
            return 'waiter-token';
          },
          releaseLock: () => undefined,
          cleanOutputs: () => true,
          cleanHttpCoreOutputs: () => true,
          cleanCoreRepositoryOutputs: () => true,
          execute: () => {
            throw new Error('stop after waiter registration');
          },
        }),
      ).rejects.toThrow('stop after waiter registration');
      expect(waiterSurvivedSweep).toBe(true);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('protects aged run roots when lock owner metadata is unreadable', () => {
    const runRoot = resolve(
      tmpdir(),
      `nest-base-core-run-unreadable-lock-${randomUUID()}`,
    );
    const lockPath = resolve(
      tmpdir(),
      `nest-base-core-lock-unreadable-${randomUUID()}`,
    );
    mkdirSync(runRoot, { recursive: true });
    mkdirSync(resolve(lockPath, 'owner.json'), { recursive: true });
    writeFileSync(resolve(runRoot, '.promotion-owner'), 'owned-build');
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(resolve(runRoot, '.promotion-owner'), old, old);

    try {
      expect(isStalePromotionRunRoot(runRoot, Date.now(), lockPath)).toBe(
        false,
      );
      cleanStalePromotionRunRoots(undefined, lockPath);
      expect(existsSync(runRoot)).toBe(true);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('preserves a long-running active root whose ownership marker is old', () => {
    const runRoot = resolve(
      tmpdir(),
      `nest-base-core-run-long-running-${randomUUID()}`,
    );
    const lockPath = resolve(tmpdir(), `nest-base-core-lock-${randomUUID()}`);
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(resolve(runRoot, '.promotion-owner'), 'active-build');
    const old = new Date(Date.now() - 10 * 60_000);
    utimesSync(resolve(runRoot, '.promotion-owner'), old, old);
    const lockToken = acquireCoreOutputLock({ lockPath });

    try {
      cleanStalePromotionRunRoots(undefined, lockPath);
      expect(existsSync(runRoot)).toBe(true);
      expect(isStalePromotionRunRoot(runRoot, Date.now(), lockPath)).toBe(
        false,
      );
    } finally {
      releaseCoreOutputLock(lockToken, lockPath);
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(lockPath, { recursive: true, force: true });
    }
  });

  it('fails closed and reports residual paths when owned cleanup cannot prove absence', async () => {
    const runRoot = temporaryDirectory('residue-failure-run');
    const packageRoot = resolve(runRoot, 'package');
    const errors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => errors.push(args.join(' '));

    try {
      await expect(
        runPromotionGates({
          createContext: () => ({
            buildId: 'residue-build',
            lockPath: resolve(runRoot, 'lock'),
            packageRoot,
            runRoot,
          }),
          acquireLock: () => 'residue-token',
          releaseLock: () => undefined,
          cleanOutputs: () => {
            mkdirSync(resolve(packageRoot, 'dist'), { recursive: true });
            return false;
          },
          execute: () => {
            throw new Error('forced residue failure');
          },
          removeRunRoot: () => {
            throw new Error('residue root remains');
          },
        }),
      ).rejects.toThrow('Could not clean generated outputs');

      expect(errors.join('\n')).toContain('residual artifact');
      expect(errors.join('\n')).toContain(resolve(packageRoot, 'dist'));
    } finally {
      console.error = originalConsoleError;
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('waits for the bounded promotion lock budget during concurrent runs', async () => {
    const runRoot = temporaryDirectory('lock-budget-run');
    let timeoutMs: number | undefined;

    try {
      await expect(
        runPromotionGates({
          createContext: () => ({
            buildId: 'lock-budget-build',
            lockPath: resolve(runRoot, 'lock'),
            packageRoot: resolve(runRoot, 'package'),
            runRoot,
          }),
          acquireLock: (options) => {
            timeoutMs = options?.timeoutMs;
            throw new Error('bounded lock failure');
          },
          cleanupLock: () => undefined,
        }),
      ).rejects.toThrow('bounded lock failure');
      expect(timeoutMs).toBe(120_000);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('does not delete a run root owned by another invocation', async () => {
    const runRoot = temporaryDirectory('active-run');
    const packageRoot = resolve(runRoot, 'package');
    writeFileSync(resolve(runRoot, '.promotion-owner'), 'other-build');
    mkdirSync(resolve(packageRoot, 'dist'), { recursive: true });

    try {
      await expect(
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
      ).rejects.toThrow('Promotion run root must be a new, empty directory');
      expect(existsSync(resolve(runRoot, '.promotion-owner'))).toBe(true);
      expect(existsSync(resolve(packageRoot, 'dist'))).toBe(true);
    } finally {
      rmSync(runRoot, { recursive: true, force: true });
    }
  });

  it('uses case-insensitive containment for Windows repository paths', () => {
    const repositoryRoot = 'C:\\repo\\packages';
    const differentlyCasedRunRoot = 'C:\\repo\\PACKAGES\\run';

    expect(
      isPromotionPathWithinOrEqual(
        differentlyCasedRunRoot,
        repositoryRoot,
        'win32',
      ),
    ).toBe(true);
  });
});

async function waitForChildExit(child: {
  exited: Promise<number>;
  pid: number;
}) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      child.exited,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const identity = captureProcessIdentity(child.pid);
          if (identity) terminateProcessTree(identity);
          reject(
            new Error(`Promotion child ${child.pid} exceeded its deadline`),
          );
        }, 110_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

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
