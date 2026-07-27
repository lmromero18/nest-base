import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
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
      user: request.user,
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
