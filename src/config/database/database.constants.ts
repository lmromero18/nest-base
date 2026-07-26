export const DATABASE_CONNECTIONS = {
  BASE: 'base_connection',
} as const;

export type DatabaseConnectionName =
  (typeof DATABASE_CONNECTIONS)[keyof typeof DATABASE_CONNECTIONS];
