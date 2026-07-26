import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { RESPONSE_MESSAGES } from '../constants/response-messages';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { extractAndDecodeToken } from '../utils/token.util';

type RequestWithUser = FastifyRequest & {
  user?: JwtPayload;
};

const ERROR_MAP: Record<string, string> = {
  TOKEN_MISSING: RESPONSE_MESSAGES.AUTH.TOKEN.MISSING,
  TOKEN_INVALID: RESPONSE_MESSAGES.AUTH.TOKEN.INVALID,
  TOKEN_EXPIRED: RESPONSE_MESSAGES.AUTH.TOKEN.EXPIRED,
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    try {
      request.user = extractAndDecodeToken(request);
      return true;
    } catch (error) {
      const message =
        ERROR_MAP[(error as Error).message] ??
        RESPONSE_MESSAGES.AUTH.TOKEN.INVALID;

      throw new UnauthorizedException(message);
    }
  }
}
