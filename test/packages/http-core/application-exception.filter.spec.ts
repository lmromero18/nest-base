import { describe, expect, it } from 'bun:test';
import type { ArgumentsHost } from '@nestjs/common';
import { ApplicationException } from '@nest-base/core';
import { ApplicationExceptionFilter } from '../../../packages/http-core/src/index';

describe('application error HTTP boundary', () => {
  for (const [category, status] of [
    ['validation', 400],
    ['not-found', 404],
    ['conflict', 409],
    ['unsupported', 405],
  ] as const) {
    it('maps ' + category + ' without leaking diagnostic details', () => {
      let code = 0;
      let body: unknown;
      const reply = {
        status(value: number) {
          code = value;
          return this;
        },
        send(value: unknown) {
          body = value;
        },
      };
      const host = {
        switchToHttp: () => ({ getResponse: () => reply }),
      } as unknown as ArgumentsHost;
      new ApplicationExceptionFilter().catch(
        new ApplicationException(
          category,
          'example-error',
          'private diagnostic',
          { secret: 'hidden' },
        ),
        host,
      );
      expect(code).toBe(status);
      expect(body).toEqual({
        statusCode: status,
        error: category,
        code: 'example-error',
      });
      expect(JSON.stringify(body)).not.toContain('private diagnostic');
      expect(JSON.stringify(body)).not.toContain('hidden');
    });
  }
});
