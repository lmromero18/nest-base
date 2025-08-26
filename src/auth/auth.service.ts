import { Injectable, UnauthorizedException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { ClienteService } from './cliente/cliente.service';
import { UsuarioService } from './usuario/usuario.service';
import { Usuario } from './usuario/usuario.entity';
import { IJWT, ITokenResponse } from './auth.interfaces';
import { Cliente } from './cliente/cliente.entity';
import { TOKEN_SIGN_ALGORITHM } from './auth.constants';
import { TokenAccesoService } from './token/token-acceso.service';
import { TokenAcceso } from './token/token-acceso.entity';

@Injectable()
export class AuthService {
  constructor(
    private usuarioService: UsuarioService,
    private clienteService: ClienteService,
    private tokenAccesoService: TokenAccesoService,
  ) {}

  async signIn(username: string, contrasena: string): Promise<ITokenResponse> {
    // Single DB query: username OR correo using the same input
    const user = await this.usuarioService.findOneByUsernameOrCorreo(username, {
      relations: ['cliente', 'roles', 'roles.permisos'],
    });

    if (user?.contrasena !== contrasena) {
      throw new UnauthorizedException();
    }

    const client = await this.getClientForUser(user);
    if (!client) {
      throw new UnauthorizedException();
    }

    return this.mintToken(user, client);
  }

  async refresh(current: IJWT): Promise<ITokenResponse> {
    const user = await this.usuarioService.findOneBy('id', current.sub, {
      relations: ['cliente', 'roles', 'roles.permisos'],
    });

    if (!user || !user.cliente) {
      throw new UnauthorizedException();
    }

    if (String(user.cliente.id) !== String(current.aud)) {
      throw new UnauthorizedException();
    }

    return this.mintToken(user, user.cliente);
  }

  // Helpers
  private async getClientForUser(user: Usuario): Promise<Cliente | undefined> {
    if (user.cliente) return user.cliente;
    if (user.clienteId) {
      const found = await this.clienteService.findOne(user.clienteId);
      return found ?? undefined;
    }
    return undefined;
  }

  private buildScopes(user: Usuario): string[] {
    return Array.from(
      new Set(
        (user.roles || [])
          .flatMap((r) => r.permisos || [])
          .map((p) => p.codigo)
          .filter((v) => typeof v === 'string'),
      ),
    );
  }

  private buildUser(
    user: Usuario,
  ): Pick<
    Usuario,
    'username' | 'correo' | 'isEmailVerificado' | 'jsonAtributos'
  > {
    const { cliente, roles, ...usrBase } = user;
    return {
      username: usrBase.username,
      correo: usrBase.correo,
      isEmailVerificado: usrBase.isEmailVerificado,
      jsonAtributos: usrBase.jsonAtributos ?? {},
    };
  }

  private async mintToken(
    user: Usuario,
    client: Cliente,
  ): Promise<ITokenResponse> {
    const scopes = this.buildScopes(user);
    const usr = this.buildUser(user);

    const totalMinutes = Math.max(1, Number(client.nuTiempoTokenMin ?? 30));
    const totalSeconds = 60 * totalMinutes;
    const now = Math.floor(Date.now() / 1000);
    const exp = now + totalSeconds;

    // Persist token access record and include its JID in the JWT
    const tokenRecord: TokenAcceso = await this.tokenAccesoService.create({
      usuario: user,
      cliente: client,
      isRevocado: false,
      tsExpiracion: new Date(exp * 1000),
      nuDuracionMin: totalMinutes,
    } as Partial<TokenAcceso>);

    const payload: IJWT = {
      sub: user.id,
      aud: String(user.clienteId ?? client.id),
      scp: scopes,
      usr,
      jit: tokenRecord.jid,
      iat: now,
      exp,
    };

    const token = sign(payload, client.secreto, {
      algorithm: TOKEN_SIGN_ALGORITHM,
    });
    return { access_token: token, expires_in: totalSeconds };
  }
}
