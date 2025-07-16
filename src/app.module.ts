import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { Module } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Logger } from './common/services/logger.service';
import { CorecustovalModule } from './corecustoval/corecustoval.module';
import { BaseHttpModule } from './modules/base-http.module';
import { LoggerModule } from './common/modules/logger.module';

@Module({
  imports: [
    CorecustovalModule,
    BaseHttpModule,
    LoggerModule,

  ],
  controllers: [AppController],
  providers: [
    AppService,
  ],
  exports: [
  ],
})
export class AppModule { }
