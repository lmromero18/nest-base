import { MethodNotAllowedException } from '@nestjs/common';
import {
  DeepPartial,
  EntityManager,
  EntityMetadata,
  FindManyOptions,
  FindOneOptions,
  FindOptionsOrder,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { RequestContext } from '../context/request-context';
import {
  ParsedListQuery,
  QuerySchema,
  QueryStringParser,
} from '../query/query-string-parser';

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  currentPage: number;
  lastPage: number;
  perPage: number;
  from: number | null;
  to: number | null;
}

export interface MutationOptions {
  /** EntityManager transaccional (dataSource.transaction(async (manager) => ...)). */
  manager?: EntityManager;
}

type ListFindOptions<T extends ObjectLiteral> = Omit<
  FindManyOptions<T>,
  'where' | 'skip' | 'take' | 'order' | 'relations'
>;

/**
 * Servicio CRUD genérico sobre un Repository de TypeORM.
 *
 * Configuración sobrescribible en el servicio hijo:
 *
 *   class PersonaService extends BaseService<Persona> {
 *     protected override readonly filterable = ['nombre', 'estado', 'ciudad.nombre'];
 *     protected override readonly sortable = ['nombre', 'id'];
 *     protected override readonly allowedRelations = ['ciudad'];
 *     protected override readonly maxPerPage = 50;
 *   }
 *
 * Sin configurar, se exponen todas las columnas visibles (las marcadas con
 * `select: false` quedan siempre excluidas de filtros y ordenamiento).
 */
export abstract class BaseService<T extends ObjectLiteral> {
  /** Rutas filtrables (columnas o "relacion.columna"). undefined = todas las visibles. */
  protected readonly filterable?: string[];
  /** Columnas raíz ordenables vía orderBy. undefined = todas las visibles. */
  protected readonly sortable?: string[];
  /** Relaciones expuestas (rutas con punto para anidadas). undefined = todas. */
  protected readonly allowedRelations?: string[];
  protected readonly defaultPerPage: number = 20;
  protected readonly maxPerPage: number = 100;
  /** Permite perPage=0 (traer todo). Por defecto se degrada a maxPerPage. */
  protected readonly allowUnpaginated: boolean = false;
  /**
   * Columnas de auditoría estampadas automáticamente (si existen en la entidad)
   * con el usuario del RequestContext. Sobrescribir con null para desactivar.
   */
  protected readonly auditColumns: {
    created: string;
    updated: string;
  } | null = { created: 'idCreado', updated: 'idActualizado' };

  private parserInstance?: QueryStringParser;

  constructor(protected readonly repository: Repository<T>) {}

  // --- Lectura --------------------------------------------------------------

  /**
   * Listado paginado a partir del query-string crudo del request.
   * El contrato de filtros está documentado en QueryStringParser.
   */
  async find(
    query: Record<string, unknown> = {},
    options?: ListFindOptions<T>,
  ): Promise<PaginatedResponse<T>> {
    const parsed = this.parseListQuery(query);
    const findOptions: FindManyOptions<T> = {
      where: parsed.where as FindOptionsWhere<T> | FindOptionsWhere<T>[],
      order: parsed.order as FindOptionsOrder<T>,
      relations: parsed.relations,
      ...options,
    };

    if (!parsed.paginate) {
      const data = await this.repository.find(findOptions);
      return this.buildPaginatedResponse(data, data.length, 1, data.length);
    }

    const skip = (parsed.page - 1) * parsed.perPage;
    const [data, total] = await this.repository.findAndCount({
      ...findOptions,
      skip,
      take: parsed.perPage,
    });

    return this.buildPaginatedResponse(
      data,
      total,
      parsed.page,
      parsed.perPage,
    );
  }

  /**
   * Obtiene un registro por su PK permitiendo cargar relaciones igual que en find():
   *   service.findOne(id, { with: 'rel1,rel2.sub' })
   */
  async findOne(
    id: unknown,
    filters: { with?: string } = {},
    options?: Omit<FindOneOptions<T>, 'where' | 'relations'>,
  ): Promise<T | null> {
    const relations = filters.with
      ? this.parseListQuery({ with: filters.with }).relations
      : undefined;
    return this.findByPk(id, { ...(options ?? {}), relations });
  }

  /**
   * Buscador genérico por PK. Acepta primitivo (PK simple) u objeto
   * { pk1: v1, pk2: v2 } (PK compuesta). Coerce string→number en PKs numéricas.
   */
  async findByPk(
    pkValue: unknown,
    options?: Omit<FindOneOptions<T>, 'where'>,
  ): Promise<T | null> {
    const where = this.buildPkWhere(pkValue);
    if (!where) return null;
    return this.repository.findOne({
      where: where as FindOptionsWhere<T>,
      ...(options ?? {}),
    });
  }

  /** Busca un registro por una columna específica. */
  async findOneBy<K extends keyof T>(
    column: K,
    value: T[K],
    options?: Omit<FindOneOptions<T>, 'where'>,
  ): Promise<T | null> {
    const where = {
      [column as string]: value,
    } as unknown as FindOptionsWhere<T>;
    return this.repository.findOne({ where, ...(options ?? {}) });
  }

