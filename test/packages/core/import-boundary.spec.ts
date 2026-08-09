import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

describe('@nest-base/core import boundary', () => {
  it('keeps package entrypoints free of auth and application adapters', () => {
    const files = [
      'packages/core/src/index.ts',
      'packages/core/src/services/index.ts',
      'packages/core/src/query/index.ts',
      'packages/core/src/application/index.ts',
      'packages/core/src/context/index.ts',
    ];
    const forbidden = [
      'JwtPayload',
      'jwt-payload',
      'CrudControllerFactory',
      '@nestjs/',
      'fastify',
      'winston',
      'pg',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const token of forbidden) expect(source).not.toContain(token);
    }
  });
});
