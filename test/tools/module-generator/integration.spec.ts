import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';

import { generateModule } from '../../../tools/module-generator/generator';
import { runCli, parseCliArgs } from '../../../tools/module-generator/cli';
import { encodeRegistrationBackup } from '../../../tools/module-generator/publisher';

const fixtureRoot = join(process.cwd(), 'test/tools/module-generator/fixtures');
const generatedPaths = [
  'src/modules/producto/producto.module.ts',
  'src/modules/producto/producto.controller.ts',
  'src/modules/producto/producto.service.ts',
  'src/modules/producto/producto.entity.ts',
  'src/modules/producto/dto/create-producto.dto.ts',
  'src/modules/producto/dto/update-producto.dto.ts',
  'test/modules/producto/producto.service.spec.ts',
] as const;
const rootPaths = [
  'src/app.module.ts',
  'src/config/database/data-source.ts',
] as const;

function createProject(
  fixture: 'supported' | 'unsupported' = 'supported',
  eol: '\n' | '\r\n' = '\n',
  bom = false,
): string {
  const project = mkdtempSync(join(tmpdir(), 'module-generator-integration-'));
  mkdirSync(join(project, 'src/config/database'), { recursive: true });
  mkdirSync(join(project, 'src/modules'), { recursive: true });
  mkdirSync(join(project, 'test/modules'), { recursive: true });
  for (const [name, target] of [
    ['app.module.ts', 'src/app.module.ts'],
    ['data-source.ts', 'src/config/database/data-source.ts'],
  ] as const) {
    const source = readFileSync(join(fixtureRoot, fixture, name), 'utf8')
      .replaceAll('\r\n', '\n')
      .replaceAll('\n', eol);
    writeFileSync(join(project, target), `${bom ? '\ufeff' : ''}${source}`);
  }
  return project;
}

function snapshot(project: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.set(path.slice(project.length + 1), readFileSync(path));
    }
  };
  visit(project);
  return files;
}

function assertTypeScriptCompiles(project: string): void {
  for (const path of snapshot(project).keys()) {
    if (!path.endsWith('.ts')) continue;
    const source = readFileSync(join(project, path), 'utf8');
    const result = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2023 },
      fileName: path,
      reportDiagnostics: true,
    });
    expect(result.diagnostics ?? []).toEqual([]);
  }
}

