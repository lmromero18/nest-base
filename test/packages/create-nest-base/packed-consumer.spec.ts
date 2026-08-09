import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { describe, expect, it, setDefaultTimeout } from 'bun:test';

setDefaultTimeout(120_000);

const packageRoot = resolve(__dirname, '../../../packages/create-nest-base');
const bunExecutable = process.execPath;
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

type PackReport = {
  filename: string;
};

function run(
  command: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return Bun.spawnSync(command, {
    cwd,
    env: { ...environment, NODE_PATH: '' },
    stderr: 'pipe',
    stdout: 'pipe',
  });
}

function output(result: ReturnType<typeof run>): string {
  return `${result.stdout.toString()}${result.stderr.toString()}`;
}

function packInto(directory: string): string {
  const result = run(
    [npmExecutable, 'pack', '--json', '--pack-destination', directory],
    packageRoot,
  );

  expect(result.exitCode).toBe(0);
  const report = JSON.parse(result.stdout.toString()) as PackReport[];
  const archive = report[0]?.filename;

  expect(archive).toMatch(/\.tgz$/);
  return resolve(directory, archive);
}

function packCoreInto(directory: string): string {
  const coreRoot = resolve(packageRoot, '../core');
  if (!existsSync(resolve(coreRoot, 'dist'))) {
    const build = run([bunExecutable, 'build.ts'], coreRoot);
    expect(build.exitCode, output(build)).toBe(0);
  }
  const result = run(
    [
      npmExecutable,
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      directory,
    ],
    coreRoot,
  );
  expect(result.exitCode).toBe(0);
  const report = JSON.parse(result.stdout.toString()) as PackReport[];
  const archive = report[0]?.filename;
  expect(archive).toMatch(/\.tgz$/);
  if (!archive) throw new Error('Core archive was not produced.');
  return resolve(directory, archive);
}

function createConsumer(): string {
  return mkdtempSync(resolve(tmpdir(), 'create-nest-base-consumer-'));
}

function resolveInstalledBin(workspace: string): string {
  const binDirectory = resolve(workspace, 'node_modules/.bin');
  const names = readdirSync(binDirectory);
  const binName = [
    'create-nest-base.bunx',
    'create-nest-base.cmd',
    'create-nest-base',
    'create-nest-base.exe',
  ].find((name) => names.includes(name));

  expect(binName).toBeTruthy();
  return resolve(binDirectory, binName as string);
}

function withCleanConsumer(callback: (workspace: string) => void) {
  const workspace = createConsumer();
  const archiveDirectory = createConsumer();

  try {
    const archive = packInto(archiveDirectory);
    const install = run(['bun', 'add', archive], workspace);

    expect(install.exitCode).toBe(0);
    callback(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
    rmSync(archiveDirectory, { recursive: true, force: true });
  }
}

function runPackedCi(workspace: string, target: string, coreArchive: string) {
  const coreBytes = new Uint8Array(readFileSync(coreArchive));
  const integrity = `sha512-${createHash('sha512').update(coreBytes).digest('base64')}`;
  return run(
    [
      bunExecutable,
      'x',
      '--bun',
      'create-nest-base',
      '--ci',
      '--target',
      target,
      '--yes',
      '--core-version',
      '0.1.0',
      '--core-source',
      coreArchive,
      '--core-integrity',
      integrity,
      '--retry',
    ],
    workspace,
    { ...process.env, CI: '1' },
  );
}

function runPackedHelp(workspace: string) {
  return run(
    [bunExecutable, 'x', '--bun', 'create-nest-base', '--help'],
    workspace,
  );
}

describe('create-nest-base packed consumer', () => {
  it('installs the packed archive in a clean Bun consumer and runs its bin', () => {
    withCleanConsumer((workspace) => {
      const binPath = resolveInstalledBin(workspace);
      const installedEntry = resolve(
        workspace,
        'node_modules/create-nest-base/index.ts',
      );
      const installedConsumerGate = readFileSync(
        resolve(workspace, 'node_modules/create-nest-base/consumer-gate.ts'),
        'utf8',
      );
      const help = runPackedHelp(workspace);

      expect(binPath.startsWith(`${workspace}${sep}`)).toBe(true);
      expect(installedEntry.startsWith(`${workspace}${sep}`)).toBe(true);
      expect(installedConsumerGate).toContain(
        "['install', '--ignore-scripts']",
      );
      expect(installedConsumerGate).toContain("'reflect-metadata': '0.2.2'");
      expect(installedConsumerGate).toContain("typeorm: '0.3.31'");
      expect(help.exitCode).toBe(0);
      expect(output(help)).toContain('create-nest-base');
      expect(output(help)).toContain('--target');
    });
  });

  it('runs only from the installed package boundary outside the repository', () => {
    withCleanConsumer((workspace) => {
      const binPath = resolveInstalledBin(workspace);
      const help = runPackedHelp(workspace);
      const combinedOutput = output(help);

      expect(binPath.startsWith(`${workspace}${sep}`)).toBe(true);
      expect(help.exitCode).toBe(0);
      expect(combinedOutput).toContain('create-nest-base');
      expect(combinedOutput).not.toContain(packageRoot);
      expect(combinedOutput).not.toContain(resolve(packageRoot, 'index.ts'));
      expect(workspace.startsWith(`${packageRoot}${sep}`)).toBe(false);
    });
  });

  it('fails instead of falling back when an installed import is missing', () => {
    withCleanConsumer((workspace) => {
      rmSync(resolve(workspace, 'node_modules/create-nest-base/cli.ts'));
      const help = runPackedHelp(workspace);

      expect(help.exitCode).not.toBe(0);
      expect(output(help)).toContain("'./cli.js'");
      expect(output(help)).not.toContain(packageRoot);
    });
  });

  it('runs CI generation from the packed wizard with a packed core artifact', () => {
    const workspace = createConsumer();
    const wizardArchiveDirectory = createConsumer();
    const coreArchiveDirectory = createConsumer();
    try {
      const wizardArchive = packInto(wizardArchiveDirectory);
      const coreArchive = packCoreInto(coreArchiveDirectory);
      const install = run(['bun', 'add', wizardArchive], workspace);
      expect(install.exitCode).toBe(0);

      const target = resolve(workspace, 'generated-app');
      mkdirSync(resolve(target, 'src'), { recursive: true });
      mkdirSync(resolve(target, 'test'), { recursive: true });
      writeFileSync(
        resolve(target, 'package.json'),
        JSON.stringify({ name: 'generated-app' }),
      );
      const result = runPackedCi(workspace, target, coreArchive);

      expect(result.exitCode, output(result)).toBe(0);
      expect(output(result)).toContain('core-crud');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(wizardArchiveDirectory, { recursive: true, force: true });
      rmSync(coreArchiveDirectory, { recursive: true, force: true });
    }
  });
});
