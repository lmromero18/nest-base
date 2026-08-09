import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  cleanupCoreBuildWorkspace,
  runCoreBuildInWorkspace,
} from '../../../tools/core-run-context';

const coreRoot = resolve('packages/core');
const entrypoints = ['', 'services', 'query', 'application', 'context'];

setDefaultTimeout(120_000);

describe('@nest-base/core executable build contract', () => {
  it('declares the exact dual-runtime metadata and conditional export order', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(coreRoot, 'package.json'), 'utf8'),
    ) as Record<string, unknown>;
    const exports = manifest.exports as Record<string, Record<string, string>>;

    expect(manifest.type).toBe('module');
    expect(manifest.main).toBe('./dist/cjs/index.js');
    expect(manifest.module).toBe('./dist/esm/index.js');
    expect(manifest.types).toBe('./dist/types/index.d.ts');
    expect(manifest.sideEffects).toBe(false);
    expect(manifest.files).toEqual(['README.md', 'LICENSE', 'dist']);
    expect(manifest.engines).toEqual({ node: '>=20 <25', bun: '>=1.3.14' });
    expect(manifest.peerDependencies).toEqual({
      'reflect-metadata': '>=0.2.0 <0.3.0',
      typeorm: '>=0.3.28 <0.4.0',
    });

    for (const subpath of [
      '.',
      './services',
      './query',
      './application',
      './context',
    ]) {
      expect(Object.keys(exports[subpath])).toEqual([
        'types',
        'import',
        'require',
        'default',
      ]);
    }
  });

  it('emits deterministic ESM, CJS, source maps, declarations, and the CJS boundary', () => {
    const isolatedPackageRoot = runCoreBuildInWorkspace(resolve('.'));
    try {
      expect(
        readFileSync(
          resolve(isolatedPackageRoot, 'dist/cjs/package.json'),
          'utf8',
        ),
      ).toBe('{"type":"commonjs"}\n');

      for (const subpath of entrypoints) {
        const relative = subpath ? `${subpath}/index` : 'index';
        expect(
          existsSync(resolve(isolatedPackageRoot, `dist/esm/${relative}.js`)),
        ).toBe(true);
        expect(
          existsSync(
            resolve(isolatedPackageRoot, `dist/esm/${relative}.js.map`),
          ),
        ).toBe(true);
        expect(
          existsSync(resolve(isolatedPackageRoot, `dist/cjs/${relative}.js`)),
        ).toBe(true);
        expect(
          existsSync(
            resolve(isolatedPackageRoot, `dist/cjs/${relative}.js.map`),
          ),
        ).toBe(true);
        expect(
          existsSync(
            resolve(isolatedPackageRoot, `dist/types/${relative}.d.ts`),
          ),
        ).toBe(true);
      }
    } finally {
      cleanupCoreBuildWorkspace(isolatedPackageRoot);
    }
  });

  it('imports and requires root and every public subpath', async () => {
    const isolatedPackageRoot = runCoreBuildInWorkspace(resolve('.'));
    try {
      for (const subpath of entrypoints) {
        const esm = (await import(
          `${resolve(isolatedPackageRoot, `dist/esm/${subpath ? `${subpath}/` : ''}index.js`)}?test=${subpath}`
        )) as Record<string, unknown>;
        expect(Object.keys(esm).length).toBeGreaterThan(0);

        const cjsPath = resolve(
          isolatedPackageRoot,
          `dist/cjs/${subpath ? `${subpath}/` : ''}index.js`,
        );
        const result = execFileSync(
          'node',
          [
            '-e',
            `console.log(Object.keys(require(${JSON.stringify(cjsPath)})).length)`,
          ],
          {
            encoding: 'utf8',
          },
        );
        expect(Number(result.trim())).toBeGreaterThan(0);
      }
    } finally {
      cleanupCoreBuildWorkspace(isolatedPackageRoot);
    }
  });
});