describe('module generator temporary-project integration', () => {
  it('previews without writes, publishes nine outputs, compiles, and reruns idempotently', () => {
    const project = createProject();
    try {
      const before = snapshot(project);
      const preview = runCli(
        parseCliArgs(['--dry-run', '--register', 'producto']),
        project,
      );
      expect(preview.exitCode).toBe(0);
      expect(preview.output).toContain('REGISTER: DRY RUN');
      expect(snapshot(project)).toEqual(before);

      const applied = runCli(parseCliArgs(['--register', 'producto']), project);
      expect(applied.exitCode).toBe(0);
      expect(applied.output).toContain('REGISTERED');
      expect(
        [...generatedPaths, ...rootPaths].every((path) =>
          existsSync(join(project, path)),
        ),
      ).toBe(true);
      expect(
        readFileSync(join(project, 'src/app.module.ts'), 'utf8'),
      ).toContain('ProductoModule');
      expect(
        readFileSync(
          join(project, 'src/config/database/data-source.ts'),
          'utf8',
        ),
      ).toContain('ProductoEntity');
      assertTypeScriptCompiles(project);

      const afterApply = snapshot(project);
      const rerun = runCli(parseCliArgs(['--register', 'producto']), project);
      expect(rerun.output).toContain('ALREADY REGISTERED');
      expect(snapshot(project)).toEqual(afterApply);
      expect(
        [...snapshot(project).keys()].some((path) =>
          /registration-|\.staging-/.test(path),
        ),
      ).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('preserves CRLF, BOM, and unrelated edits through registration', () => {
    const project = createProject('supported', '\r\n', true);
    try {
      const appPath = join(project, 'src/app.module.ts');
      const appBefore = readFileSync(appPath, 'utf8');
      writeFileSync(appPath, `${appBefore}// unrelated edit\r\n`);
      const result = generateModule('orden-compra', {
        cwd: project,
        dryRun: false,
        register: true,
      });
      expect(result.registered).toBe(true);
      const app = readFileSync(appPath, 'utf8');
      expect(app.startsWith('\ufeff')).toBe(true);
      expect(app).toContain('// unrelated edit\r\n');
      expect(app).toContain(
        "import { OrdenCompraModule } from './modules/orden-compra/orden-compra.module';\r\n",
      );
      expect(app.includes('\n') && !app.includes('\r\n')).toBe(false);
      expect(snapshot(project).size).toBe(9);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('refuses a root replacement while another registration holds its lock', () => {
    const project = createProject();
    try {
      const appPath = join(project, 'src/app.module.ts');
      const original = readFileSync(appPath);
      writeFileSync(
        `${appPath}.registration-lock`,
        JSON.stringify({ pid: process.pid, token: 'active-owner' }),
      );

      expect(() =>
        generateModule('producto', {
          cwd: project,
          dryRun: false,
          register: true,
        }),
      ).toThrow();

      expect(readFileSync(appPath)).toEqual(original);
      expect(existsSync(`${appPath}.registration-lock`)).toBe(true);
      expect(
        [...snapshot(project).keys()].some((path) => /\.staging-/.test(path)),
      ).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('recovers a lock owned by a process that is no longer alive', () => {
    const project = createProject();
    try {
      const appPath = join(project, 'src/app.module.ts');
      writeFileSync(
        `${appPath}.registration-lock`,
        JSON.stringify({ pid: 2147483647, token: 'stale-owner' }),
      );

      const result = generateModule('producto', {
        cwd: project,
        dryRun: false,
        register: true,
      });

      expect(result.registered).toBe(true);
      expect(existsSync(appPath)).toBe(true);
      expect(existsSync(`${appPath}.registration-lock`)).toBe(false);
      expect(
        [...snapshot(project).keys()].some((path) => path.endsWith('.stale')),
      ).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('recovers a root left damaged while a registration backup exists', () => {
    const project = createProject();
    try {
      const appPath = join(project, 'src/app.module.ts');
      const original = readFileSync(appPath);
      writeFileSync(
        `${appPath}.registration-crash.bak`,
        encodeRegistrationBackup(original, {
          sha256: (bytes) => createHash('sha256').update(bytes).digest('hex'),
        }),
      );
      writeFileSync(appPath, 'truncated');

      const result = generateModule('producto', {
        cwd: project,
        dryRun: false,
        register: true,
      });

      expect(result.registered).toBe(true);
      expect(readFileSync(appPath, 'utf8')).toContain('ProductoModule');
      expect(existsSync(`${appPath}.registration-crash.bak`)).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('recovers a valid legacy raw backup while rejecting partial raw backups', () => {
    const project = createProject();
    try {
      const appPath = join(project, 'src/app.module.ts');
      const original = readFileSync(appPath);
      writeFileSync(`${appPath}.registration-legacy.bak`, original);
      writeFileSync(appPath, 'truncated');

      const result = generateModule('producto', {
        cwd: project,
        dryRun: false,
        register: true,
      });

      expect(result.registered).toBe(true);
      expect(readFileSync(appPath, 'utf8')).toContain('ProductoModule');
      expect(existsSync(`${appPath}.registration-legacy.bak`)).toBe(false);

      writeFileSync(
        `${appPath}.registration-partial-legacy.bak`,
        original.subarray(0, 8),
      );
      const before = readFileSync(appPath);
      generateModule('orden-compra', {
        cwd: project,
        dryRun: true,
        register: true,
      });

      expect(readFileSync(appPath)).toEqual(before);
      expect(existsSync(`${appPath}.registration-partial-legacy.bak`)).toBe(
        false,
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('does not recover a partial backup over an existing registration root', () => {
    const project = createProject();
    try {
      const appPath = join(project, 'src/app.module.ts');
      const current = readFileSync(appPath);
      writeFileSync(
        `${appPath}.registration-interrupted.bak`,
        current.subarray(0, 8),
      );

      generateModule('producto', {
        cwd: project,
        dryRun: true,
        register: true,
      });

      expect(readFileSync(appPath)).toEqual(current);
      expect(existsSync(`${appPath}.registration-interrupted.bak`)).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('refuses unsupported roots with zero writes and no temporary artifacts', () => {
    const project = createProject('unsupported');
    try {
      const before = snapshot(project);
      const result = runCli(parseCliArgs(['--register', 'producto']), project);
      expect(result.exitCode).toBe(1);
      expect(result.output).toMatch(/unsupported|entities|imports/i);
      expect(snapshot(project)).toEqual(before);
      expect(
        [...before.keys()].some((path) =>
          /registration-|\.staging-/.test(path),
        ),
      ).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
