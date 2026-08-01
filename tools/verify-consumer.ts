import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  createCorePackageWorkspace,
  getCoreOutputLockPath,
  withCoreOutputLock,
} from './core-run-context';

export function hasRepositorySourceImport(source: string): boolean {
  return /(?:from|import\s*\(|require\s*\()\s*["'](?:src[\\/]|[^"']*[\\/]src[\\/])/m.test(
    source,
  );
}

export function createConsumerManifest(tarball: string) {
  return {
    name: 'nest-base-independent-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@nest-base/core': `file:${tarball}`,
      'reflect-metadata': '>=0.2.0 <0.3.0',
      typeorm: '>=0.3.28 <0.4.0',
    },
  };
}

export function createConsumerTsConfig(consumer: string) {
  return {
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
  };
}

export function getConsumerCompilerCommand(compiler: string): string[] {
  return ['bun', compiler, '-p', 'tsconfig.json'];
}

const repositoryRoot = resolve(
  process.env.NEST_BASE_REPOSITORY_ROOT ?? process.cwd(),
);
const packageRoot = resolve(
  process.env.NEST_BASE_CORE_PACKAGE_ROOT ??
    resolve(repositoryRoot, 'packages/core'),
);
const childTimeoutMs = 120_000;

export interface ConsumerCommandOptions {
  timeoutMs?: number;
  exec?: typeof execFileSync;
}

export function runConsumerCommand(
  command: string[],
  cwd: string,
  options: ConsumerCommandOptions = {},
): void {
  const lockToken = process.env.NEST_BASE_CORE_LOCK_TOKEN;
  const executable =
    process.platform === 'win32' && command[0] === 'npm'
      ? 'npm.cmd'
      : command[0];
  (options.exec ?? execFileSync)(executable, command.slice(1), {
    cwd,
    stdio: 'inherit',
    timeout: options.timeoutMs ?? childTimeoutMs,
    killSignal: 'SIGTERM',
    env: {
      ...process.env,
      ...(lockToken ? { NEST_BASE_CORE_LOCK_TOKEN: lockToken } : {}),
    },
  });
}

export interface ConsumerVerificationOptions {
  run?: (command: string[], cwd: string) => void;
  root?: string;
  packageRoot?: string;
  withLock?: typeof withCoreOutputLock;
}

export function runConsumerVerification(
  options: ConsumerVerificationOptions = {},
): void {
  const useExistingBuild =
    process.env.NEST_BASE_CONSUMER_USE_EXISTING_BUILD === '1';
  const preserveCoreOutputs =
    process.env.NEST_BASE_CONSUMER_PRESERVE_CORE_OUTPUTS === '1';
  const root =
    options.root ??
    (process.env.NEST_BASE_CORE_RUN_ROOT
      ? join(process.env.NEST_BASE_CORE_RUN_ROOT, 'consumer')
      : join(
          tmpdir(),
          `nest-base-independent-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        ));
  const isolatedPackageRoot =
    options.packageRoot ??
    (process.env.NEST_BASE_CORE_PACKAGE_ROOT
      ? packageRoot
      : join(root, 'package'));
  const corePackageRoot = isolatedPackageRoot;
  const ownsWorkspace =
    !options.packageRoot && !process.env.NEST_BASE_CORE_PACKAGE_ROOT;
  const buildRunRoot = join(root, 'build-run');
  const previousEnvironment = ownsWorkspace
    ? {
        packageRoot: process.env.NEST_BASE_CORE_PACKAGE_ROOT,
        sourceRoot: process.env.NEST_BASE_CORE_SOURCE_ROOT,
        runRoot: process.env.NEST_BASE_CORE_RUN_ROOT,
        lockPath: process.env.NEST_BASE_CORE_LOCK_PATH,
        repositoryRoot: process.env.NEST_BASE_REPOSITORY_ROOT,
      }
    : undefined;
  const run = options.run ?? runConsumerCommand;
  const tarballs = join(root, 'artifacts');
  const consumer = join(root, 'consumer');
  try {
    if (ownsWorkspace) {
      createCorePackageWorkspace(repositoryRoot, corePackageRoot);
      process.env.NEST_BASE_CORE_PACKAGE_ROOT = corePackageRoot;
      process.env.NEST_BASE_CORE_SOURCE_ROOT = join(
        corePackageRoot,
        'src/common',
      );
      process.env.NEST_BASE_CORE_RUN_ROOT = buildRunRoot;
      process.env.NEST_BASE_CORE_LOCK_PATH = getCoreOutputLockPath();
      process.env.NEST_BASE_REPOSITORY_ROOT = repositoryRoot;
    }
    mkdirSync(tarballs, { recursive: true });
    mkdirSync(consumer, { recursive: true });
    (options.withLock ?? withCoreOutputLock)(() => {
      if (!useExistingBuild)
        run(
          ['bun', resolve(repositoryRoot, 'packages/core/build.ts')],
          repositoryRoot,
        );
      run(
        ['npm', 'pack', '--ignore-scripts', '--pack-destination', tarballs],
        corePackageRoot,
      );
      const tarballName = readdirSync(tarballs).find((name) =>
        name.endsWith('.tgz'),
      );
      if (!tarballName)
        throw new Error('No packed @nest-base/core artifact was produced');
      const tarball = join(tarballs, tarballName);

      writeFileSync(
        join(consumer, 'package.json'),
        `${JSON.stringify(createConsumerManifest(tarball), null, 2)}\n`,
      );
      writeFileSync(
        join(consumer, 'tsconfig.json'),
        `${JSON.stringify(createConsumerTsConfig(consumer), null, 2)}\n`,
      );
      mkdirSync(join(consumer, 'src'), { recursive: true });
      const source = `import 'reflect-metadata';
import { BaseService, RequestContext, QueryStringParser, ApplicationException } from '@nest-base/core';
class ConsumerService extends BaseService<{ id: number }> {}
const query = new QueryStringParser({ isFilterable: () => true, isSortable: () => true, isRelationPath: () => true }).parse({ id: '7' });
const where = query.where as Record<string, unknown>;
const error = new ApplicationException('validation', 'consumer.invalid', 'invalid');
const context = RequestContext.run({ principal: { subject: 'consumer' } }, () => RequestContext.userId);
if (where.id !== '7' || error.code !== 'consumer.invalid' || context !== 'consumer' || !(ConsumerService.prototype instanceof BaseService)) throw new Error('consumer API contract failed');
console.log('independent consumer ESM API passed');
`;
      if (hasRepositorySourceImport(source))
        throw new Error('Consumer source imports repository source');
      writeFileSync(join(consumer, 'src/index.ts'), source);
      writeFileSync(
        join(consumer, 'cjs-check.cjs'),
        `const core = require('@nest-base/core'); if (!core.BaseService || !core.QueryStringParser) process.exit(1); console.log('independent consumer CJS API passed');\n`,
      );

      run(['bun', 'install'], consumer);
      const compiler = resolve(
        repositoryRoot,
        'node_modules/typescript/bin/tsc',
      );
      if (!existsSync(compiler))
        throw new Error(
          'Repository-approved TypeScript compiler is unavailable; run bun install',
        );
      run(getConsumerCompilerCommand(compiler), consumer);
      run(['node', 'dist/index.js'], consumer);
      run(['node', 'cjs-check.cjs'], consumer);
      run(['bun', 'dist/index.js'], consumer);
      run(['bun', 'cjs-check.cjs'], consumer);
      if (
        readdirSync(join(consumer, 'src')).some((name) =>
          hasRepositorySourceImport(requireText(join(consumer, 'src', name))),
        )
      )
        throw new Error(
          'Independent consumer source imports repository source',
        );
      if (
        !existsSync(join(consumer, 'node_modules/@nest-base/core/package.json'))
      )
        throw new Error(
          'Independent consumer did not install the packed core artifact',
        );
      console.log(`verify:consumer passed (${consumer})`);
    });
  } finally {
    try {
      rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    } finally {
      if (!preserveCoreOutputs && ownsWorkspace) {
        rmSync(resolve(corePackageRoot, 'dist'), {
          recursive: true,
          force: true,
        });
        rmSync(resolve(corePackageRoot, '.build-types'), {
          recursive: true,
          force: true,
        });
      }
    }
    if (previousEnvironment) {
      restoreEnvironment(
        'NEST_BASE_CORE_PACKAGE_ROOT',
        previousEnvironment.packageRoot,
      );
      restoreEnvironment(
        'NEST_BASE_CORE_SOURCE_ROOT',
        previousEnvironment.sourceRoot,
      );
      restoreEnvironment(
        'NEST_BASE_CORE_RUN_ROOT',
        previousEnvironment.runRoot,
      );
      restoreEnvironment(
        'NEST_BASE_REPOSITORY_ROOT',
        previousEnvironment.repositoryRoot,
      );
      restoreEnvironment(
        'NEST_BASE_CORE_LOCK_PATH',
        previousEnvironment.lockPath,
      );
    }
  }
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function requireText(path: string): string {
  return readFileSync(path, 'utf8');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename))
  runConsumerVerification();
