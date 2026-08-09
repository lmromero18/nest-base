import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, JwtVerifyOptions } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { RESPONSE_MESSAGES } from '../constants/response-messages';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { getEnv } from '../utils/env';
import { extractBearerToken } from '../utils/token.util';

type RequestWithUser = FastifyRequest & {
  user?: JwtPayload;
};

const ASYMMETRIC_ALGORITHMS: JwtVerifyOptions['algorithms'] = [
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
];

const SYMMETRIC_ALGORITHMS: JwtVerifyOptions['algorithms'] = [
  'HS256',
  'HS384',
  'HS512',
];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly verifyOptions: JwtVerifyOptions | null;

  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
  ) {
    this.verifyOptions = buildVerifyOptions();

    if (!this.verifyOptions) {
      const message = RESPONSE_MESSAGES.AUTH.TOKEN.CONFIG_MISSING;
      if (getEnv('NODE_ENV') === 'production') {
        // Fail-fast: en producción nunca se debe arrancar sin poder verificar tokens
        throw new Error(message);
      }
      this.logger.error(
        `${message}. Las rutas protegidas responderán 503 hasta configurarla.`,
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();

    let token: string;
    try {
      token = extractBearerToken(request.headers.authorization);
    } catch {
      throw new UnauthorizedException(RESPONSE_MESSAGES.AUTH.TOKEN.MISSING);
    }

    if (!this.verifyOptions) {
      throw new ServiceUnavailableException(
        RESPONSE_MESSAGES.AUTH.TOKEN.CONFIG_MISSING,
      );
    }

    try {
      request.user = this.jwtService.verify<JwtPayload>(
        token,
        this.verifyOptions,
      );
      return true;
    } catch (error) {
      const name = (error as Error)?.name;
      const message =
        name === 'TokenExpiredError'
          ? RESPONSE_MESSAGES.AUTH.TOKEN.EXPIRED
          : RESPONSE_MESSAGES.AUTH.TOKEN.INVALID;
      throw new UnauthorizedException(message);
    }
  }
}

/**
 * Resuelve la clave de verificación desde el entorno:
 * - JWT_PUBLIC_KEY (PEM, admite saltos de línea escapados como \n) → RS/ES
 * - JWT_SECRET → HS
 */
function buildVerifyOptions(): JwtVerifyOptions | null {
  const publicKey = getEnv('JWT_PUBLIC_KEY').replace(/\\n/g, '\n').trim();
  if (publicKey) {
    return { publicKey, algorithms: ASYMMETRIC_ALGORITHMS };
  }

  const secret = getEnv('JWT_SECRET').trim();
  if (secret) {
    return { secret, algorithms: SYMMETRIC_ALGORITHMS };
  }

  return null;
}
