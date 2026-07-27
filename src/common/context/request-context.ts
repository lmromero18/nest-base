import { AsyncLocalStorage } from 'node:async_hooks';
import type { Principal } from '../application/principal';

export interface RequestContextStore {
  principal?: Principal;
  /** @deprecated Use principal; retained for callers that seed the context directly. */
  user?: {
    sub?: string | number;
    aud?: string;
  };
  requestId?: string;
}

const storage = new AsyncLocalStorage<RequestContextStore>();

/**
 * Contexto por request basado en AsyncLocalStorage.
 * Permite que servicios (ej. BaseService para auditoría) accedan al usuario
 * autenticado sin recibir el request por parámetro.
 * Fuera de un request HTTP (crons, seeds) `get()` retorna undefined y los
 * consumidores deben degradar con gracia.
 */
export class RequestContext {
  static run<T>(store: RequestContextStore, fn: () => T): T {
    return storage.run(store, fn);
  }

  static get(): RequestContextStore | undefined {
    return storage.getStore();
  }

  static get principal(): Principal | undefined {
    return storage.getStore()?.principal;
  }

  /** Identificador del usuario autenticado (claim `sub`), si existe. */
  static get userId(): string | number | undefined {
    const store = storage.getStore();
    return store?.principal?.subject ?? store?.user?.sub;
  }

  /** Identificador del cliente/audiencia (claim `aud`), si existe. */
  static get clientId(): string | undefined {
    const store = storage.getStore();
    return store?.principal?.clientId ?? store?.user?.aud;
  }
}
