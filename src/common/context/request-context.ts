import { AsyncLocalStorage } from 'node:async_hooks';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

export interface RequestContextStore {
  user?: JwtPayload;
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

  static get user(): JwtPayload | undefined {
    return storage.getStore()?.user;
  }

  /** Identificador del usuario autenticado (claim `sub`), si existe. */
  static get userId(): string | number | undefined {
    return storage.getStore()?.user?.sub;
  }

  /** Identificador del cliente/audiencia (claim `aud`), si existe. */
  static get clientId(): string | undefined {
    return storage.getStore()?.user?.aud;
  }
}
