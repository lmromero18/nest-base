import * as dotenv from 'dotenv';

// quiet: dotenv v17 imprime tips promocionales por defecto
dotenv.config({ quiet: true });

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue ?? '';
  }
  return value;
}

export function getBoolEnv(key: string, defaultValue = false): boolean {
  const value = getEnv(key);
  if (value === '') {
    return defaultValue;
  }
  return ['true', '1', 'yes', 'y'].includes(value.toLowerCase());
}

export function getNumberEnv(key: string, defaultValue: number): number {
  const value = Number(getEnv(key));
  return Number.isFinite(value) && getEnv(key) !== '' ? value : defaultValue;
}
