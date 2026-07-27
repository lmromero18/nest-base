import { BadRequestException } from '@nestjs/common';
import {
  Between,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Raw,
} from 'typeorm';

/**
 * Contrato de query-string soportado por la librería base:
 *
 *   Paginación:   ?page=2&perPage=50            (perPage=0 → sin paginar, si el servicio lo permite)
 *   Igualdad:     ?estado=ACTIVO                (repetido → IN: ?estado=A&estado=B)
 *   Operadores:   ?nombre_like=ana  ?monto_gte=10  ?monto_lte=99
 *                 ?fecha_between=2026-01-01,2026-12-31
 *                 ?deletedAt_null=true|false    ?id_not=1,2,3
 *   Relaciones:   ?persona.nombre_like=ana      (ruta completa validada)
 *   Cargar rel.:  ?with=persona,persona.ciudad
 *   Orden:        ?orderBy=nombre:ASC,id:DESC
 *   OR:           ?or=[{"estado":"A"},{"estado":"B"}]   o   ?or=estado=A|estado=B
 *                 (los bloques OR solo soportan igualdad y se combinan con el AND base)
 */

export interface ParsedListQuery {
  page: number;
  /** Tamaño de página efectivo (con tope aplicado). Sin significado si paginate=false. */
  perPage: number;
  paginate: boolean;
  where: Record<string, unknown> | Array<Record<string, unknown>>;
  order: Record<string, 'ASC' | 'DESC'>;
  relations: string[];
}

/**
 * Conocimiento de la entidad que el parser necesita. La implementación real
 * (basada en metadata de TypeORM + allowlists) vive en BaseService; en tests
 * se puede sustituir por un objeto simple.
 */
export interface QuerySchema {
  /** ¿La ruta (columna, o relación...columna) es filtrable? Valida la ruta completa. */
  isFilterable(path: string[]): boolean;
  /** ¿La columna raíz es ordenable? */
  isSortable(column: string): boolean;
  /** ¿La ruta completa está compuesta solo por relaciones válidas y permitidas? */
  isRelationPath(path: string[]): boolean;
}

export interface QueryParserOptions {
  defaultPerPage: number;
  maxPerPage: number;
  /** Si false, perPage=0 se degrada a maxPerPage en lugar de traer todo. */
  allowUnpaginated: boolean;
  /** Profundidad máxima de relaciones en `with` (rel.sub.subsub). */
  maxRelationDepth: number;
  /** Cantidad máxima de relaciones distintas en `with`. */
  maxRelations: number;
}

export const DEFAULT_PARSER_OPTIONS: QueryParserOptions = {
  defaultPerPage: 20,
  maxPerPage: 100,
  allowUnpaginated: false,
  maxRelationDepth: 3,
  maxRelations: 10,
};

const RESERVED_KEYS = new Set(['page', 'perPage', 'orderBy', 'with', 'or']);
const OPERATOR_SUFFIX = /(_like|_gte|_lte|_between|_null|_not)$/;

export class QueryStringParser {
  private readonly options: QueryParserOptions;

  constructor(
    private readonly schema: QuerySchema,
    options: Partial<QueryParserOptions> = {},
  ) {
    this.options = { ...DEFAULT_PARSER_OPTIONS, ...options };
  }

  parse(query: Record<string, unknown> = {}): ParsedListQuery {
    let paramSeq = 0;
    const nextParam = () => `qsp_${paramSeq++}`;

    const { page, perPage, paginate } = this.parsePagination(query);
    const where = this.parseFilters(query, nextParam);
    const order = this.parseOrder(query.orderBy);
    const relations = this.parseRelations(query.with);
    const finalWhere = this.applyOrBlocks(where, query.or);

    return { page, perPage, paginate, where: finalWhere, order, relations };
  }

  // --- Paginación -----------------------------------------------------------

  private parsePagination(query: Record<string, unknown>): {
    page: number;
    perPage: number;
    paginate: boolean;
  } {
    const page = toPositiveInt(first(query.page), 1);
    const requested = toNonNegativeInt(
      first(query.perPage),
      this.options.defaultPerPage,
    );

    if (requested === 0) {
      if (this.options.allowUnpaginated) {
        return { page: 1, perPage: 0, paginate: false };
      }
      return { page, perPage: this.options.maxPerPage, paginate: true };
    }

    return {
      page,
      perPage: Math.min(requested, this.options.maxPerPage),
      paginate: true,
    };
  }

  // --- Filtros --------------------------------------------------------------

  private parseFilters(
    query: Record<string, unknown>,
    nextParam: () => string,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    for (const rawKey of Object.keys(query)) {
      if (RESERVED_KEYS.has(rawKey)) continue;
      const value = query[rawKey];
      if (value === undefined) continue;

      const opMatch = rawKey.match(OPERATOR_SUFFIX);
      const op = opMatch ? opMatch[1] : null;

      if (op) {
        const path = rawKey.slice(0, -op.length).split('.');
        if (path[path.length - 1] !== '' && this.schema.isFilterable(path)) {
          const comparator = this.buildComparator(op, value, rawKey, nextParam);
          if (comparator !== undefined) {
            assignNested(where, path, comparator);
          }
          continue;
        }
        // Si "campo_like" no es filtrable, puede tratarse de una columna
        // cuyo nombre real termina en el sufijo: se intenta como igualdad.
      }

      const plainPath = rawKey.split('.');
      if (this.schema.isFilterable(plainPath)) {
        assignNested(where, plainPath, plainComparator(value));
      }
    }

    return where;
  }

