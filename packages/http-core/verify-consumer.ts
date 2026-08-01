import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    `${JSON.stringify(
      {
        name: 'nest-base-http-core-independent-consumer',
        private: true,
        type: 'module',
        dependencies: {
          '@nest-base/core': '0.1.0',
          '@nest-base/http-core': `file:${httpTarball}`,
          '@nestjs/common': '>=11.0.0 <12.0.0',
          '@nestjs/swagger': '>=11.0.0 <12.0.0',
          'reflect-metadata': '>=0.2.0 <0.3.0',
          typeorm: '>=0.3.28 <0.4.0',
        },
      },
      null,
      2,
    )}\n`,
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
    run(
      [
        'bun',
        resolve(repositoryRoot, 'node_modules/typescript/bin/tsc'),
        '-p',
        'tsconfig.json',
      ],
      consumer,
    );
    run(['node', 'dist/index.js'], consumer);
    run(['node', 'cjs-check.cjs'], consumer);
    run(['bun', 'dist/index.js'], consumer);
    run(['bun', 'cjs-check.cjs'], consumer);
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

main();
