import {
  Repository,
  DeepPartial,
  ObjectLiteral,
  FindManyOptions,
  FindOneOptions,
  Not,
  IsNull,
  Between,
  LessThanOrEqual,
  MoreThanOrEqual,
  ILike,
  FindOptionsWhere,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  current_page: number;
  last_page: number;
  per_page: number;
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

    // Ajustar parámetros de paginación
    if (filters.per_page) {
      limit = parseInt(filters.per_page, 20);
    }
    if (filters.page) {
      page = parseInt(filters.page, 1);
    }

    // Construcción de filtros (where)
    const where: any = {};
    for (const key of Object.keys(filters)) {
      const value = filters[key];

      if (key.endsWith('_like')) {
        const field = key.replace('_like', '');
        if (validColumns.includes(field)) {
          where[field] = ILike(`%${value}%`);
        }
      } else if (key.endsWith('_gte')) {
        const field = key.replace('_gte', '');
        if (validColumns.includes(field)) {
          where[field] = MoreThanOrEqual(value);
        }
      } else if (key.endsWith('_lte')) {
        const field = key.replace('_lte', '');
        if (validColumns.includes(field)) {
          where[field] = LessThanOrEqual(value);
        }
      } else if (key.endsWith('_between')) {
        const field = key.replace('_between', '');
        const [min, max] = String(value).split(',');
        if (validColumns.includes(field)) {
          where[field] = Between(min, max);
        }
      } else if (key.endsWith('_null')) {
        const field = key.replace('_null', '');
        if (validColumns.includes(field)) {
          where[field] = IsNull();
        }
      } else if (key.endsWith('_not')) {
        const field = key.replace('_not', '');
        if (validColumns.includes(field)) {
          where[field] = Not(value);
        }
      } else if (validColumns.includes(key)) {
        where[key] = value;
      }
    }

    // Ordenamiento
    const order: any = {};
    if (filters.order_by) {
      const fields = String(filters.order_by).split(',');
      for (const field of fields) {
        const [col, dir = 'ASC'] = field.trim().split(':');
        if (validColumns.includes(col)) {
          order[col] = dir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
        }
      }
    }

    // Relaciones
    const relations: string[] =
      typeof filters.with === 'string'
        ? filters.with.split(',').map((r) => r.trim())
        : [];

    // Si se desactiva la paginación
    if (filters.per_page == 0) {
      const data = await this.repository.find({
        where,
        order,
        relations,
        ...options,
      });

      return {
        data,
        total: data.length,
        current_page: 1,
        last_page: 1,
        per_page: data.length,
        from: data.length > 0 ? 1 : null,
        to: data.length > 0 ? data.length : null,
      };
    }

    const skip = (page - 1) * limit;

    // Consulta paginada
    const [data, total] = await this.repository.findAndCount({
      where,
      skip,
      take: limit,
      order,
      relations,
      ...options,
    });

    const last_page = Math.ceil(total / limit) || 1;
    const from = total > 0 ? skip + 1 : null;
    const to = total > 0 ? skip + data.length : null;

    // --- Return Formatted Response ---
    return {
      data,
      total,
      current_page: page,
      last_page,
      per_page: limit,
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

  async findOne(id: any): Promise<T | null> {
    return this.repository.findOneBy({ id });
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

  async remove(id: any): Promise<void> {
    await this.repository.delete(id);
  }

  async softDelete(id: number) {
    return this.repository.softDelete(id);
  }
}
