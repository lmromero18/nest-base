export type ApplicationErrorCategory =
  'validation' | 'not-found' | 'conflict' | 'unsupported';

export interface ApplicationError {
  category: ApplicationErrorCategory;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export class ApplicationException extends Error implements ApplicationError {
  readonly name = 'ApplicationException';

  constructor(
    readonly category: ApplicationErrorCategory,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
