import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from '@fastify/helmet';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import * as pg from 'pg';
import { version } from '../package.json';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { getEnv } from './common/utils/env';

// bigint y numeric llegan como string desde pg; se parsean a number asumiendo
// que no se manejan valores > 2^53 ni montos que requieran precisión decimal exacta
pg.types.setTypeParser(20, (val: string) => parseInt(val, 10)); // OID 20: bigint
pg.types.setTypeParser(1700, (val: string) => parseFloat(val)); // OID 1700: numeric

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    {
      bufferLogs: true,
    },
  );

  // Instancia única de winston (la provee AppLoggerModule)
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  app.flushLogs();

  // Swagger UI usa scripts inline; con CSP activo no carga
  await app.register(helmet, { contentSecurityPolicy: false });

  app.setGlobalPrefix('api');

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const corsOrigins = getEnv('CORS_ORIGINS')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    // Sin CORS_ORIGINS: abierto en desarrollo, cerrado en producción
    origin:
      corsOrigins.length > 0
        ? corsOrigins
        : getEnv('NODE_ENV') !== 'production',
    credentials: true,
  });

  app.enableShutdownHooks();

  const swaggerEnabled =
    getEnv(
      'SWAGGER_ENABLED',
      getEnv('NODE_ENV') === 'production' ? 'false' : 'true',
    ) === 'true';

  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle(getEnv('APP_NAME', 'NEST-BASE'))
      .setDescription(
        'API basada en la librería CRUD genérica (BaseService + CrudControllerFactory). ' +
          'Los listados aceptan filtros dinámicos: campo=valor, campo_like, campo_gte, ' +
          'campo_lte, campo_between, campo_null, campo_not, relacion.campo, with, orderBy, or.',
      )
      .setVersion(version)
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  const port = Number(getEnv('PORT', '3000'));

  await app.listen(port, '0.0.0.0');

  Logger.log(
    `${getEnv('APP_NAME', 'Application')} running on http://localhost:${port}`,
    'Bootstrap',
  );

  if (swaggerEnabled) {
    Logger.log(`Swagger UI en http://localhost:${port}/docs`, 'Bootstrap');
  }
}

bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    'Bootstrap',
  );
  process.exit(1);
});
