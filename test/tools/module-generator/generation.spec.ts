import { describe, expect, it } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateModule,
  type FileSystem,
} from '../../../tools/module-generator/generator';

function tempProject(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'module-generator-test-'));
  for (const path of ['src/modules', 'test/modules']) mkdir(path, cwd);
  return cwd;
}

function mkdir(path: string, cwd: string): void {
  mkdirSync(join(cwd, path), { recursive: true });
}

function filesUnder(root: string, current = root): string[] {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = join(current, entry.name);
    return entry.isDirectory()
      ? filesUnder(root, path)
      : [path.slice(root.length + 1).replaceAll('\\', '/')];
  });
}

describe('module generator safe generation', () => {
  it('keeps dry-run immutable while reporting the complete plan', () => {
    const cwd = tempProject();
    try {
      const result = generateModule('orden-compra', { cwd, dryRun: true });
      expect(result.written).toBe(false);
      expect(result.plan.files).toHaveLength(7);
      expect(readdirSync(join(cwd, 'src/modules'))).toEqual([]);
      expect(readdirSync(join(cwd, 'test/modules'))).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('refuses any existing module destination before writing', () => {
    const cwd = tempProject();
    try {
      mkdir('src/modules/orden-compra', cwd);
      expect(() =>
        generateModule('orden-compra', { cwd, dryRun: false }),
      ).toThrow('destinations already exist');
      expect(readdirSync(join(cwd, 'test/modules'))).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('writes all source and generated contract files successfully', () => {
    const cwd = tempProject();
    try {
      const result = generateModule('orden-compra', { cwd, dryRun: false });
      expect(result.written).toBe(true);
      const expectedFiles = [
        'src/modules/orden-compra/orden-compra.module.ts',
        'src/modules/orden-compra/orden-compra.controller.ts',
        'src/modules/orden-compra/orden-compra.service.ts',
        'src/modules/orden-compra/orden-compra.entity.ts',
        'src/modules/orden-compra/dto/create-orden-compra.dto.ts',
        'src/modules/orden-compra/dto/update-orden-compra.dto.ts',
        'test/modules/orden-compra/orden-compra.service.spec.ts',
      ];
      expect(filesUnder(cwd).sort()).toEqual(expectedFiles.sort());
      expect(existsSync(join(cwd, 'src/app.module.ts'))).toBe(false);
      expect(existsSync(join(cwd, 'src/config/database/data-source.ts'))).toBe(
        false,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it(
    'materializes and executes a generated contract fixture in isolation',
    () => {
      const cwd = mkdtempSync(join(tmpdir(), 'module-generator-fixture-'));
      const fixtureSource = join(cwd, 'src');
      try {
        expect(cwd.startsWith(process.cwd())).toBe(false);
        symlinkSync(
          join(process.cwd(), 'node_modules'),
          join(cwd, 'node_modules'),
          'junction',
        );
        mkdir('src/modules', cwd);
        mkdir('test/modules', cwd);
        cpSync(
          join(process.cwd(), 'src/common'),
          join(fixtureSource, 'common'),
          {
            recursive: true,
          },
        );
        mkdir('src/config/database', cwd);
        cpSync(
          join(process.cwd(), 'src/config/database/database.constants.ts'),
          join(cwd, 'src/config/database/database.constants.ts'),
          { recursive: true },
        );
        writeFileSync(
          join(cwd, 'tsconfig.json'),
          JSON.stringify({
            compilerOptions: {
              module: 'nodenext',
              moduleResolution: 'nodenext',
              target: 'ES2023',
              strict: true,
              experimentalDecorators: true,
              emitDecoratorMetadata: true,
              skipLibCheck: true,
            },
            include: ['src/**/*.ts', 'test/**/*.ts'],
          }),
          'utf8',
        );

        generateModule('orden-compra', { cwd, dryRun: false });
        execFileSync('bun', ['x', 'tsc', '--noEmit', '-p', 'tsconfig.json'], {
          cwd,
          stdio: 'pipe',
        });
        execFileSync(
          'bun',
          ['test', 'test/modules/orden-compra/orden-compra.service.spec.ts'],
          { cwd, stdio: 'pipe' },
        );
        expect(
          existsSync(
            join(cwd, 'test/modules/orden-compra/orden-compra.service.spec.ts'),
          ),
        ).toBe(true);
      } finally {
        rmSync(cwd, { recursive: true, force: true });
      }
      expect(existsSync(cwd)).toBe(false);
      expect(
        readdirSync(process.cwd()).filter((name) =>
          name.startsWith('.module-generator-fixture-'),
        ),
      ).toEqual([]);
    },
    { timeout: 15_000 },
  );

  it('cleans staged and committed output when a rename fails', () => {
    const cwd = tempProject();
    let renameCount = 0;
    const fileSystem: FileSystem = {
      existsSync,
      mkdirSync,
      writeFileSync,
      mkdtempSync,
      rmSync,
      renameSync: (from: string, to: string) => {
        renameCount += 1;
        if (renameCount === 2) throw new Error('simulated rename failure');
        renameSync(from, to);
      },
    };
    try {
      expect(() =>
        generateModule('orden-compra', { cwd, dryRun: false }, fileSystem),
      ).toThrow('Generated files were cleaned up');
      expect(readdirSync(join(cwd, 'src/modules'))).toEqual([]);
      expect(readdirSync(join(cwd, 'test/modules'))).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rolls back the first stage when the later stage cannot be created', () => {
    const cwd = tempProject();
    let stageCount = 0;
    const fileSystem: FileSystem = {
      existsSync,
      mkdirSync,
      writeFileSync,
      renameSync,
      rmSync,
      mkdtempSync: (prefix: string) => {
        stageCount += 1;
        if (stageCount === 2) throw new Error('simulated staging failure');
        return mkdtempSync(prefix);
      },
    };
    try {
      expect(() =>
        generateModule('orden-compra', { cwd, dryRun: false }, fileSystem),
      ).toThrow('simulated staging failure');
      expect(readdirSync(join(cwd, 'src/modules'))).toEqual([]);
      expect(readdirSync(join(cwd, 'test/modules'))).toEqual([]);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('reports cleanup failures instead of hiding them', () => {
    const cwd = tempProject();
    const fileSystem: FileSystem = {
      existsSync,
      mkdirSync,
      writeFileSync,
      renameSync,
      mkdtempSync,
      rmSync: () => {
        throw new Error('simulated cleanup failure');
      },
    };
    try {
      expect(() =>
        generateModule('orden-compra', { cwd, dryRun: false }, fileSystem),
      ).toThrow('cleanup failed');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
