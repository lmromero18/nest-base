import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/guards/auth.guard';
import { LoggerModule } from './common/modules/logger.module';
import { loadDbConfig } from './common/utils/db-config';
import { getEnv } from './common/utils/env';
import { CryptoModule } from './crypto/crypto.module';
import { Carro } from './database/models/carro.entity';
import { BaseHttpModule } from './modules/base-http.module';
import { DatabaseModule } from './modules/database.module';

@Module({
  imports: [
    CryptoModule,
    DatabaseModule.forConnections([
      loadDbConfig('DB_', getEnv('DB_NAME'), [Carro]),
    ]),
    BaseHttpModule,
    LoggerModule,
    AuthModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
  exports: [],
})
export class AppModule {}
