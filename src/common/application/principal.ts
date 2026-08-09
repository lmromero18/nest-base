/** Identity made available to application services without transport details. */
export interface Principal {
  subject?: string | number;
  clientId?: string;
}
