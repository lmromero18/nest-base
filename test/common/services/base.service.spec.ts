import { describe, expect, it } from 'bun:test';
import type { Repository } from 'typeorm';
import { RequestContext } from '../../../src/common/context/request-context';
import { ApplicationException } from '../../../src/common/application/application-error';
import { BaseService } from '../../../src/common/services/base.service';

interface Demo {
  id: number;
  nombre: string;
  secreto: string;
  idCreado?: number;
  idActualizado?: number;
  tsCreatedAt?: Date;
  tsDeletedAt?: Date | null;
}

interface FakeColumn {
  propertyName: string;
  type: string;
  isSelect: boolean;
  isGenerated: boolean;
  isCreateDate: boolean;
  isUpdateDate: boolean;
  isDeleteDate: boolean;
  isVersion: boolean;
}

const makeColumn = (
  propertyName: string,
  opts: Partial<Omit<FakeColumn, 'propertyName'>> = {},
): FakeColumn => ({
  propertyName,
  type: opts.type ?? 'varchar',
  isSelect: opts.isSelect ?? true,
  isGenerated: opts.isGenerated ?? false,
  isCreateDate: opts.isCreateDate ?? false,
  isUpdateDate: opts.isUpdateDate ?? false,
  isDeleteDate: opts.isDeleteDate ?? false,
  isVersion: false,
});

interface FakeSetup {
  withDeleteDate?: boolean;
  preloadResult?: Record<string, unknown> | undefined;
  affected?: number;
}

function makeService(config: FakeSetup = {}) {
  const columns: FakeColumn[] = [
    makeColumn('id', { type: 'int', isGenerated: true }),
    makeColumn('nombre'),
    makeColumn('secreto', { isSelect: false }),
    makeColumn('idCreado', { type: 'int' }),
    makeColumn('idActualizado', { type: 'int' }),
    makeColumn('tsCreatedAt', { isCreateDate: true }),
  ];
  if (config.withDeleteDate) {
    columns.push(makeColumn('tsDeletedAt', { isDeleteDate: true }));
  }

  const metadata = {
    name: 'Demo',
    columns,
    relations: [] as unknown[],
    primaryColumns: [columns[0]],
    deleteDateColumn: config.withDeleteDate
      ? columns.find((c) => c.isDeleteDate)
      : undefined,
  };

  const calls: Record<string, unknown[][]> = {};
  const push = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const affectedResult = { affected: config.affected ?? 1 };

  const repo = {
    metadata,
    target: class DemoEntity {},
    create: (data: unknown) => {
      push('create', [data]);
      return data;
    },
    save: (entity: unknown) => {
      push('save', [entity]);
      return Promise.resolve(entity);
    },
    preload: (data: unknown) => {
      push('preload', [data]);
      return Promise.resolve(config.preloadResult);
    },
    findOne: (opts: unknown) => {
      push('findOne', [opts]);
      return Promise.resolve(null);
    },
    find: (opts: unknown) => {
      push('find', [opts]);
      return Promise.resolve([]);
    },
    findAndCount: (opts: unknown) => {
      push('findAndCount', [opts]);
      return Promise.resolve([[], 0]);
    },
    delete: (where: unknown) => {
      push('delete', [where]);
      return Promise.resolve(affectedResult);
    },
    softDelete: (where: unknown) => {
      push('softDelete', [where]);
      return Promise.resolve(affectedResult);
    },
    restore: (where: unknown) => {
      push('restore', [where]);
      return Promise.resolve(affectedResult);
    },
  };

  class DemoService extends BaseService<Demo> {
    constructor() {
      super(repo as unknown as Repository<Demo>);
    }
  }

  return { service: new DemoService(), calls };
}

describe('BaseService — create', () => {
  it('descarta columnas protegidas del payload (PK generada, timestamps)', async () => {
    const { service, calls } = makeService();
    await service.create({
      id: 99,
      nombre: 'x',
      tsCreatedAt: new Date('2020-01-01'),
    });

    const payload = calls.create[0][0] as Record<string, unknown>;
    expect(payload.id).toBeUndefined();
    expect(payload.tsCreatedAt).toBeUndefined();
    expect(payload.nombre).toBe('x');
  });

  it('estampa idCreado desde el RequestContext', async () => {
    const { service, calls } = makeService();
    await RequestContext.run({ user: { sub: '7' } }, () =>
      service.create({ nombre: 'x' }),
    );

    const payload = calls.create[0][0] as Record<string, unknown>;
    expect(payload.idCreado).toBe(7);
  });

  it('estampa idCreado desde el principal neutral', async () => {
    const { service, calls } = makeService();
    await RequestContext.run({ principal: { subject: '11' } }, () =>
      service.create({ nombre: 'x' }),
    );

    const payload = calls.create[0][0] as Record<string, unknown>;
    expect(payload.idCreado).toBe(11);
  });

  it('usa el repositorio del manager transaccional para crear', async () => {
    const { service, calls } = makeService();
    const manager = {
      getRepository: () => service['repository'],
    };

    await service.create(
      { nombre: 'transaccional' },
      { manager: manager as never },
    );

    expect(calls.create[0][0]).toEqual({ nombre: 'transaccional' });
    expect(calls.save).toHaveLength(1);
  });

  it('sin contexto de request no estampa auditoría', async () => {
    const { service, calls } = makeService();
    await service.create({ nombre: 'x' });

    const payload = calls.create[0][0] as Record<string, unknown>;
    expect(payload.idCreado).toBeUndefined();
  });
});

