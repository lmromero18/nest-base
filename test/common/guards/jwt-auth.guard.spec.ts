import { beforeEach, describe, expect, it } from 'bun:test';
import type { ExecutionContext } from '@nestjs/common';
import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard';

const SECRET = 'secreto-de-pruebas';
const jwtService = new JwtService({});

const sign = (
  payload: Record<string, unknown>,
  options: Record<string, unknown> = {},
): string => jwtService.sign(payload, { secret: SECRET, ...options });

function makeContext(
  headers: Record<string, string | undefined> = {},
  isPublic = false,
) {
  const request: Record<string, unknown> = { headers };
  const reflector = {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
  const context = {
    getHandler: () => function handler() {},
    getClass: () => class TestController {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, reflector, context };
}

describe('JwtAuthGuard', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = SECRET;
    delete process.env.JWT_PUBLIC_KEY;
  });

  it('acepta un token con firma válida y expone el payload en request.user', () => {
    const token = sign({ sub: '1', aud: 'cliente-a' });
    const { request, reflector, context } = makeContext({
      authorization: `Bearer ${token}`,
    });

    const guard = new JwtAuthGuard(reflector, jwtService);
    expect(guard.canActivate(context)).toBe(true);

    const user = request.user as Record<string, unknown>;
    expect(user.sub).toBe('1');
    expect(user.aud).toBe('cliente-a');
  });

  it('rechaza un token firmado con otra clave', () => {
    const token = jwtService.sign({ sub: '1' }, { secret: 'otra-clave' });
    const { reflector, context } = makeContext({
      authorization: `Bearer ${token}`,
    });

    const guard = new JwtAuthGuard(reflector, jwtService);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rechaza un token expirado', () => {
    const token = sign({ sub: '1' }, { expiresIn: '-10s' });
    const { reflector, context } = makeContext({
      authorization: `Bearer ${token}`,
    });

    const guard = new JwtAuthGuard(reflector, jwtService);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rechaza requests sin header Authorization', () => {
    const { reflector, context } = makeContext({});
    const guard = new JwtAuthGuard(reflector, jwtService);
    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException);
  });

  it('deja pasar rutas @Public sin token', () => {
    const { reflector, context } = makeContext({}, true);
    const guard = new JwtAuthGuard(reflector, jwtService);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('sin clave configurada responde 503 (fail closed), nunca acepta tokens', () => {
    delete process.env.JWT_SECRET;
    delete process.env.JWT_PUBLIC_KEY;

    const token = sign({ sub: '1' });
    const { reflector, context } = makeContext({
      authorization: `Bearer ${token}`,
    });

    const guard = new JwtAuthGuard(reflector, jwtService);
    expect(() => guard.canActivate(context)).toThrow(
      ServiceUnavailableException,
    );
  });
});
