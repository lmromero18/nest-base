import { Injectable, UnauthorizedException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { ClienteService } from './cliente/cliente.service';
import { UsuarioService } from './usuario/usuario.service';

@Injectable()
export class AuthService {
  constructor(
    private usuarioService: UsuarioService,
    private clienteService: ClienteService,
  ) {}

  async signIn(
    username: string,
    contrasena: string,
  ): Promise<{ access_token: string }> {
    const user = await this.usuarioService.findOneBy('username', username);
    if (user?.contrasena !== contrasena) {
      throw new UnauthorizedException();
    }

    const client = await this.clienteService.findOne(user.clienteId);

    if (!client) {
      throw new UnauthorizedException();
    }

    const payload = { username: user.username, sub: user.id };
    const token = sign(payload, client.secreto, { expiresIn: '60s' });
    return { access_token: token };
  }
}
