import { describe, expect, it, setDefaultTimeout } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as core from '../../../packages/core/src/index';
import * as application from '../../../packages/core/src/application';
import * as context from '../../../packages/core/src/context';
import * as query from '../../../packages/core/src/query';
import * as services from '../../../packages/core/src/services';
import {
  cleanupCoreBuildWorkspace,
  runCoreBuildInWorkspace,
} from '../../../tools/core-run-context';

setDefaultTimeout(120_000);

describe('@nest-base/core public manifest', () => {
  it('describes the executable PR2 package boundary', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve('packages/core/package.json'), 'utf8'),
    ) as {
      exports?: Record<string, Record<string, string>>;
      files: string[];
      main?: string;
      module?: string;
      types?: string;
    };

    expect(packageJson.exports).toEqual({
      '.': {
        types: './dist/types/index.d.ts',
        import: './dist/esm/index.js',
        require: './dist/cjs/index.js',
        default: './dist/esm/index.js',
      },
      './services': {
        types: './dist/types/services/index.d.ts',
        import: './dist/esm/services/index.js',
        require: './dist/cjs/services/index.js',
        default: './dist/esm/services/index.js',
      },
      './query': {
        types: './dist/types/query/index.d.ts',
        import: './dist/esm/query/index.js',
        require: './dist/cjs/query/index.js',
        default: './dist/esm/query/index.js',
      },
      './application': {
        types: './dist/types/application/index.d.ts',
        import: './dist/esm/application/index.js',
        require: './dist/cjs/application/index.js',
        default: './dist/esm/application/index.js',
      },
      './context': {
        types: './dist/types/context/index.d.ts',
        import: './dist/esm/context/index.js',
        require: './dist/cjs/context/index.js',
        default: './dist/esm/context/index.js',
      },
    });
    expect(packageJson.types).toBe('./dist/types/index.d.ts');
    expect(packageJson.main).toBe('./dist/cjs/index.js');
    expect(packageJson.module).toBe('./dist/esm/index.js');
    expect(packageJson.files).toEqual(['README.md', 'LICENSE', 'dist']);
  });

  it('fails closed when a declared package target is absent from npm pack output', () => {
    const isolatedPackageRoot = runCoreBuildInWorkspace(resolve('.'));
    try {
      const packageJson = JSON.parse(
        readFileSync(resolve(isolatedPackageRoot, 'package.json'), 'utf8'),
      ) as {
        exports?: Record<string, Record<string, string>>;
        main?: string;
        module?: string;
        types?: string;
      };
      const packOutput = JSON.parse(
        execFileSync(
          'npm',
          ['pack', '--dry-run', '--json', '--ignore-scripts'],
          {
            cwd: isolatedPackageRoot,
            encoding: 'utf8',
          },
        ),
      ) as Array<{ files: Array<{ path: string }> }>;
      const packedFiles = new Set(
        packOutput[0]?.files.map((file) => file.path),
      );
      const declaredTargets = [
        packageJson.types,
        packageJson.main,
        packageJson.module,
        ...Object.values(packageJson.exports ?? {}).flatMap((entry) =>
          Object.values(entry),
        ),
      ].filter((target): target is string => Boolean(target));

      expect(
        declaredTargets.filter(
          (target) => !packedFiles.has(target.replace(/^\.\//, '')),
        ),
      ).toEqual([]);
    } finally {
      cleanupCoreBuildWorkspace(isolatedPackageRoot);
    }
  });

  it('exports only the allowed runtime symbols at root and subpaths', () => {
    expect(Object.keys(core).sort()).toEqual([
      'ApplicationException',
      'BaseService',
      'DEFAULT_PARSER_OPTIONS',
      'QueryStringParser',
      'RequestContext',
    ]);
    expect(Object.keys(services)).toEqual(['BaseService']);
    expect(Object.keys(query).sort()).toEqual([
      'DEFAULT_PARSER_OPTIONS',
      'QueryStringParser',
    ]);
    expect(Object.keys(application)).toEqual(['ApplicationException']);
    expect(Object.keys(context)).toEqual(['RequestContext']);
  });

  it('does not expose the HTTP controller adapter', () => {
    expect('CrudControllerFactory' in core).toBe(false);
    expect('CrudControllerFactory' in application).toBe(false);
  });
});
