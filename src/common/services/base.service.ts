import {
  Repository,
  DeepPartial,
  ObjectLiteral,
  FindManyOptions,
  FindOneOptions,
  Not,
  In,
  IsNull,
  Between,
  LessThanOrEqual,
  MoreThanOrEqual,
  ILike,
  FindOptionsWhere,
  Raw,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  currentPage: number;
  lastPage: number;
  perPage: number;
  from: number | null;
  to: number | null;
}

export class BaseService<T extends ObjectLiteral> {
  constructor(protected readonly repository: Repository<T>) {}

  async find(
    page = 1,
    limit = 20,
    filters: Record<string, any> = {},
    options?: Omit<FindManyOptions<T>, 'where' | 'skip' | 'take'>,
  ): Promise<PaginatedResponse<T>> {
    const validColumns = this.repository.metadata.columns.map(
      (col) => col.propertyName,
    );
    const validRelations = this.repository.metadata.relations.map(
      (r) => r.propertyName,
    );

    // --- Ajustar parámetros de paginación ---
    const toPositiveInt = (val: any, fallback: number): number => {
      if (val === undefined || val === null || val === '') return fallback;
      const n =
        typeof val === 'number' ? Math.trunc(val) : parseInt(String(val), 10);
      return Number.isNaN(n) || n <= 0 ? fallback : n;
    };

    if (filters.perPage !== undefined) {
      // Permitimos perPage=0 para desactivar paginación más adelante
      const parsed = parseInt(String(filters.perPage), 10);
      limit = Number.isNaN(parsed) ? limit : parsed; // puede ser 0
    }

    if (filters.page !== undefined) {
      page = toPositiveInt(filters.page, 1);
    }

    // Construcción de filtros (where) con soporte para notación de relación "relation.column"
    const where: any = {};
    // Convierte un valor a lista para operadores IN/NOT IN. Acepta array o CSV string
    const toList = (val: any): any[] => {
      if (Array.isArray(val)) return val;
      const parts = String(val)
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
      return parts.map((p) => {
        const n = Number(p);
        return isNaN(n) ? p : n;
      });
    };
    const assignNested = (obj: any, path: string[], val: any) => {
      let current = obj;
      for (let i = 0; i < path.length - 1; i++) {
        const seg = path[i];
        if (!current[seg] || typeof current[seg] !== 'object')
          current[seg] = {};
        current = current[seg];
      }
      current[path[path.length - 1]] = val;
    };

    for (const rawKey of Object.keys(filters)) {
      const value = filters[rawKey];
      if (value === undefined) continue;

      // Soporte operadores sufijo en columna simple (no relación)
      const processDirectFilter = (field: string, operator: string | null) => {
        if (!validColumns.includes(field)) return false;
        switch (operator) {
          case '_like':
            where[field] = Raw(
              (alias) =>
                `CAST(${alias} AS varchar) ILIKE :value::varchar`,
              { value: `%${String(value)}%` },
            );
            return true;
          case '_gte':
            where[field] = MoreThanOrEqual(value);
            return true;
          case '_lte':
            where[field] = LessThanOrEqual(value);
            return true;
          case '_between': {
            const [min, max] = String(value).split(',');
            where[field] = Between(min, max);
            return true;
          }
          case '_null':
            where[field] = IsNull();
            return true;
          case '_not':
            {
              const list = toList(value);
              if (list.length > 0) {
                where[field] = Not(In(list));
              }
            }
            return true;
          default:
            where[field] = value;
            return true;
        }
      };

      // Detectar si es relación: formato relation.column (posible cadena más profunda relation.sub.column)
      if (rawKey.includes('.')) {
        const pathParts = rawKey.split('.');
        // Validar que el primer segmento sea una relación válida; si no, ignorar filtro silenciosamente
        if (!validRelations.includes(pathParts[0])) {
          continue;
        }
        const last = pathParts[pathParts.length - 1];
        // Operadores en último segmento (e.g. relation.column_like no soportado por ahora -> se podría extender)
        if (/_like$|_gte$|_lte$|_between$|_null$|_not$/.test(last)) {
          // Extraer operador y campo
          const opMatch = last.match(/(_like|_gte|_lte|_between|_null|_not)$/);
          if (opMatch) {
            const op = opMatch[1];
            const pureField = last.replace(op, '');
            pathParts[pathParts.length - 1] = pureField; // sustituir por nombre puro
            let comparator: any;
            switch (op) {
              case '_like':
                comparator = ILike(`%${value}%`);
                break;
              case '_gte':
                comparator = MoreThanOrEqual(value);
                break;
              case '_lte':
                comparator = LessThanOrEqual(value);
                break;
              case '_between': {
                const [min, max] = String(value).split(',');
                comparator = Between(min, max);
                break;
              }
              case '_null':
                comparator = IsNull();
                break;
              case '_not':
                {
                  const list = toList(value);
                  if (list.length > 0) {
                    comparator = Not(In(list));
                  } else {
                    comparator = undefined as any;
                  }
                }
                break;
            }
            if (typeof comparator !== 'undefined') {
              assignNested(where, pathParts, comparator);
            }
            continue;
          }
        }
        // Caso simple relation.column = valor
        assignNested(where, pathParts, value);
        continue;
      }

      // Campo simple con sufijo operador
      const suffixMatch = rawKey.match(
        /(_like|_gte|_lte|_between|_null|_not)$/,
      );
      if (suffixMatch) {
        const operator = suffixMatch[1];
        const field = rawKey.replace(operator, '');
        if (processDirectFilter(field, operator)) continue;
      }

      // Campo simple directo
      processDirectFilter(rawKey, null);
    }

    // Ordenamiento
    const order: any = {};
    if (filters.orderBy) {
      const fields = String(filters.orderBy).split(',');
      for (const field of fields) {
        const [col, dir = 'ASC'] = field.trim().split(':');
        if (validColumns.includes(col)) {
          order[col] = dir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        }
      }
    }

    // Relaciones (acepta string CSV o array directamente)
    let relations: string[] = [];
    if (Array.isArray(filters.with)) {
      const validRelationPropertyNames = this.repository.metadata.relations.map(
        (rel) => rel.propertyName,
      );
      relations = filters.with
        .filter((r: any) => typeof r === 'string')
        .filter((r: string) => {
          const root = r.split('.')[0];
          return validRelationPropertyNames.includes(root);
        });
    } else if (typeof filters.with === 'string') {
      const requested = filters.with
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      const validRelationPropertyNames = this.repository.metadata.relations.map(
        (rel) => rel.propertyName,
      );
      relations = requested.filter((r) => {
        const root = r.split('.')[0];
        return validRelationPropertyNames.includes(root);
      });
    }
    // Eliminar duplicados manteniendo orden
    relations = Array.from(new Set(relations));

    // --- OR Support (_or) ---
    // Permite enviar _or como: JSON array '[{"field":1},{"field":2}]' o como 'a=1&b=2|a=3'
    const buildPartialWhere = (obj: Record<string, any>): any => {
      const partial: any = {};
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (v === undefined) continue;
        if (k.includes('.')) {
          const pathParts = k.split('.');
          if (!validRelations.includes(pathParts[0])) continue; // se ignora si no es relación válida
          assignNested(partial, pathParts, v);
          continue;
        }
        if (!validColumns.includes(k)) continue;
        partial[k] = v;
      }
      return partial;
    };

