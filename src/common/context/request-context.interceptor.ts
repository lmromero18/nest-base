import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import type { JwtPayload } from '../interfaces/jwt-payload.interface';
import type { Principal } from '../application/principal';
import { RequestContext, RequestContextStore } from './request-context';

type RequestWithUser = FastifyRequest & {
  user?: JwtPayload;
};

/**
 * Interceptor global que envuelve la ejecución del handler dentro de
 * RequestContext.run(). Corre después de los guards, por lo que ya dispone
 * del usuario autenticado colocado por JwtAuthGuard en request.user.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const store: RequestContextStore = {
      principal: principalFromJwtPayload(request.user),
      requestId: request.id,
    };

    // La suscripción debe crearse dentro de run() para que AsyncLocalStorage
    // propague el store a todo el pipeline del handler.
    return new Observable((subscriber) => {
      const subscription = RequestContext.run(store, () =>
        next.handle().subscribe(subscriber),
      );
      return () => subscription.unsubscribe();
    });
  }
}

export function principalFromJwtPayload(
  payload: JwtPayload | undefined,
): Principal | undefined {
  const subject = payload?.sub;
  const hasValidSubject =
    (typeof subject === 'string' && subject.trim().length > 0) ||
    (typeof subject === 'number' && Number.isFinite(subject));

  if (!hasValidSubject) {
    return undefined;
  }

  const clientId = payload?.aud;
  return {
    subject,
    ...(typeof clientId === 'string' && clientId ? { clientId } : {}),
  };
}
