import { Injectable } from '@nestjs/common';
import { Usuario } from './usuario.entity';
import { BaseService } from 'src/common/services/base.service';
import { InjectRepository } from '@nestjs/typeorm';
import { getEnv } from 'src/common/utils/env';
import { Repository, FindOneOptions } from 'typeorm';

@Injectable()
export class UsuarioService extends BaseService<Usuario> {
  constructor(
    @InjectRepository(Usuario, getEnv('AUTH_DB_NAME'))
    private readonly usuarioRepository: Repository<Usuario>,
  ) {
    super(usuarioRepository);
  }

  // Single DB query to find by username OR correo
  async findOneByUsernameOrCorreo(
    identifier: string,
    options?: Omit<FindOneOptions<Usuario>, 'where'>,
  ): Promise<Usuario | null> {
    return this.usuarioRepository.findOne({
      where: [{ username: identifier }, { correo: identifier }],
      ...(options || {}),
    });
  }
}
