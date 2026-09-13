import {
  And,
  Equal,
  FindOperator,
  DeepPartial,
  EntityMetadata,
  FindManyOptions,
  FindOneOptions,
  FindOptionsOrder,
  FindOptionsWhere,
  ObjectLiteral,
  Repository,
} from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { ApplicationException } from '../application/application-error';
import type {
  MutationOptions,
  PaginatedResponse,
} from '../application/crud.contracts';
import { RequestContext } from '../context/request-context';
import {
  ParsedListQuery,
  QuerySchema,
  QueryStringParser,
} from '../query/query-string-parser';

export type {
  MutationOptions,
  PaginatedResponse,
} from '../application/crud.contracts';

/** Equality constraints over root columns; arrays represent alternatives (OR).
 * Operators and relation predicates are deliberately rejected as authority scopes.
 */
export type ScopeWhere<T> = Partial<{
  [K in keyof T]: Extract<T[K], string | number | boolean | Date>;
}>;
export type ScopeOperation =
  | 'find'
  | 'findOne'
  | 'findByPk'
  | 'findOneBy'
  | 'count'
  | 'exists'
  | 'create'
  | 'update'
  | 'delete'
  | 'softDelete'
  | 'restore';
export interface ScopeContext {
  readonly operation: ScopeOperation;
  readonly manager?: MutationOptions['manager'];
}
type ResolvedScope<T> = readonly ScopeWhere<T>[] | undefined;
type ReadOptions<T extends ObjectLiteral> = Omit<FindOneOptions<T>, 'where'> &
  MutationOptions;

type ListFindOptions<T extends ObjectLiteral> = Omit<
  FindManyOptions<T>,
  'where' | 'skip' | 'take' | 'order' | 'relations'
