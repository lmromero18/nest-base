import { describe, expect, it } from 'bun:test';
import * as http from '../../../packages/http-core/src/index';

describe('@nest-base/http-core public exports', () => {
  it('exposes the factory and its supporting response contract', () => {
    expect(http.CrudControllerFactory).toBeFunction();
    expect(http.DEFAULT_CRUD_ROUTES).toEqual([
      'find',
      'findOne',
      'create',
      'update',
      'softDelete',
    ]);
    expect(http.SuccessResponse).toBeFunction();
    expect(http.successResponse('ok').status).toBe('success');
  });
});
