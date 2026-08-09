import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { runCli, runCliPipeline } from '../../../packages/create-nest-base/cli';
import { createMetadataFileSystem } from '../../../packages/create-nest-base/metadata';
import type { CliPipelineDependencies } from '../../../packages/create-nest-base/cli';

const bytes = new TextEncoder().encode('packed-artifact');
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const root = join(tmpdir(), 'create-nest-base-pipeline');
const target = join(root, 'demo');
const defaultTarget = join(root, 'default-demo');
const packagePath = join(target, 'package.json');
const manifestPath = join(target, '.nest-base', 'manifest.json');

const args = {
  ci: true,
  dryRun: false,
  yes: true,
  help: false,
  target,
  coreVersion: '1.0.0',
  coreSource: '@nest-base/core@1.0.0',
  coreIntegrity: integrity as `sha512-${string}`,
};

describe('create-nest-base CLI pipeline', () => {
  function dependencies(
    overrides: Partial<CliPipelineDependencies> = {},
  ): CliPipelineDependencies {
    return {
      fileSystem: {
        exists: (path: string) => path === root,
        isDirectory: () => true,
        entries: () => [],
        canWrite: () => true,
      },
      artifactLoaders: {
        registry: () => Promise.resolve({ bytes }),
        inspect: () => ({ package: '@nest-base/core', version: '1.0.0' }),
      },
      independentConsumerGate: { verify: () => Promise.resolve() },
      confirm: () => Promise.resolve(),
      scaffold: () => Promise.resolve(),
      scaffoldFileSystem: {
        readPackage: () => ({ name: 'demo' }),
        isDirectory: () => true,
      },
      metadataFileSystem: createMetadataFileSystem(),
      install: () => Promise.resolve(),
      ...overrides,
    };
  }

  it('runs metadata-enabled CLI flow and compensates on install failure without removing failed target', async () => {
    const targetExists = true;
    const files: Record<string, string> = {
      [packagePath]: JSON.stringify({ name: 'demo' }),
    };
    const binaryFiles: Record<string, Uint8Array> = {};
    const metadataFileSystem = {
      readFile: (path: string) => files[path],
      writeFile: (path: string, content: string) => {
        files[path] = content;
      },
      exists: (path: string) => path in files || path in binaryFiles,
      mkdir: () => undefined,
      removeFile: (path: string) => {
        delete files[path];
        delete binaryFiles[path];
      },
      writeBytes: (path: string, content: Uint8Array) => {
        binaryFiles[path] = content;
      },
      readBytes: (path: string) => binaryFiles[path],
    };
    let message = 'pipeline unexpectedly succeeded';
    try {
      await runCliPipeline(
        args,
        dependencies({
          fileSystem: {
            exists: (path: string) =>
              path === root || (path === target && targetExists),
            isDirectory: () => true,
            entries: () => [],
            canWrite: () => true,
          },
          metadataFileSystem,
          install: () => Promise.reject(new Error('install failed')),
        }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('Rollback completed');
    expect(JSON.parse(files[packagePath])).toMatchObject({
      name: 'demo',
    });
    expect(files[manifestPath]).toBeUndefined();
    expect(targetExists).toBe(true);
  });

  it('reports a real leftover and recovery diagnostic when install mutates an owned file', async () => {
    const files: Record<string, string> = {
      [packagePath]: JSON.stringify({ name: 'demo' }),
    };
    const binaryFiles: Record<string, Uint8Array> = {};
    const metadataFileSystem = {
      readFile: (path: string) => files[path],
      writeFile: (path: string, content: string) => {
        files[path] = content;
      },
      exists: (path: string) => path in files || path in binaryFiles,
      mkdir: () => undefined,
      removeFile: (path: string) => {
        delete files[path];
        delete binaryFiles[path];
      },
      writeBytes: (path: string, content: Uint8Array) => {
        binaryFiles[path] = content;
      },
      readBytes: (path: string) => binaryFiles[path],
    };
    let message = 'pipeline unexpectedly succeeded';
    try {
      await runCliPipeline(
        args,
        dependencies({
          metadataFileSystem,
          install: () => {
            files[packagePath] = 'changed by install';
            return Promise.reject(new Error('install failed'));
          },
        }),
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(`Leftovers: ${packagePath}`);
    expect(files[packagePath]).toBe('changed by install');
  });

  it('retries a preserved scaffold without invoking scaffold again', async () => {
    const calls: string[] = [];
    await runCliPipeline(
      { ...args, retry: true },
      dependencies({
        metadataFileSystem: undefined,
        fileSystem: {
          exists: (path) => path === root || path === target,
          isDirectory: () => true,
          entries: () => ['package.json'],
          canWrite: () => true,
        },
        scaffold: () => {
          calls.push('scaffold');
          return Promise.resolve();
        },
        install: () => {
          calls.push('install');
          return Promise.resolve();
        },
      }),
    );
    expect(calls).toEqual(['install']);
  });
  it('fails closed when no real packed artifact or consumer runner is available', () => {
    return expect(
      runCli(args, {
        fileSystem: {
          exists: (path) => path === root,
          isDirectory: () => true,
          entries: () => [],
          canWrite: () => true,
        },
        artifactLoaders: { registry: () => Promise.resolve(undefined) },
        confirm: () => Promise.resolve(),
        scaffold: () => Promise.resolve(),
        scaffoldFileSystem: {
          readPackage: () => ({ name: 'demo' }),
          isDirectory: () => true,
        },
        install: () => Promise.resolve(),
      }),
    ).rejects.toThrow('unavailable');
  });

  it('takes the default interactive plan through the artifact gate', () => {
    const calls: string[] = [];

    expect(
      runCli(
        {
          ci: false,
          dryRun: false,
          yes: false,
          help: false,
          target: defaultTarget,
        },
        {
          fileSystem: {
            exists: (path) => path === root,
            isDirectory: () => true,
            entries: () => [],
            canWrite: () => true,
          },
          artifactLoaders: {
            registry: () => {
              calls.push('artifact-gate');
              return Promise.resolve(undefined);
            },
          },
          confirm: () => Promise.resolve(),
          scaffold: () => Promise.resolve(),
          scaffoldFileSystem: {
            readPackage: () => ({ name: 'default-demo' }),
            isDirectory: () => true,
          },
          install: () => Promise.resolve(),
        },
      ),
    ).rejects.toThrow('unavailable');

    expect(calls).toEqual(['artifact-gate']);
  });

  it('refuses before confirmation and writes when the target is not writable', async () => {
    const calls: string[] = [];
    let message = 'resolved';
    try {
      await runCli(args, {
        fileSystem: {
          exists: (path) => {
            if (!calls.includes('preflight')) calls.push('preflight');
            return path === root;
          },
          isDirectory: () => true,
          entries: () => [],
          canWrite: () => false,
        },
        artifactLoaders: { registry: () => Promise.resolve(undefined) },
        confirm: () => {
          calls.push('confirm');
          return Promise.resolve();
        },
        scaffold: () => {
          calls.push('scaffold');
          return Promise.resolve();
        },
        scaffoldFileSystem: {
          readPackage: () => ({ name: 'demo' }),
          isDirectory: () => true,
        },
        install: () => {
          calls.push('install');
          return Promise.resolve();
        },
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('writable');
    expect(calls).toEqual(['preflight']);
  });

  it('rejects a relative target before confirmation, scaffold, install, or filesystem writes', async () => {
    const calls: string[] = [];
    let message = 'resolved';
    try {
      await runCli(
        { ...args, target: 'relative-target' },
        {
          fileSystem: {
            exists: () => {
              calls.push('filesystem');
              return false;
            },
            isDirectory: () => {
              calls.push('filesystem');
              return true;
            },
            entries: () => {
              calls.push('filesystem');
              return [];
            },
            canWrite: () => {
              calls.push('filesystem');
              return true;
            },
          },
          artifactLoaders: {
            registry: () => {
              calls.push('artifact');
              return Promise.resolve({ bytes });
            },
          },
          confirm: () => {
            calls.push('confirm');
            return Promise.resolve();
          },
          scaffold: () => {
            calls.push('scaffold');
            return Promise.resolve();
          },
          scaffoldFileSystem: {
            readPackage: () => {
              calls.push('scaffold-read');
              return { name: 'demo' };
            },
            isDirectory: () => {
              calls.push('scaffold-read');
              return true;
            },
          },
          install: () => {
            calls.push('install');
            return Promise.resolve();
          },
        },
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('unsafe target');
    expect(calls).toEqual([]);
  });

  it('executes preflight, artifact gate, confirmation, scaffold, and exactly one install in order', async () => {
    const calls: string[] = [];
    const result = await runCli(args, {
      fileSystem: {
        exists: (path) => {
          if (!calls.includes('preflight')) calls.push('preflight');
          return path === root;
        },
        isDirectory: () => true,
        entries: () => [],
        canWrite: () => true,
      },
      artifactLoaders: {
        registry: () => {
          calls.push('artifact-gate');
          return Promise.resolve({ bytes });
        },
        inspect: () => ({ package: '@nest-base/core', version: '1.0.0' }),
      },
      independentConsumerGate: {
        verify: () => {
          calls.push('consumer');
          return Promise.resolve();
        },
      },
      confirm: () => {
        calls.push('confirm');
        return Promise.resolve();
      },
      scaffold: (command) => {
        calls.push(`scaffold:${command.args.join(' ')}`);
        return Promise.resolve();
      },
      scaffoldFileSystem: {
        readPackage: () => ({ name: 'demo' }),
        isDirectory: () => true,
      },
      install: (command) => {
        calls.push(`install:${command.cwd}`);
        return Promise.resolve();
      },
    });

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual([
      'preflight',
      'artifact-gate',
      'consumer',
      'confirm',
      'scaffold:@nestjs/cli@11.0.0 new demo --strict --skip-install --skip-git',
      `install:${target}`,
    ]);
  });

  it('allows an accepted non-CI confirmation and performs no writes when cancelled', async () => {
    const interactiveArgs = {
      ...args,
      ci: false,
      yes: false,
      coreSource: '@nest-base/core@1.0.0',
    };
    const calls: string[] = [];
    const result = await runCli(
      interactiveArgs,
      dependencies({
        metadataFileSystem: undefined,
        confirm: () => {
          calls.push('confirm');
          return Promise.resolve();
        },
        scaffold: () => {
          calls.push('scaffold');
          return Promise.resolve();
        },
        install: () => {
          calls.push('install');
          return Promise.resolve();
        },
      }),
    );
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual(['confirm', 'scaffold', 'install']);

    const cancelled: string[] = [];
    let cancelledMessage = 'unexpected success';
    try {
      await runCli(
        interactiveArgs,
        dependencies({
          metadataFileSystem: undefined,
          confirm: () => {
            cancelled.push('confirm');
            return Promise.reject(
              new Error('Plan was not confirmed. No writes were performed.'),
            );
          },
          scaffold: () => {
            cancelled.push('scaffold');
            return Promise.resolve();
          },
          install: () => {
            cancelled.push('install');
            return Promise.resolve();
          },
        }),
      );
    } catch (error) {
      cancelledMessage = error instanceof Error ? error.message : String(error);
    }
    expect(cancelledMessage).toContain('No writes were performed');
    expect(cancelled).toEqual(['confirm']);
  });
});
