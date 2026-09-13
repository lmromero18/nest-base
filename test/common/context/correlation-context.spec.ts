import { expect, it } from 'bun:test';
import { RequestContext } from '../../../src/common/context/request-context';

it('isolates minimal identity and correlation across concurrent requests', async () => {
  const results = await Promise.all(
    ['a', 'b'].map((id) =>
      RequestContext.run(
        {
          principal: { subject: id, clientId: 'partition-' + id },
          requestId: id,
          correlationId: 'correlation-' + id,
        },
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 1));
          return {
            subject: RequestContext.userId,
            clientId: RequestContext.clientId,
            correlationId: RequestContext.get()?.correlationId,
          };
        },
      ),
    ),
  );
  expect(results).toEqual([
    { subject: 'a', clientId: 'partition-a', correlationId: 'correlation-a' },
    { subject: 'b', clientId: 'partition-b', correlationId: 'correlation-b' },
  ]);
  expect(RequestContext.get()).toBeUndefined();
});
