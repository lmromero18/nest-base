import { describe, expect, it } from 'bun:test';
import { Reflector } from '@nestjs/core';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { IsString } from 'class-validator';
import { readFileSync } from 'node:fs';
import { CrudControllerFactory } from '../../../src/common/controller/crud-controller.factory';
import type {
  CrudAuthorization,
  CrudControllerOptions,
  CrudControllerConstructor,
  CrudRoute,
} from '../../../src/common/controller/crud-controller.factory';

function handler(
  controller: CrudControllerConstructor<Record<string, unknown>>,
  route: CrudRoute,
): (...args: never[]) => unknown {
  return Reflect.get(controller.prototype as object, route) as (
    ...args: never[]
  ) => unknown;
}

class InputDto {
  @IsString()
  name!: string;
}
const routes: CrudRoute[] = [
  'find',
  'findOne',
  'create',
  'update',
  'softDelete',
  'hardDelete',
  'restore',
];
const defaults = { createDto: InputDto, updateDto: InputDto };
describe('CRUD authorization extension', () => {
  it('preserves generated routes without authorization options', () => {
    const controller = CrudControllerFactory(defaults);
    expect(
      Reflect.getMetadata(METHOD_METADATA, handler(controller, 'find')),
    ).toBeDefined();
    expect(
      Reflect.getMetadata('test-policy', handler(controller, 'find')),
    ).toBeUndefined();
  });
  for (const route of routes) {
    it('attaches opaque policy to ' + route, () => {
      const value = { capability: route, interpretation: ['consumer-owned'] };
      const authorization: CrudAuthorization = {
        [route]: [{ key: 'test-policy', value }],
      };
      const controller = CrudControllerFactory({
        ...defaults,
        routes: [route],
        authorization,
        strictAuthorizationCoverage: true,
      });
      expect(
        new Reflector().get<unknown>('test-policy', handler(controller, route)),
      ).toEqual(value);
      expect(
        Reflect.getMetadata(METHOD_METADATA, handler(controller, route)),
      ).toBeDefined();
    });
  }
  it('covers all enabled routes in strict mode', () => {
    const authorization = Object.fromEntries(
      routes.map((route) => [route, [{ key: 'test-policy', value: route }]]),
    );
    expect(() =>
      CrudControllerFactory({
        ...defaults,
        routes,
        authorization,
        strictAuthorizationCoverage: true,
      }),
    ).not.toThrow();
  });
  it('rejects missing coverage deterministically at factory creation', () => {
    expect(() =>
      CrudControllerFactory({ ...defaults, strictAuthorizationCoverage: true }),
    ).toThrow('missing authorization policy for find');
  });
  it('disabled routes require no policies and receive no HTTP metadata', () => {
    const controller = CrudControllerFactory({
      routes: ['find'],
      strictAuthorizationCoverage: true,
      authorization: { find: [{ key: 'p', value: 'read' }] },
    });
    expect(
      Reflect.getMetadata(METHOD_METADATA, handler(controller, 'create')),
    ).toBeUndefined();
  });
  it('supports symbol metadata keys and explicit consumer policy values', () => {
    const key = Symbol('policy');
    const controller = CrudControllerFactory({
      routes: ['find'],
      authorization: { find: [{ key, value: [] }] },
      strictAuthorizationCoverage: true,
    });
    expect(
      new Reflector().get<unknown>(key, handler(controller, 'find')),
    ).toEqual([]);
  });
  it('keeps generated controller metadata isolated', () => {
    const one = CrudControllerFactory({
      routes: ['find'],
      authorization: { find: [{ key: 'p', value: 'one' }] },
    });
    const two = CrudControllerFactory({
      routes: ['find'],
      authorization: { find: [{ key: 'p', value: 'two' }] },
    });
    expect(Reflect.getMetadata('p', handler(one, 'find'))).toBe('one');
    expect(Reflect.getMetadata('p', handler(two, 'find'))).toBe('two');
  });
  for (const authorization of [
    null,
    [],
    'policy',
    { unknown: [] },
    { find: [] },
    { find: [{}] },
    { find: [{ key: '', value: 1 }] },
    { find: [{ key: 'p' }] },
    { find: [{ key: 'p', value: undefined }] },
    {
      find: [
        { key: 'p', value: 1 },
        { key: 'p', value: 2 },
      ],
    },
  ]) {
    it('rejects malformed policy map ' + JSON.stringify(authorization), () => {
      expect(() =>
        CrudControllerFactory({
          routes: ['find'],
          authorization,
        } as unknown as CrudControllerOptions),
      ).toThrow('CrudControllerFactory:');
    });
  }
  it('rejects malformed strict flag and route configuration', () => {
    expect(() =>
      CrudControllerFactory({
        routes: ['unknown'],
      } as unknown as CrudControllerOptions),
    ).toThrow('invalid routes');
    expect(() =>
      CrudControllerFactory({
        ...defaults,
        strictAuthorizationCoverage: 'yes',
      } as unknown as CrudControllerOptions),
    ).toThrow('strictAuthorizationCoverage');
  });
  it('contains no concrete authentication or permission dependencies', () => {
    const source = readFileSync(
      'src/common/controller/crud-controller.factory.ts',
      'utf8',
    );
    for (const forbidden of [
      "from '../guards/",
      "from '../decorators/permissions",
      '@nestjs/jwt',
      'apiseg',
    ])
      expect(source).not.toContain(forbidden);
  });
});
