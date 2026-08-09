import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import {
  createConsumerManifest,
  createConsumerInstallCommand,
  createConsumerBuildCommands,
  createConsumerSource,
  createIndependentConsumerGate,
} from '../../../packages/create-nest-base/consumer-gate';
import { runCliPipeline } from '../../../packages/create-nest-base/cli';

setDefaultTimeout(120_000);

describe('create-nest-base independent consumer gate', () => {
  it('creates a consumer manifest that installs only the packed core and its runtime peers', () => {
    const tarball = resolve('C:/tmp/core.tgz');
    expect(createConsumerManifest(tarball)).toEqual({
      name: 'nest-base-independent-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@nest-base/core': pathToFileURL(tarball).href.replace(
          /^file:\/\/\/([A-Za-z]:\/)/,
          'file://$1',
        ),
        'reflect-metadata': '0.2.2',
        typeorm: '0.3.31',
      },
    });
  });

  it('installs the packed consumer with lifecycle scripts disabled', () => {
    expect(createConsumerInstallCommand()).toEqual([
      'install',
      '--ignore-scripts',
    ]);
  });

  it('serializes a Windows-shaped tarball path as a portable file URL', () => {
    const tarball =
      process.platform === 'win32'
        ? 'C:\\tmp\\core.tgz'
        : resolve('C:/tmp/core.tgz');

    expect(
      createConsumerManifest(tarball).dependencies['@nest-base/core'],
    ).toBe(
      pathToFileURL(tarball).href.replace(
        /^file:\/\/\/([A-Za-z]:\/)/,
        'file://$1',
      ),
    );
    expect(
      createConsumerManifest(tarball).dependencies['@nest-base/core'],
    ).toMatch(/^file:\/\//);
  });

  it('creates a representative consumer that imports the installed package', () => {
    const source = createConsumerSource();

    expect(source).toContain("from '@nest-base/core'");
    expect(source).toContain('BaseService');
    expect(source).not.toContain('packages/core');
  });

  it('creates a packed HTTP-core consumer without repository-source fallback', () => {
    const source = createConsumerSource('http-core');
    expect(source).toContain("from '@nest-base/http-core'");
    expect(source).not.toContain('packages/http-core');
    expect(() =>
      createConsumerManifest('C:/tmp/http-core.tgz', 'http-core'),
    ).toThrow('packed core dependency');
    const manifest = createConsumerManifest(
      'C:/tmp/http-core.tgz',
      'http-core',
      new Map([['core-crud', 'C:/tmp/core.tgz']]),
    );
    expect(manifest.dependencies['@nest-base/http-core']).toContain(
      'http-core.tgz',
    );
    expect(manifest.dependencies['@nest-base/core']).toContain('core.tgz');
    expect(manifest.dependencies['@nest-base/core']).not.toBe('0.1.0');
  });

  it('runs both ESM and CJS build/runtime commands for HTTP-core', () => {
    expect(createConsumerBuildCommands('http-core')).toEqual([
      [
        'build',
        'src/index.ts',
        '--outfile',
        'dist/esm/index.js',
        '--target',
        'node',
        '--format',
        'esm',
        '--external',
        '@nest-base/http-core',
        '--external',
        '@nest-base/core',
      ],
      ['dist/esm/index.js'],
      [
        'build',
        'src/index.ts',
        '--outfile',
        'dist/cjs/index.cjs',
        '--target',
        'node',
        '--format',
        'cjs',
        '--external',
        '@nest-base/http-core',
        '--external',
        '@nest-base/core',
      ],
      ['dist/cjs/index.cjs'],
    ]);
  });

  it('compiles and runs a consumer against a real packed core artifact', async () => {
    const archiveDirectory = mkdtempSync(`${tmpdir()}/create-nest-base-core-`);
    const packageRoot = resolve(__dirname, '../../../packages/core');
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
      rmSync(resolve(packageRoot, 'dist'), { recursive: true, force: true });
      rmSync(resolve(packageRoot, '.dist-backup'), {
        recursive: true,
        force: true,
      });
      const packed = Bun.spawnSync(
        [process.execPath, 'packages/core/build.ts'],
        { cwd: resolve(packageRoot, '../..'), stdout: 'pipe', stderr: 'pipe' },
      );
      expect(
        packed.exitCode,
        `${packed.stdout.toString()}${packed.stderr.toString()}`,
      ).toBe(0);
      const archiveResult = Bun.spawnSync(
        [
          npm,
          'pack',
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          archiveDirectory,
        ],
        { cwd: packageRoot, stdout: 'pipe', stderr: 'pipe' },
      );
      expect(archiveResult.exitCode).toBe(0);
      const report = JSON.parse(archiveResult.stdout.toString()) as Array<{
        filename: string;
      }>;
      const archive = report[0]?.filename;
      expect(archive).toMatch(/\.tgz$/);
      if (!archive) throw new Error('Core archive was not produced.');
      const artifactBytes = new Uint8Array(
        readFileSync(resolve(archiveDirectory, archive)),
      );
      const integrity: `sha512-${string}` = `sha512-${createHash('sha512')
        .update(artifactBytes)
        .digest('base64')}`;
      const target = resolve(archiveDirectory, 'consumer-target');

      const result = await runCliPipeline(
        {
          ci: true,
          packageManager: 'bun',
          dryRun: false,
          yes: true,
          help: false,
          retry: false,
          target,
          coreVersion: '0.1.0',
          coreSource: '@nest-base/core@0.1.0',
          coreIntegrity: integrity,
          selections: ['core-crud'],
        },
        {
          fileSystem: {
            exists: (path) => path === archiveDirectory || path === target,
            isDirectory: () => true,
            entries: () => [],
            canWrite: () => true,
          },
          artifactLoaders: {
            registry: () => Promise.resolve({ bytes: artifactBytes }),
            inspect: () => ({ package: '@nest-base/core', version: '0.1.0' }),
          },
          independentConsumerGate: createIndependentConsumerGate(),
          confirm: () => Promise.resolve(),
          scaffold: () => Promise.resolve(),
          scaffoldFileSystem: {
            readPackage: () => ({ name: 'consumer-target' }),
            isDirectory: () => true,
          },
          install: () => Promise.resolve(),
        },
      );
      expect(result.exitCode).toBe(0);
    } finally {
      rmSync(archiveDirectory, { recursive: true, force: true });
      rmSync(resolve(packageRoot, 'dist'), { recursive: true, force: true });
      rmSync(resolve(packageRoot, '.dist-backup'), {
        recursive: true,
        force: true,
      });
    }
  });
});
