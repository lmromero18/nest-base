import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerModule } from './common/modules/logger.module';
import { loadDbConfig } from './common/utils/db-config';
import { getEnv } from './common/utils/env';
import { Cuenta } from './database/models/cuenta.entity';
import { SaldoCuenta } from './database/models/saldo-cuenta.entity';
import { BaseHttpModule } from './modules/base-http.module';
import { DatabaseModule } from './modules/database.module';
import { CryptoModule } from './crypto/crypto.module';

@Module({
  imports: [
    CryptoModule,
    DatabaseModule.forConnections([
      loadDbConfig('DB_', getEnv('DB_NAME'), [Cuenta, SaldoCuenta]),
    ]),
    BaseHttpModule,
    LoggerModule,

  ],
  controllers: [AppController],
  providers: [
    AppService,
  ],
  exports: [
  ],
})
export class AppModule { }
