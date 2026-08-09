import { describe, expect, it } from 'bun:test';
import {
  buildScaffoldCommand,
  verifyVanillaScaffold,
} from '../../../packages/create-nest-base/scaffold';
import { BunInstallContract } from '../../../packages/create-nest-base/install';

async function rejectionMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('create-nest-base scaffold and install contract', () => {
  it('constructs the pinned vanilla Nest command exactly', () => {
    expect(buildScaffoldCommand('demo')).toEqual({
      executable: 'bunx',
      args: [
        '@nestjs/cli@11.0.0',
        'new',
        'demo',
        '--package-manager',
        'bun',
        '--strict',
        '--skip-install',
        '--skip-git',
      ],
    });
  });

  it('requires vanilla package.json, src, and test', () => {
    expect(() =>
      verifyVanillaScaffold('C:\\work\\demo', {
        readPackage: () => ({ name: 'demo' }),
        isDirectory: (path) => path.endsWith('src'),
      }),
    ).toThrow('test');

    expect(
      verifyVanillaScaffold('C:\\work\\demo', {
        readPackage: () => ({ name: 'demo' }),
        isDirectory: (path) => path.endsWith('src') || path.endsWith('test'),
      }),
    ).toEqual({ packageName: 'demo' });
  });

  it('runs exactly one target-CWD bun install with selected dependencies', async () => {
    const calls: Array<{ cwd: string; args: string[] }> = [];
    const contract = new BunInstallContract((command) => {
      calls.push(command);
      return Promise.resolve();
    });
    await contract.install('C:\\work\\demo', {
      dependencies: { '@nest-base/core': '1.0.0' },
    });

    expect(calls).toEqual([{ cwd: 'C:\\work\\demo', args: ['install'] }]);
    expect(
      await rejectionMessage(
        contract.install('C:\\work\\demo', { dependencies: {} }),
      ),
    ).toContain('exactly one');
  });
});
