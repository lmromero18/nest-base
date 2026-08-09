export type CrudOrderDirection = 'ASC' | 'DESC';

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
  manager?: import('typeorm').EntityManager;
}

export interface CrudQuery {
  page?: number;
  perPage?: number;
  filters?: Record<string, unknown>;
  order?: Record<string, CrudOrderDirection>;
  relations?: string[];
  or?: Array<Record<string, unknown>>;
}
