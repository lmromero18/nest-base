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
import { ClienteController } from './cliente/cliente.controller';
import { UsuarioController } from './usuario/usuario.controller';
import { TokenAcceso } from './token/token-acceso.entity';
import { TokenAccesoService } from './token/token-acceso.service';
import { TokenCleanupService } from './token/token-cleanup.service';

@Module({
  imports: [
    DatabaseModule.forEntities(getEnv('AUTH_DB_NAME'), [
      Usuario,
      Cliente,
      Rol,
      Permiso,
      TokenAcceso,
    ]),
  ],
  controllers: [AuthController, ClienteController, UsuarioController],
  providers: [
    AuthService,
    UsuarioService,
    ClienteService,
    RolService,
    PermisoService,
    TokenAccesoService,
    TokenCleanupService,
  ],
  exports: [
    AuthService,
    UsuarioService,
    ClienteService,
    RolService,
    PermisoService,
    TokenAccesoService,
    TokenCleanupService,
  ],
})
export class AuthModule {}
