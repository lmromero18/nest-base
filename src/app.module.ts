import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppLoggerModule } from './common/logger/app-logger.module';
import { DatabaseModule } from './config/database/database.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { HealthModule } from './modules/health/health.module';
import { LoginModule } from './modules/login/login.module';@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),

    AppLoggerModule,

    DatabaseModule,

    HealthModule,

    LoginModule,

    // CampamentosModule, // TODO: create src/modules/campamentos/campamentos.module.ts
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
