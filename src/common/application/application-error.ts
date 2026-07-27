export type ApplicationErrorCategory =
  'validation' | 'not-found' | 'conflict' | 'unsupported';

export interface ApplicationError {
  category: ApplicationErrorCategory;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
