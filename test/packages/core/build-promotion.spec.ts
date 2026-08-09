import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  type PromotionFs,
  type RetryPolicy,
  promoteBuildArtifacts,
  recoverPromotionState,
  retryPromotionRemove,
  retryPromotionRename,
} from '../../../packages/core/build';

const policy: RetryPolicy = {
  maxAttempts: 3,
  delaysMs: [10, 20],
};

describe('core promotion filesystem retry seam', () => {
  it('rejects an explicitly configured repository root before promotion starts', () => {
    const repositoryRoot = resolve(process.cwd());
    const externalRepositoryRoot = resolve(repositoryRoot, '..');

    const environments: NodeJS.ProcessEnv[] = [
      {
        ...process.env,
        NEST_BASE_CORE_PACKAGE_ROOT: repositoryRoot,
        NEST_BASE_REPOSITORY_ROOT: repositoryRoot,
      },
      {
        ...process.env,
        NEST_BASE_CORE_PACKAGE_ROOT: repositoryRoot,
        NEST_BASE_REPOSITORY_ROOT: externalRepositoryRoot,
      },
    ];
    const packageOnlyEnvironment: NodeJS.ProcessEnv = {
      ...process.env,
      NEST_BASE_CORE_PACKAGE_ROOT: repositoryRoot,
    };
    delete packageOnlyEnvironment.NEST_BASE_REPOSITORY_ROOT;
    environments.push(packageOnlyEnvironment);

    for (const env of environments)
      expect(() =>
        execFileSync('bun', ['-e', "import './packages/core/build.ts'"], {
          cwd: repositoryRoot,
          env,
          stdio: 'pipe',
        }),
      ).toThrow(/Explicit core package root cannot be the repository root/);
  });

  it('retries a transient Windows rename failure and records bounded waits', () => {
    const operations: string[] = [];
    let attempts = 0;
    const fs = fakeFs(operations, {
      rename: () => {
        attempts += 1;
        if (attempts < 3) throw filesystemError('EPERM');
      },
    });

    retryPromotionRename(fs, 'dist', '.dist-backup', policy);

    expect(attempts).toBe(3);
    expect(operations).toEqual([
      'rename:dist:.dist-backup',
      'wait:10',
      'rename:dist:.dist-backup',
      'wait:20',
      'rename:dist:.dist-backup',
    ]);
  });

  it('stops at the retry budget and reports a permanent Windows handle', () => {
    const operations: string[] = [];
    const fs = fakeFs(operations, {
      remove: () => {
        throw filesystemError('EPERM');
      },
    });

    expect(() => retryPromotionRemove(fs, '.dist-backup', policy)).toThrow(
      /remove .*\.dist-backup.*attempts=3.*budget=3.*code=EPERM/,
    );
    expect(operations).toEqual([
      'remove:.dist-backup',
      'wait:10',
      'remove:.dist-backup',
      'wait:20',
      'remove:.dist-backup',
    ]);
  });

  it('does not retry a non-retryable filesystem failure', () => {
    const operations: string[] = [];
    const fs = fakeFs(operations, {
      rename: () => {
        throw filesystemError('EACCES');
      },
    });

    expect(() =>
      retryPromotionRename(fs, 'dist', '.dist-backup', policy),
    ).toThrow(
      /rename .*dist.*\.dist-backup.*attempts=1.*budget=3.*code=EACCES/,
    );
    expect(operations).toEqual(['rename:dist:.dist-backup']);
  });

  it('guards backup rename failure before replacement and leaves the active output', () => {
    const operations: string[] = [];
    const fs = statefulFs(operations, ['dist'], {
      rename: (source, target) => {
        if (source === 'dist' && target === '.dist-backup')
          throw filesystemError('EACCES');
      },
    });

    expect(() =>
      promoteBuildArtifacts(
        fs,
        'artifact-dist',
        'dist',
        '.dist-backup',
        policy,
      ),
    ).toThrow(/rename .*dist.*\.dist-backup.*attempts=1.*code=EACCES/);
    expect(fs.paths()).toEqual(['dist']);
    expect(operations).toEqual(['rename:dist:.dist-backup']);
  });

  it('restores the previous output before deleting the backup after partial replacement', () => {
    const operations: string[] = [];
    const fs = statefulFs(operations, ['dist', 'artifact-dist'], {
      partialRename: (source, target) =>
        source === 'artifact-dist' && target === 'dist',
    });

    expect(() =>
      promoteBuildArtifacts(
        fs,
        'artifact-dist',
        'dist',
        '.dist-backup',
        policy,
      ),
    ).toThrow(/rename .*artifact-dist.*dist.*code=EACCES/);
    expect(fs.paths()).toEqual(['dist']);
    expect(operations).toEqual([
      'rename:dist:.dist-backup',
      'rename:artifact-dist:dist',
      'remove:dist',
      'rename:.dist-backup:dist',
    ]);
  });

  it('recovers stale backup state and can repeat recovery without deleting valid dist', () => {
    const operations: string[] = [];
    const fs = statefulFs(operations, ['.dist-backup']);

    recoverPromotionState(fs, 'dist', '.dist-backup', policy);
    const afterFirstRecovery = fs.paths();
    recoverPromotionState(fs, 'dist', '.dist-backup', policy);

    expect(afterFirstRecovery).toEqual(['dist']);
    expect(fs.paths()).toEqual(['dist']);
    expect(operations).toEqual(['rename:.dist-backup:dist']);
  });
});

function fakeFs(
  operations: string[],
  overrides: Partial<Pick<PromotionFs, 'rename' | 'remove'>>,
): PromotionFs {
  return {
    exists: () => false,
    rename: (source, target) => {
      operations.push(`rename:${source}:${target}`);
      overrides.rename?.(source, target);
    },
    remove: (path) => {
      operations.push(`remove:${path}`);
      overrides.remove?.(path);
    },
    wait: (milliseconds) => operations.push(`wait:${milliseconds}`),
  };
}

function statefulFs(
  operations: string[],
  initialPaths: string[],
  overrides: Partial<Pick<PromotionFs, 'rename' | 'remove'>> & {
    partialRename?: (source: string, target: string) => boolean;
  } = {},
): PromotionFs & { paths(): string[] } {
  const paths = new Set(initialPaths);
  return {
    exists: (path) => paths.has(path),
    rename: (source, target) => {
      operations.push(`rename:${source}:${target}`);
      if (overrides.partialRename?.(source, target)) {
        if (!paths.has(source)) throw filesystemError('ENOENT');
        paths.delete(source);
        paths.add(target);
        throw filesystemError('EACCES');
      }
      overrides.rename?.(source, target);
      if (!paths.has(source)) throw filesystemError('ENOENT');
      paths.delete(source);
      paths.add(target);
    },
    remove: (path) => {
      operations.push(`remove:${path}`);
      overrides.remove?.(path);
      paths.delete(path);
    },
    wait: (milliseconds) => operations.push(`wait:${milliseconds}`),
    paths: () => [...paths].sort(),
  };
}

function filesystemError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`filesystem failure: ${code}`), { code });
}
