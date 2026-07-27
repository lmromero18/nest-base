import { describe, expect, it } from 'bun:test';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { JwtPayload } from '../../../src/common/interfaces/jwt-payload.interface';
import {
  principalFromJwtPayload,
  RequestContextInterceptor,
} from '../../../src/common/context/request-context.interceptor';
import { RequestContext } from '../../../src/common/context/request-context';
import { Observable } from 'rxjs';

describe('RequestContext', () => {
  it('exposes the neutral principal through compatibility getters', () => {
    const principal = { subject: 'user-42', clientId: 'client-a' };

    RequestContext.run({ principal, requestId: 'request-1' }, () => {
      expect(RequestContext.get()?.principal).toEqual(principal);
      expect(RequestContext.userId).toBe('user-42');
      expect(RequestContext.clientId).toBe('client-a');
    });
  });

  it('preserves absent identity without manufacturing an audit value', () => {
    RequestContext.run({ requestId: 'public-request' }, () => {
      expect(RequestContext.get()?.principal).toBeUndefined();
      expect(RequestContext.userId).toBeUndefined();
      expect(RequestContext.clientId).toBeUndefined();
    });

    expect(RequestContext.get()).toBeUndefined();
  });

  it('isolates nested asynchronous request stores', async () => {
    const observed: string[] = [];

    await RequestContext.run({ principal: { subject: 'outer' } }, async () => {
      await Promise.resolve();
      observed.push(String(RequestContext.userId));

      await RequestContext.run(
        { principal: { subject: 'inner' } },
        async () => {
          await Promise.resolve();
          observed.push(String(RequestContext.userId));
        },
      );

      observed.push(String(RequestContext.userId));
    });

    expect(observed).toEqual(['outer', 'inner', 'outer']);
    expect(RequestContext.get()).toBeUndefined();
  });
});

describe('principalFromJwtPayload', () => {
  it('maps a valid subject and audience without retaining JWT metadata', () => {
    const payload: JwtPayload = {
      sub: 'user-42',
      aud: 'client-a',
      exp: 123,
      scopes: ['read'],
    };

    expect(principalFromJwtPayload(payload)).toEqual({
      subject: 'user-42',
      clientId: 'client-a',
    });
  });

  it('returns no principal for an unusable subject', () => {
    expect(
      principalFromJwtPayload({ sub: '   ', aud: 'client-a' }),
    ).toBeUndefined();
    expect(principalFromJwtPayload({ aud: 'client-a' })).toBeUndefined();
  });
});

describe('RequestContextInterceptor', () => {
  it('runs HTTP handlers with the mapped principal and request id', () => {
    const request = {
      id: 'request-7',
      user: { sub: 'user-7', aud: 'client-b' },
    };
    const interceptor = new RequestContextInterceptor();
    let observed: unknown;
    const next: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          observed = {
            principal: RequestContext.get()?.principal,
            requestId: RequestContext.get()?.requestId,
          };
          subscriber.next('ok');
          subscriber.complete();
        }),
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    interceptor.intercept(context, next).subscribe();

    expect(observed).toEqual({
      principal: { subject: 'user-7', clientId: 'client-b' },
      requestId: 'request-7',
    });
  });
});
