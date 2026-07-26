import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';
import { getBoolEnv, getEnv, getNumberEnv } from '../../common/utils/env';
import { DATABASE_CONNECTIONS } from './database.constants';

/**
 * Opciones de conexión compartidas entre la app (DatabaseModule) y el CLI de
 * TypeORM (data-source.ts para migraciones).
 */
export const basePostgresOptions = (
  prefix: string,
): Omit<PostgresConnectionOptions, 'entities' | 'migrations'> => ({
  type: 'postgres',
  host: getEnv(`${prefix}_HOST`, 'localhost'),
  port: getNumberEnv(`${prefix}_PORT`, 5432),
  username: getEnv(`${prefix}_USERNAME`, 'postgres'),
  password: getEnv(`${prefix}_PASSWORD`, 'postgres'),
  database: getEnv(`${prefix}_DATABASE`, 'postgres'),
  schema: getEnv(`${prefix}_SCHEMA`, 'public'),
  synchronize: getBoolEnv(`${prefix}_SYNCHRONIZE`),
  logging: getBoolEnv(`${prefix}_LOGGING`),
  ssl: getBoolEnv(`${prefix}_SSL`)
    ? {
        rejectUnauthorized: getBoolEnv(
          `${prefix}_SSL_REJECT_UNAUTHORIZED`,
          true,
        ),
      }
    : false,
  extra: {
    max: getNumberEnv(`${prefix}_POOL_MAX`, 10),
    idleTimeoutMillis: getNumberEnv(`${prefix}_POOL_IDLE_MS`, 30_000),
  },
});

const createPostgresConfig = (
  name: string,
  prefix: string,
): TypeOrmModuleOptions => {
  return {
    name,
    ...basePostgresOptions(prefix),
    autoLoadEntities: true,
  };
};

export const baseDatabaseConfig = (): TypeOrmModuleOptions =>
  createPostgresConfig(DATABASE_CONNECTIONS.BASE, 'DB_BASE');
