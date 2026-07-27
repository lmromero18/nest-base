import { describe, expect, it } from 'bun:test';
import * as contracts from '../../../src/common/application/crud.contracts';
import * as application from '../../../src/common/application';
import * as context from '../../../src/common/context';
import * as services from '../../../src/common/services';
import { RequestContext as DirectRequestContext } from '../../../src/common/context/request-context';

describe('source-owned core contract facades', () => {
  it('re-exports the canonical context and service identities', () => {
    expect(context.RequestContext).toBe(DirectRequestContext);
    const principal: application.Principal = { subject: 'user-1' };
    expect(services.BaseService).toBeDefined();
    expect(principal.subject).toBe('user-1');
  });

  it('owns the exact pagination and mutation contracts without legacy result aliases', () => {
    const response: contracts.PaginatedResponse<string> = {
      data: ['item'],
      total: 1,
      currentPage: 1,
      lastPage: 1,
      perPage: 20,
      from: 1,
      to: 1,
    };
    const options: contracts.MutationOptions = {};

    expect(response).toEqual({
      data: ['item'],
      total: 1,
      currentPage: 1,
      lastPage: 1,
      perPage: 20,
      from: 1,
      to: 1,
    });
    expect(options).toEqual({});
    expect('CrudResult' in contracts).toBe(false);
    expect('PaginatedResult' in contracts).toBe(false);
  });
});
