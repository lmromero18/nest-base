import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { decode, verify } from 'jsonwebtoken';
import { Request } from 'express';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth.decorator';
import { TokenAccesoService } from '../token/token-acceso.service';
// ClienteService no longer needed; client is loaded via user relation

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private tokenAccesoService: TokenAccesoService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    // Track decoded payload and token record for potential revocation on failure
    let decoded: any;
    let tokenAcceso: any = null;
    try {
      // Decode unverified to fetch JID (jit)
      decoded = decode(token);
      if (!decoded || typeof decoded !== 'object' || !decoded.jit) {
        throw new UnauthorizedException();
      }

      // Single lookup: load token record with its client to get the secret
      tokenAcceso = await this.tokenAccesoService.findOneBy(
        'jid',
        decoded.jit,
        {
          relations: ['cliente'],
        },
      );

      if (!tokenAcceso || tokenAcceso.isRevocado) {
        throw new UnauthorizedException();
      }

      // Optional: enforce DB expiration too
      if (
        tokenAcceso.tsExpiracion &&
        tokenAcceso.tsExpiracion.getTime() <= Date.now()
      ) {
        throw new UnauthorizedException();
      }

      const clientSecret = tokenAcceso.cliente?.secreto;
      if (!clientSecret) {
        throw new UnauthorizedException();
      }

      const payload: any = verify(token, clientSecret);

      // Integrity checks: sub and aud must match the DB record
      if (
        String(payload.sub) !== String(tokenAcceso.usuarioId) ||
        String(payload.aud) !== String(tokenAcceso.clienteId)
      ) {
        throw new UnauthorizedException();
      }

      request['user'] = payload;
    } catch {
      // Best-effort: revoke the token record if available or by jit
      try {
        if (tokenAcceso && tokenAcceso.jid && !tokenAcceso.isRevocado) {
          await this.tokenAccesoService.revokeByJid(tokenAcceso.jid);
        } else if (decoded && decoded.jit) {
          await this.tokenAccesoService.revokeByJid(decoded.jit);
        }
      } catch {}
      throw new UnauthorizedException();
    }

    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    if (type === 'Bearer' && token) return token;
    const cookieToken = (request as any).cookies?.['access_token'];
    return cookieToken;
  }
}
