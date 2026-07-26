import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { baseDatabaseConfig } from './database.config';
import { DATABASE_CONNECTIONS } from './database.constants';

const connections = [TypeOrmModule.forRoot(baseDatabaseConfig())];

const entityModule = TypeOrmModule.forFeature([], DATABASE_CONNECTIONS.BASE);

@Global()
@Module({
  imports: [...connections, entityModule],
  exports: [entityModule],
})
export class DatabaseModule {}
