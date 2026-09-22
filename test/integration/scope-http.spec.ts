import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  Controller,
  Get,
  Param,
  UseFilters,
  UseGuards,
  Catch,
} from '@nestjs/common';
import type {
  CanActivate,
  ExecutionContext,
  ExceptionFilter,
  ArgumentsHost,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApplicationException } from '@nest-base/core';
import { ApplicationExceptionFilter } from '../../packages/http-core/src/errors/application-exception.filter';
import { CrudControllerFactory } from '../../src/common/controller/crud-controller.factory';
import type { BaseService } from '../../src/common/services/base.service';

const policy = Symbol('opaque-policy');
const value = { action: 'read', all: false };
const seen: unknown[] = [];
class PolicyGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const reflector = new Reflector();
    seen.push(reflector.get(policy, context.getHandler()));
    seen.push(reflector.get('other', context.getHandler()));
    return true;
  }
}
@Controller('records')
@UseGuards(PolicyGuard)
class ConsumerController extends CrudControllerFactory<{ id: number }>({
  routes: ['find'],
  authorization: {
    find: [
      { key: policy, value },
      { key: 'other', value: [] },
    ],
  },
  strictAuthorizationCoverage: true,
}) {
  constructor() {
    super({
      find: () => Promise.resolve({ data: [{ id: 1 }], meta: {} }),
    } as unknown as BaseService<{ id: number }>);
  }
}
@Catch()
class CatchAll implements ExceptionFilter {
  catch(_error: unknown, host: ArgumentsHost) {
    host
      .switchToHttp()
      .getResponse<{ status(code: number): { send(body: unknown): void } }>()
      .status(599)
      .send({ caught: 'global' });
  }
}
@Controller('errors')
@UseFilters(ApplicationExceptionFilter)
class ErrorController {
  @Get(':category')
  fail(@Param('category') category: string) {
    if (
      !['validation', 'not-found', 'conflict', 'unsupported'].includes(category)
    )
      throw new Error('secret stack');
    throw new ApplicationException(
      category as 'validation' | 'not-found' | 'conflict' | 'unsupported',
      'public-code',
      'private message',
      { secret: 'private detail' },
    );
  }
}
describe('real Nest Fastify consumer boundaries', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [ConsumerController, ErrorController],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    app.useGlobalFilters(new CatchAll());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('real generated route delivers opaque string and symbol metadata to Reflector', async () => {
    const response = await app.inject({ method: 'GET', url: '/records' });
    expect(response.statusCode).toBe(200);
    expect(seen).toEqual([value, []]);
    expect(seen[0]).toBe(value);
  });
  for (const [category, code] of [
    ['validation', 400],
    ['not-found', 404],
    ['conflict', 409],
    ['unsupported', 405],
  ] as const) {
    it(
      category + ' selects the specific filter before a global catch-all',
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: '/errors/' + category,
        });
        expect(response.statusCode).toBe(code);
        expect(response.json<Record<string, unknown>>()).toEqual({
          statusCode: code,
          error: category,
          code: 'public-code',
        });
        expect(response.body).not.toContain('private');
        expect(response.body).not.toContain('stack');
      },
    );
  }
  it('unmatched errors still reach the global catch-all', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/errors/unknown',
    });
    expect(response.statusCode).toBe(599);
    expect(response.json<Record<string, unknown>>()).toEqual({
      caught: 'global',
    });
  });
});
