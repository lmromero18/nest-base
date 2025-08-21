export interface ILoginInput {
  username: string;
  contrasena: string;
}

export enum AuthBaseStatus {
  ACTIVO = 'ACTIVO',
  INACTIVO = 'INACTIVO',
}
