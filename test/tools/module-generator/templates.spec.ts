import { describe, expect, it } from 'bun:test';
import { createGenerationPlan } from '../../../tools/module-generator/generator';

describe('module generator templates', () => {
  it('renders the complete standard CRUD contract deterministically', () => {
    const first = createGenerationPlan('orden-compra');
    const second = createGenerationPlan('orden-compra');

    expect(first).toEqual(second);
    expect(first.files.map(({ relativePath }) => relativePath)).toEqual([
      'src/modules/orden-compra/orden-compra.module.ts',
      'src/modules/orden-compra/orden-compra.controller.ts',
      'src/modules/orden-compra/orden-compra.service.ts',
      'src/modules/orden-compra/orden-compra.entity.ts',
      'src/modules/orden-compra/dto/create-orden-compra.dto.ts',
      'src/modules/orden-compra/dto/update-orden-compra.dto.ts',
      'test/modules/orden-compra/orden-compra.service.spec.ts',
    ]);

    const source = first.files
      .filter(({ relativePath }) => relativePath.startsWith('src/'))
      .map(({ content }) => content)
      .join('\n');

    expect(source).toContain(
      "import { CrudControllerFactory } from '../../common/controller/crud-controller.factory';",
    );
    expect(source).toContain(
      "routes: ['find', 'findOne', 'create', 'update', 'softDelete']",
    );
    expect(source).toContain(
      'protected override readonly auditColumns = null;',
    );
    expect(source).toContain("schema: getEnv('DB_BASE_SCHEMA', 'public')");
    expect(source).toContain(
      '@InjectRepository(OrdenCompraEntity, DATABASE_CONNECTIONS.BASE)',
    );
    expect(source).toContain(
      "import { IsNotEmpty, IsString, MaxLength } from 'class-validator';",
    );
    expect(source).not.toContain('import type { CreateOrdenCompraDto }');

    const generatedContract = first.files.at(-1)?.content ?? '';
    expect(generatedContract).toContain(
      "import { BaseService } from '../../../src/common/services/base.service';",
    );
    expect(generatedContract).toContain(
      "import { OrdenCompraService } from '../../../src/modules/orden-compra/orden-compra.service';",
    );
    expect(generatedContract).toContain(
      'expect(OrdenCompraService.prototype).toBeInstanceOf(BaseService);',
    );
  });

  it('renders a different valid module without leaking identifiers', () => {
    const plan = createGenerationPlan('tipo-documento');
    const contents = plan.files.map(({ content }) => content).join('\n');

    expect(contents).toContain('TipoDocumentoEntity');
    expect(contents).toContain('tb_tipo_documento');
    expect(contents).not.toContain('OrdenCompra');
    expect(
      plan.files.every(({ content }) => !content.includes('<module>')),
    ).toBe(true);
  });
});
