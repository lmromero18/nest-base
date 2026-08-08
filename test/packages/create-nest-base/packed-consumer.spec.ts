import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'bun:test';

const packageRoot = resolve(
  import.meta.dir,
  '../../../packages/create-nest-base',
);
const bunExecutable = process.execPath;
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';

type PackReport = {
  filename: string;
};

function run(command: string[], cwd: string) {
  return Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, NODE_PATH: '' },
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
      const help = runPackedHelp(workspace);

      expect(binPath.startsWith(`${workspace}${sep}`)).toBe(true);
      expect(installedEntry.startsWith(`${workspace}${sep}`)).toBe(true);
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
});
