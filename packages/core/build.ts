import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  getCoreRunContext,
  withCoreOutputLock,
} from '../../tools/core-run-context.js';

const packageRoot = resolve(
  process.env.NEST_BASE_CORE_PACKAGE_ROOT ?? import.meta.dir,
);
const repositoryRoot = resolve(
  process.env.NEST_BASE_REPOSITORY_ROOT ?? resolve(packageRoot, '../..'),
);
const sourceRoot = resolve(
  process.env.NEST_BASE_CORE_SOURCE_ROOT ??
    resolve(repositoryRoot, 'src/common'),
);
const distRoot = resolve(packageRoot, 'dist');
const promotionBackupRoot = resolve(packageRoot, '.dist-backup');
const { buildId: promotionBuildId, runRoot } = getCoreRunContext();
const temporaryRoot = resolve(packageRoot, '.build-work');
const preserveRunRoot = Boolean(process.env.NEST_BASE_PROMOTION_BUILD_ID);
const compiler = resolve(
  process.env.NEST_BASE_REPOSITORY_ROOT ?? repositoryRoot,
  'node_modules/typescript/bin/tsc',
);

const entrypoints = [
  ['', 'index'],
  ['services', 'index'],
  ['query', 'index'],
  ['application', 'index'],
  ['context', 'index'],
] as const;

const sourceFiles = [
  'services/base.service.ts',
  'query/query-string-parser.ts',
  'application/crud.contracts.ts',
  'application/application-error.ts',
  'application/principal.ts',
  'context/request-context.ts',
] as const;

