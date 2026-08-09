import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

setDefaultTimeout(120_000);
import {
  hasRepositorySourceImport,
  createConsumerManifest,
  createConsumerTsConfig,
  getConsumerCompilerCommand,
  runConsumerVerification,
} from '../../../tools/verify-consumer';
import {
  cleanupCoreBuildWorkspace,
  runCoreBuildInWorkspace,
} from '../../../tools/core-run-context';

describe('independent vanilla consumer gate', () => {
  it('detects repository-source imports instead of allowing a fixture shortcut', () => {
    expect(
      hasRepositorySourceImport(
        "import { BaseService } from '@nest-base/core';",
      ),
    ).toBe(false);
    expect(
      hasRepositorySourceImport(
        "import { BaseService } from '../../../src/common/services/base.service';",
      ),
    ).toBe(true);
    expect(
      hasRepositorySourceImport("from 'src/common/services/base.service';"),
    ).toBe(true);
  });

  it('creates a manifest whose sole direct dependency is the packed core artifact', () => {
    expect(createConsumerManifest('C:/tmp/core.tgz')).toEqual({
      name: 'nest-base-independent-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@nest-base/core': 'file:C:/tmp/core.tgz',
        'reflect-metadata': '>=0.2.0 <0.3.0',
        typeorm: '>=0.3.28 <0.4.0',
      },
    });
  });

  it('generates an explicit, repository-pinned compiler project', () => {
    const consumer = 'C:/tmp/consumer';
    expect(createConsumerTsConfig(consumer)).toEqual({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        rootDir: join(consumer, 'src'),
        outDir: join(consumer, 'dist'),
        skipLibCheck: true,
      },
      include: [join(consumer, 'src/**/*.ts')],
    });
    expect(getConsumerCompilerCommand('C:/tmp/tsc.js')).toEqual([
      'bun',
      'C:/tmp/tsc.js',
      '-p',
      'tsconfig.json',
    ]);
  });

  it('supports serial repeated consumer verification without repository-source imports', () => {
    expect(
      hasRepositorySourceImport(
        "import { BaseService } from '@nest-base/core';",
      ),
    ).toBe(false);
    expect(
      hasRepositorySourceImport("import { BaseService } from '../src/base';"),
    ).toBe(true);
  });

  it('keeps the core build artifact inventory stable across serial builds', () => {
    const isolatedPackageRoot = runCoreBuildInWorkspace(resolve('.'));
    let secondPackageRoot: string | undefined;

    try {
      const firstInventory = readCoreArtifactInventory(isolatedPackageRoot);
      secondPackageRoot = runCoreBuildInWorkspace(resolve('.'));
      const secondInventory = readCoreArtifactInventory(secondPackageRoot);

      expect(secondInventory).toEqual(firstInventory);
      expect(
        secondInventory.some((file) => file.startsWith('cjs/package.json:')),
      ).toBe(true);
      expect(
        secondInventory.some((file) => file.startsWith('types/index.d.ts:')),
      ).toBe(true);
    } finally {
      cleanupCoreBuildWorkspace(isolatedPackageRoot);
      if (secondPackageRoot) cleanupCoreBuildWorkspace(secondPackageRoot);
    }
  });

  it('keeps the real packed consumer gate green across serial repeated runs', () => {
    const distRoot = join(resolve('.'), 'packages/core/dist');
    try {
      expect(() => {
        runConsumerVerification();
        runConsumerVerification();
      }).not.toThrow();
      expect(matchingConsumerRoots()).toEqual([]);
    } finally {
      rmSync(distRoot, { recursive: true, force: true });
      expect(existsSync(distRoot)).toBe(false);
    }
  });

  it('cleans the matching consumer root when lock acquisition fails', () => {
    const root = join(tmpdir(), `nest-base-independent-${randomUUID()}`);

    expect(() =>
      runConsumerVerification({
        root,
        withLock: () => {
          throw new Error('forced consumer lock failure');
        },
      }),
    ).toThrow('forced consumer lock failure');

    expect(existsSync(root)).toBe(false);
    expect(matchingConsumerRoots()).toEqual([]);
  });
});

function matchingConsumerRoots(): string[] {
  return readdirSync(tmpdir(), { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith('nest-base-independent-'),
    )
    .map((entry) => entry.name)
    .sort();
}

function readCoreArtifactInventory(
  packageRoot = join(resolve('.'), 'packages/core'),
): string[] {
  const files: string[] = [];
  const visit = (directory: string, relative = ''): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryRelative = join(relative, entry.name).replaceAll('\\', '/');
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath, entryRelative);
      else files.push(`${entryRelative}:${readFileSync(entryPath).length}`);
    }
  };
  visit(join(packageRoot, 'dist'));
  return files.sort();
}
