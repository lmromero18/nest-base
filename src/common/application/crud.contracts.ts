export type CrudOrderDirection = 'ASC' | 'DESC';

export interface CrudQuery {
  page?: number;
  perPage?: number;
  filters?: Record<string, unknown>;
  order?: Record<string, CrudOrderDirection>;
  relations?: string[];
  or?: Array<Record<string, unknown>>;
}

export interface CrudResult<T> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
  lastPage: number;
}

export type PaginatedResult<T> = CrudResult<T>;
