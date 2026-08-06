import { describe, expect, it } from 'bun:test';

import {
  createGenerationPlan,
  deriveNameModel,
  getNameValidationError,
  STANDARD_FILE_PATHS,
} from '../../../tools/module-generator/generator';

describe('module generator naming foundation', () => {
  it('derives stable identifiers from a supported Spanish kebab-case name', () => {
    expect(deriveNameModel('catalogo-tipo-documento')).toEqual({
      moduleName: 'catalogo-tipo-documento',
      className: 'CatalogoTipoDocumento',
      entityName: 'CatalogoTipoDocumentoEntity',
      propertyName: 'catalogoTipoDocumento',
      tableName: 'tb_catalogo_tipo_documento',
      route: 'catalogo-tipo-documento',
    });
  });

  it('derives a different valid name without leaking identifiers between plans', () => {
    expect(deriveNameModel('orden-compra')).toMatchObject({
      moduleName: 'orden-compra',
      className: 'OrdenCompra',
      entityName: 'OrdenCompraEntity',
      propertyName: 'ordenCompra',
      tableName: 'tb_orden_compra',
      route: 'orden-compra',
    });
    expect(createGenerationPlan('orden-compra').files[0]?.relativePath).toBe(
      'src/modules/orden-compra/orden-compra.module.ts',
    );
  });

  it('rejects malformed, reserved, and traversal-shaped names with actionable errors', () => {
    for (const name of [
      'Catalogo',
      'catalogo--tipo',
      '../secret',
      'foo_bar',
      'auth',
      'health-check',
      'websockets',
      'web-sockets',
    ]) {
      expect(getNameValidationError(name)).toContain('module name');
      expect(() => deriveNameModel(name)).toThrow();
    }
  });

  it('keeps the standard file plan ordered and deterministic', () => {
    const first = createGenerationPlan('producto');
    const second = createGenerationPlan('producto');

    expect(first).toEqual(second);
    expect(first.files.map((file) => file.relativePath)).toEqual(
      STANDARD_FILE_PATHS.map((path) =>
        path.replaceAll('<module>', 'producto'),
      ),
    );
    expect(first.files).toHaveLength(7);
  });

  it('keeps the generated test outside the source module tree', () => {
    const plan = createGenerationPlan('producto');

    expect(plan.files.at(-1)?.relativePath).toBe(
      'test/modules/producto/producto.service.spec.ts',
    );
    expect(
      plan.files
        .slice(0, 6)
        .every((file) => file.relativePath.startsWith('src/modules/')),
    ).toBe(true);
  });
});
