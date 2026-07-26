import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { WinstonModule } from 'nest-winston';
import * as pg from 'pg';
import { AppModule } from './app.module';
import { winstonLoggerOptions } from './common/logger/winston-logger.config';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { getEnv } from './common/utils/env';

// Configurar pg para parsear bigint (int8) y numeric a números de JS
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10)); // OID 20: bigint
pg.types.setTypeParser(1700, (val: string) => parseFloat(val)); // OID 1700: numeric


async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    {
      logger: WinstonModule.createLogger(winstonLoggerOptions),
    },
  );

  app.setGlobalPrefix('api');

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalFilters(new HttpExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: true,
    credentials: true,
  });

  const port = Number(getEnv('PORT', '3000'));

  await app.listen(port, '0.0.0.0');

  Logger.log(
    `${getEnv('APP_NAME', 'Application')} running on http://localhost:${port}`,
    'Bootstrap',
  );
}

bootstrap();
