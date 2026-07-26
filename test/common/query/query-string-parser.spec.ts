import { describe, expect, it } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import {
  QuerySchema,
  QueryStringParser,
} from '../../../src/common/query/query-string-parser';

const FILTERABLE = [
  'id',
  'nombre',
  'estado',
  'monto',
  'tag_like', // columna cuyo nombre real termina en sufijo de operador
  'persona.nombre',
  'persona.ciudad.nombre',
];

const schema: QuerySchema = {
  isFilterable: (path) => FILTERABLE.includes(path.join('.')),
  isSortable: (column) => ['id', 'nombre'].includes(column),
  isRelationPath: (path) =>
    ['persona', 'persona.ciudad'].includes(path.join('.')),
};

const parser = new QueryStringParser(schema);

const operator = (value: unknown): FindOperator<unknown> => {
  expect(value).toBeInstanceOf(FindOperator);
  return value as FindOperator<unknown>;
};

describe('QueryStringParser — paginación', () => {
  it('aplica defaults', () => {
    const parsed = parser.parse({});
    expect(parsed.page).toBe(1);
    expect(parsed.perPage).toBe(20);
    expect(parsed.paginate).toBe(true);
  });

  it('parsea page y perPage numéricos', () => {
    const parsed = parser.parse({ page: '3', perPage: '50' });
    expect(parsed.page).toBe(3);
    expect(parsed.perPage).toBe(50);
  });

  it('valores inválidos caen al default en lugar de propagar NaN', () => {
    const parsed = parser.parse({ page: 'abc', perPage: 'xyz' });
    expect(parsed.page).toBe(1);
    expect(parsed.perPage).toBe(20);
  });

  it('aplica el tope maxPerPage', () => {
    const parsed = parser.parse({ perPage: '99999' });
    expect(parsed.perPage).toBe(100);
  });

  it('perPage=0 se degrada al tope si el servicio no permite listar todo', () => {
    const parsed = parser.parse({ perPage: '0' });
    expect(parsed.paginate).toBe(true);
    expect(parsed.perPage).toBe(100);
  });

  it('perPage=0 desactiva la paginación cuando allowUnpaginated=true', () => {
    const open = new QueryStringParser(schema, { allowUnpaginated: true });
    const parsed = open.parse({ perPage: '0' });
    expect(parsed.paginate).toBe(false);
  });
});

describe('QueryStringParser — filtros', () => {
  it('igualdad simple sobre columna permitida', () => {
    const parsed = parser.parse({ estado: 'ACTIVO' });
    expect(parsed.where).toEqual({ estado: 'ACTIVO' });
  });

  it('ignora columnas fuera de la allowlist', () => {
    const parsed = parser.parse({ password: 'x', estado: 'A' });
    expect(parsed.where).toEqual({ estado: 'A' });
  });

  it('las claves reservadas no se interpretan como filtros', () => {
    const parsed = parser.parse({ page: '2', orderBy: 'id' });
    expect(parsed.where).toEqual({});
  });

  it('param repetido se convierte en IN', () => {
    const parsed = parser.parse({ estado: ['A', 'B'] });
    const op = operator((parsed.where as Record<string, unknown>).estado);
    expect(op.type).toBe('in');
    expect(op.value).toEqual(['A', 'B']);
  });

  it('_gte y _lte', () => {
    const parsed = parser.parse({ monto_gte: '10', monto_lte: '99' });
    const where = parsed.where as Record<string, unknown>;
    expect(operator(where.monto).type).toBeDefined();
  });

  it('_like genera un Raw con ILIKE', () => {
    const parsed = parser.parse({ nombre_like: 'ana' });
    const op = operator((parsed.where as Record<string, unknown>).nombre);
    expect(op.type).toBe('raw');
  });

  it('dos _like en la misma query usan parámetros distintos (sin colisión)', () => {
    const parsed = parser.parse({ nombre_like: 'ana', estado_like: 'act' });
    const where = parsed.where as Record<string, unknown>;
    const a = operator(where.nombre);
    const b = operator(where.estado);
    expect(a.objectLiteralParameters).toBeDefined();
    expect(b.objectLiteralParameters).toBeDefined();
    const aKeys = Object.keys(a.objectLiteralParameters ?? {});
    const bKeys = Object.keys(b.objectLiteralParameters ?? {});
    expect(aKeys[0]).not.toBe(bKeys[0]);
  });

  it('_between válido', () => {
    const parsed = parser.parse({ monto_between: '10, 99' });
    const op = operator((parsed.where as Record<string, unknown>).monto);
    expect(op.type).toBe('between');
  });

  it('_between malformado responde 400', () => {
    expect(() => parser.parse({ monto_between: '10' })).toThrow(
      BadRequestException,
    );
    expect(() => parser.parse({ monto_between: '10,,' })).toThrow(
      BadRequestException,
    );
  });

  it('_null=true → IS NULL y _null=false → NOT NULL', () => {
    const isNull = operator(
      (parser.parse({ monto_null: 'true' }).where as Record<string, unknown>)
        .monto,
    );
    expect(isNull.type).toBe('isNull');

    const notNull = operator(
      (parser.parse({ monto_null: 'false' }).where as Record<string, unknown>)
        .monto,
    );
    expect(notNull.type).toBe('not');
  });

  it('_not con lista CSV → NOT IN', () => {
    const op = operator(
      (parser.parse({ id_not: '1,2,3' }).where as Record<string, unknown>).id,
    );
    expect(op.type).toBe('not');
  });

  it('columna cuyo nombre termina en sufijo se filtra por igualdad', () => {
    const parsed = parser.parse({ tag_like: 'literal' });
    expect(parsed.where).toEqual({ tag_like: 'literal' });
  });
});

