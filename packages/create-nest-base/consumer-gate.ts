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

export function createConsumerManifest(
  tarball: string,
  capabilityId = 'core-crud',
  dependencyTarballs?: ReadonlyMap<string, string>,
) {
  if (capabilityId === 'http-core' && !dependencyTarballs?.has('core-crud'))
    throw new Error(
      'Packed HTTP-core consumer requires a packed core dependency.',
    );
  const fileSpec = pathToFileURL(tarball).href.replace(
    /^file:\/\/\/([A-Za-z]:\/)/,
    'file://$1',
  );
  return {
    name: 'nest-base-independent-consumer',
    private: true,
    type: 'module',
    dependencies: {
      '@nest-base/core':
        (dependencyTarballs?.has('core-crud')
          ? capabilityId === 'http-core'
            ? `file:${dependencyTarballs.get('core-crud') as string}`
            : pathToFileURL(dependencyTarballs.get('core-crud') as string).href
          : undefined) ?? (capabilityId === 'core-crud' ? fileSpec : '0.1.0'),
      ...(capabilityId === 'http-core'
        ? {
            '@nest-base/http-core': fileSpec,
            '@nestjs/common': '>=11.0.0 <12.0.0',
            '@nestjs/swagger': '>=11.0.0 <12.0.0',
          }
        : {}),
      ...consumerPeerVersions,
    },
  };
}

export function createConsumerBuildCommands(capabilityId: string): string[][] {
  const external =
    capabilityId === 'http-core'
      ? ['--external', '@nest-base/http-core', '--external', '@nest-base/core']
      : ['--external', '@nest-base/core'];
  return [
    [
      'build',
      'src/index.ts',
      '--outfile',
      'dist/esm/index.js',
      '--target',
      'node',
      '--format',
      'esm',
      ...external,
    ],
    ['dist/esm/index.js'],
    [
      'build',
      'src/index.ts',
      '--outfile',
      'dist/cjs/index.cjs',
      '--target',
      'node',
      '--format',
      'cjs',
      ...external,
    ],
    ['dist/cjs/index.cjs'],
  ];
}

export function createConsumerInstallCommand(): string[] {
  return ['install', '--ignore-scripts'];
}

export function createConsumerSource(capabilityId = 'core-crud'): string {
  if (capabilityId === 'http-core')
    return `import 'reflect-metadata';
import { CrudControllerFactory } from '@nest-base/http-core';
import { BaseService } from '@nest-base/core';
class ConsumerService extends BaseService<{ id: number }> {}
if (typeof CrudControllerFactory !== 'function' || !(ConsumerService.prototype instanceof BaseService))
  throw new Error('Independent HTTP-core consumer API contract failed.');
`;
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
  capabilityId = 'core-crud',
  dependencies?: ReadonlyMap<string, ArtifactRecord>,
): Promise<void> {
  const root = mkConsumerRoot();
  const tarball = join(root, `${capabilityId}.tgz`);
  const consumer = join(root, 'consumer');
  try {
    await Promise.resolve();
    mkdirSync(join(consumer, 'src'), { recursive: true });
    writeFileSync(tarball, artifact.bytes);
    const dependencyTarballs = new Map<string, string>();
    if (dependencies) {
      for (const [id, dependency] of dependencies) {
        const dependencyPath = join(root, `${id}.tgz`);
        writeFileSync(dependencyPath, dependency.bytes);
        dependencyTarballs.set(id, dependencyPath);
      }
    }
    writeFileSync(
      join(consumer, 'package.json'),
      `${JSON.stringify(createConsumerManifest(tarball, capabilityId, dependencyTarballs), null, 2)}\n`,
    );
    writeFileSync(
      join(consumer, 'src', 'index.ts'),
      createConsumerSource(capabilityId),
    );

    run(createConsumerInstallCommand(), consumer);
    for (const command of createConsumerBuildCommands(capabilityId))
      run(command, consumer);
    assertInstalledArtifact(consumer, identity, capabilityId);
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
  capabilityId = 'core-crud',
): void {
  const packageRoot = resolve(
    consumer,
    'node_modules',
    '@nest-base',
    capabilityId === 'http-core' ? 'http-core' : 'core',
  );
  const packageJsonPath = join(packageRoot, 'package.json');
  if (!existsSync(packageJsonPath))
    throw new Error(
      `Independent consumer did not install the packed ${capabilityId} artifact.`,
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
      `Independent consumer installed an unexpected ${capabilityId} artifact.`,
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
