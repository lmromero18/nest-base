import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';

const packageRoot = resolve(
  import.meta.dir,
  '../../../packages/create-nest-base',
);
const manifestPath = resolve(packageRoot, 'package.json');

const expectedFiles = [
  'index.ts',
  'cli.ts',
  'artifact-gate.ts',
  'install.ts',
  'metadata.ts',
  'preflight.ts',
  'registry.ts',
  'scaffold.ts',
  'types.ts',
  'ux.ts',
  'README.md',
  'LICENSE',
];
const expectedPackedFiles = [...expectedFiles, 'package.json'];

function inspectPackedFiles(): string[] {
  const result = Bun.spawnSync(['npm', 'pack', '--dry-run', '--json'], {
    cwd: packageRoot,
    stderr: 'pipe',
    stdout: 'pipe',
  });

  expect(result.exitCode).toBe(0);

  const packReport = JSON.parse(result.stdout.toString()) as Array<{
    files: Array<{ path: string }>;
  }>;
  return (packReport[0]?.files ?? [])
    .map(({ path }) => {
      const normalized = path.replaceAll('\\', '/');
      return normalized.startsWith('package/')
        ? normalized.slice('package/'.length)
        : normalized;
    })
    .sort();
}

describe('create-nest-base package readiness', () => {
  it('declares the supported Bun CLI package contract', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      name: string;
      private: boolean;
      version: string;
      type: string;
      main: string;
      module: string;
      exports: Record<string, string>;
      bin: Record<string, string>;
      engines: { bun: string };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };

    expect(manifest.name).toBe('create-nest-base');
    expect(manifest.private).toBe(false);
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(manifest.type).toBe('module');
    expect(manifest.main).toBe('./index.ts');
    expect(manifest.module).toBe('./index.ts');
    expect(manifest.exports).toEqual({ '.': './index.ts' });
    expect(manifest.bin).toEqual({ 'create-nest-base': './index.ts' });
    expect(manifest.engines.bun).toBe('>=1.3.14');

    expect(manifest.dependencies ?? {}).not.toHaveProperty('@nest-base/core');
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@nestjs/cli');
    expect(manifest.devDependencies ?? {}).not.toHaveProperty(
      '@nest-base/core',
    );
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('@nestjs/cli');
    expect(manifest.peerDependencies ?? {}).not.toHaveProperty(
      '@nest-base/core',
    );
    expect(manifest.peerDependencies ?? {}).not.toHaveProperty('@nestjs/cli');
  });

  it('declares the exact source and documentation boundary', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      files: string[];
    };

    expect(manifest.files).toEqual(expectedFiles);
    expect(manifest.files).toHaveLength(12);
    for (const file of expectedFiles)
      expect(existsSync(resolve(packageRoot, file))).toBe(true);
  });

  it('preserves an executable Bun entrypoint and package-local checks', () => {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      scripts: Record<string, string>;
    };
    const entrypoint = readFileSync(resolve(packageRoot, 'index.ts'), 'utf8');

    expect(entrypoint.startsWith('#!/usr/bin/env bun')).toBe(true);
    expect(manifest.scripts['pack:check']).toBe('npm pack --dry-run --json');
    expect(manifest.scripts.check).toBe('bun run pack:check');
  });

  it('matches the exact file list produced by pack inspection', () => {
    expect(inspectPackedFiles()).toEqual([...expectedPackedFiles].sort());
  });

  it('excludes workspace and development files from the packed boundary', () => {
    const packedFiles = inspectPackedFiles();

    expect(packedFiles).toContain('index.ts');
    expect(packedFiles).toContain('README.md');
    expect(packedFiles).toContain('LICENSE');
    expect(packedFiles).not.toContain('bun.lock');
    expect(packedFiles).not.toContain('package-lock.json');
    expect(packedFiles).not.toContain('test/packages/create-nest-base');
  });
});
