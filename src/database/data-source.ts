import { config as dotenvConfig } from 'dotenv';
import { join } from 'path';
import 'reflect-metadata';
import { DataSource } from 'typeorm';

// Load .env from project root
dotenvConfig();

const DB_PREFIX = 'DB_';

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Env ${key} is required`);
  }
  return v;
}

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: env(`${DB_PREFIX}HOST`),
  port: parseInt(env(`${DB_PREFIX}PORT`)),
  username: env(`${DB_PREFIX}USERNAME`),
  password: env(`${DB_PREFIX}PASSWORD`),
  database: env(`${DB_PREFIX}DATABASE`),
  schema: env(`${DB_PREFIX}SCHEMA`, 'public'),
  entityPrefix: env(`${DB_PREFIX}PREFIX`, ''),
  logging: env(`${DB_PREFIX}LOGGING`, 'false') === 'true',
  entities: [join(__dirname, '..', '**/*.entity.{ts,js}')],
  migrations: [join(__dirname, 'migrations/*.{ts,js}')],
  synchronize: false,
});
