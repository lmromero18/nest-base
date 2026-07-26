import { HttpStatus } from '@nestjs/common';

export type SuccessStatus = 'success';

export interface SuccessResponseOptions<T = unknown> {
  message?: string;
  data?: T;
  meta?: Record<string, unknown>;
  statusCode?: number;
}

// Envelope estándar de éxito para respuestas de escritura/acciones
export class SuccessResponse<T = unknown> {
  readonly status: SuccessStatus = 'success';
  readonly message?: string;
  readonly statusCode: number;
  readonly data?: T;
  readonly meta?: Record<string, unknown>;

  constructor(options: SuccessResponseOptions<T> = {}) {
    this.message = options.message;
    this.statusCode = options.statusCode ?? HttpStatus.OK;
    if (options.data !== undefined) {
      this.data = options.data;
    }
    if (options.meta !== undefined) {
      this.meta = options.meta;
    }
  }
}

export const successResponse = <T = unknown>(
  message?: string,
  data?: T,
): SuccessResponse<T> => new SuccessResponse<T>({ message, data });
