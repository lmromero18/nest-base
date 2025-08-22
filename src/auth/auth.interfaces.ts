export interface ILoginInput {
  username: string;
  contrasena: string;
}

export interface IJWT {
  sub: number;
  aud: string;
  scp: string[];
  usr: Record<string, any>;
  iat: number;
  exp: number;
}
