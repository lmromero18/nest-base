import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const packageRoot = resolve(import.meta.dir);
const repositoryRoot = resolve(packageRoot, '../..');
const distRoot = resolve(packageRoot, 'dist');
const temporaryRoot = resolve(packageRoot, '.build-work');
const compiler = resolve(repositoryRoot, 'node_modules/typescript/bin/tsc');
const publishedCoreTypes = resolve(
  repositoryRoot,
  'node_modules/@nest-base/core/dist/types/index.d.ts',
);

function run(project: string): void {
  const result = Bun.spawnSync(['bun', compiler, '-p', project], {
    cwd: repositoryRoot,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (result.exitCode !== 0) throw new Error(`Build failed: ${project}`);
}

function copySources(): void {
  const source = readFileSync(
    resolve(repositoryRoot, 'src/common/controller/crud-controller.factory.ts'),
    'utf8',
  )
    .replace(
      "import { RESPONSE_MESSAGES } from '../constants/response-messages';",
      "import { RESPONSE_MESSAGES } from '../constants/response-messages.js';",
    )
    .replace(
      "from '../responses/success.response';",
      "from '../responses/success.response.js';",
    )
    .replace(
      "import { BaseService, PaginatedResponse } from '../services/base.service';",
      "import type { BaseService, PaginatedResponse } from '@nest-base/core';",
    );
  const target = resolve(
    temporaryRoot,
    'src/controller/crud-controller.factory.impl.ts',
  );
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, source);

  for (const relative of [
    'src/index.ts',
    'src/controller/crud-controller.factory.ts',
    'src/responses/success.response.ts',
  ]) {
    const targetPath = resolve(temporaryRoot, relative);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(
      targetPath,
      readFileSync(resolve(packageRoot, relative), 'utf8'),
    );
  }

  mkdirSync(resolve(temporaryRoot, 'src/constants'), { recursive: true });
  writeFileSync(
    resolve(temporaryRoot, 'src/constants/response-messages.ts'),
    `export const RESPONSE_MESSAGES = { GENERAL: { NO_ENCONTRADO: 'Recurso no encontrado', ELIMINADO_EXITO: 'Eliminado correctamente', RESTAURADO_EXITO: 'Restaurado correctamente' } } as const;\n`,
  );
}

function writeConfig(format: 'esm' | 'cjs' | 'types'): void {
  const config = {
    compilerOptions: {
      target: 'ES2022',
      module:
        format === 'esm'
          ? 'NodeNext'
          : format === 'cjs'
            ? 'CommonJS'
            : 'NodeNext',
      moduleResolution:
        format === 'esm' || format === 'types' ? 'NodeNext' : 'Node',
      rootDir: './src',
      baseUrl: repositoryRoot,
      paths: {
        '@nest-base/core': [publishedCoreTypes],
      },
      outDir:
        format === 'types'
          ? resolve(temporaryRoot, 'artifact-dist/types')
          : resolve(temporaryRoot, `artifact-dist/${format}`),
      strict: true,
      skipLibCheck: true,
      esModuleInterop: true,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      declaration: format === 'types',
      emitDeclarationOnly: format === 'types',
      sourceMap: format !== 'types',
      noEmitOnError: true,
    },
    include: ['src/**/*.ts'],
  };
  writeFileSync(
    resolve(temporaryRoot, `tsconfig.${format}.json`),
    JSON.stringify(config),
  );
}

function main(): void {
  if (!existsSync(compiler))
    throw new Error('TypeScript compiler is unavailable');
  rmSync(temporaryRoot, { recursive: true, force: true });
  mkdirSync(temporaryRoot, { recursive: true });

  try {
    copySources();
    writeConfig('esm');
    writeConfig('cjs');
    writeConfig('types');
    run(resolve(temporaryRoot, 'tsconfig.esm.json'));
    run(resolve(temporaryRoot, 'tsconfig.cjs.json'));
    run(resolve(temporaryRoot, 'tsconfig.types.json'));
    writeFileSync(
      resolve(temporaryRoot, 'artifact-dist/cjs/package.json'),
      '{"type":"commonjs"}\n',
    );

    const previousDist = resolve(temporaryRoot, 'previous-dist');
    if (existsSync(distRoot)) renameSync(distRoot, previousDist);
    try {
      renameSync(resolve(temporaryRoot, 'artifact-dist'), distRoot);
    } catch (error) {
      if (existsSync(previousDist)) renameSync(previousDist, distRoot);
      throw error;
    }
    console.log('build:http-core passed');
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

main();
