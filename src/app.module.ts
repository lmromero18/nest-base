import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppLoggerModule } from './common/logger/app-logger.module';
import { RequestContextInterceptor } from './common/context/request-context.interceptor';
import { DatabaseModule } from './config/database/database.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { getEnv } from './common/utils/env';
import { HealthModule } from './modules/health/health.module';
import { LoginModule } from './modules/login/login.module';
import { NotificationModule } from './modules/notification/notification.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    // JwtAuthGuard resuelve la clave por llamada; el registro global solo expone JwtService
    JwtModule.register({ global: true }),

    ScheduleModule.forRoot(),

    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: Number(getEnv('THROTTLE_TTL_MS', '60000')),
          limit: Number(getEnv('THROTTLE_LIMIT', '100')),
        },
      ],
    }),

    AppLoggerModule,

    DatabaseModule,

    HealthModule,

    LoginModule,

    NotificationModule,
  ],
  providers: [
    // El orden importa: primero rate limiting, luego autenticación
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },
  ],
})
export class AppModule {}
