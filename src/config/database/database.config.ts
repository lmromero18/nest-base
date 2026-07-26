import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { getEnv } from '../../common/utils/env';
import { DATABASE_CONNECTIONS } from './database.constants';

const toBoolean = (value: string, defaultValue = false): boolean => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
};

const createPostgresConfig = (
  name: string,
  prefix: string,
): TypeOrmModuleOptions => {
  return {
    name,
    type: 'postgres',
    host: getEnv(`${prefix}_HOST`, 'localhost'),
    port: Number(getEnv(`${prefix}_PORT`, '5432')),
    username: getEnv(`${prefix}_USERNAME`, 'postgres'),
    password: getEnv(`${prefix}_PASSWORD`, 'postgres'),
    database: getEnv(`${prefix}_DATABASE`, 'postgres'),
    schema: getEnv(`${prefix}_SCHEMA`, 'public'),
    autoLoadEntities: true,
    synchronize: toBoolean(getEnv(`${prefix}_SYNCHRONIZE`, 'false')),
    logging: toBoolean(getEnv(`${prefix}_LOGGING`, 'false')),
  };
};

export const sensoDatabaseConfig = (): TypeOrmModuleOptions =>
  createPostgresConfig(DATABASE_CONNECTIONS.BASE, 'DB_BASE');
