import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  inspectHttpCoreDependencyBoundary,
  type HttpCoreDependencyAuditInput,
} from '../../../packages/http-core/audit';
import {
  inspectHttpCorePackList,
  type HttpCorePackedEntry,
} from '../../../packages/http-core/audit-tarball';
import {
  createHttpCoreConsumerManifest,
  getHttpCoreConsumerCommands,
  assertHttpCoreConsumerProvenance,
  hasRepositorySourceImport,
} from '../../../packages/http-core/verify-consumer';
import { getPromotionCheckpointEvidence } from '../../../tools/promotion-gates';

describe('@nest-base/http-core package-platform evidence', () => {
  it('rejects invalid metadata, entry points, and bundled runtime dependencies', () => {
    const violations = inspectHttpCoreDependencyBoundary({
      manifest: {
        dependencies: { '@nestjs/common': '^11.0.0' },
        peerDependencies: {
          '@nest-base/core': '>=0.1.0 <0.2.0',
          '@nestjs/common': '>=11.0.0 <12.0.0',
          '@nestjs/swagger': '>=11.0.0 <12.0.0',
          typeorm: '>=0.3.28 <0.4.0',
        },
      },
      runtimeFiles: [
        {
          path: 'dist/esm/index.js',
          source:
            "import { CrudControllerFactory } from 'src/common/controller'; import 'node_modules/@nestjs/common';",
        },
      ],
      cjsBoundaryExists: false,
    });

    expect(violations).toEqual([
      'HTTP Core must not declare runtime dependencies: @nestjs/common',
      'Missing nested CommonJS package boundary',
      'dist/esm/index.js: emitted runtime output references node_modules',
      'dist/esm/index.js: emitted runtime output references repository source',
    ]);
  });

  it('accepts the exact peer metadata and externalized runtime boundary', () => {
    expect(
      inspectHttpCoreDependencyBoundary(validHttpCoreAuditInput()),
    ).toEqual([]);
  });

  it('rejects tarballs with missing metadata, entry points, and runtime dependencies', () => {
    const violations = inspectHttpCorePackList([
      {
        path: 'package/package.json',
        content: JSON.stringify({
          dependencies: { '@nestjs/common': '^11.0.0' },
        }),
      },
      {
        path: 'package/dist/esm/index.js',
        content: "import '@nestjs/common';",
      },
    ]);

    expect(violations).toEqual([
      'bundled runtime dependency @nestjs/common in package/dist/esm/index.js',
      'bundled runtime dependency @nestjs/common in package/package.json',
      'missing CommonJS entry point dist/cjs/index.js',
      'missing CommonJS package boundary dist/cjs/package.json',
      'missing LICENSE',
      'missing README.md',
      'missing declaration entry point dist/types/index.d.ts',
      'missing peer dependency metadata in package/package.json',
    ]);
  });

  it('accepts the complete packed entry-point and metadata contract', () => {
    expect(inspectHttpCorePackList(validHttpCorePack())).toEqual([]);
  });

  it('rejects unexpected tarball entries and optional runtime dependencies', () => {
    const entries = validHttpCorePack();
    entries.push({ path: 'package/unexpected.txt' });
    const manifest = JSON.parse(entries[2].content ?? '{}') as Record<
      string,
      unknown
    >;
    manifest.optionalDependencies = { 'injected-runtime': '^1.0.0' };
    entries[2].content = JSON.stringify(manifest);

    expect(inspectHttpCorePackList(entries)).toEqual([
      'bundled runtime dependency injected-runtime in package/package.json',
      'unexpected tarball entry package/unexpected.txt',
    ]);
  });

  it('builds an isolated tarball consumer and rejects workspace-source fallback', () => {
    expect(createHttpCoreConsumerManifest('C:/tmp/http-core.tgz')).toEqual({
      name: 'nest-base-http-core-independent-consumer',
      private: true,
      type: 'module',
      dependencies: {
        '@nest-base/core': '0.1.0',
        '@nest-base/http-core': 'file:C:/tmp/http-core.tgz',
        '@nestjs/common': '>=11.0.0 <12.0.0',
        '@nestjs/swagger': '>=11.0.0 <12.0.0',
        'reflect-metadata': '>=0.2.0 <0.3.0',
        typeorm: '>=0.3.28 <0.4.0',
      },
    });
    expect(getHttpCoreConsumerCommands('C:/tmp/tsc.js')).toEqual([
      ['bun', 'C:/tmp/tsc.js', '-p', 'tsconfig.json'],
      ['node', 'dist/index.js'],
      ['node', 'cjs-check.cjs'],
      ['bun', 'dist/index.js'],
      ['bun', 'cjs-check.cjs'],
    ]);
    expect(hasRepositorySourceImport("from '@nest-base/http-core'")).toBe(
      false,
    );
    expect(
      hasRepositorySourceImport("from '../../../src/common/controller'"),
    ).toBe(true);
  });

  it('enforces consumer source and installed-package provenance at runtime', () => {
    const root = resolve(
      tmpdir(),
      `http-core-provenance-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(resolve(root, 'src'), { recursive: true });
    mkdirSync(resolve(root, 'node_modules/@nest-base/http-core'), {
      recursive: true,
    });
    writeFileSync(
      resolve(root, 'src/index.ts'),
      "import { CrudControllerFactory } from '@nest-base/http-core';",
    );
    writeFileSync(
      resolve(root, 'node_modules/@nest-base/http-core/package.json'),
      JSON.stringify({ name: '@nest-base/http-core', version: '0.1.0' }),
    );

    try {
      expect(() => assertHttpCoreConsumerProvenance(root)).not.toThrow();
      writeFileSync(
        resolve(root, 'src/index.ts'),
        "import { CrudControllerFactory } from '../../../src/common/controller';",
      );
      expect(() => assertHttpCoreConsumerProvenance(root)).toThrow(
        'Independent HTTP-core consumer source imports repository source',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects a consumer that did not install the packed HTTP-core artifact', () => {
    const root = resolve(
      tmpdir(),
      `http-core-provenance-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    mkdirSync(resolve(root, 'src'), { recursive: true });
    writeFileSync(
      resolve(root, 'src/index.ts'),
      "import { CrudControllerFactory } from '@nest-base/http-core';",
    );

    try {
      expect(() => assertHttpCoreConsumerProvenance(root)).toThrow(
        'Independent HTTP-core consumer did not install the packed artifact',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps root scripts exact and package-specific', () => {
    const scripts = (
      JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;

    expect({
      buildCore: scripts['build:core'],
      buildHttpCore: scripts['build:http-core'],
      auditCore: scripts['audit:core'],
      auditHttpCore: scripts['audit:http-core'],
      tarballCore: scripts['audit:tarball'],
      tarballHttpCore: scripts['audit:http-core:tarball'],
      consumerCore: scripts['verify:consumer'],
      consumerHttpCore: scripts['verify:http-core:consumer'],
    }).toEqual({
      buildCore: 'bun packages/core/build.ts',
      buildHttpCore: 'bun packages/http-core/build.ts',
      auditCore: 'bun packages/core/audit.ts',
      auditHttpCore: 'bun packages/http-core/audit.ts',
      tarballCore: 'bun packages/core/audit-tarball.ts',
      tarballHttpCore: 'bun packages/http-core/audit-tarball.ts',
      consumerCore: 'bun tools/verify-consumer.ts',
      consumerHttpCore: 'bun packages/http-core/verify-consumer.ts',
    });
  });

  it('normalizes package evidence for every promotion checkpoint', () => {
    expect(getPromotionCheckpointEvidence('C2')).toEqual({
      packageName: '@nest-base/core',
      checkpoint: 'C2',
    });
    expect(getPromotionCheckpointEvidence('http-core-tarball')).toEqual({
      packageName: '@nest-base/http-core',
      checkpoint: 'http-core-tarball',
    });
  });
});

function validHttpCoreAuditInput(): HttpCoreDependencyAuditInput {
  return {
    manifest: {
      peerDependencies: {
        '@nest-base/core': '>=0.1.0 <0.2.0',
        '@nestjs/common': '>=11.0.0 <12.0.0',
        '@nestjs/swagger': '>=11.0.0 <12.0.0',
        typeorm: '>=0.3.28 <0.4.0',
      },
    },
    runtimeFiles: [
      {
        path: 'dist/esm/index.js',
        source: "import { CrudControllerFactory } from '@nestjs/common';",
      },
    ],
    cjsBoundaryExists: true,
  };
}

function validHttpCorePack(): HttpCorePackedEntry[] {
  return [
    { path: 'package/README.md' },
    { path: 'package/LICENSE' },
    {
      path: 'package/package.json',
      content: JSON.stringify({
        peerDependencies: {
          '@nest-base/core': '>=0.1.0 <0.2.0',
          '@nestjs/common': '>=11.0.0 <12.0.0',
          '@nestjs/swagger': '>=11.0.0 <12.0.0',
          typeorm: '>=0.3.28 <0.4.0',
        },
      }),
    },
    { path: 'package/dist/cjs/package.json', content: '{"type":"commonjs"}' },
    { path: 'package/dist/esm/index.js', content: 'export {}' },
    { path: 'package/dist/cjs/index.js', content: 'module.exports = {}' },
    { path: 'package/dist/types/index.d.ts', content: 'export {}' },
  ];
}
