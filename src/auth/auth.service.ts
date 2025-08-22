import { Injectable, UnauthorizedException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { ClienteService } from './cliente/cliente.service';
import { UsuarioService } from './usuario/usuario.service';
import { Usuario } from './usuario/usuario.entity';
import { IJWT } from './auth.interfaces';

@Injectable()
export class AuthService {
  constructor(
    private usuarioService: UsuarioService,
    private clienteService: ClienteService,
  ) {}

  async signIn(
    username: string,
    contrasena: string,
  ): Promise<{ access_token: string; expires_in: number }> {
    const user = await this.usuarioService.findOneBy('username', username, {
      relations: ['cliente', 'roles', 'roles.permisos'],
    });

    if (user?.contrasena !== contrasena) {
      throw new UnauthorizedException();
    }

    const client = user.clienteId
      ? await this.clienteService.findOne(user.clienteId)
      : user.cliente;

    if (!client) {
      throw new UnauthorizedException();
    }

    // Build scopes from roles' permisos (unique coPermiso strings)
    const scopes: string[] = Array.from(
      new Set(
        (user.roles || [])
          .flatMap((r) => r.permisos || [])
          .map((p) => p.coPermiso)
          .filter((v) => typeof v === 'string'),
      ),
    );

    const { cliente, roles, ...usrBase } = user;

    const usr: Pick<
      Usuario,
      'username' | 'correo' | 'isEmailVerificado' | 'jsonAtributos'
    > = {
      username: usrBase.username,
      correo: usrBase.correo,
      isEmailVerificado: usrBase.isEmailVerificado,
      jsonAtributos: usrBase.jsonAtributos ?? {},
    };

    // Generate token expiration time and issued at
    const ttlSeconds = 60 * 15;
    const now = Math.floor(Date.now() / 1000);
    const exp = now + ttlSeconds;

    const payload: IJWT = {
      sub: user.id,
      aud: String(user.clienteId),
      scp: scopes,
      usr,
      iat: now,
      exp,
    };

    const token = sign(payload, client.secreto, { algorithm: 'HS256' });
    return { access_token: token, expires_in: ttlSeconds };
  }
}
