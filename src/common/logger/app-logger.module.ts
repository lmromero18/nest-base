import { Module } from '@nestjs/common';
import { WinstonModule } from 'nest-winston';
import { winstonLoggerOptions } from './winston-logger.config';

@Module({
  imports: [WinstonModule.forRoot(winstonLoggerOptions)],
})
export class AppLoggerModule {}
