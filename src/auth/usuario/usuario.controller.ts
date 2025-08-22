import { Controller } from '@nestjs/common';
import { BaseController } from 'src/common/controllers/base.controller';
import { UsuarioService } from './usuario.service';
import { Usuario } from './usuario.entity';

@Controller('auth/usuario')
export class UsuarioController extends BaseController<Usuario> {
  constructor(private readonly usuarioService: UsuarioService) {
    super(usuarioService);
  }
}
