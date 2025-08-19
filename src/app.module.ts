import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LoggerModule } from './common/modules/logger.module';
import { loadDbConfig } from './common/utils/db-config';
import { getEnv } from './common/utils/env';
import { BaseHttpModule } from './modules/base-http.module';
import { DatabaseModule } from './modules/database.module';
import { CryptoModule } from './crypto/crypto.module';
import { Carro } from './database/models/carro.entity';

@Module({
  imports: [
    CryptoModule,
    DatabaseModule.forConnections([
      loadDbConfig('DB_', getEnv('DB_NAME'), [Carro]),
    ]),
    BaseHttpModule,
    LoggerModule,
  ],
  controllers: [AppController],
  providers: [AppService],
  exports: [],
})
export class AppModule {}
