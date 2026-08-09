import { tmpdir } from 'node:os';
import { dirname, join, parse, sep } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { preflightTarget } from '../../../packages/create-nest-base/preflight';

const target = join(tmpdir(), 'create-nest-base-preflight', 'demo');
const parent = dirname(target);

describe('create-nest-base preflight', () => {
  it('rejects empty, relative, and traversal targets before resolve or filesystem access', () => {
    const accesses: string[] = [];
    const fileSystem = {
      exists: (path: string) => {
        accesses.push(`exists:${path}`);
        return false;
      },
      isDirectory: (path: string) => {
        accesses.push(`directory:${path}`);
        return true;
      },
      entries: (path: string) => {
        accesses.push(`entries:${path}`);
        return [];
      },
      canWrite: (path: string) => {
        accesses.push(`write:${path}`);
        return true;
      },
    };

    for (const invalidTarget of [
      '',
      'relative-target',
      `${parent}${sep}..${sep}demo`,
    ]) {
      expect(() => preflightTarget(invalidTarget, fileSystem)).toThrow(
        'unsafe target',
      );
    }
    expect(accesses).toEqual([]);
  });

  it('rejects filesystem roots and non-empty targets before side effects', () => {
    expect(() => preflightTarget(parse(tmpdir()).root)).toThrow(
      'unsafe target',
    );
    expect(() =>
      preflightTarget(target, {
        exists: () => true,
        isDirectory: () => true,
        entries: () => ['package.json'],
        canWrite: () => true,
      }),
    ).toThrow('not empty');
  });

  it('accepts a missing child beneath an existing directory', () => {
    const result = preflightTarget(target, {
      exists: (path) => path === parent,
      isDirectory: () => true,
      entries: () => [],
      canWrite: () => true,
    });

    expect(result.target).toBe(target);
  });

  it('requires Bun 1.3.14 or newer', () => {
    expect(() => preflightTarget(target, undefined, '1.3.13')).toThrow(
      'Bun 1.3.14',
    );
    expect(
      preflightTarget(
        target,
        {
          exists: (path) => path === parent,
          isDirectory: () => true,
          entries: () => [],
          canWrite: () => true,
        },
        '1.3.14',
      ).bunVersion,
    ).toBe('1.3.14');
  });

  it('refuses a target that cannot be created or written', () => {
    expect(() =>
      preflightTarget(join(parent, 'blocked'), {
        exists: (path) => path === parent,
        isDirectory: () => true,
        entries: () => [],
        canWrite: () => false,
      }),
    ).toThrow('writable');
  });
});
