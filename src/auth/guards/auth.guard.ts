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
import { ClienteService } from '../cliente/cliente.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private usuarioService: UsuarioService,
    private clienteService: ClienteService,
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
      // Decode first to figure out which secret to use (per-tenant/client)
      const decoded: any = decode(token);
      if (!decoded || typeof decoded !== 'object' || !decoded.sub) {
        throw new UnauthorizedException();
      }

      const userId = decoded.sub;
      // Load user to obtain its client id, then load client to get its secret
      const user = await this.usuarioService.findOne(userId);
      const client = await this.clienteService.findOne((user as any).clienteId);

      if (!client) {
        throw new UnauthorizedException();
      }

      const payload = verify(token, client.secreto);

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
