import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/guards/auth.guard';
import { LoggerModule } from './common/modules/logger.module';
import { CryptoModule } from './crypto/crypto.module';
import { appDataSourceOptions } from './database/data-source';
import { BaseHttpModule } from './modules/base-http.module';
import { DatabaseModule } from './modules/database.module';

@Module({
  imports: [
    CryptoModule,
    DatabaseModule.forConnections(appDataSourceOptions),
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
export class AppModule { }
