import * as dotenv from 'dotenv';
dotenv.config();

export function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    return defaultValue ?? '';
  }
  return value;
}