    let finalWhere: any = where; // por defecto AND base
    if (filters.or) {
      let orBlocks: any[] = [];
      const rawOr = String(filters.or).trim();
      try {
        if (rawOr.startsWith('[')) {
          const parsed = JSON.parse(rawOr);
          if (Array.isArray(parsed)) {
            orBlocks = parsed
              .map((p) =>
                p && typeof p === 'object' ? buildPartialWhere(p) : null,
              )
              .filter(Boolean);
          }
        } else {
          // formato segments separados por |
          const segments = rawOr
            .split('|')
            .map((s) => s.trim())
            .filter(Boolean);
          for (const seg of segments) {
            const obj: Record<string, any> = {};
            const pairs = seg
              .split('&')
              .map((p) => p.trim())
              .filter(Boolean);
            for (const pair of pairs) {
              const [key, ...rest] = pair.split('=');
              if (!key) continue;
              obj[key] = decodeURIComponent(rest.join('='));
            }
            orBlocks.push(buildPartialWhere(obj));
          }
        }
      } catch (e) {
        // Parse fallido: ignoramos _or
        orBlocks = [];
      }
      if (orBlocks.length > 0) {
        finalWhere = orBlocks.map((block) => ({ ...where, ...block }));
      }
    }

    // Si se desactiva la paginación
    if (filters.perPage == 0) {
      const data = await this.repository.find({
        where: finalWhere,
        order,
        relations,
        ...options,
      });

      return {
        data,
        total: data.length,
        currentPage: 1,
        lastPage: 1,
        perPage: data.length,
        from: data.length > 0 ? 1 : null,
        to: data.length > 0 ? data.length : null,
      };
    }

