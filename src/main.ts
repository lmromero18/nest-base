import { NestFactory, Reflector } from '@nestjs/core';
import { ClassSerializerInterceptor } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import helmet from 'helmet';

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
  app.use(helmet());
  app.setGlobalPrefix('api');
  // Enable global serialization so @Exclude/@Expose work on entities
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  await app.listen(
    Number(process.env.APP_PORT ?? 4000),
    process.env.APP_HOST ?? '127.0.0.1',
  );
};

bootstrap();
