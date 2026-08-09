import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import {
  formatHelp,
  parseCliArgs,
  runCliPipeline,
  serializePlan,
  type CliPipelineDependencies,
} from '../../../packages/create-nest-base/cli';
import {
  buildMetadataPreview,
  createMetadataFileSystem,
  rollbackOwnedWrites,
} from '../../../packages/create-nest-base/metadata';
import { normalizeCiInput } from '../../../packages/create-nest-base/cli';
import {
  buildInteractiveCards,
  normalizeInteractiveInput,
} from '../../../packages/create-nest-base/ux';
import { preflightTarget } from '../../../packages/create-nest-base/preflight';

const bytes = new TextEncoder().encode('integration-artifact');
const integrity: `sha512-${string}` = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

async function expectRejected(
  promise: Promise<unknown>,
  message: string,
): Promise<void> {
  await promise.then(
    () => {
      throw new Error('Expected rejection.');
    },
    (error: unknown) => {
      expect(error instanceof Error ? error.message : String(error)).toContain(
        message,
      );
    },
  );
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'create-nest-base-'));
  const target = join(root, 'demo');
  const calls: string[] = [];
  const dependencies: CliPipelineDependencies = {
    fileSystem: {
      exists: existsSync,
      isDirectory: (path) => statSync(path).isDirectory(),
      entries: readdirSync,
      canWrite: () => true,
    },
    artifactLoaders: {
      registry: () => Promise.resolve({ bytes }),
      inspect: () => ({ package: '@nest-base/core', version: '1.0.0' }),
    },
    independentConsumerGate: { verify: () => Promise.resolve() },
    confirm: () => {
      calls.push('confirm');
      return Promise.resolve();
    },
    scaffold: (command, cwd) => {
      calls.push(`scaffold:${command.args.join(' ')}`);
      const project = join(cwd, command.args[2]);
      mkdirSync(join(project, 'src'), { recursive: true });
      mkdirSync(join(project, 'test'), { recursive: true });
      writeFileSync(
        join(project, 'package.json'),
        JSON.stringify({ name: 'demo' }),
      );
      return Promise.resolve();
    },
    scaffoldFileSystem: {
      readPackage: (path) =>
        JSON.parse(readFileSync(path, 'utf8')) as { name?: unknown },
      isDirectory: (path) => statSync(path).isDirectory(),
    },
    metadataFileSystem: createMetadataFileSystem(),
    install: ({ cwd, args }) => {
      calls.push(`install:${cwd}:${args.join(' ')}`);
      return Promise.resolve();
    },
  };
  return { root, target, calls, dependencies };
}

function args(target: string, dryRun = false) {
  return {
    ci: true,
    dryRun,
    yes: true,
    help: false,
    target,
    coreVersion: '1.0.0',
    coreSource: '@nest-base/core@1.0.0',
    coreIntegrity: integrity,
  } as const;
}

