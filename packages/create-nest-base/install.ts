import type { PackageManager } from './types.js';
export type { PackageManager } from './types.js';

export interface SelectedDependencies {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface InstallCommand {
  cwd: string;
  executable?: string;
  args: ['install'];
}

export interface PackageManagerAdapterOptions {
  platform?: NodeJS.Platform;
  resolveExecutable?: (executable: string) => string | undefined;
}

export interface PackageManagerAdapter {
  manager: PackageManager;
  scaffoldCommand(projectName: string): {
    executable: string;
    args: string[];
  };
  installCommand(cwd: string): InstallCommand;
}

const launchers: Record<PackageManager, string[]> = {
  npm: ['npx'],
  pnpm: ['pnpm', 'dlx'],
  yarn: ['yarn', 'dlx'],
  bun: ['bunx'],
};

export function describePackageManagerCommands(
  manager: PackageManager,
  projectName: string,
): {
  scaffold: { executable: string; args: string[] };
  install: { executable: string; args: ['install'] };
} {
  const extension =
    manager === 'npm' && process.platform === 'win32' ? '.cmd' : '';
  return {
    scaffold: {
      executable: `${launchers[manager][0]}${extension}`,
      args: [
        ...launchers[manager].slice(1),
        '@nestjs/cli@11.0.0',
        'new',
        projectName,
        '--package-manager',
        manager,
        '--strict',
        '--skip-install',
        '--skip-git',
      ],
    },
    install: { executable: `${manager}${extension}`, args: ['install'] },
  };
}

export function resolveExecutableOnPath(
  executable: string,
): string | undefined {
  return Bun.which(executable) ?? undefined;
}

export function createPackageManagerAdapter(
  manager: PackageManager,
  options: PackageManagerAdapterOptions = {},
): PackageManagerAdapter {
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(manager))
    throw new Error('Package manager must be npm, pnpm, yarn, or bun.');
  const extension =
    manager === 'npm' && (options.platform ?? process.platform) === 'win32'
      ? '.cmd'
      : '';
  const resolver = options.resolveExecutable ?? resolveExecutableOnPath;
  const launcher = resolveRequiredExecutable(
    `${launchers[manager][0]}${extension}`,
    resolver,
  );
  return {
    manager,
    scaffoldCommand(projectName) {
      return {
        executable: launcher,
        args: [
          ...launchers[manager].slice(1),
          '@nestjs/cli@11.0.0',
          'new',
          projectName,
          '--package-manager',
          manager,
          '--strict',
          '--skip-install',
          '--skip-git',
        ],
      };
    },
    installCommand(cwd) {
      if (!cwd.trim()) throw new Error('Install target CWD is required.');
      return {
        executable: resolveRequiredExecutable(
          `${manager}${extension}`,
          resolver,
        ),
        cwd,
        args: ['install'],
      };
    },
  };
}

function resolveRequiredExecutable(
  executable: string,
  resolver: (executable: string) => string | undefined,
): string {
  const resolved = resolver(executable);
  if (resolved) return resolved;
  throw new Error(
    `${executable.replace(/\.cmd$/, '')} executable is unavailable.`,
  );
}

export class BunInstallContract {
  private hasInstalled = false;

  public constructor(
    private readonly run: (command: InstallCommand) => Promise<void>,
  ) {}

  public async install(
    cwd: string,
    selectedDependencies: SelectedDependencies,
  ): Promise<void> {
    if (this.hasInstalled)
      throw new Error('The install contract allows exactly one install.');
    if (!cwd.trim()) throw new Error('Install target CWD is required.');
    if (!selectedDependencies)
      throw new Error('Selected dependencies are required.');
    this.hasInstalled = true;
    await this.run({ cwd, args: ['install'] });
  }
}
