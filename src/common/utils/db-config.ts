import { DataSourceOptions } from 'typeorm';
import { getEnv } from '../utils/env';

export type DbConnName = string;

export interface DbEnvConfig {
  name: DbConnName;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  schema?: string;
  prefix?: string;
  logging?: boolean;
  synchronize?: boolean;
  migrations: string[];
  entities: string[];
}

export function loadDbConfig(
  prefix: string,
  name: string,
  migrationsPath: string,
  entitiesPath: string,
): DbEnvConfig {
  return {
    name,
    host: getEnv(`${prefix}HOST`),
    port: parseInt(getEnv(`${prefix}PORT`)),
    username: getEnv(`${prefix}USERNAME`),
    password: getEnv(`${prefix}PASSWORD`),
    database: getEnv(`${prefix}DATABASE`),
    schema: getEnv(`${prefix}SCHEMA`),
    prefix: getEnv(`${prefix}PREFIX`, ''),
    logging: getEnv(`${prefix}LOGGING`, 'false') === 'true',
    synchronize: getEnv(`${prefix}SYNCHRONIZE`, 'false') === 'true',
    migrations: [migrationsPath],
    entities: [entitiesPath],
  };
}

export function createDataSourceOptions(
  baseConfig: any,
  type?: 'postgres' | 'mysql' | 'sqlite',
): DataSourceOptions {
  return {
    name: baseConfig.name,
    type: type ?? 'postgres',
    host: baseConfig.host,
    port: baseConfig.port,
    username: baseConfig.username,
    password: baseConfig.password,
    database: baseConfig.database,
    schema: baseConfig.schema,
    logging: baseConfig.logging,
    synchronize: baseConfig.synchronize,
    entityPrefix: baseConfig.prefix,
    entities: baseConfig.entities,
    migrations: baseConfig.migrations,
    migrationsRun: true,
  };
}