describe('create-nest-base temporary-root acceptance coverage', () => {
  it('exposes help for CLI smoke checks without resolving a target', () => {
    const parsed = parseCliArgs(['--help']);
    expect(parsed.help).toBe(true);
    expect(formatHelp()).toContain('create-nest-base');
  });

  it('keeps interactive and CI plans equivalent and explains capability availability', () => {
    const interactive = normalizeInteractiveInput({
      target: 'C:\\demo',
      coreVersion: '1.0.0',
      coreIntegrity: integrity,
    });
    const ci = normalizeCiInput({
      ci: true,
      target: 'C:\\demo',
      coreVersion: '1.0.0',
      coreSource: { kind: 'registry', spec: '@nest-base/core@1.0.0' },
      coreIntegrity: integrity,
    });
    expect(serializePlan(interactive)).toBe(serializePlan(ci));
    expect(buildInteractiveCards().map((card) => card.id)).toContain(
      'generator',
    );
    expect(
      buildInteractiveCards().find((card) => card.id === 'kafka')?.message,
    ).toContain('unavailable');
  });

  it('runs a real temporary-root flow in the pinned order and writes a mirror', async () => {
    const context = setup();
    const result = await runCliPipeline(
      args(context.target),
      context.dependencies,
    );
    expect(result.exitCode).toBe(0);
    expect(context.calls).toEqual([
      'confirm',
      'scaffold:@nestjs/cli@11.0.0 new demo --package-manager bun --strict --skip-install --skip-git',
      `install:${context.target}:install`,
    ]);
    const packageJson = JSON.parse(
      readFileSync(join(context.target, 'package.json'), 'utf8'),
    ) as {
      nestBase: { capabilities: Array<{ id: string }> };
      dependencies: Record<string, string>;
    };
    expect(packageJson.nestBase.capabilities[0].id).toBe('core-crud');
    expect(packageJson.dependencies['@nest-base/core']).toBe('1.0.0');
    expect(
      readFileSync(join(context.target, '.nest-base', 'manifest.json'), 'utf8'),
    ).toContain('resolvedEntries');
  });

  it('keeps dry-run immutable and rejects existing roots, old Bun, and missing artifacts', async () => {
    const context = setup();
    const result = await runCliPipeline(
      args(context.target, true),
      context.dependencies,
    );
    expect(result.output).toContain('No files');
    expect(readdirSync(context.root)).toEqual([]);
    expect(() => preflightTarget(context.root, undefined, '1.3.13')).toThrow(
      'Bun 1.3.14',
    );
    mkdirSync(join(context.root, 'occupied'));
    writeFileSync(join(context.root, 'occupied', 'README.md'), 'owned');
    expect(() => preflightTarget(join(context.root, 'occupied'))).toThrow(
      'not empty',
    );
    await expectRejected(
      runCliPipeline(args(join(context.root, 'missing')), {
        ...context.dependencies,
        artifactLoaders: { registry: () => Promise.resolve(undefined) },
      }),
      'unavailable',
    );
  });

  it('is verify-only on rerun, reports drift, dependency conflicts, and rollback recovery', async () => {
    const context = setup();
    const first = await runCliPipeline(
      args(context.target),
      context.dependencies,
    );
    expect(first.exitCode).toBe(0);
    const samePlan = buildMetadataPreview(
      first.plan!,
      context.dependencies.metadataFileSystem!,
    );
    expect(samePlan.writes).toEqual([]);
    const packagePath = join(context.target, 'package.json');
    writeFileSync(packagePath, JSON.stringify({ name: 'changed' }));
    expect(() =>
      buildMetadataPreview(
        first.plan!,
        context.dependencies.metadataFileSystem!,
      ),
    ).toThrow('drift');
    const conflictRoot = mkdtempSync(
      join(tmpdir(), 'create-nest-base-conflict-'),
    );
    writeFileSync(
      join(conflictRoot, 'package.json'),
      JSON.stringify({
        name: 'conflict',
        peerDependencies: { '@nest-base/core': '2.0.0' },
      }),
    );
    expect(() =>
      buildMetadataPreview(
        { ...first.plan!, target: conflictRoot },
        createMetadataFileSystem(),
      ),
    ).toThrow('conflict');
    const recoveryRoot = join(context.root, 'recovery');
    writeFileSync(recoveryRoot, 'new');
    writeFileSync(recoveryRoot, 'changed by another process');
    const rollback = rollbackOwnedWrites(
      {
        writes: [
          { path: recoveryRoot, content: 'new', previousContent: 'old' },
        ],
        manifest: {} as never,
        mirror: {} as never,
      },
      createMetadataFileSystem(),
    );
    expect(rollback.leftovers).toEqual([recoveryRoot]);
    expect(readFileSync(recoveryRoot, 'utf8')).toBe(
      'changed by another process',
    );
  });

  it('preserves a failed new target and reports recovery when install changes owned bytes', async () => {
    const context = setup();
    const install = () => {
      writeFileSync(join(context.target, 'package.json'), 'changed by install');
      return Promise.reject(new Error('install failed'));
    };
    await expectRejected(
      runCliPipeline(args(context.target), {
        ...context.dependencies,
        install,
      }),
      'Leftovers',
    );
    expect(existsSync(context.target)).toBe(true);
    expect(readFileSync(join(context.target, 'package.json'), 'utf8')).toBe(
      'changed by install',
    );
  });
});
