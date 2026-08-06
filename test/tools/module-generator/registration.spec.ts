import { describe, expect, it } from 'bun:test';

import {
  createGenerationPlan,
  deriveNameModel,
} from '../../../tools/module-generator/generator';
import {
  classifyRegistrationState,
  createRegistrationPlan,
  parseSupportedRoot,
  preflightRegistration,
  createRootCandidate,
  type RegistrationSnapshot,
} from '../../../tools/module-generator/registration';

const emptySnapshot = (
  plan: ReturnType<typeof createRegistrationPlan>,
): RegistrationSnapshot => ({
  generated: plan.generatedDestinations.map((path) => ({
    path,
    state: 'missing',
  })),
  roots: plan.rootTargets.map((target) => ({
    target,
    importState: 'missing',
    memberState: 'missing',
  })),
});

describe('module registration foundation', () => {
  it('reuses NameModel and derives exact symbols and nine targets', () => {
    const plan = createRegistrationPlan(
      deriveNameModel('catalogo-tipo-documento'),
    );

    expect(plan.moduleSymbol).toBe('CatalogoTipoDocumentoModule');
    expect(plan.entitySymbol).toBe('CatalogoTipoDocumentoEntity');
    expect(plan.generatedDestinations).toEqual([
      'src/modules/catalogo-tipo-documento/catalogo-tipo-documento.module.ts',
      'src/modules/catalogo-tipo-documento/catalogo-tipo-documento.controller.ts',
      'src/modules/catalogo-tipo-documento/catalogo-tipo-documento.service.ts',
      'src/modules/catalogo-tipo-documento/catalogo-tipo-documento.entity.ts',
      'src/modules/catalogo-tipo-documento/dto/create-catalogo-tipo-documento.dto.ts',
      'src/modules/catalogo-tipo-documento/dto/update-catalogo-tipo-documento.dto.ts',
      'test/modules/catalogo-tipo-documento/catalogo-tipo-documento.service.spec.ts',
    ]);
    expect(plan.rootTargets.map(({ path }) => path)).toEqual([
      'src/app.module.ts',
      'src/config/database/data-source.ts',
    ]);
    expect(plan.previews).toHaveLength(9);
  });

  it('orders registration imports by path and symbols deterministically', () => {
    const plan = createRegistrationPlan('orden-compra');

    expect(plan.imports).toEqual([
      {
        path: '../../modules/orden-compra/orden-compra.entity',
        symbol: 'OrdenCompraEntity',
        target: 'src/config/database/data-source.ts',
      },
      {
        path: './modules/orden-compra/orden-compra.module',
        symbol: 'OrdenCompraModule',
        target: 'src/app.module.ts',
      },
    ]);
    expect(plan.previews.map(({ path }) => path)).toEqual([
      ...plan.generatedDestinations,
      'src/app.module.ts',
      'src/config/database/data-source.ts',
    ]);
  });

  it('distinguishes ready, duplicate, partial, mismatched, and idempotent states', () => {
    const plan = createRegistrationPlan('producto');
    const ready = emptySnapshot(plan);
    expect(() =>
      classifyRegistrationState({ generated: [], roots: [] }),
    ).toThrow(/empty or incomplete snapshot/i);
    expect(classifyRegistrationState(ready)).toEqual({ status: 'ready' });

    const duplicate = structuredClone(ready);
    duplicate.roots[0].importState = 'duplicate';
    expect(classifyRegistrationState(duplicate)).toEqual({
      status: 'collision',
      reason: 'duplicate',
    });

    const partial = structuredClone(ready);
    partial.generated[0].state = 'exact';
    expect(classifyRegistrationState(partial)).toEqual({
      status: 'collision',
      reason: 'partial',
    });

    const mismatched = structuredClone(ready);
    mismatched.roots[1].memberState = 'mismatched';
    expect(classifyRegistrationState(mismatched)).toEqual({
      status: 'collision',
      reason: 'mismatched',
    });

    const registered = structuredClone(ready);
    registered.generated.forEach((file) => (file.state = 'exact'));
    registered.roots.forEach((root) => {
      root.importState = 'exact';
      root.memberState = 'exact';
    });
    expect(classifyRegistrationState(registered)).toEqual({
      status: 'already-registered',
    });
  });

  it('does not change the default generation plan', () => {
    const archivedPhase5APaths = [
      'src/modules/producto/producto.module.ts',
      'src/modules/producto/producto.controller.ts',
      'src/modules/producto/producto.service.ts',
      'src/modules/producto/producto.entity.ts',
      'src/modules/producto/dto/create-producto.dto.ts',
      'src/modules/producto/dto/update-producto.dto.ts',
      'test/modules/producto/producto.service.spec.ts',
    ];

    expect(
      createGenerationPlan('producto').files.map(
        ({ relativePath }) => relativePath,
      ),
    ).toEqual(archivedPhase5APaths);
  });

  it('scans supported roots and exposes deterministic token-aware anchors', () => {
    const app = parseSupportedRoot(
      'src/app.module.ts',
      '\ufeffimport { Module } from "@nestjs/common";\r\nimport { Existing } from "./existing";\r\n\r\n@Module({ imports: [Existing] })\r\nexport class AppModule {}\r\n',
    );
    const data = parseSupportedRoot(
      'src/config/database/data-source.ts',
      "import { DataSource } from 'typeorm';\nimport Existing from './existing';\nexport default new DataSource({ entities: [Existing] });\n",
    );

    expect(app.eol).toBe('\r\n');
    expect(app.bom).toBe(true);
    expect(app.firstNonImportStart).toBeGreaterThan(0);
    expect(app.targetArrayClose).toBeGreaterThan(app.firstNonImportStart);
    expect(data.targetArrayClose).toBeGreaterThan(0);
    expect(app.tokens.length).toBeGreaterThan(4);
  });

  it('rejects unsupported grammar, mixed endings, holes, spreads, duplicates, and incomplete roots', () => {
    const refusals = [
      [
        'src/app.module.ts',
        '@Module({ imports: [...items] }) export class AppModule {}',
      ],
      [
        'src/app.module.ts',
        '@Module({ imports: [Existing,, Other] }) export class AppModule {}',
      ],
      [
        'src/app.module.ts',
        '@Module({ imports: [Existing] }) export class AppModule {} export class AppModule {}',
      ],
      [
        'src/app.module.ts',
        '@Module({ providers: [] }) export class AppModule {}',
      ],
      [
        'src/config/database/data-source.ts',
        'export default new DataSource({ entities: items });',
      ],
      [
        'src/app.module.ts',
        'import { Module } from "x";\n\r\n@Module({ imports: [] }) export class AppModule {}',
      ],
      [
        'src/config/database/data-source.ts',
        'import { DataSource } from "typeorm"; export default new DataSource({ entities: []',
      ],
    ] as const;

    for (const [path, source] of refusals) {
      expect(() => parseSupportedRoot(path, source)).toThrow(/registration/i);
    }
  });

  it('preflight refuses before any write or mkdir and validates candidate TypeScript', () => {
    const plan = createRegistrationPlan('producto');
    const calls: string[] = [];
    const fileSystem = {
      exists: (path: string) => {
        calls.push(`exists:${path}`);
        return (
          path === 'src/app.module.ts' ||
          path === 'src/config/database/data-source.ts'
        );
      },
      readFile: (path: string) => {
        calls.push(`read:${path}`);
        return new TextEncoder().encode(
          path.includes('app.module')
            ? '@Module({ providers: [] }) export class AppModule {}'
            : 'export default new DataSource({ entities: [] });',
        );
      },
      mkdir: () => calls.push('mkdir'),
      write: () => calls.push('write'),
    };

    expect(() => preflightRegistration(plan, fileSystem)).toThrow(
      /app.module/i,
    );
    expect(calls.some((call) => call === 'mkdir' || call === 'write')).toBe(
      false,
    );
  });

  it('inserts at both anchors while preserving unrelated bytes and line endings', () => {
    const appText =
      '// keep this header\r\nimport { Module } from "@nestjs/common";\r\n@Module({ imports: [Existing] })\r\nexport class AppModule {}\r\n';
    const root = parseSupportedRoot('src/app.module.ts', appText);
    const candidate = createRootCandidate(
      root,
      createRegistrationPlan('producto').rootTargets[0],
    );

    expect(candidate).toContain('// keep this header\r\n');
    expect(candidate).toContain(
      "import { ProductoModule } from './modules/producto/producto.module';\r\n",
    );
    expect(candidate).toContain('imports: [Existing, ProductoModule]');
    expect(candidate.includes('\n') && !candidate.includes('\r\n')).toBe(false);
    expect(parseSupportedRoot('src/app.module.ts', candidate).members).toEqual([
      'Existing',
      'ProductoModule',
    ]);
  });

  it('rejects every refusal without invoking write or mkdir', () => {
    const plan = createRegistrationPlan('producto');
    const refusalSources = [
      '@Module({ imports: [...items] }) export class AppModule {}',
      '@Module({ imports: [Existing,, Other] }) export class AppModule {}',
      'import { DataSource } from "typeorm";\n\r\nexport default new DataSource({ entities: [] });',
    ];

    for (const source of refusalSources) {
      const calls: string[] = [];
      const fileSystem = {
        exists: () => true,
        readFile: (path: string) =>
          new TextEncoder().encode(
            path.includes('app.module')
              ? source
              : 'export default new DataSource({ entities: [] });',
          ),
        mkdir: () => calls.push('mkdir'),
        write: () => calls.push('write'),
      };
      expect(() => preflightRegistration(plan, fileSystem)).toThrow(
        /registration/i,
      );
      expect(calls).toEqual([]);
    }
  });

  it('rejects nested dynamic imports with a file-specific diagnostic before writes', () => {
    const plan = createRegistrationPlan('producto');
    const calls: string[] = [];
    const fileSystem = {
      exists: (path: string) => {
        calls.push(`exists:${path}`);
        return (
          path === 'src/app.module.ts' ||
          path === 'src/config/database/data-source.ts'
        );
      },
      readFile: (path: string) => {
        calls.push(`read:${path}`);
        return new TextEncoder().encode(
          path.includes('app.module')
            ? '@Module({ imports: [] }) export class AppModule {}'
            : "const loaded = import('x'); export default new DataSource({ entities: [] });",
        );
      },
      mkdir: () => calls.push('mkdir'),
      write: () => calls.push('write'),
    };

    expect(() => preflightRegistration(plan, fileSystem)).toThrow(
      /Registration refused for src\/config\/database\/data-source\.ts .*dynamic imports/i,
    );
    expect(calls.some((call) => call === 'mkdir' || call === 'write')).toBe(
      false,
    );
  });

  it('rejects dynamic imports nested in supported app root expressions', () => {
    expect(() =>
      parseSupportedRoot(
        'src/app.module.ts',
        "const loaded = import('x'); @Module({ imports: [] }) export class AppModule {}",
      ),
    ).toThrow(
      /Registration refused for src\/app\.module\.ts .*dynamic imports/i,
    );
  });

  it('rejects multiple Module decorators instead of selecting the first', () => {
    expect(() =>
      parseSupportedRoot(
        'src/app.module.ts',
        '@Module({ imports: [] }) @Module({ imports: [] }) export class AppModule {}',
      ),
    ).toThrow(
      /Registration refused for src\/app\.module\.ts .*@Module.*exactly one/i,
    );
  });

  it('rejects type-only imports from runtime registration roots', () => {
    expect(() =>
      parseSupportedRoot(
        'src/app.module.ts',
        "import type { Existing } from './existing'; @Module({ imports: [Existing] }) export class AppModule {}",
      ),
    ).toThrow(
      /Registration refused for src\/app\.module\.ts .*imports.*type-only/i,
    );
  });

  it('rejects TypeScript import type nodes anywhere in supported roots', () => {
    expect(() =>
      parseSupportedRoot(
        'src/config/database/data-source.ts',
        "type Loaded = import('./existing').Existing; export default new DataSource({ entities: [] });",
      ),
    ).toThrow(
      /Registration refused for src\/config\/database\/data-source\.ts .*dynamic imports/i,
    );
  });

  it('refuses partial roots before writes instead of reporting already registered', () => {
    const plan = createRegistrationPlan('producto');
    const calls: string[] = [];
    const fileSystem = {
      exists: (path: string) => {
        calls.push(`exists:${path}`);
        return (
          path === 'src/app.module.ts' ||
          path === 'src/config/database/data-source.ts'
        );
      },
      readFile: (path: string) => {
        calls.push(`read:${path}`);
        return new TextEncoder().encode(
          path.includes('app.module')
            ? "import { ProductoModule } from './modules/producto/producto.module'; @Module({ imports: [ProductoModule] }) export class AppModule {}"
            : "import { ProductoEntity } from '../../modules/producto/producto.entity'; export default new DataSource({ entities: [ProductoEntity] });",
        );
      },
      mkdir: () => calls.push('mkdir'),
      write: () => calls.push('write'),
    };

    expect(() => preflightRegistration(plan, fileSystem)).toThrow(
      /partial|incomplete|already registered/i,
    );
    expect(calls.some((call) => call === 'mkdir' || call === 'write')).toBe(
      false,
    );
  });

  it('captures root bytes and candidates from one read snapshot', () => {
    const plan = createRegistrationPlan('producto');
    const app = '@Module({ imports: [] }) export class AppModule {}';
    const data = 'export default new DataSource({ entities: [] });';
    const reads = new Map<string, number>();
    const fileSystem = {
      exists: (path: string) =>
        plan.rootTargets.some((root) => root.path === path),
      readFile: (path: string) => {
        const count = (reads.get(path) ?? 0) + 1;
        reads.set(path, count);
        const source = path.includes('app.module') ? app : data;
        return new TextEncoder().encode(
          count === 1 ? source : `${source}\n// raced`,
        );
      },
      mkdir: () => undefined,
      write: () => undefined,
    };

    const preflight = preflightRegistration(plan, fileSystem);
    expect(reads.get('src/app.module.ts')).toBe(1);
    expect(reads.get('src/config/database/data-source.ts')).toBe(1);
    expect(preflight.rootSnapshots).toHaveLength(2);
    expect(new TextDecoder().decode(preflight.rootSnapshots[0].bytes)).toBe(
      app,
    );
    expect(preflight.candidates[0]).toContain('ProductoModule');
  });

  it('rejects an aliased target import instead of treating matching text as registered', () => {
    const plan = createRegistrationPlan('producto');
    const fileSystem = {
      exists: (path: string) =>
        plan.rootTargets.some(({ path: root }) => root === path),
      readFile: (path: string) =>
        new TextEncoder().encode(
          path.includes('app.module')
            ? "import { ProductoModule as ExistingModule } from './modules/producto/producto.module'; @Module({ imports: [ProductoModule] }) export class AppModule {}"
            : 'export default new DataSource({ entities: [] });',
        ),
      mkdir: () => undefined,
      write: () => undefined,
    };

    expect(() => preflightRegistration(plan, fileSystem)).toThrow(
      /identity|symbol|mismatch/i,
    );
  });
});
