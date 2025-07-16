import * as dotenv from 'dotenv';
dotenv.config();

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Variable de entorno ${key} no está definida.`);
  }
  return value;
}