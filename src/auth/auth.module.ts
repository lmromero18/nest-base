import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseModule } from 'src/modules/database.module';
import { getEnv } from 'src/common/utils/env';
import { Usuario } from './usuario/usuario.entity';
import { Cliente } from './cliente/cliente.entity';
import { Rol } from './rol/rol.entity';
import { Permiso } from './permiso/permiso.entity';
import { UsuarioService } from './usuario/usuario.service';
import { ClienteService } from './cliente/cliente.service';
import { RolService } from './rol/rol.service';
import { PermisoService } from './permiso/permiso.service';

@Module({
  imports: [
    DatabaseModule.forEntities(getEnv('AUTH_DB_NAME'), [
      Usuario,
      Cliente,
      Rol,
      Permiso,
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    UsuarioService,
    ClienteService,
    RolService,
    PermisoService,
  ],
  exports: [
    AuthService,
    UsuarioService,
    ClienteService,
    RolService,
    PermisoService,
  ],
})
export class AuthModule {}
