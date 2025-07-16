import { Module } from '@nestjs/common';
import { DatabaseModule } from 'src/modules/database.module';
import { getEnv } from 'src/common/utils/env';
import { CuentaController } from 'src/corecustoval/cuenta/cuenta.controller';
import { CuentaService } from 'src/corecustoval/cuenta/cuenta.service';
import { Cuenta } from 'src/database/models/cuenta.entity';
import { SaldoCuenta } from 'src/database/models/saldo-cuenta.entity';
import { SaldoCuentaController } from 'src/corecustoval/saldo-cuenta/saldo-cuenta.controller';
import { SaldoCuentaService } from 'src/corecustoval/saldo-cuenta/saldo-cuenta.service';

@Module({
    imports: [
        DatabaseModule.forEntities(getEnv('DB_NAME'), [Cuenta, SaldoCuenta]),
    ],
    controllers: [
        CuentaController,
        SaldoCuentaController
    ],
    providers: [
        CuentaService,
        SaldoCuentaService
    ],
})
export class BaseHttpModule { }
