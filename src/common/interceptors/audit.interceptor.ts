import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

type RequestWithUser = FastifyRequest & {
  user?: JwtPayload;
  body?: Record<string, unknown>;
};

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    const method = request.method;

    // Si no hay usuario autenticado o no hay body, no se hace nada
    if (!user || !request.body) {
      return next.handle();
    }

    const sub = user.sub;
    if (sub === undefined || sub === null) {
      return next.handle();
    }

    const userId = Number(sub);

    if (method === 'POST') {
      request.body.idCreado = userId;
    } else if (method === 'PATCH') {
      request.body.idActualizado = userId;
    }

    return next.handle();
  }
}
