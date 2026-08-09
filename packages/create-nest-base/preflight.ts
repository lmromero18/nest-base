import {
  accessSync,
  existsSync,
  readdirSync,
  statSync,
  constants,
} from 'node:fs';
import { isAbsolute, dirname, parse, resolve } from 'node:path';

export interface TargetFileSystem {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  entries(path: string): string[];
  canWrite(path: string): boolean;
}

export interface TargetPreflight {
  target: string;
  bunVersion: string;
  existing: boolean;
}

export const defaultFileSystem: TargetFileSystem = {
  exists: existsSync,
  isDirectory: (path) => statSync(path).isDirectory(),
  entries: readdirSync,
  canWrite: (path) => {
    try {
      accessSync(path, constants.W_OK);
      return true;
    } catch {
      return false;
    }
  },
};

export function preflightTarget(
  targetInput: string,
  fileSystem: TargetFileSystem = defaultFileSystem,
  bunVersion = Bun.version,
  allowNonEmpty = false,
): TargetPreflight {
  const trimmedTarget = targetInput?.trim();
  if (
    !trimmedTarget ||
    !isAbsolute(trimmedTarget) ||
    trimmedTarget.includes('\0') ||
    trimmedTarget.split(/[\\/]+/).some((segment) => segment === '..')
  ) {
    throw new Error('An unsafe target must be an absolute writable directory.');
  }
  const target = resolve(trimmedTarget);
  if (parse(target).root === target)
    throw new Error('An unsafe target cannot be a filesystem root.');
  assertBunVersion(bunVersion);

  if (fileSystem.exists(target)) {
    if (!fileSystem.isDirectory(target))
      throw new Error('The target is not a directory.');
    if (!allowNonEmpty && fileSystem.entries(target).length > 0)
      throw new Error('The target is not empty.');
  } else {
    const parent = dirname(target);
    if (!fileSystem.exists(parent) || !fileSystem.isDirectory(parent)) {
      throw new Error('The target parent directory is not available.');
    }
  }
  const writablePath = fileSystem.exists(target) ? target : dirname(target);
  if (!fileSystem.canWrite(writablePath))
    throw new Error('The target is not writable and cannot be created safely.');
  return { target, bunVersion, existing: fileSystem.exists(target) };
}

export function assertBunVersion(version: string): void {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  const actual = match ? match.slice(1, 4).map(Number) : [0, 0, 0];
  const required = [1, 3, 14];
  let comparison = 0;
  for (let index = 0; index < required.length; index += 1) {
    if (actual[index] !== required[index]) {
      comparison = actual[index] < required[index] ? -1 : 1;
      break;
    }
  }
  if (comparison < 0) {
    throw new Error('Bun 1.3.14 or newer is required.');
  }
}
