export interface ILoginInput {
  username: string;
  contrasena: string;
}
export interface IJWT {
  sub: number;
  aud: string;
  scp: string[];
  usr: Record<string, any>;
  jit: string;
  iat: number;
  exp: number;
}

export interface ITokenResponse {
  access_token: string;
  expires_in: number;
}
