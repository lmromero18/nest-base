import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type {
  ArtifactRecord,
  IndependentConsumerGate,
  PackedArtifactIdentity,
} from './artifact-gate.js';

const commandTimeoutMs = 120_000;
const consumerPeerVersions = {
  'reflect-metadata': '0.2.2',
  typeorm: '0.3.31',
} as const;

export function createConsumerManifest(tarball: string) {
  const fileSpec = pathToFileURL(tarball).href.replace(
    /^file:\/\/\/([A-Za-z]:\/)/,
    'file://$1',
  );
  return {
    name: 'nest-base-independent-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@nest-base/core': fileSpec,
      ...consumerPeerVersions,
    },
  };
}

export function createConsumerInstallCommand(): string[] {
  return ['install', '--ignore-scripts'];
}

export function createConsumerSource(): string {
  return `import 'reflect-metadata';
import {
  ApplicationException,
  BaseService,
  QueryStringParser,
  RequestContext,
} from '@nest-base/core';

class ConsumerService extends BaseService<{ id: number }> {}
const query = new QueryStringParser({
  isFilterable: () => true,
  isSortable: () => true,
  isRelationPath: () => true,
}).parse({ id: '7' });
const error = new ApplicationException('validation', 'consumer.invalid', 'invalid');
const subject = RequestContext.run(
  { principal: { subject: 'consumer' } },
  () => RequestContext.userId,
);

if (
  query.where.id !== '7' ||
  error.code !== 'consumer.invalid' ||
  subject !== 'consumer' ||
  !(ConsumerService.prototype instanceof BaseService)
)
  throw new Error('Independent consumer API contract failed.');
`;
}

export function createIndependentConsumerGate(): IndependentConsumerGate {
  return { verify: verifyIndependentConsumer };
}

export async function verifyIndependentConsumer(
  artifact: ArtifactRecord,
  identity: PackedArtifactIdentity,
): Promise<void> {
  const root = mkConsumerRoot();
  const tarball = join(root, 'core.tgz');
  const consumer = join(root, 'consumer');
  try {
    await Promise.resolve();
    mkdirSync(join(consumer, 'src'), { recursive: true });
    writeFileSync(tarball, artifact.bytes);
    writeFileSync(
      join(consumer, 'package.json'),
      `${JSON.stringify(createConsumerManifest(tarball), null, 2)}\n`,
    );
    writeFileSync(join(consumer, 'src', 'index.ts'), createConsumerSource());

    run(createConsumerInstallCommand(), consumer);
    run(
      [
        'build',
        'src/index.ts',
        '--outfile',
        'dist/index.js',
        '--target',
        'node',
        '--external',
        '@nest-base/core',
      ],
      consumer,
    );
    run(['dist/index.js'], consumer);
    assertInstalledArtifact(consumer, identity);
  } finally {
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

export function assertInstalledArtifact(
  consumer: string,
  identity: PackedArtifactIdentity,
): void {
  const packageRoot = resolve(consumer, 'node_modules', '@nest-base', 'core');
  const packageJsonPath = join(packageRoot, 'package.json');
  if (!existsSync(packageJsonPath))
    throw new Error(
      'Independent consumer did not install the packed core artifact.',
    );

  const installed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    name?: unknown;
    version?: unknown;
  };
  if (
    installed.name !== identity.package ||
    installed.version !== identity.version
  )
    throw new Error(
      'Independent consumer installed an unexpected core artifact.',
    );
}

function mkConsumerRoot(): string {
  return join(
    tmpdir(),
    `create-nest-base-consumer-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
}

function run(args: string[], cwd: string): void {
  execFileSync(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    timeout: commandTimeoutMs,
    env: { ...process.env, NODE_PATH: '' },
  });
}
