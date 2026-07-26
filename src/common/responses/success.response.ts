import { HttpStatus } from '@nestjs/common';

export type SuccessStatus = 'success';

export interface SuccessResponseOptions<T = any> {
  message?: string;
  data?: T;
  meta?: Record<string, any>;
  statusCode?: number;
}

// Simple success payload you can instantiate and return from controllers
export class SuccessResponse<T = any> {
  readonly status: SuccessStatus = 'success';
  readonly message?: string;
  readonly statusCode: number;

  constructor(options: SuccessResponseOptions<T> = {}) {
    this.message = options.message;
    this.statusCode = options.statusCode ?? HttpStatus.OK;
  }
}

export const successResponse = <T = any>(
  message?: string,
): SuccessResponse<T> =>
  new SuccessResponse<T>({ message, statusCode: HttpStatus.OK });