  /** Total de registros que cumplen los filtros del query-string. */
  async count(query: Record<string, unknown> = {}): Promise<number> {
    const parsed = this.parseListQuery(query);
    return this.repository.count({
      where: parsed.where as FindOptionsWhere<T> | FindOptionsWhere<T>[],
    });
  }

  /** ¿Existe al menos un registro que cumpla los filtros? */
  async exists(query: Record<string, unknown> = {}): Promise<boolean> {
    const parsed = this.parseListQuery(query);
    return this.repository.exists({
      where: parsed.where as FindOptionsWhere<T> | FindOptionsWhere<T>[],
    });
  }

  // --- Escritura ------------------------------------------------------------

  /**
   * Crea un registro. Las columnas generadas (PK autoincremental/uuid) y las
   * de timestamps/soft-delete se descartan del payload: el cliente nunca
   * puede fijarlas (evita sobrescrituras vía POST con id existente).
   */
  async create(data: DeepPartial<T>, options?: MutationOptions): Promise<T> {
    const repo = this.repo(options);
    const payload = this.sanitizeWritePayload(data);
    this.stampAudit(payload, 'created');
    const entity = repo.create(payload as DeepPartial<T>);
    return repo.save(entity);
  }

  /**
   * Actualiza por PK usando preload + save, de modo que corren los listeners
   * (@BeforeUpdate) y se pueden actualizar relaciones. Retorna null si no existe.
   */
  async updateByPk(
    pk: unknown,
    data: DeepPartial<T>,
    options?: MutationOptions,
  ): Promise<T | null> {
    const repo = this.repo(options);
    const pkWhere = this.buildPkWhere(pk);
    if (!pkWhere) return null;

    const payload = this.sanitizeWritePayload(data);
    this.stampAudit(payload, 'updated');

    const entity = await repo.preload({
      ...pkWhere,
      ...payload,
    } as DeepPartial<T>);
    if (!entity) return null;

    return repo.save(entity);
  }

  /** Busca por una columna única (no PK) y actualiza usando la PK real. */
  async updateByUniqueColumn<K extends keyof T>(
    column: K,
    value: T[K],
    data: DeepPartial<T>,
    options?: MutationOptions,
  ): Promise<T | null> {
    const entity = await this.findOneBy(column, value);
    if (!entity) return null;
    return this.updateByPk(entity, data, options);
  }

  /** Borrado físico por PK. Retorna false si no existía. */
  async removeByPk(pk: unknown, options?: MutationOptions): Promise<boolean> {
    const where = this.buildPkWhere(pk);
    if (!where) return false;
    const result = await this.repo(options).delete(
      where as FindOptionsWhere<T>,
    );
    return (result.affected ?? 0) > 0;
  }

  /** Busca por una columna única (no PK) y elimina usando la PK real. */
  async removeByUniqueColumn<K extends keyof T>(
    column: K,
    value: T[K],
    options?: MutationOptions,
  ): Promise<boolean> {
    const entity = await this.findOneBy(column, value);
    if (!entity) return false;
    return this.removeByPk(entity, options);
  }

  /**
   * Borrado lógico por PK. Lanza 405 si la entidad no tiene @DeleteDateColumn.
   * Retorna false si no existía.
   */
  async softDeleteByPk(
    pk: unknown,
    options?: MutationOptions,
  ): Promise<boolean> {
    this.assertSoftDeleteSupport();
    const where = this.buildPkWhere(pk);
    if (!where) return false;
    const result = await this.repo(options).softDelete(
      where as FindOptionsWhere<T>,
    );
    return (result.affected ?? 0) > 0;
  }

  /** Restaura un registro borrado lógicamente. Retorna false si no aplicó. */
  async restoreByPk(pk: unknown, options?: MutationOptions): Promise<boolean> {
    this.assertSoftDeleteSupport();
    const where = this.buildPkWhere(pk);
    if (!where) return false;
    const result = await this.repo(options).restore(
      where as FindOptionsWhere<T>,
    );
    return (result.affected ?? 0) > 0;
  }

  /** Indica si la entidad soporta borrado lógico (@DeleteDateColumn). */
  supportsSoftDelete(): boolean {
    return Boolean(this.repository.metadata.deleteDateColumn);
  }

  // --- Infraestructura ------------------------------------------------------

  /** Parseo del query-string con el schema/allowlists de esta entidad. */
  protected parseListQuery(query: Record<string, unknown>): ParsedListQuery {
    if (!this.parserInstance) {
      this.parserInstance = new QueryStringParser(this.buildQuerySchema(), {
        defaultPerPage: this.defaultPerPage,
        maxPerPage: this.maxPerPage,
        allowUnpaginated: this.allowUnpaginated,
      });
    }
    return this.parserInstance.parse(query);
  }

  /** Repositorio efectivo: el transaccional si se pasó un manager. */
  protected repo(options?: MutationOptions): Repository<T> {
    return options?.manager
      ? options.manager.getRepository<T>(this.repository.target)
      : this.repository;
  }

