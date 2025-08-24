import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/guards/auth.guard';
import { LoggerModule } from './common/modules/logger.module';
import { CryptoModule } from './crypto/crypto.module';
import { appDataSourceOptions } from './database/data-source';
import { BaseHttpModule } from './modules/base-http.module';
import { DatabaseModule } from './modules/database.module';
import { ClienteFilterMiddleware } from './common/middlewares/client-filter.middleware';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    CryptoModule,
    DatabaseModule.forConnections(appDataSourceOptions),
    BaseHttpModule,
    LoggerModule,
    ScheduleModule.forRoot(),
    AuthModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    ClienteFilterMiddleware,
  ],
  exports: [],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(ClienteFilterMiddleware)
      .exclude({ path: 'auth/login', method: RequestMethod.POST })
      .forRoutes({ path: 'api/*path', method: RequestMethod.ALL });
  }
}

