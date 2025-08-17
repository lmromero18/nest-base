// modules/base-http.module.ts
import { Module } from '@nestjs/common';
import { getEnv } from 'src/common/utils/env';
import { Cuenta } from 'src/database/models/cuenta.entity';
import { SaldoCuenta } from 'src/database/models/saldo-cuenta.entity';
import { CuentaController } from 'src/corecustoval/cuenta/cuenta.controller';
import { SaldoCuentaController } from 'src/corecustoval/saldo-cuenta/saldo-cuenta.controller';
import { CuentaService } from 'src/corecustoval/cuenta/cuenta.service';
import { SaldoCuentaService } from 'src/corecustoval/saldo-cuenta/saldo-cuenta.service';
import { CrudModule } from './crud.module';

@Module({
  imports: [
    CrudModule.forFeature({
      entity: Cuenta,
      controller: CuentaController,
      service: CuentaService,
      connectionName: getEnv('DB_NAME'),
    }),
    CrudModule.forFeature({
      entity: SaldoCuenta,
      controller: SaldoCuentaController,
      service: SaldoCuentaService,
      connectionName: getEnv('DB_NAME'),
    }),
  ],
})
export class BaseHttpModule {}