describe('QueryStringParser — relaciones', () => {
  it('filtro anidado relacion.columna con operador', () => {
    const parsed = parser.parse({ 'persona.nombre_like': 'ana' });
    const where = parsed.where as Record<string, Record<string, unknown>>;
    expect(operator(where.persona.nombre).type).toBe('raw');
  });

  it('ignora rutas de relación no permitidas', () => {
    const parsed = parser.parse({ 'otra.campo': 'x' });
    expect(parsed.where).toEqual({});
  });

  it('with acepta CSV y descarta relaciones inválidas', () => {
    const parsed = parser.parse({ with: 'persona, persona.ciudad, noexiste' });
    expect(parsed.relations).toEqual(['persona', 'persona.ciudad']);
  });

  it('with deduplica', () => {
    const parsed = parser.parse({ with: 'persona,persona' });
    expect(parsed.relations).toEqual(['persona']);
  });
});

describe('QueryStringParser — orden y OR', () => {
  it('orderBy con dirección y default ASC', () => {
    const parsed = parser.parse({ orderBy: 'nombre:DESC, id' });
    expect(parsed.order).toEqual({ nombre: 'DESC', id: 'ASC' });
  });

  it('orderBy ignora columnas no ordenables', () => {
    const parsed = parser.parse({ orderBy: 'estado:DESC' });
    expect(parsed.order).toEqual({});
  });

  it('or en formato JSON combina cada bloque con el AND base', () => {
    const parsed = parser.parse({
      monto: '5',
      or: '[{"estado":"A"},{"estado":"B"}]',
    });
    const where = parsed.where as Array<Record<string, unknown>>;
    expect(Array.isArray(where)).toBe(true);
    expect(where).toHaveLength(2);
    expect(where[0]).toEqual({ monto: '5', estado: 'A' });
    expect(where[1]).toEqual({ monto: '5', estado: 'B' });
  });

  it('or en formato pipe', () => {
    const parsed = parser.parse({ or: 'estado=A|estado=B' });
    const where = parsed.where as Array<Record<string, unknown>>;
    expect(where).toHaveLength(2);
  });

  it('or con JSON inválido responde 400', () => {
    expect(() => parser.parse({ or: '[{estado:' })).toThrow(
      BadRequestException,
    );
  });

  it('or ignora campos fuera de la allowlist dentro de los bloques', () => {
    const parsed = parser.parse({ or: '[{"password":"x"}]' });
    expect(Array.isArray(parsed.where)).toBe(false);
  });
});
