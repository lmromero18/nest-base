import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import helmet from '@fastify/helmet';
import { getEnv } from './common/utils/env';
import { Logger as AppLogger } from './common/services/logger.service';
import cookie from '@fastify/cookie';
// HMR declaration must be at top-level
declare const module: any;

const fastifyCorsOptions = {
  origin: true,
  methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE'],
  allowedHeaders: [
    'content-type',
    'authorization',
    'x-enc',
    'x-nonce',
    'x-requested-with',
  ],
  exposedHeaders: ['x-enc', 'x-nonce'],
  credentials: true,
  maxAge: 86400,
};

const bootstrap = async (): Promise<void> => {
  const fastify = new FastifyAdapter({ bodyLimit: 50 * 1024 * 1024 });
  fastify.enableCors(fastifyCorsOptions);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastify,
  );
  // Ensure the app handles shutdown to free the port
  app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  const appLogger = app.get(AppLogger);
  app.useLogger(appLogger);
  await app.register(cookie, {
    parseOptions: {
      sameSite: 'lax',
    },
  });
  await app.register(helmet, {
    contentSecurityPolicy: getEnv('NODE_ENV') === 'production',
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  app.setGlobalPrefix('api');
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  appLogger.info('Bootstrapping application');
  await app.listen(
    Number(process.env.APP_PORT ?? 4000),
    process.env.APP_HOST ?? '127.0.0.1',
  );

  // On HMR rebuild, close the server to ensure the port is released
  if (module?.hot) {
    module.hot.accept();
    module.hot.dispose(async () => {
      await app.close();
    });
  }
};

bootstrap();
