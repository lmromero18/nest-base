import { describe, expect, it } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  collectPeerResolutionPaths,
  inspectDependencyBoundary,
  type DependencyAuditInput,
} from '../../../packages/core/audit';

describe('@nest-base/core dependency audit', () => {
  it('exposes the deterministic emitted dependency audit command', () => {
    const manifest = JSON.parse(
      readFileSync(resolve('package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    expect(manifest.scripts['audit:core']).toBe('bun packages/core/audit.ts');
  });

  it('rejects duplicate peer installations and singleton identities', () => {
    const violations = inspectDependencyBoundary(
      auditInput({
        dependencyTree: [
          packageNode('typeorm', '/consumer/node_modules/typeorm'),
          packageNode(
            'typeorm',
            '/consumer/node_modules/some-adapter/node_modules/typeorm',
          ),
        ],
        peerResolutions: {
          typeorm: [
            '/consumer/node_modules/typeorm',
            '/consumer/node_modules/some-adapter/node_modules/typeorm',
          ],
          'reflect-metadata': ['/consumer/node_modules/reflect-metadata'],
        },
      }),
    );

    expect(violations).toEqual([
      'duplicate installed typeorm packages: /consumer/node_modules/some-adapter/node_modules/typeorm, /consumer/node_modules/typeorm',
      'typeorm must resolve to one singleton identity: /consumer/node_modules/some-adapter/node_modules/typeorm, /consumer/node_modules/typeorm',
    ]);
  });

  it('accepts externalized peers when runtime imports remain bare and identities are unique', () => {
    const violations = inspectDependencyBoundary(
      auditInput({
        peerResolutions: {
          typeorm: ['/consumer/node_modules/typeorm'],
          'reflect-metadata': ['/consumer/node_modules/reflect-metadata'],
        },
      }),
    );

    expect(violations).toEqual([]);
  });

  it('rejects a second singleton identity even when the dependency tree is not duplicated', () => {
    const violations = inspectDependencyBoundary(
      auditInput({
        peerResolutions: {
          typeorm: ['/consumer/node_modules/typeorm'],
          'reflect-metadata': [
            '/consumer/node_modules/reflect-metadata',
            '/consumer/node_modules/legacy/node_modules/reflect-metadata',
          ],
        },
      }),
    );

    expect(violations).toEqual([
      'reflect-metadata must resolve to one singleton identity: /consumer/node_modules/legacy/node_modules/reflect-metadata, /consumer/node_modules/reflect-metadata',
    ]);
  });

  it('rejects forbidden dependencies installed in the package tree', () => {
    const violations = inspectDependencyBoundary(
      auditInput({
        dependencyTree: [
          packageNode('fastify', '/package/node_modules/fastify'),
          packageNode('@nestjs/common', '/package/node_modules/@nestjs/common'),
        ],
        peerResolutions: {
          typeorm: ['/consumer/node_modules/typeorm'],
          'reflect-metadata': ['/consumer/node_modules/reflect-metadata'],
        },
      }),
    );

    expect(violations).toEqual([
      'forbidden installed runtime dependency: @nestjs/common at /package/node_modules/@nestjs/common',
      'forbidden installed runtime dependency: fastify at /package/node_modules/fastify',
    ]);
  });

  it('finds hoisted and nested duplicate peers through the filesystem audit path', () => {
    const root = join(tmpdir(), `core-audit-${Date.now()}-${Math.random()}`);
    const consumer = join(root, 'consumer');
    const packageRoot = join(consumer, 'node_modules', '@nest-base', 'core');
    const hoistedTypeorm = join(consumer, 'node_modules', 'typeorm');
    const nestedTypeorm = join(
      consumer,
      'node_modules',
      'adapter',
      'node_modules',
      'typeorm',
    );
    const hoistedNestCommon = join(
      consumer,
      'node_modules',
      '@nestjs',
      'common',
    );
    const nestedNestCommon = join(
      consumer,
      'node_modules',
      'adapter',
      'node_modules',
      '@nestjs',
      'common',
    );
    const hoistedNestCore = join(consumer, 'node_modules', '@nestjs', 'core');
    const nestedNestCore = join(
      consumer,
      'node_modules',
      'adapter',
      'node_modules',
      '@nestjs',
      'core',
    );
    const adapter = join(consumer, 'node_modules', 'adapter');
    const reflectMetadata = join(consumer, 'node_modules', 'reflect-metadata');

    try {
      for (const path of [
        packageRoot,
        hoistedTypeorm,
        nestedTypeorm,
        hoistedNestCommon,
        nestedNestCommon,
        hoistedNestCore,
        nestedNestCore,
        reflectMetadata,
        adapter,
      ])
        mkdirSync(path, { recursive: true });
      for (const [path, name] of [
        [packageRoot, '@nest-base/core'],
        [hoistedTypeorm, 'typeorm'],
        [nestedTypeorm, 'typeorm'],
        [hoistedNestCommon, '@nestjs/common'],
        [nestedNestCommon, '@nestjs/common'],
        [hoistedNestCore, '@nestjs/core'],
        [nestedNestCore, '@nestjs/core'],
        [reflectMetadata, 'reflect-metadata'],
        [adapter, 'adapter'],
      ])
        writeFileSync(
          join(path, 'package.json'),
          JSON.stringify({ name, version: '1.0.0' }),
        );

      const peerResolutions = collectPeerResolutionPaths(
        ['typeorm', 'reflect-metadata', '@nestjs/common', '@nestjs/core'],
        [consumer],
      );
      const violations = inspectDependencyBoundary(
        auditInput({ peerResolutions }),
      );

      expect(peerResolutions.typeorm).toEqual(
        [nestedTypeorm, hoistedTypeorm].sort(),
      );
      expect(peerResolutions['@nestjs/common']).toEqual(
        [nestedNestCommon, hoistedNestCommon].sort(),
      );
      expect(peerResolutions['@nestjs/core']).toEqual(
        [nestedNestCore, hoistedNestCore].sort(),
      );
      expect(violations).toContain(
        `typeorm must resolve to one singleton identity: ${[nestedTypeorm, hoistedTypeorm].sort().join(', ')}`,
      );
      expect(violations).toContain(
        `@nestjs/common must resolve to one singleton identity: ${[nestedNestCommon, hoistedNestCommon].sort().join(', ')}`,
      );
      expect(violations).toContain(
        `@nestjs/core must resolve to one singleton identity: ${[nestedNestCore, hoistedNestCore].sort().join(', ')}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function packageNode(name: string, path: string) {
  return { name, version: '1.0.0', path };
}

function auditInput(
  overrides: Partial<DependencyAuditInput> = {},
): DependencyAuditInput {
  return {
    runtimeFiles: [
      {
        path: '/package/dist/esm/services/base.service.js',
        source: 'import { DataSource } from "typeorm";',
      },
    ],
    manifest: {
      dependencies: {},
      optionalDependencies: {},
      peerDependencies: {
        'reflect-metadata': '>=0.2.0 <0.3.0',
        typeorm: '>=0.3.28 <0.4.0',
      },
    },
    dependencyTree: [],
    peerResolutions: {},
    cjsBoundaryExists: true,
    ...overrides,
  };
}