function run(command: string[]): void {
  const result = Bun.spawnSync(command, {
    cwd: repositoryRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0)
    throw new Error(`Build command failed: ${command.join(' ')}`);
}

function runCompiler(project: string): void {
  if (!existsSync(compiler))
    throw new Error('Repository-approved TypeScript compiler is unavailable');
  run(['bun', compiler, '-p', project]);
}

function prepareSourceFiles(): void {
  mkdirSync(resolve(temporaryRoot, 'src/common'), { recursive: true });

  for (const relative of sourceFiles) {
    const target = resolve(temporaryRoot, 'src/common', relative);
    mkdirSync(dirname(target), { recursive: true });
    const source = readFileSync(resolve(sourceRoot, relative), 'utf8')
      .replace(/from (['"])(\.\.?\/[^'"\n]+)\1/g, 'from $1$2.js$1')
      .replace(
        "import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';",
        'type ColumnMetadata = { type?: unknown; propertyName: string };',
      );
    writeFileSync(target, source);
  }
}

function assertSourceProvenance(): void {
  const explicitSourceRoot = process.env.NEST_BASE_CORE_SOURCE_ROOT;
  if (
    explicitSourceRoot &&
    !resolve(explicitSourceRoot).startsWith(
      `${packageRoot}${process.platform === 'win32' ? '\\' : '/'}`,
    )
  ) {
    throw new Error(
      'Explicit core source root must be inside the isolated package workspace',
    );
  }

  for (const relative of sourceFiles) {
    const trackedFile = `src/common/${relative}`;
    const source = resolve(sourceRoot, relative);
    const expectedBlob = git(['rev-parse', `HEAD:${trackedFile}`]);
    const actualBlob = git(['hash-object', '--', source]);
    if (expectedBlob !== actualBlob)
      throw new Error(
        `Core source provenance check failed: ${trackedFile} does not match the repository Git blob`,
      );
  }
}

function git(command: string[]): string {
  const result = Bun.spawnSync(['git', ...command], {
    cwd: repositoryRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (result.exitCode !== 0)
    throw new Error(
      `Could not establish core source provenance from Git: git ${command.join(' ')}`,
    );
  return new TextDecoder().decode(result.stdout).trim();
}

function writeDeclarationConfig(): void {
  for (const [subpath] of entrypoints) {
    const target = resolve(temporaryRoot, 'src', subpath, 'index.ts');
    mkdirSync(dirname(target), { recursive: true });
    const prefix = subpath ? '../common' : './common';
    const content =
      subpath === ''
        ? `export { BaseService } from '${prefix}/services/base.service.js';\nexport type { MutationOptions, PaginatedResponse, CrudOrderDirection, CrudQuery } from '${prefix}/application/crud.contracts.js';\nexport { ApplicationException } from '${prefix}/application/application-error.js';\nexport type { ApplicationError, ApplicationErrorCategory } from '${prefix}/application/application-error.js';\nexport type { Principal } from '${prefix}/application/principal.js';\nexport { RequestContext } from '${prefix}/context/request-context.js';\nexport type { RequestContextStore } from '${prefix}/context/request-context.js';\nexport { DEFAULT_PARSER_OPTIONS, QueryStringParser } from '${prefix}/query/query-string-parser.js';\nexport type { ParsedListQuery, QueryParserOptions, QuerySchema } from '${prefix}/query/query-string-parser.js';\n`
        : subpath === 'services'
          ? `export { BaseService } from '${prefix}/services/base.service.js';\nexport type { MutationOptions, PaginatedResponse } from '${prefix}/application/crud.contracts.js';\n`
          : subpath === 'query'
            ? `export { DEFAULT_PARSER_OPTIONS, QueryStringParser } from '${prefix}/query/query-string-parser.js';\nexport type { ParsedListQuery, QueryParserOptions, QuerySchema } from '${prefix}/query/query-string-parser.js';\n`
            : subpath === 'application'
              ? `export { ApplicationException } from '${prefix}/application/application-error.js';\nexport type { ApplicationError, ApplicationErrorCategory } from '${prefix}/application/application-error.js';\nexport type { Principal } from '${prefix}/application/principal.js';\n`
              : `export { RequestContext } from '${prefix}/context/request-context.js';\nexport type { RequestContextStore } from '${prefix}/context/request-context.js';\n`;
    writeFileSync(target, content);
  }
  writeFileSync(
    resolve(temporaryRoot, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        baseUrl: repositoryRoot,
        paths: {
          typeorm: [resolve(repositoryRoot, 'node_modules/typeorm/index.d.ts')],
        },
        typeRoots: [resolve(repositoryRoot, 'node_modules/@types')],
        rootDir: './src',
        outDir: resolve(temporaryRoot, 'artifact-dist/types'),
        module: 'CommonJS',
        moduleResolution: 'Node',
        target: 'ES2022',
        declaration: true,
        emitDeclarationOnly: true,
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        noEmitOnError: true,
      },
      include: ['src/**/*.ts'],
    }),
  );
}

function writeRuntimeConfig(format: 'esm' | 'cjs'): void {
  writeFileSync(
    resolve(temporaryRoot, `tsconfig.${format}.json`),
    JSON.stringify({
      compilerOptions: {
        baseUrl: repositoryRoot,
        paths: {
          typeorm: [resolve(repositoryRoot, 'node_modules/typeorm/index.d.ts')],
        },
        typeRoots: [resolve(repositoryRoot, 'node_modules/@types')],
        rootDir: './src',
        outDir: `./artifact-dist/${format}`,
        module: format === 'esm' ? 'NodeNext' : 'CommonJS',
        moduleResolution: format === 'esm' ? 'NodeNext' : 'Node',
        target: 'ES2022',
        declaration: false,
        sourceMap: true,
        strict: true,
        skipLibCheck: true,
        esModuleInterop: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        noEmitOnError: true,
      },
      include: ['src/**/*.ts'],
    }),
  );
}

function prepareBuildWorkspace(): void {
  rmSync(temporaryRoot, { recursive: true, force: true });
  mkdirSync(temporaryRoot, { recursive: true });
  prepareSourceFiles();
  writeDeclarationConfig();
  writeRuntimeConfig('esm');
  writeRuntimeConfig('cjs');
  for (const format of ['esm', 'cjs'] as const) {
    mkdirSync(resolve(temporaryRoot, `artifact-dist/${format}`), {
      recursive: true,
    });
  }
  mkdirSync(resolve(temporaryRoot, 'artifact-dist/types'), { recursive: true });
  writeFileSync(
    resolve(temporaryRoot, 'artifact-dist/cjs/package.json'),
    '{"type":"commonjs"}\n',
  );
  writeFileSync(resolve(temporaryRoot, 'package.json'), '{"type":"module"}\n');
}

function buildRuntime(format: 'esm' | 'cjs'): void {
  runCompiler(resolve(temporaryRoot, `tsconfig.${format}.json`));
}

function promoteBuild(): void {
  const artifactRoot = resolve(temporaryRoot, 'artifact-dist');
  recoverInterruptedPromotion();
  if (existsSync(promotionBackupRoot))
    rmSync(promotionBackupRoot, { recursive: true, force: true });
  if (existsSync(distRoot)) renameSync(distRoot, promotionBackupRoot);
  try {
    renameSync(artifactRoot, distRoot);
    rmSync(promotionBackupRoot, { recursive: true, force: true });
  } catch (error) {
    restorePreviousDist();
    throw error;
  }
}

function recoverInterruptedPromotion(): void {
  if (existsSync(distRoot)) {
    if (existsSync(promotionBackupRoot))
      rmSync(promotionBackupRoot, { recursive: true, force: true });
    return;
  }
  if (existsSync(promotionBackupRoot))
    renameSync(promotionBackupRoot, distRoot);
}

function restorePreviousDist(): void {
  if (!existsSync(promotionBackupRoot)) return;
  if (existsSync(distRoot)) rmSync(distRoot, { recursive: true, force: true });
  renameSync(promotionBackupRoot, distRoot);
}

function main(): void {
  recoverInterruptedPromotion();
  assertSourceProvenance();
  prepareBuildWorkspace();
  buildRuntime('esm');
  buildRuntime('cjs');
  runCompiler(resolve(temporaryRoot, 'tsconfig.json'));
  if (!existsSync(resolve(temporaryRoot, 'artifact-dist/types/index.d.ts')))
    throw new Error('Declaration build did not emit dist/types/index.d.ts');
  if (!existsSync(resolve(temporaryRoot, 'artifact-dist/cjs/package.json')))
    throw new Error('CJS build did not emit dist/cjs/package.json');
  promoteBuild();
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(resolve(runRoot, 'promotion-build-id'), promotionBuildId);
  console.log('build:core passed');
}

withCoreOutputLock(() => {
  try {
    main();
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
    if (!preserveRunRoot) rmSync(runRoot, { recursive: true, force: true });
  }
});
