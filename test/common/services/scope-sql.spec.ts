import { beforeAll, describe, expect, it } from 'bun:test';
import { DataSource, EntitySchema } from 'typeorm';
import type { FindManyOptions, FindOptionsWhere } from 'typeorm';
import { BaseService } from '../../../src/common/services/base.service';

interface RecordRow {
  id: number;
  partition: string;
  state: string;
  deletedAt?: Date;
}
const entity = new EntitySchema<RecordRow>({
  name: 'ScopedRecord',
  columns: {
    id: { type: Number, primary: true },
    partition: { type: String },
    state: { type: String },
    deletedAt: { type: Date, nullable: true, deleteDate: true },
  },
});
class MetadataSource extends DataSource {
  prepare() {
    return this.buildMetadatas();
  }
}
const source = new MetadataSource({ type: 'postgres', entities: [entity] });
beforeAll(() => source.prepare());
class Service extends BaseService<RecordRow> {
  protected override readonly requireScope = true;
  protected override buildScope() {
    return { partition: 'a' };
  }
}
describe('scope predicates compiled by the real PostgreSQL TypeORM driver (no connection)', () => {
  it('places AND and OR constraints in parameterized SELECT SQL', async () => {
    const repository = source.getRepository(entity);
    let sql = '';
    let values: unknown[] = [];
    repository.findAndCount = (options?: FindManyOptions<RecordRow>) => {
      [sql, values] = repository
        .createQueryBuilder('record')
        .setFindOptions(options ?? {})
        .getQueryAndParameters();
      return Promise.resolve([[], 0]);
    };
    await new Service(repository).find({
      or: JSON.stringify([{ partition: 'b' }, { state: 'pending' }]),
    });
    expect(sql).toContain(' AND ');
    expect(sql).toContain(' OR ');
    expect(sql).toContain('"partition" = $');
    expect(values.filter((value) => value === 'a').length).toBe(2);
    expect(values).toContain('b');
    expect(values).toContain('pending');
  });
  for (const operation of [
    'update',
    'delete',
    'softDelete',
    'restore',
  ] as const) {
    it('includes scope in the final ' + operation + ' statement', async () => {
      const repository = source.getRepository(entity);
      let sql = '';
      let values: unknown[] = [];
      repository.findOne = () =>
        Promise.resolve({ id: 1, partition: 'a', state: 'active' });
      const capture = (
        where: FindOptionsWhere<RecordRow> | FindOptionsWhere<RecordRow>[],
      ) => {
        const qb = repository.createQueryBuilder();
        const mutation =
          operation === 'update'
            ? qb.update().set({ state: 'changed' })
            : operation === 'delete'
              ? qb.delete()
              : operation === 'softDelete'
                ? qb.softDelete()
                : qb.restore();
        [sql, values] = mutation.where(where).getQueryAndParameters();
        return Promise.resolve({ affected: 0, raw: [], generatedMaps: [] });
      };
      if (operation === 'update') repository.update = capture;
      if (operation === 'delete') repository.delete = capture;
      if (operation === 'softDelete') repository.softDelete = capture;
      if (operation === 'restore') repository.restore = capture;
      const service = new Service(repository);
      if (operation === 'update')
        await service.updateByPk(1, { state: 'changed' });
      if (operation === 'delete') await service.removeByPk(1);
      if (operation === 'softDelete') await service.softDeleteByPk(1);
      if (operation === 'restore') await service.restoreByPk(1);
      expect(sql).toContain('WHERE');
      expect(sql.slice(sql.indexOf('WHERE'))).toContain('"partition" = $');
      expect(sql.slice(sql.indexOf('WHERE'))).toContain('"id" = $');
      expect(values).toContain('a');
      expect(values).toContain(1);
    });
  }
});
