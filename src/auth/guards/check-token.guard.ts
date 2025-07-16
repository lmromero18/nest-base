import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import axios from 'axios';
import { IS_PUBLIC_KEY } from '../public.decorator';
import { getEnv } from 'src/common/utils/env';
import { Logger } from 'src/common/services/logger.service';

@Injectable()
export class CheckTokenGuard implements CanActivate {
  constructor(private reflector: Reflector) { }


  async canActivate(context: ExecutionContext): Promise<boolean> {
    const logger = new Logger();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      throw new UnauthorizedException('Unauthenticated.');
    }

    try {
      const authApiUrl = getEnv('URL_AUTH_API');
      const response = await axios.get(`${authApiUrl}/api/v3/auth/user/sesion/check`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        validateStatus: () => true,
      });

      if (!response.data?.available) {
        throw new UnauthorizedException('Token inválido.');
      }

      return true;
    } catch {
      throw new UnauthorizedException('Error validando token.');
    }
  }
}