describe('BaseService — updateByPk', () => {
  it('retorna null si la entidad no existe', async () => {
    const { service } = makeService({ preloadResult: undefined });
    const result = await service.updateByPk('5', { nombre: 'nuevo' });
    expect(result).toBeNull();
  });

  it('usa preload+save, conserva la PK y estampa idActualizado', async () => {
    const { service, calls } = makeService({
      preloadResult: { id: 5, nombre: 'nuevo' },
    });

    await RequestContext.run({ user: { sub: 9 } }, () =>
      service.updateByPk('5', { id: 123, nombre: 'nuevo' }),
    );

    const preloadArg = calls.preload[0][0] as Record<string, unknown>;
    // La PK viene del parámetro pk (coercida a número), nunca del body
    expect(preloadArg.id).toBe(5);
    expect(preloadArg.nombre).toBe('nuevo');
    expect(preloadArg.idActualizado).toBe(9);
    expect(calls.save).toHaveLength(1);
  });
});

describe('BaseService — borrado lógico', () => {
  it('lanza 405 si la entidad no tiene @DeleteDateColumn', async () => {
    const { service } = makeService({ withDeleteDate: false });
    let error: unknown;
    try {
      await service.softDeleteByPk(5);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ApplicationException);
  });

  it('softDelete por PK con coerción de tipo', async () => {
    const { service, calls } = makeService({ withDeleteDate: true });
    const ok = await service.softDeleteByPk('5');
    expect(ok).toBe(true);
    expect(calls.softDelete[0][0]).toEqual({ id: 5 });
  });

  it('retorna false cuando no afecta filas', async () => {
    const { service } = makeService({ withDeleteDate: true, affected: 0 });
    const ok = await service.softDeleteByPk(5);
    expect(ok).toBe(false);
  });

  it('restore exige soporte de borrado lógico', async () => {
    const { service } = makeService({ withDeleteDate: false });
    let error: unknown;
    try {
      await service.restoreByPk(5);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ApplicationException);
  });
});

describe('BaseService — find', () => {
  it('aplica el tope de perPage en la consulta', async () => {
    const { service, calls } = makeService();
    await service.find({ perPage: '5000' });

    const opts = calls.findAndCount[0][0] as Record<string, unknown>;
    expect(opts.take).toBe(500);
    expect(opts.skip).toBe(0);
  });

  it('excluye del where las columnas ocultas (select:false)', async () => {
    const { service, calls } = makeService();
    await service.find({ secreto: 'x', nombre: 'ana' });

    const opts = calls.findAndCount[0][0] as Record<string, unknown>;
    expect(opts.where).toEqual({ nombre: 'ana' });
  });

  it('propaga un error neutral de validación para un filtro malformado', async () => {
    const { service } = makeService();

    let error: unknown;
    try {
      await service.find({ nombre_between: 'ana' });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApplicationException);
  });

  it('calcula skip según la página', async () => {
    const { service, calls } = makeService();
    await service.find({ page: '3', perPage: '10' });

    const opts = calls.findAndCount[0][0] as Record<string, unknown>;
    expect(opts.skip).toBe(20);
    expect(opts.take).toBe(10);
  });
});

describe('BaseService — findByPk', () => {
  it('coerce string→number en PK numérica', async () => {
    const { service, calls } = makeService();
    await service.findByPk('5');

    const opts = calls.findOne[0][0] as Record<string, unknown>;
    expect(opts.where).toEqual({ id: 5 });
  });

  it('acepta objeto con la PK', async () => {
    const { service, calls } = makeService();
    await service.findByPk({ id: '8' });

    const opts = calls.findOne[0][0] as Record<string, unknown>;
    expect(opts.where).toEqual({ id: 8 });
  });
});
