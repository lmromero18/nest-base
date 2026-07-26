import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { sensoDatabaseConfig } from './database.config';
import { DATABASE_CONNECTIONS } from './database.constants';

const connections = [TypeOrmModule.forRoot(sensoDatabaseConfig())];

const entityModule = TypeOrmModule.forFeature(
  [],
  DATABASE_CONNECTIONS.BASE,
);

@Global()
@Module({
  imports: [...connections, entityModule],
  exports: [entityModule],
})
export class DatabaseModule {}