  private buildComparator(
    op: string,
    value: unknown,
    rawKey: string,
    nextParam: () => string,
  ): unknown {
    switch (op) {
      case '_like': {
        const param = nextParam();
        const term = `%${String(first(value))}%`;
        // CAST permite _like sobre columnas no-texto (números, uuid, fechas)
        return Raw((alias) => `CAST(${alias} AS varchar) ILIKE :${param}`, {
          [param]: term,
        });
      }
      case '_gte':
        return MoreThanOrEqual(first(value));
      case '_lte':
        return LessThanOrEqual(first(value));
      case '_between': {
        const parts = String(first(value))
          .split(',')
          .map((s) => s.trim());
        if (parts.length !== 2 || parts.some((p) => p === '')) {
          throw new BadRequestException(
            `El filtro ${rawKey} requiere exactamente dos valores separados por coma`,
          );
        }
        return Between(parts[0], parts[1]);
      }
      case '_null': {
        const flag = String(first(value)).toLowerCase();
        const wantsNull = ['', 'true', '1', 'yes'].includes(flag);
        return wantsNull ? IsNull() : Not(IsNull());
      }
      case '_not': {
        const list = toList(value);
        if (list.length === 0) return undefined;
        return list.length === 1 ? Not(list[0]) : Not(In(list));
      }
      default:
        return undefined;
    }
  }

  // --- Ordenamiento ---------------------------------------------------------

  private parseOrder(rawOrderBy: unknown): Record<string, 'ASC' | 'DESC'> {
    const order: Record<string, 'ASC' | 'DESC'> = {};
    const orderBy = first(rawOrderBy);
    if (!orderBy) return order;

    for (const field of String(orderBy).split(',')) {
      const [col, dir = 'ASC'] = field.trim().split(':');
      if (col && this.schema.isSortable(col)) {
        order[col] = dir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      }
    }

    return order;
  }

  // --- Relaciones (with) ----------------------------------------------------

  private parseRelations(rawWith: unknown): string[] {
    const requested: string[] = [];

    if (Array.isArray(rawWith)) {
      requested.push(
        ...rawWith.filter((r): r is string => typeof r === 'string'),
      );
    } else if (typeof rawWith === 'string') {
      requested.push(...rawWith.split(','));
    }

    const relations = requested
      .map((r) => r.trim())
      .filter(Boolean)
      .filter((r) => {
        const path = r.split('.');
        return (
          path.length <= this.options.maxRelationDepth &&
          this.schema.isRelationPath(path)
        );
      });

    return Array.from(new Set(relations)).slice(0, this.options.maxRelations);
  }

  // --- Bloques OR -----------------------------------------------------------

  private applyOrBlocks(
    where: Record<string, unknown>,
    rawOr: unknown,
  ): Record<string, unknown> | Array<Record<string, unknown>> {
    const orValue = first(rawOr);
    if (!orValue) return where;

    const blocks = this.parseOrBlocks(String(orValue))
      .map((block) => this.buildOrWhere(block))
      .filter((block) => Object.keys(block).length > 0);

    if (blocks.length === 0) return where;

    // Cada bloque OR se combina (AND) con los filtros base
    return blocks.map((block) => deepMergePlain(where, block));
  }

  private parseOrBlocks(raw: string): Array<Record<string, unknown>> {
    const trimmed = raw.trim();

    if (trimmed.startsWith('[')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        throw new BadRequestException(
          'El parámetro "or" contiene JSON inválido',
        );
      }
      if (!Array.isArray(parsed)) {
        throw new BadRequestException(
          'El parámetro "or" debe ser un array de objetos',
        );
      }
      return parsed.filter(
        (p): p is Record<string, unknown> =>
          p !== null && typeof p === 'object' && !Array.isArray(p),
      );
    }

    // Formato: campo=valor&campo2=valor2|campo=valor3
    return trimmed
      .split('|')
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        const block: Record<string, unknown> = {};
        for (const pair of segment.split('&')) {
          const [key, ...rest] = pair.trim().split('=');
          if (!key) continue;
          block[key] = decodeURIComponent(rest.join('='));
        }
        return block;
      });
  }

  private buildOrWhere(
    block: Record<string, unknown>,
  ): Record<string, unknown> {
    const partial: Record<string, unknown> = {};
    for (const key of Object.keys(block)) {
      const value = block[key];
      if (value === undefined) continue;
      const path = key.split('.');
      if (!this.schema.isFilterable(path)) continue;
      assignNested(partial, path, plainComparator(value));
    }
    return partial;
  }
}

// --- Helpers ----------------------------------------------------------------

/** Toma el primer valor cuando el query param llega repetido como array. */
function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function toPositiveInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n =
    typeof value === 'number' ? Math.trunc(value) : parseInt(String(value), 10);
  return Number.isNaN(n) || n <= 0 ? fallback : n;
}

function toNonNegativeInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n =
    typeof value === 'number' ? Math.trunc(value) : parseInt(String(value), 10);
  return Number.isNaN(n) || n < 0 ? fallback : n;
}

/** Igualdad simple; valores repetidos (array) o CSV explícito NO se separan: array → IN. */
function plainComparator(value: unknown): unknown {
  if (Array.isArray(value)) {
    const list = value.filter((v) => v !== undefined && v !== null);
    if (list.length === 0) return undefined;
    return list.length === 1 ? list[0] : In(list);
  }
  return value;
}

/** Convierte un valor a lista para IN/NOT IN. Acepta array o CSV string. */
function toList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function assignNested(
  obj: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    if (!isPlainObject(current[segment])) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value;
}

/**
 * Merge recursivo de objetos planos (los operadores de TypeORM son instancias
 * de clase y se tratan como valores atómicos, nunca se mezclan).
 */
function deepMergePlain(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const key of Object.keys(override)) {
    const baseValue = result[key];
    const overrideValue = override[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMergePlain(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value.constructor === Object || value.constructor === undefined)
  );
}
