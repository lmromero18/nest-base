// main.ts
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import helmet from 'helmet';

const fastifyCorsOptions = {
  origin: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
  allowedHeaders: [
    'content-type',
    'authorization',
    'x-enc',       // 👈 importante
    'x-nonce',     // 👈 importante
    'x-requested-with',
  ],
  exposedHeaders: [
    'x-enc',       // 👈 cliente las leerá
    'x-nonce',     // 👈
  ],
  credentials: true,
  maxAge: 86400,
};

const bootstrap = async (): Promise<void> => {
  const fastify = new FastifyAdapter({ bodyLimit: 50 * 1024 * 1024 });
  fastify.enableCors(fastifyCorsOptions);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, fastify);
  app.use(helmet());
  app.setGlobalPrefix('api');

  await app.listen(Number(process.env.APP_PORT ?? 3000), process.env.APP_HOST ?? '127.0.0.1');
};

bootstrap();
