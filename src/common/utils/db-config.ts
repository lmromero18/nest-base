// common/utils/db-config.ts
import { DbEnvConfig } from 'src/modules/database.module';
import { getEnv } from '../utils/env';

export function loadDbConfig(
  prefix: string,
  name: string,
  entities?: any[],
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
    entities,
  };
}
