import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dir);
const repositoryRoot = resolve(packageRoot, '../..');
const root = join(
  tmpdir(),
  `nest-base-http-core-consumer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
);
const artifacts = join(root, 'artifacts');
const consumer = join(root, 'consumer');

export function hasRepositorySourceImport(source: string): boolean {
  return /(?:from|import\s*\(|require\s*\()\s*["'](?:src[\\/]|[^"']*[\\/]src[\\/])/m.test(
    source,
  );
}

export function assertHttpCoreConsumerProvenance(consumerRoot: string): void {
  const sourceRoot = join(consumerRoot, 'src');
  for (const entry of readdirSync(sourceRoot)) {
    const sourcePath = join(sourceRoot, entry);
    if (
      entry.endsWith('.ts') &&
      hasRepositorySourceImport(readFileSync(sourcePath, 'utf8'))
    )
      throw new Error(
        'Independent HTTP-core consumer source imports repository source',
      );
  }
  if (
    !existsSync(
      join(consumerRoot, 'node_modules/@nest-base/http-core/package.json'),
    )
  )
    throw new Error(
      'Independent HTTP-core consumer did not install the packed artifact',
    );
}

export function createHttpCoreConsumerManifest(tarball: string) {
  return {
    name: 'nest-base-http-core-independent-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@nest-base/core': '0.1.0',
      '@nest-base/http-core': `file:${tarball}`,
      '@nestjs/common': '>=11.0.0 <12.0.0',
      '@nestjs/swagger': '>=11.0.0 <12.0.0',
      'reflect-metadata': '>=0.2.0 <0.3.0',
      typeorm: '>=0.3.28 <0.4.0',
    },
  };
}

export function getHttpCoreConsumerCommands(compiler: string): string[][] {
  return [
    ['bun', compiler, '-p', 'tsconfig.json'],
    ['node', 'dist/index.js'],
    ['node', 'cjs-check.cjs'],
    ['bun', 'dist/index.js'],
    ['bun', 'cjs-check.cjs'],
  ];
}

function run(command: string[], cwd: string): void {
  const executable =
    process.platform === 'win32' && command[0] === 'npm'
      ? 'npm.cmd'
      : command[0];
  execFileSync(executable, command.slice(1), {
    cwd,
    stdio: 'inherit',
    timeout: 120_000,
  });
}

function main(): void {
  mkdirSync(artifacts, { recursive: true });
  mkdirSync(join(consumer, 'src'), { recursive: true });
  run(
    ['npm', 'pack', '--ignore-scripts', '--pack-destination', artifacts],
    packageRoot,
  );
  const name = readdirSync(artifacts).find((entry) => entry.endsWith('.tgz'));
  if (!name)
    throw new Error('No packed @nest-base/http-core artifact was produced');
  const httpTarball = join(artifacts, name);

  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify(createHttpCoreConsumerManifest(httpTarball), null, 2)}\n`,
  );
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    `${JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          rootDir: './src',
          outDir: './dist',
          skipLibCheck: true,
        },
        include: ['src/**/*.ts'],
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(consumer, 'src/index.ts'),
    `import 'reflect-metadata';
import { CrudControllerFactory } from '@nest-base/http-core';
import { BaseService } from '@nest-base/core';

class ConsumerService extends BaseService<{ id: number }> {}
if (typeof CrudControllerFactory !== 'function' || !(ConsumerService.prototype instanceof BaseService)) throw new Error('HTTP core consumer API contract failed');
console.log('independent http-core consumer ESM API passed');
`,
  );
  writeFileSync(
    join(consumer, 'cjs-check.cjs'),
    `const http = require('@nest-base/http-core'); const core = require('@nest-base/core'); if (typeof http.CrudControllerFactory !== 'function' || typeof core.BaseService !== 'function') process.exit(1); console.log('independent http-core consumer CJS API passed');\n`,
  );

  try {
    run(['bun', 'install'], consumer);
    for (const command of getHttpCoreConsumerCommands(
      resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'),
    ))
      run(command, consumer);
    assertHttpCoreConsumerProvenance(consumer);
    console.log(`verify:http-core:consumer passed (${consumer})`);
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

if (import.meta.main) main();
