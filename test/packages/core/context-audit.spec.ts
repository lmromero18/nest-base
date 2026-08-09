import { describe, expect, it } from 'bun:test';
import type { Repository } from 'typeorm';
import { BaseService } from '../../../packages/core/src/services';
import { RequestContext } from '../../../packages/core/src/context';

type RecordEntity = { id: number; name: string; idCreado?: number };

describe('@nest-base/core context and audit contract', () => {
  it('stamps a neutral principal while anonymous operations remain unchanged', async () => {
    const calls: Record<string, unknown[]> = {};
    const repository = {
      metadata: {
        columns: [
          {
            propertyName: 'id',
            type: 'int',
            isGenerated: true,
            isCreateDate: false,
            isUpdateDate: false,
            isDeleteDate: false,
            isVersion: false,
            isSelect: true,
          },
          {
            propertyName: 'name',
            type: 'varchar',
            isGenerated: false,
            isCreateDate: false,
            isUpdateDate: false,
            isDeleteDate: false,
            isVersion: false,
            isSelect: true,
          },
          {
            propertyName: 'idCreado',
            type: 'int',
            isGenerated: false,
            isCreateDate: false,
            isUpdateDate: false,
            isDeleteDate: false,
            isVersion: false,
            isSelect: true,
          },
        ],
        relations: [],
        primaryColumns: [],
        deleteDateColumn: undefined,
      },
      create: (value: unknown) => {
        calls.create = [value];
        return value;
      },
      save: (value: unknown) => Promise.resolve(value),
      target: class RecordEntity {},
    } as unknown as Repository<RecordEntity>;
    class Service extends BaseService<RecordEntity> {}
    const service = new Service(repository);

    await RequestContext.run({ principal: { subject: '42' } }, () =>
      service.create({ name: 'owned' }),
    );
    expect((calls.create?.[0] as RecordEntity).idCreado).toBe(42);

    delete calls.create;
    await service.create({ name: 'anonymous' });
    expect((calls.create?.[0] as RecordEntity).idCreado).toBeUndefined();
  });
});
