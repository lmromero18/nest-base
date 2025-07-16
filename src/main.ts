import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { Logger } from './common/services/logger.service';

declare const module: any;

async function bootstrap() {

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      bodyLimit: 5242880000,
    }),
    {
      logger: new Logger(),
    }
  );

  app.setGlobalPrefix('api');

  await app.listen(
    Number(process.env.APP_PORT ?? 3000),
    process.env.APP_HOST ?? '127.0.0.1'
  );


  if (module.hot) {
    module.hot.accept();
    module.hot.dispose(() => app.close());
  }
}
bootstrap();
