import { join } from 'node:path';
import { createPackageManagerAdapter } from './install.js';
import type { PackageManager } from './types.js';

export interface ScaffoldCommand {
  executable: string;
  args: string[];
}

export function buildScaffoldCommand(
  projectName: string,
  packageManager: PackageManager = 'bun',
): ScaffoldCommand {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(projectName)) {
    throw new Error('Project name is invalid.');
  }
  return createPackageManagerAdapter(packageManager).scaffoldCommand(
    projectName,
  );
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
