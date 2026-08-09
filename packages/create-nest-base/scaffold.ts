import { join } from 'node:path';

export interface ScaffoldCommand {
  executable: 'bunx';
  args: [
    string,
    'new',
    string,
    '--package-manager',
    'bun',
    '--strict',
    '--skip-install',
    '--skip-git',
  ];
}

export function buildScaffoldCommand(projectName: string): ScaffoldCommand {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(projectName)) {
    throw new Error('Project name is invalid.');
  }
  return {
    executable: 'bunx',
    args: [
      '@nestjs/cli@11.0.0',
      'new',
      projectName,
      '--package-manager',
      'bun',
      '--strict',
      '--skip-install',
      '--skip-git',
    ],
  };
}

export interface ScaffoldFileSystem {
  readPackage(path: string): { name?: unknown };
  isDirectory(path: string): boolean;
}

export function verifyVanillaScaffold(
  target: string,
  fileSystem: ScaffoldFileSystem,
): { packageName: string } {
  const packageJson = fileSystem.readPackage(join(target, 'package.json'));
  if (typeof packageJson.name !== 'string' || !packageJson.name.trim()) {
    throw new Error('Vanilla scaffold package.json is invalid.');
  }
  if (!fileSystem.isDirectory(join(target, 'src'))) {
    throw new Error('Vanilla scaffold src directory is missing.');
  }
  if (!fileSystem.isDirectory(join(target, 'test'))) {
    throw new Error('Vanilla scaffold test directory is missing.');
  }
  return { packageName: packageJson.name };
}
