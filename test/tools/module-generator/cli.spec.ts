import { describe, expect, it } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  formatHelp,
  parseCliArgs,
  runCli,
} from '../../../tools/module-generator/cli';

describe('module generator CLI', () => {
  it('accepts one name and dry-run while reporting manual completion guidance', () => {
    const parsed = parseCliArgs(['--dry-run', 'orden-compra']);
    const result = runCli(parsed, 'C:/workspace');

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain('orden-compra');
    expect(result.output).toContain('DRY RUN');
    expect(result.output).toContain('src/app.module.ts');
    expect(result.output).toContain('data-source.ts');
    expect(result.output).toContain('migration');
  });

  it('accepts explicit registration and rejects non-standard modes', () => {
    expect(parseCliArgs(['--register', 'orden-compra'])).toMatchObject({
      register: true,
    });
    expect(() =>
      parseCliArgs(['--mode', 'notifications', 'orden-compra']),
    ).toThrow('Non-standard module modes are not supported');
  });

  it('previews and applies registration only when explicitly requested', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'module-generator-register-'));
    mkdirSync(join(cwd, 'src/config/database'), { recursive: true });
    mkdirSync(join(cwd, 'src/modules'), { recursive: true });
    mkdirSync(join(cwd, 'test/modules'), { recursive: true });
    writeFileSync(
      join(cwd, 'src/app.module.ts'),
      '@Module({ imports: [] }) export class AppModule {}',
    );
    writeFileSync(
      join(cwd, 'src/config/database/data-source.ts'),
      'export default new DataSource({ entities: [] });',
    );
    try {
      const preview = runCli(
        parseCliArgs(['--dry-run', '--register', 'producto']),
        cwd,
      );
      expect(preview.exitCode).toBe(0);
      expect(preview.output).toContain('REGISTER: DRY RUN');
      expect(existsSync(join(cwd, 'src/modules/producto'))).toBe(false);

      const applied = runCli(parseCliArgs(['--register', 'producto']), cwd);
      expect(applied.exitCode).toBe(0);
      expect(applied.output).toContain('REGISTERED');
      expect(readFileSync(join(cwd, 'src/app.module.ts'), 'utf8')).toContain(
        'ProductoModule',
      );
      expect(
        readFileSync(join(cwd, 'src/config/database/data-source.ts'), 'utf8'),
      ).toContain('ProductoEntity');
      const appBytes = readFileSync(join(cwd, 'src/app.module.ts'));
      const rerun = runCli(parseCliArgs(['--register', 'producto']), cwd);
      expect(rerun.output).toContain('ALREADY REGISTERED');
      expect(readFileSync(join(cwd, 'src/app.module.ts'))).toEqual(appBytes);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('lists every generated destination, root, and exact registration edit in preview', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'module-generator-preview-'));
    mkdirSync(join(cwd, 'src/config/database'), { recursive: true });
    mkdirSync(join(cwd, 'src/modules'), { recursive: true });
    mkdirSync(join(cwd, 'test/modules'), { recursive: true });
    writeFileSync(
      join(cwd, 'src/app.module.ts'),
      '@Module({ imports: [] }) export class AppModule {}',
    );
    writeFileSync(
      join(cwd, 'src/config/database/data-source.ts'),
      'export default new DataSource({ entities: [] });',
    );
    try {
      const appBefore = readFileSync(join(cwd, 'src/app.module.ts'));
      const dataSourceBefore = readFileSync(
        join(cwd, 'src/config/database/data-source.ts'),
      );
      const result = runCli(
        parseCliArgs(['--dry-run', '--register', 'producto']),
        cwd,
      );

      expect(result.output).toContain('Registration preview:');
      for (const path of [
        'src/modules/producto/producto.module.ts',
        'src/modules/producto/producto.controller.ts',
        'src/modules/producto/producto.service.ts',
        'src/modules/producto/producto.entity.ts',
        'src/modules/producto/dto/create-producto.dto.ts',
        'src/modules/producto/dto/update-producto.dto.ts',
        'test/modules/producto/producto.service.spec.ts',
      ]) {
        expect(result.output).toContain(`  - create ${path}`);
      }
      expect(result.output).toContain('  - edit src/app.module.ts');
      expect(result.output).toContain(
        "import { ProductoModule } from './modules/producto/producto.module';",
      );
      expect(result.output).toContain('add ProductoModule to @Module imports');
      expect(result.output).toContain(
        '  - edit src/config/database/data-source.ts',
      );
      expect(result.output).toContain(
        "import { ProductoEntity } from '../../modules/producto/producto.entity';",
      );
      expect(result.output).toContain(
        'add ProductoEntity to DataSource entities',
      );
      expect(readFileSync(join(cwd, 'src/app.module.ts'))).toEqual(appBefore);
      expect(
        readFileSync(join(cwd, 'src/config/database/data-source.ts')),
      ).toEqual(dataSourceBefore);
      expect(existsSync(join(cwd, 'src/modules/producto'))).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('rejects missing or multiple names with actionable errors', () => {
    expect(() => parseCliArgs([])).toThrow('Provide exactly one module name');
    expect(() => parseCliArgs(['uno', 'dos'])).toThrow(
      'Provide exactly one module name',
    );
    expect(formatHelp()).toContain(
      'bun run module:generate -- [options] <module-name>',
    );
  });

  it('generates on normal invocation only after safety checks pass', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'module-generator-cli-'));
    mkdirSync(join(cwd, 'src/modules'), { recursive: true });
    mkdirSync(join(cwd, 'test/modules'), { recursive: true });
    try {
      const result = runCli(parseCliArgs(['orden-compra']), cwd);
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('GENERATED');
      expect(existsSync(join(cwd, 'src/modules/orden-compra'))).toBe(true);
      expect(existsSync(join(cwd, 'test/modules/orden-compra'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
