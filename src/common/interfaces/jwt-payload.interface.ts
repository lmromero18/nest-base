export interface JwtPayloadUser {
  name?: string;
  username?: string;
  email?: string;
  avatar?: string;
  active?: boolean;
  descripcion?: string | null;
  tx_atributo?: Record<string, unknown>;
  created_at?: string | null;
  st_verificado?: string;
  fe_ultimo_acceso?: string | null;
  [key: string]: unknown;
}

export interface JwtPayload {
  aud?: string;
  jti?: string;
  iat?: number;
  nbf?: number;
  exp?: number;
  adc?: string;
  sub?: string | number;
  scopes?: unknown[];
  user?: JwtPayloadUser;
  [key: string]: unknown;
}
