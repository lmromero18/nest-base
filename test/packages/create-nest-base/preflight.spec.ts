import { describe, expect, it } from 'bun:test';
import { preflightTarget } from '../../../packages/create-nest-base/preflight';

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

    for (const target of ['', 'relative-target', 'C:\\work\\..\\demo']) {
      expect(() => preflightTarget(target, fileSystem)).toThrow(
        'unsafe target',
      );
    }
    expect(accesses).toEqual([]);
  });

  it('rejects filesystem roots and non-empty targets before side effects', () => {
    expect(() => preflightTarget('C:\\')).toThrow('unsafe target');
    expect(() =>
      preflightTarget('C:\\work\\demo', {
        exists: () => true,
        isDirectory: () => true,
        entries: () => ['package.json'],
        canWrite: () => true,
      }),
    ).toThrow('not empty');
  });

  it('accepts a missing child beneath an existing directory', () => {
    const result = preflightTarget('C:\\work\\demo', {
      exists: (path) => path === 'C:\\work',
      isDirectory: () => true,
      entries: () => [],
      canWrite: () => true,
    });

    expect(result.target).toMatch(/work[\\/]demo$/);
  });

  it('requires Bun 1.3.14 or newer', () => {
    expect(() =>
      preflightTarget('C:\\work\\demo', undefined, '1.3.13'),
    ).toThrow('Bun 1.3.14');
    expect(
      preflightTarget(
        'C:\\work\\demo',
        {
          exists: (path) => path === 'C:\\work',
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
      preflightTarget('C:\\work\\blocked', {
        exists: (path) => path === 'C:\\work',
        isDirectory: () => true,
        entries: () => [],
        canWrite: () => false,
      }),
    ).toThrow('writable');
  });
});