    const skip = (page - 1) * limit;

    // Consulta paginada
    const [data, total] = await this.repository.findAndCount({
      where: finalWhere,
      skip,
      take: limit,
      order,
      relations,
      ...options,
    });

    const lastPage = Math.ceil(total / limit) || 1;
    const from = total > 0 ? skip + 1 : null;
    const to = total > 0 ? skip + data.length : null;

    // --- Return Formatted Response ---
    return {
      data,
      total,
      currentPage: page,
      lastPage,
      perPage: limit,
      from,
      to,
    };
  }

  async create(data: DeepPartial<T>): Promise<T> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async findAll(): Promise<{ data: T[] }> {
    const data = await this.repository.find();
    return { data };
  }

  /**
   * Obtiene un registro por su PK permitiendo cargar relaciones igual que en find().
   * Uso rápido:
   *  service.findOne(id, { with: 'rel1,rel2' })
   *  service.findOne(id, { relations: ['rel1', 'rel2'] })
   */
  async findOne(
    id: any,
    filters: { with?: string } = {},
    options?: Omit<FindOneOptions<T>, 'where' | 'relations'> & {
      relations?: string[];
    },
  ): Promise<T | null> {
    // Normalizamos relaciones desde filters.with o options.relations
    let relations: string[] | undefined = options?.relations;
    if (filters.with) {
      const validRelationPropertyNames = this.repository.metadata.relations.map(
        (r) => r.propertyName,
      );
      const requested = filters.with
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      relations = requested.filter((r) => {
        const root = r.split('.')[0];
        return validRelationPropertyNames.includes(root);
      });
      relations = Array.from(new Set(relations));
    }
    return this.findByPk(id, { ...(options || {}), relations });
  }

  /**
   * Generic Primary Key finder.
   * Accepts either:
   *  - Primitive (string/number) when the entity has a SINGLE primary column.
   *  - Object with shape { pk1: val1, pk2: val2 } for composite keys.
   * Performs light type coercion (string->number) for numeric PK columns.
   */
  async findByPk(
    pkValue: any,
    options?: Omit<FindOneOptions<T>, 'where'>,
  ): Promise<T | null> {
    const primaryColumns = this.repository.metadata.primaryColumns;
    if (!primaryColumns.length) return null;

    // If composite key expected, require an object with all keys
    if (primaryColumns.length > 1) {
      if (typeof pkValue !== 'object' || pkValue === null) {
        // Cannot resolve composite PK from primitive
        return null;
      }
      // Build where ensuring only primary columns are taken
      const where: any = {};
      for (const col of primaryColumns) {
        if (pkValue[col.propertyName] === undefined) return null; // missing a component
        where[col.propertyName] = this.coercePkType(
          col,
          pkValue[col.propertyName],
        );
      }
      return this.repository.findOne({ where, ...(options || {}) });
    }

    // Single primary column
    const pkCol = primaryColumns[0];
    if (typeof pkValue === 'object' && pkValue !== null) {
      // If an object is passed, try to extract the single pk prop
      if (pkValue[pkCol.propertyName] === undefined) return null;
      pkValue = pkValue[pkCol.propertyName];
    }
    const coerced = this.coercePkType(pkCol, pkValue);
    return this.repository.findOne({
      where: { [pkCol.propertyName]: coerced } as any,
      ...(options || {}),
    });
  }

  private coercePkType(column: { type: any; propertyName: string }, val: any) {
    if (val == null) return val;
    if (typeof val === 'string') {
      const colType = String(column.type || '').toLowerCase();
      if (/int|numeric|decimal|number|bigint/.test(colType)) {
        const parsed = Number(val);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
    return val;
  }

  // Finds one entity by a specific column and value. Returns null if not found.
  async findOneBy<K extends keyof T>(
    column: K,
    value: T[K],
    options?: Omit<FindOneOptions<T>, 'where'>,
  ): Promise<T | null> {
    const where = {
      [column as string]: value,
    } as unknown as FindOptionsWhere<T>;
    return this.repository.findOne({ where, ...(options || {}) });
  }

  async update(id: any, data: QueryDeepPartialEntity<T>): Promise<T | null> {
    await this.repository.update(id, data);
    return this.findOne(id);
  }

  /**
   * Actualiza por PK dinámica (simple o compuesta). Si no existe, retorna null.
   */
  /**
   * Busca por una columna única (no PK), actualiza usando la PK real.
   * Útil para entidades donde txDescripcion es PK pero se busca por id* numérico.
   */
  async updateByUniqueColumn(
    column: string,
    value: any,
    data: QueryDeepPartialEntity<T>,
  ): Promise<T | null> {
    const entity = await this.findOneBy(column as any, value);
    if (!entity) return null;

    const primaryColumns = this.repository.metadata.primaryColumns;
    if (!primaryColumns.length) return null;

    const pkCol = primaryColumns[0];
    const pkValue = (entity as any)[pkCol.propertyName];
    await this.repository.update({ [pkCol.propertyName]: pkValue } as any, data);
    return this.findByPk(pkValue);
  }

  /**
   * Busca por una columna única (no PK), elimina usando la PK real.
   */
  async removeByUniqueColumn(column: string, value: any): Promise<boolean> {
    const entity = await this.findOneBy(column as any, value);
    if (!entity) return false;

    const primaryColumns = this.repository.metadata.primaryColumns;
    if (!primaryColumns.length) return false;

    const pkCol = primaryColumns[0];
    const pkValue = (entity as any)[pkCol.propertyName];
    const res = await this.repository.delete({ [pkCol.propertyName]: pkValue } as any);
    return (res.affected ?? 0) > 0;
  }

  async updateByPk(
    pk: any,
    data: QueryDeepPartialEntity<T>,
  ): Promise<T | null> {
    const entity = await this.findByPk(pk);
    if (!entity) return null;
    const primaryColumns = this.repository.metadata.primaryColumns.map(
      (c) => c.propertyName,
    );
    const where: any = {};
    if (primaryColumns.length === 1) {
      where[primaryColumns[0]] =
        typeof pk === 'object' && pk !== null ? pk[primaryColumns[0]] : pk;
    } else {
      for (const col of primaryColumns) where[col] = pk[col];
    }
    await this.repository.update(where, data);
    return this.findByPk(pk);
  }

  async remove(id: any): Promise<void> {
    await this.repository.delete(id);
  }

  async removeByPk(pk: any): Promise<boolean> {
    const primaryColumns = this.repository.metadata.primaryColumns.map(
      (c) => c.propertyName,
    );
    const where: any = {};
    if (primaryColumns.length === 1) {
      where[primaryColumns[0]] =
        typeof pk === 'object' && pk !== null ? pk[primaryColumns[0]] : pk;
    } else {
      for (const col of primaryColumns) {
        if (pk[col] === undefined) return false;
        where[col] = pk[col];
      }
    }
    const res = await this.repository.delete(where);
    return (res.affected ?? 0) > 0;
  }

  async softDelete(id: number) {
    return this.repository.softDelete(id);
  }

  async softDeleteByPk(pk: any) {
    const primaryColumns = this.repository.metadata.primaryColumns.map(
      (c) => c.propertyName,
    );
    const where: any = {};
    if (primaryColumns.length === 1) {
      where[primaryColumns[0]] =
        typeof pk === 'object' && pk !== null ? pk[primaryColumns[0]] : pk;
    } else {
      for (const col of primaryColumns) {
        if (pk[col] === undefined) return { affected: 0 } as any;
        where[col] = pk[col];
      }
    }
    return this.repository.softDelete(where);
  }
}
