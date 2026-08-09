import { describe, expect, it } from 'bun:test';
import {
  normalizeCiInput,
  parseCliArgs,
  serializePlan,
} from '../../../packages/create-nest-base/cli';
import {
  normalizeInteractiveInput,
  renderPreview,
} from '../../../packages/create-nest-base/ux';
import {
  createPackageManagerAdapter,
  resolveExecutableOnPath,
  type PackageManager,
} from '../../../packages/create-nest-base/install';

const artifact = {
  coreSource: { kind: 'registry' as const, spec: '@nest-base/core@1.2.3' },
  coreVersion: '1.2.3',
  coreIntegrity: ('sha512-' + 'A'.repeat(88)) as `sha512-${string}`,
  selections: ['core-crud'],
};

describe('create-nest-base manager plan', () => {
  it('defaults interactive plans to Bun and keeps normalized data immutable', () => {
    const plan = normalizeInteractiveInput({ target: './demo' });

    expect(plan.packageManager).toBe('bun');
    expect(plan.installEnabled).toBe(true);
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.capabilities[0])).toBe(true);
    expect(Object.isFrozen(plan.capabilities[0].source)).toBe(true);
    expect(renderPreview(plan)).toContain('Package manager: bun');
    expect(renderPreview(plan)).toContain('Install: enabled');
  });

  it('previews concrete commands, artifact identities, and confirmation actions', () => {
    const plan = normalizeInteractiveInput({
      target: './demo',
      packageManager: 'pnpm',
      coreVersion: '1.2.3',
      coreSource: { kind: 'registry', spec: '@nest-base/core@1.2.3' },
      coreIntegrity: artifact.coreIntegrity,
    });

    const preview = renderPreview(plan);
    expect(preview).toContain(
      'Scaffold command: pnpm dlx @nestjs/cli@11.0.0 new demo --package-manager pnpm --strict --skip-install --skip-git',
    );
    expect(preview).toContain('Install command: pnpm install');
    expect(preview).toContain('Source: registry @nest-base/core@1.2.3');
    expect(preview).toContain('Version: 1.2.3');
    expect(preview).toContain(`Integrity: ${artifact.coreIntegrity}`);
    expect(preview).toContain(
      'Action: confirm to create files and install packages',
    );
  });

  it('requires an explicit supported manager in CI and never infers it', () => {
    expect(() =>
      normalizeCiInput({ ci: true, target: './demo', ...artifact }),
    ).toThrow('package manager');
    expect(() =>
      normalizeCiInput({
        ci: true,
        target: './demo',
        packageManager: 'deno' as PackageManager,
        ...artifact,
      }),
    ).toThrow('npm, pnpm, yarn, or bun');

    const plan = normalizeCiInput({
      ci: true,
      target: './demo',
      packageManager: 'pnpm',
      ...artifact,
    });
    expect(plan.packageManager).toBe('pnpm');
    expect(serializePlan(plan)).toContain('"packageManager":"pnpm"');
  });

  it('parses the explicit manager and skip-install CLI controls', () => {
    expect(
      parseCliArgs([
        '--ci',
        '--package-manager',
        'yarn',
        '--skip-install',
        '--target',
        './demo',
      ]),
    ).toMatchObject({ ci: true, packageManager: 'yarn', skipInstall: true });
  });
});

describe('create-nest-base package manager adapter', () => {
  const managers: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

  it('maps every manager to argument arrays without shell interpolation', () => {
    for (const manager of managers) {
      const adapter = createPackageManagerAdapter(manager, {
        resolveExecutable: (command) => command,
        platform: 'linux',
      });
      const command = adapter.scaffoldCommand('demo;touch hacked');

      expect(command.args).toContain('demo;touch hacked');
      expect(command.args).not.toContain('demo;touch hacked --strict');
      expect(adapter.installCommand('/tmp/demo')).toEqual({
        executable: manager,
        cwd: '/tmp/demo',
        args: ['install'],
      });
    }
  });

  it('uses npm.cmd on Windows and rejects unavailable executables', () => {
    const resolved: string[] = [];
    const adapter = createPackageManagerAdapter('npm', {
      platform: 'win32',
      resolveExecutable: (command) => {
        resolved.push(command);
        return command;
      },
    });

    expect(adapter.scaffoldCommand('demo').executable).toBe('npx.cmd');
    expect(adapter.installCommand('C:\\demo').executable).toBe('npm.cmd');
    expect(resolved).toEqual(['npx.cmd', 'npm.cmd']);
    expect(() =>
      createPackageManagerAdapter('pnpm', {
        platform: 'linux',
        resolveExecutable: () => undefined,
      }),
    ).toThrow('pnpm executable is unavailable');
  });

  it('uses the production PATH resolver and rejects a missing manager without injection', () => {
    expect(
      resolveExecutableOnPath('__create_nest_base_missing_manager__'),
    ).toBe(undefined);
    expect(() => createPackageManagerAdapter('yarn')).toThrow(
      'executable is unavailable',
    );
  });
});
