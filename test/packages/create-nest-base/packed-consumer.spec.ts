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
import {
  classifyManagerAcceptance,
  evaluateManagerAcceptance,
  type ManagerAcceptanceEvidence,
} from '../../../packages/create-nest-base/manager-evidence';

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

function packHttpCoreInto(directory: string): string {
  const httpCoreRoot = resolve(packageRoot, '../http-core');
  rmSync(resolve(httpCoreRoot, 'dist'), { recursive: true, force: true });
  rmSync(resolve(httpCoreRoot, '.build-work'), {
    recursive: true,
    force: true,
  });
  const build = run([bunExecutable, 'build.ts'], httpCoreRoot);
  expect(build.exitCode, output(build)).toBe(0);
  const result = run(
    [
      npmExecutable,
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      directory,
    ],
    httpCoreRoot,
  );
  expect(result.exitCode, output(result)).toBe(0);
  const report = JSON.parse(result.stdout.toString()) as PackReport[];
  const archive = report[0]?.filename;
  expect(archive).toMatch(/\.tgz$/);
  if (!archive) throw new Error('HTTP-core archive was not produced.');
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

function runPackedCi(
  workspace: string,
  target: string,
  coreArchive: string,
  packageManager: 'bun' | 'npm' | 'pnpm' | 'yarn',
) {
  const coreBytes = new Uint8Array(readFileSync(coreArchive));
  const integrity = `sha512-${createHash('sha512').update(coreBytes).digest('base64')}`;
  return run(
    [
      bunExecutable,
      'x',
      '--bun',
      'create-nest-base',
      '--ci',
      '--package-manager',
      packageManager,
      '--target',
      target,
      '--select',
      'core-crud',
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

function resolveAvailableManager(
  packageManager: 'bun' | 'npm' | 'pnpm' | 'yarn',
): string | undefined {
  return (
    Bun.which(
      packageManager === 'npm' && process.platform === 'win32'
        ? 'npm.cmd'
        : packageManager,
    ) ?? undefined
  );
}

function runPackedHttpCoreCi(
  workspace: string,
  target: string,
  coreArchive: string,
  httpCoreArchive: string,
) {
  const coreBytes = new Uint8Array(readFileSync(coreArchive));
  const httpCoreBytes = new Uint8Array(readFileSync(httpCoreArchive));
  return run(
    [
      bunExecutable,
      'x',
      '--bun',
      'create-nest-base',
      '--ci',
      '--package-manager',
      'bun',
      '--target',
      target,
      '--select',
      'core-crud,http-core',
      '--yes',
      '--core-version',
      '0.1.0',
      '--core-source',
      coreArchive,
      '--core-integrity',
      `sha512-${createHash('sha512').update(coreBytes).digest('base64')}`,
      '--http-core-version',
      '0.1.0',
      '--http-core-source',
      httpCoreArchive,
      '--http-core-integrity',
      `sha512-${createHash('sha512').update(httpCoreBytes).digest('base64')}`,
      '--retry',
    ],
    workspace,
    { ...process.env, CI: '1' },
  );
}

function verifyGeneratedCoreResolution(target: string) {
  return run(
    [
      bunExecutable,
      '-e',
      "const resolved = await import.meta.resolve('@nest-base/core'); if (!resolved.includes('/node_modules/@nest-base/core/') && !resolved.includes('\\\\node_modules\\\\@nest-base\\\\core\\\\')) throw new Error(`repository fallback: ${resolved}`); const pkg = await import('@nest-base/core/package.json', { with: { type: 'json' } }); if (pkg.default?.version !== '0.1.0') throw new Error(`unexpected core version: ${pkg.default?.version}`);",
    ],
    target,
    { ...process.env, NODE_PATH: '' },
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
      const result = runPackedCi(workspace, target, coreArchive, 'bun');

      expect(result.exitCode, output(result)).toBe(0);
      expect(output(result)).toContain('core-crud');
      const resolution = verifyGeneratedCoreResolution(target);
      expect(resolution.exitCode, output(resolution)).toBe(0);
      const manifest = JSON.parse(
        readFileSync(resolve(target, '.nest-base/manifest.json'), 'utf8'),
      ) as { packageManager: string; installArgs: string[] };
      const packageJson = JSON.parse(
        readFileSync(resolve(target, 'package.json'), 'utf8'),
      ) as {
        nestBase: {
          packageManager: string;
          launcher: string;
          installEnabled: boolean;
          installArgs: string[];
          capabilities: unknown[];
        };
      };
      expect(manifest.packageManager).toBe('bun');
      expect(manifest.installArgs).toEqual(['install']);
      expect(packageJson.nestBase).toMatchObject({
        packageManager: 'bun',
        launcher: 'bunx',
        installEnabled: true,
        installArgs: ['install'],
        capabilities: [{ id: 'core-crud' }],
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(wizardArchiveDirectory, { recursive: true, force: true });
      rmSync(coreArchiveDirectory, { recursive: true, force: true });
    }
  });

  it('runs the packed wizard HTTP-core gate with packed core through ESM and CJS', () => {
    const workspace = createConsumer();
    const wizardArchiveDirectory = createConsumer();
    const coreArchiveDirectory = createConsumer();
    const httpCoreArchiveDirectory = createConsumer();
    try {
      const wizardArchive = packInto(wizardArchiveDirectory);
      const coreArchive = packCoreInto(coreArchiveDirectory);
      const httpCoreArchive = packHttpCoreInto(httpCoreArchiveDirectory);
      const install = run(['bun', 'add', wizardArchive], workspace);
      expect(install.exitCode, output(install)).toBe(0);

      const target = resolve(workspace, 'generated-http-core-app');
      mkdirSync(resolve(target, 'src'), { recursive: true });
      mkdirSync(resolve(target, 'test'), { recursive: true });
      writeFileSync(
        resolve(target, 'package.json'),
        JSON.stringify({ name: 'generated-http-core-app' }),
      );
      const result = runPackedHttpCoreCi(
        workspace,
        target,
        coreArchive,
        httpCoreArchive,
      );

      expect(result.exitCode, output(result)).toBe(0);
      expect(output(result)).toContain('http-core');
      const resolution = verifyGeneratedCoreResolution(target);
      expect(resolution.exitCode, output(resolution)).toBe(0);
      const packageJson = JSON.parse(
        readFileSync(resolve(target, 'package.json'), 'utf8'),
      ) as { nestBase: { capabilities: Array<{ id: string }> } };
      expect(packageJson.nestBase.capabilities.map(({ id }) => id)).toEqual([
        'core-crud',
        'http-core',
      ]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
      rmSync(wizardArchiveDirectory, { recursive: true, force: true });
      rmSync(coreArchiveDirectory, { recursive: true, force: true });
      rmSync(httpCoreArchiveDirectory, { recursive: true, force: true });
    }
  });

  it('runs packed core acceptance for every available supported manager', () => {
    const yarnExecutable = Bun.which(
      process.platform === 'win32' ? 'yarn.cmd' : 'yarn',
    );
    console.log(
      `packed manager evidence: yarn=${
        yarnExecutable
          ? `available (${yarnExecutable})`
          : 'unavailable (executable not found)'
      }`,
    );
    const managers = (['bun', 'npm', 'pnpm', 'yarn'] as const).filter(
      (manager) => {
        const executable = resolveAvailableManager(manager);
        console.log(
          `packed manager evidence: ${manager}=${executable ? `available (${executable})` : 'unavailable'}`,
        );
        return Boolean(executable);
      },
    );

    const acceptance: Record<
      'bun' | 'npm' | 'pnpm' | 'yarn',
      ManagerAcceptanceEvidence
    > = {
      bun: classifyManagerAcceptance({ available: true, exitCode: 1 }),
      npm: classifyManagerAcceptance({ available: true, exitCode: 1 }),
      pnpm: classifyManagerAcceptance({ available: true, exitCode: 1 }),
      yarn: classifyManagerAcceptance({
        available: Boolean(yarnExecutable),
        exitCode: 1,
      }),
    };

    for (const packageManager of managers) {
      const workspace = createConsumer();
      const wizardArchiveDirectory = createConsumer();
      const coreArchiveDirectory = createConsumer();
      try {
        const wizardArchive = packInto(wizardArchiveDirectory);
        const coreArchive = packCoreInto(coreArchiveDirectory);
        const install = run([npmExecutable, 'add', wizardArchive], workspace);
        expect(install.exitCode, output(install)).toBe(0);

        const target = resolve(workspace, `generated-${packageManager}-app`);
        mkdirSync(resolve(target, 'src'), { recursive: true });
        mkdirSync(resolve(target, 'test'), { recursive: true });
        writeFileSync(
          resolve(target, 'package.json'),
          JSON.stringify({ name: `generated-${packageManager}-app` }),
        );
        const result = runPackedCi(
          workspace,
          target,
          coreArchive,
          packageManager,
        );

        const resultOutput = output(result);
        const resolution =
          result.exitCode === 0
            ? verifyGeneratedCoreResolution(target)
            : undefined;
        const combinedOutput = `${resultOutput}${
          resolution ? output(resolution) : ''
        }`;
        acceptance[packageManager] = classifyManagerAcceptance({
          available: true,
          exitCode:
            result.exitCode === 0 && resolution?.exitCode === 0
              ? 0
              : result.exitCode || resolution?.exitCode || 1,
          output: combinedOutput,
        });
        if (acceptance[packageManager].status === 'passed') {
          expect(resultOutput).toContain('core-crud');
          continue;
        }

        console.log(
          `packed manager acceptance ${acceptance[packageManager].status}: ${packageManager}; ${combinedOutput || 'wizard install failed'}`,
        );
      } finally {
        rmSync(workspace, { recursive: true, force: true });
        rmSync(wizardArchiveDirectory, { recursive: true, force: true });
        rmSync(coreArchiveDirectory, { recursive: true, force: true });
      }
    }

    for (const manager of ['bun', 'npm', 'pnpm', 'yarn'] as const)
      if (!managers.includes(manager))
        acceptance[manager] = classifyManagerAcceptance({
          available: false,
          exitCode: 1,
        });

    expect(acceptance.bun.status).toBe('passed');
    expect(acceptance.npm.status).toBe('passed');
    expect(acceptance.pnpm.status).toBe('environment-blocked');
    expect(acceptance.yarn.status).toBe(
      yarnExecutable ? 'passed' : 'unavailable',
    );
    const summary = evaluateManagerAcceptance(acceptance);
    expect(summary.matrixPassed).toBe(false);
    expect(summary.releaseEvidence).toBe(false);
    expect(summary.publicationAllowed).toBe(false);
    expect(summary.blockers).toContain('pnpm: node:sqlite unavailable');
    if (!yarnExecutable)
      expect(summary.blockers).toContain('yarn: executable not found on PATH');
  });
});
