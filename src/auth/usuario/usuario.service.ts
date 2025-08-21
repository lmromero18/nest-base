import { Injectable } from '@nestjs/common';
import { Usuario } from './usuario.entity';
import { BaseService } from 'src/common/services/base.service';
import { InjectRepository } from '@nestjs/typeorm';
import { getEnv } from 'src/common/utils/env';
import { Repository } from 'typeorm';

@Injectable()
export class UsuarioService extends BaseService<Usuario> {
  constructor(
    @InjectRepository(Usuario, getEnv('AUTH_DB_NAME'))
    private readonly usuarioRepository: Repository<Usuario>,
  ) {
    super(usuarioRepository);
  }
}
