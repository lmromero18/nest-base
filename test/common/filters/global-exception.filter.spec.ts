import { describe, expect, it } from 'bun:test';
import { HttpStatus } from '@nestjs/common';
import { ApplicationException } from '../../../src/common/application/application-error';
import { GlobalExceptionFilter } from '../../../src/common/filters/global-exception.filter';

function capture(exception: unknown) {
  const sent: { status?: number; body?: unknown } = {};
  const response = {
    status: (status: number) => {
      sent.status = status;
      return { send: (body: unknown) => void (sent.body = body) };
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', url: '/demo' }),
    }),
  };

  new GlobalExceptionFilter().catch(exception, host as never);
  return sent;
}

describe('GlobalExceptionFilter — application errors', () => {
  it('maps validation to the existing 400 response ownership', () => {
    const result = capture(
      new ApplicationException('validation', 'invalid-query', 'Query inválido'),
    );

    expect(result.status).toBe(HttpStatus.BAD_REQUEST);
    expect(result.body).toEqual({
      statusCode: HttpStatus.BAD_REQUEST,
      message: 'Query inválido',
      error: 'Bad Request',
    });
  });

  it('maps not-found, conflict, and unsupported categories', () => {
    expect(
      capture(new ApplicationException('not-found', 'missing', 'Falta')).body,
    ).toEqual(
      expect.objectContaining({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
      }),
    );
    expect(
      capture(new ApplicationException('conflict', 'duplicate', 'Duplica'))
        .body,
    ).toEqual(
      expect.objectContaining({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
      }),
    );
    expect(
      capture(
        new ApplicationException('unsupported', 'no-soft-delete', 'No aplica'),
      ).body,
    ).toEqual(
      expect.objectContaining({
        statusCode: HttpStatus.METHOD_NOT_ALLOWED,
        error: 'Method Not Allowed',
      }),
    );
  });

  it('keeps unknown failures generic in production', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const result = capture(new Error('database secret'));
      expect(result.body).toEqual({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Error interno del servidor',
        error: 'Internal Server Error',
      });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('does not crash on a malformed application category', () => {
    const malformed = new ApplicationException(
      'invalid-category' as never,
      'broken',
      'internal detail',
    );
    const result = capture(malformed);

    expect(result.status).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(result.body).toEqual(
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: 'Internal Server Error',
      }),
    );
  });
});