> &
  MutationOptions;

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
  protected readonly maxPerPage: number = 500;
  /** Permite perPage=0 (traer todo). Por defecto se degrada a maxPerPage. */
  protected readonly allowUnpaginated: boolean = true;
  /**
   * Columnas de auditoría estampadas automáticamente (si existen en la entidad)
   * con el usuario del RequestContext. Sobrescribir con null para desactivar.
   */
  protected readonly auditColumns: {
    created: string;
    updated: string;
  } | null = { created: 'idCreado', updated: 'idActualizado' };

  protected readonly requireScope: boolean = false;

  /** Called per operation, never cached. Undefined preserves unscoped behavior. */
  protected buildScope(
    _context: ScopeContext,
  ): ScopeWhere<T> | readonly ScopeWhere<T>[] | undefined {
    void _context;
    return undefined;
  }

  /** Trusted specialization can reject, normalize or inject values before enforcement.
   * Controlled columns are enforced again afterwards; callers cannot bypass them.
   */
  protected prepareMutation(
    data: DeepPartial<T>,
    _context: ScopeContext,
  ): DeepPartial<T> {
    void _context;
    return data;
  }

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
    const scope = this.resolveScope('find', options);
    const parsed = this.parseListQuery(query);
    const { manager: _manager, ...readOptions } = options ?? {};
    void _manager;
    const repository = this.repo(options);
    const findOptions: FindManyOptions<T> = {
      ...readOptions,
      where: this.scopedWhere(
        parsed.where as FindOptionsWhere<T> | FindOptionsWhere<T>[],
        scope,
      ),
      order: parsed.order as FindOptionsOrder<T>,
      relations: parsed.relations,
    };

    if (!parsed.paginate) {
      const data = await repository.find(findOptions);
      return this.buildPaginatedResponse(data, data.length, 1, data.length);
    }

    const skip = (parsed.page - 1) * parsed.perPage;
    const [data, total] = await repository.findAndCount({
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
    options?: Omit<ReadOptions<T>, 'relations'>,
  ): Promise<T | null> {
    const relations = filters.with
      ? this.parseListQuery({ with: filters.with }).relations
      : undefined;
    const scope = this.resolveScope('findOne', options);
    const where = this.buildPkWhere(id);
    if (!where) return null;
    return this.readScoped(
      where as FindOptionsWhere<T>,
      { ...options, relations },
      scope,
    );
  }

  /**
   * Buscador genérico por PK. Acepta primitivo (PK simple) u objeto
   * { pk1: v1, pk2: v2 } (PK compuesta). Coerce string→number en PKs numéricas.
   */
  async findByPk(
    pkValue: unknown,
    options?: ReadOptions<T>,
  ): Promise<T | null> {
    const scope = this.resolveScope('findByPk', options);
    const where = this.buildPkWhere(pkValue);
    if (!where) return null;
    return this.readScoped(where as FindOptionsWhere<T>, options, scope);
  }

  /** Busca un registro por una columna específica. */
  async findOneBy<K extends keyof T>(
    column: K,
    value: T[K],
    options?: ReadOptions<T>,
  ): Promise<T | null> {
    const where = {
      [column as string]: value,
    } as unknown as FindOptionsWhere<T>;
    return this.readScoped(
      where,
      options,
      this.resolveScope('findOneBy', options),
    );
  }

  /** Total de registros que cumplen los filtros del query-string. */
  async count(
    query: Record<string, unknown> = {},
    options?: MutationOptions,
  ): Promise<number> {
    const parsed = this.parseListQuery(query);
    return this.repo(options).count({
      where: this.scopedWhere(
        parsed.where as FindOptionsWhere<T> | FindOptionsWhere<T>[],
        this.resolveScope('count', options),
      ),
    });
  }

  /** ¿Existe al menos un registro que cumpla los filtros? */
  async exists(
    query: Record<string, unknown> = {},
    options?: MutationOptions,
  ): Promise<boolean> {
    const parsed = this.parseListQuery(query);
    return this.repo(options).exists({
      where: this.scopedWhere(
        parsed.where as FindOptionsWhere<T> | FindOptionsWhere<T>[],
        this.resolveScope('exists', options),
      ),
    });
  }

  // --- Escritura ------------------------------------------------------------

  /**
   * Crea un registro. Las columnas generadas (PK autoincremental/uuid) y las
   * de timestamps/soft-delete se descartan del payload: el cliente nunca
   * puede fijarlas (evita sobrescrituras vía POST con id existente).
   */
  async create(data: DeepPartial<T>, options?: MutationOptions): Promise<T> {
    const scope = this.resolveScope('create', options);
    const repo = this.repo(options);
    const payload = this.mutationPayload(data, 'create', options, scope);
    this.stampAudit(payload, 'created');
    this.enforceScopeValues(payload, scope, 'create');
    const entity = repo.create(payload as DeepPartial<T>);
    if (!scope) return repo.save(entity);
    // INSERT, never save/upsert: caller-supplied natural keys cannot update another row.
    const result = await repo.insert(entity);
    return Object.assign(
      entity,
      result.generatedMaps[0],
      result.identifiers[0],
    );
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
    const scope = this.resolveScope('update', options);
    const repo = this.repo(options);
    const pkWhere = this.buildPkWhere(pk);
    if (!pkWhere) return null;
    if (scope)
      return this.updateScoped(
        pkWhere as FindOptionsWhere<T>,
        data,
        options,
        scope,
      );

    const payload = this.mutationPayload(data, 'update', options, scope);
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
    const scope = this.resolveScope('update', options);
    const where = { [column as string]: value } as FindOptionsWhere<T>;
    if (scope) return this.updateScoped(where, data, options, scope);
    const entity = await this.repo(options).findOne({ where });
    if (!entity) return null;
    return this.updateByPk(entity, data, options);
  }

  /** Borrado físico por PK. Retorna false si no existía. */
  async removeByPk(pk: unknown, options?: MutationOptions): Promise<boolean> {
    const scope = this.resolveScope('delete', options);
    const where = this.buildPkWhere(pk);
    if (!where) return false;
    const result = await this.repo(options).delete(
      this.scopedWhere(where as FindOptionsWhere<T>, scope),
    );
    return (result.affected ?? 0) > 0;
  }

  /** Busca por una columna única (no PK) y elimina usando la PK real. */
  async removeByUniqueColumn<K extends keyof T>(
    column: K,
    value: T[K],
    options?: MutationOptions,
  ): Promise<boolean> {
    const scope = this.resolveScope('delete', options);
    const where = { [column as string]: value } as FindOptionsWhere<T>;
    if (scope) {
      const result = await this.repo(options).delete(
        this.scopedWhere(where, scope),
      );
      return (result.affected ?? 0) > 0;
    }
    const entity = await this.repo(options).findOne({ where });
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
    const scope = this.resolveScope('softDelete', options);
    this.assertSoftDeleteSupport();
    const where = this.buildPkWhere(pk);
    if (!where) return false;
    const result = await this.repo(options).softDelete(
      this.scopedWhere(where as FindOptionsWhere<T>, scope),
    );
    return (result.affected ?? 0) > 0;
  }

  /** Restaura un registro borrado lógicamente. Retorna false si no aplicó. */
  async restoreByPk(pk: unknown, options?: MutationOptions): Promise<boolean> {
    const scope = this.resolveScope('restore', options);
    this.assertSoftDeleteSupport();
    const where = this.buildPkWhere(pk);
    if (!where) return false;
    const result = await this.repo(options).restore(
      this.scopedWhere(where as FindOptionsWhere<T>, scope),
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

  private resolveScope(
    operation: ScopeOperation,
    options?: MutationOptions,
  ): ResolvedScope<T> {
    const raw = this.buildScope({ operation, manager: options?.manager });
    if (raw === undefined) {
      if (this.requireScope)
        throw new ApplicationException(
          'validation',
          'scope-required',
          'Operation requires a scope',
        );
      return undefined;
    }
    const branches: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
    if (!branches.length || branches.length > 64) this.invalidScope();
    return branches.map((branch) => {
      if (
        !branch ||
        Object.getPrototypeOf(branch) !== Object.prototype ||
        !Object.keys(branch).length
      )
        this.invalidScope();
      const copy: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(
        branch as Record<string, unknown>,
      )) {
        const column = this.repository.metadata.columns.find(
          (c) => c.propertyName === key,
        );
        if (
          !column ||
          column.isVersion ||
          column.isUpdateDate ||
          column.isDeleteDate ||
          column.relationMetadata ||
          ['__proto__', 'prototype', 'constructor'].includes(key) ||
          !(
            typeof value === 'string' ||
            typeof value === 'boolean' ||
            (typeof value === 'number' && Number.isFinite(value)) ||
            (value instanceof Date && Number.isFinite(value.getTime()))
          )
        )
          this.invalidScope();
        copy[key] = value instanceof Date ? new Date(value) : value;
      }
      return Object.freeze(copy) as ScopeWhere<T>;
    });
  }

  private invalidScope(): never {
    throw new ApplicationException(
      'validation',
      'invalid-scope',
      'Scope must contain non-empty alternatives of root-column equalities',
    );
  }

  private scopedWhere(
    where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
    scope: ResolvedScope<T>,
  ): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
    if (!scope) return where;
    const caller = Array.isArray(where) ? where : [where];
    if (!caller.length || caller.length * scope.length > 256)
      this.invalidScope();
    const result = caller.flatMap((branch) =>
      scope.map((constraints) => {
        const merged = { ...branch } as Record<string, unknown>;
        for (const [key, value] of Object.entries(constraints)) {
          const previous = merged[key];
          // Preserve both predicates, including a conflicting caller equality.
          merged[key] =
            previous === undefined || previous === null
              ? Equal(value)
              : And(
                  Equal(value),
                  previous instanceof FindOperator ? previous : Equal(previous),
                );
        }
        return merged as FindOptionsWhere<T>;
      }),
    );
    return result.length === 1 ? result[0] : result;
  }

  private readScoped(
    where: FindOptionsWhere<T>,
    options: ReadOptions<T> | undefined,
    scope: ResolvedScope<T>,
  ): Promise<T | null> {
    const { manager: _manager, ...readOptions } = options ?? {};
    void _manager;
    return this.repo(options).findOne({
      ...readOptions,
      where: this.scopedWhere(where, scope),
    });
  }

  private mutationPayload(
    data: DeepPartial<T>,
    operation: 'create' | 'update',
    options: MutationOptions | undefined,
    scope: ResolvedScope<T>,
  ): Record<string, unknown> {
    const prepared = this.prepareMutation(
      { ...data },
      { operation, manager: options?.manager },
    );
    const payload = this.sanitizeWritePayload(prepared);
    if (scope) {
      for (const relation of this.repository.metadata.relations) {
        if (
          Object.prototype.hasOwnProperty.call(payload, relation.propertyName)
        ) {
          throw new ApplicationException(
            'unsupported',
            'scoped-relation-write',
            'Scoped graph writes require an explicit application operation',
          );
        }
      }
      if (operation === 'update') {
        for (const column of this.repository.metadata.primaryColumns)
          delete payload[column.propertyName];
      }
    }
    this.enforceScopeValues(payload, scope, operation);
    return payload;
  }

  private enforceScopeValues(
    payload: Record<string, unknown>,
    scope: ResolvedScope<T>,
    operation: 'create' | 'update',
  ): void {
    if (!scope) return;
    const same = (a: unknown, b: unknown) =>
      a instanceof Date && b instanceof Date
        ? a.getTime() === b.getTime()
        : Object.is(a, b);
    const keys = new Set(scope.flatMap((branch) => Object.keys(branch)));
    for (const key of keys) {
      const first: unknown = (scope[0] as Record<string, unknown>)[key];
      if (
        scope.every(
          (branch) =>
            Object.hasOwn(branch, key) &&
            same((branch as Record<string, unknown>)[key], first),
        )
      ) {
        payload[key] = first instanceof Date ? new Date(first) : first;
      } else if (operation === 'update' && Object.hasOwn(payload, key)) {
        throw new ApplicationException(
          'validation',
          'scope-field-write',
          'Cannot reassign a scoped column across alternatives',
        );
      }
    }
    if (
      operation === 'create' &&
      !scope.some((branch) =>
        Object.entries(branch).every(([key, value]) =>
          same(payload[key], value),
        ),
      )
    ) {
      throw new ApplicationException(
        'validation',
        'scope-create-mismatch',
        'Creation must satisfy an explicit scope alternative',
      );
    }
  }

  private async updateScoped(
    where: FindOptionsWhere<T>,
    data: DeepPartial<T>,
    options: MutationOptions | undefined,
    scope: readonly ScopeWhere<T>[],
  ): Promise<T | null> {
    const repo = this.repo(options);
    const payload = this.mutationPayload(data, 'update', options, scope);
    this.stampAudit(payload, 'updated');
    this.enforceScopeValues(payload, scope, 'update');
    const scoped = this.scopedWhere(where, scope);
    const current = await repo.findOne({ where: scoped });
    if (!current) return null;
    const pk = this.buildPkWhere(current);
    if (!pk) return null;
    // Scope remains in the write predicate: a pre-read is not authorization.
    const guarded = this.scopedWhere({ ...where, ...pk }, scope);
    const result = await repo.update(
      guarded,
      payload as Parameters<Repository<T>['update']>[1],
    );
    if (!result.affected) return null;
    return repo.findOne({
      where: this.scopedWhere(pk as FindOptionsWhere<T>, scope),
    });
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

    const userId = RequestContext.principal?.subject ?? RequestContext.userId;
    if (userId === undefined || userId === null) return;

    const numeric = Number(userId);
    payload[columnName] = Number.isFinite(numeric) ? numeric : userId;
  }

  private assertSoftDeleteSupport(): void {
    if (!this.supportsSoftDelete()) {
      throw new ApplicationException(
        'unsupported',
        'soft-delete-not-supported',
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