  private buildQuerySchema(): QuerySchema {
    const rootMetadata = this.repository.metadata;
    const filterableSet = this.filterable ? new Set(this.filterable) : null;
    const sortableSet = this.sortable ? new Set(this.sortable) : null;
    const relationSet = this.allowedRelations
      ? new Set(this.allowedRelations)
      : null;

    const resolveRelationChain = (path: string[]): EntityMetadata | null => {
      let current = rootMetadata;
      for (const segment of path) {
        const relation = current.relations.find(
          (r) => r.propertyName === segment,
        );
        if (!relation) return null;
        current = relation.inverseEntityMetadata;
      }
      return current;
    };

    const isRelationAllowed = (relationPath: string[]): boolean =>
      relationSet === null || relationSet.has(relationPath.join('.'));

    const isVisibleColumn = (
      metadata: EntityMetadata,
      column: string,
    ): boolean => {
      const col = metadata.columns.find((c) => c.propertyName === column);
      // Las columnas select:false (ej. hashes) jamás se exponen a filtros
      return Boolean(col && col.isSelect);
    };

    return {
      isFilterable: (path: string[]): boolean => {
        if (path.length === 0 || path.some((segment) => segment === '')) {
          return false;
        }
        if (filterableSet && !filterableSet.has(path.join('.'))) {
          return false;
        }
        if (path.length === 1) {
          return isVisibleColumn(rootMetadata, path[0]);
        }
        const relationPath = path.slice(0, -1);
        if (!isRelationAllowed(relationPath)) return false;
        const target = resolveRelationChain(relationPath);
        return (
          target !== null && isVisibleColumn(target, path[path.length - 1])
        );
      },

      isSortable: (column: string): boolean => {
        if (sortableSet && !sortableSet.has(column)) return false;
        return isVisibleColumn(rootMetadata, column);
      },

      isRelationPath: (path: string[]): boolean => {
        if (path.length === 0 || path.some((segment) => segment === '')) {
          return false;
        }
        if (!isRelationAllowed(path)) return false;
        return resolveRelationChain(path) !== null;
      },
    };
  }

  private buildPkWhere(pk: unknown): Record<string, unknown> | null {
    const primaryColumns = this.repository.metadata.primaryColumns;
    if (!primaryColumns.length) return null;

    if (primaryColumns.length === 1) {
      const column = primaryColumns[0];
      let value = pk;
      if (typeof pk === 'object' && pk !== null) {
        value = (pk as Record<string, unknown>)[column.propertyName];
      }
      if (value === undefined || value === null) return null;
      return { [column.propertyName]: this.coercePkType(column, value) };
    }

    if (typeof pk !== 'object' || pk === null) return null;
    const where: Record<string, unknown> = {};
    for (const column of primaryColumns) {
      const value = (pk as Record<string, unknown>)[column.propertyName];
      if (value === undefined) return null;
      where[column.propertyName] = this.coercePkType(column, value);
    }
    return where;
  }

  private coercePkType(column: ColumnMetadata, value: unknown): unknown {
    if (value == null || typeof value !== 'string') return value;
    const colType = String(column.type || '').toLowerCase();
    if (/int|numeric|decimal|number|bigint/.test(colType)) {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return value;
  }

  /**
   * Elimina del payload columnas que el cliente no debe controlar:
   * PKs generadas, timestamps automáticos, soft-delete y versión.
   */
  private sanitizeWritePayload(data: DeepPartial<T>): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      ...(data as Record<string, unknown>),
    };
    for (const column of this.repository.metadata.columns) {
      const isProtected =
        column.isGenerated ||
        column.isCreateDate ||
        column.isUpdateDate ||
        column.isDeleteDate ||
        column.isVersion;
      if (isProtected) {
        delete payload[column.propertyName];
      }
    }
    return payload;
  }

  private stampAudit(
    payload: Record<string, unknown>,
    kind: 'created' | 'updated',
  ): void {
    if (!this.auditColumns) return;
    const columnName = this.auditColumns[kind];
    if (!columnName) return;

    const hasColumn = this.repository.metadata.columns.some(
      (c) => c.propertyName === columnName,
    );
    if (!hasColumn) return;

    const userId = RequestContext.userId;
    if (userId === undefined || userId === null) return;

    const numeric = Number(userId);
    payload[columnName] = Number.isFinite(numeric) ? numeric : userId;
  }

  private assertSoftDeleteSupport(): void {
    if (!this.supportsSoftDelete()) {
      throw new MethodNotAllowedException(
        `La entidad ${this.repository.metadata.name} no soporta borrado lógico (falta @DeleteDateColumn)`,
      );
    }
  }

  private buildPaginatedResponse(
    data: T[],
    total: number,
    page: number,
    perPage: number,
  ): PaginatedResponse<T> {
    const effectivePerPage = perPage > 0 ? perPage : total;
    const lastPage =
      effectivePerPage > 0 ? Math.ceil(total / effectivePerPage) || 1 : 1;
    const skip = (page - 1) * effectivePerPage;
    return {
      data,
      total,
      currentPage: page,
      lastPage,
      perPage: effectivePerPage,
      from: total > 0 ? skip + 1 : null,
      to: total > 0 ? skip + data.length : null,
    };
  }
}
