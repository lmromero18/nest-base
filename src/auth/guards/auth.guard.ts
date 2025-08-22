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
import { UsuarioService } from '../usuario/usuario.service';
// ClienteService no longer needed; client is loaded via user relation

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private usuarioService: UsuarioService,
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

    try {
      // Decode unverified to discover aud (clienteId) and sub (user id)
      const decoded: any = decode(token);
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        !decoded.sub ||
        !decoded.aud
      ) {
        throw new UnauthorizedException();
      }

      const userId = decoded.sub;
      const clienteId = decoded.aud;

      // Prefer verifying with client secret via user lookup only once
      const userWithClient = await this.usuarioService.findOneBy('id', userId, {
        relations: ['cliente'],
      });

      if (
        !userWithClient ||
        !userWithClient.cliente ||
        String(userWithClient.cliente.id) !== String(clienteId)
      ) {
        throw new UnauthorizedException();
      }

      const clientSecret = userWithClient.cliente.secreto;
      const payload = verify(token, clientSecret);

      // Attach payload as user; keep aud/sub/scp/usr
      request['user'] = payload;
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
