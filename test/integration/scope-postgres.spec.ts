/* eslint-disable @typescript-eslint/await-thenable -- Bun resolves promise matchers. */
import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'bun:test';
import { randomUUID } from 'node:crypto';
import {
  DataSource,
  Entity,
  Column,
  PrimaryColumn,
  DeleteDateColumn,
  BeforeInsert,
  BeforeUpdate,
  EventSubscriber,
} from 'typeorm';
import type {
  EntitySubscriberInterface,
  InsertEvent,
  UpdateEvent,
} from 'typeorm';
import type { DeepPartial, Repository } from 'typeorm';
import { BaseService } from '../../src/common/services/base.service';
import type {
  ScopeWhere,
  ScopeContext,
} from '../../src/common/services/base.service';
import { testDatabaseUrl } from '../../tools/postgres-test';

const lifecycle: string[] = [];
const schema = 'nest_base_scope_' + randomUUID().replaceAll('-', '');
@Entity({ name: 'records', schema })
class Row {
  @PrimaryColumn({ type: 'integer' })
  id!: number;
  @Column({ type: 'text' })
  partition!: string;
  @Column({ type: 'text' })
  state!: string;
  @DeleteDateColumn({ type: 'timestamptz', nullable: true })
  deletedAt?: Date | null;
  @BeforeInsert()
  inserted() {
    lifecycle.push('entity-insert');
  }
  @BeforeUpdate()
  updated() {
    lifecycle.push('entity-update');
  }
}
@EventSubscriber()
class Observer implements EntitySubscriberInterface<Row> {
  listenTo() {
    return Row;
  }
  beforeInsert(_event: InsertEvent<Row>) {
    void _event;
    lifecycle.push('subscriber-insert');
  }
  beforeUpdate(_event: UpdateEvent<Row>) {
    void _event;
    lifecycle.push('subscriber-update');
  }
}

class Scoped extends BaseService<Row> {
  protected override readonly requireScope = true;
  scope: ScopeWhere<Row> | readonly ScopeWhere<Row>[] | undefined = {
    partition: 'a',
  };
  protected override buildScope(_context: ScopeContext) {
    void _context;
    return this.scope;
  }
}
let source: DataSource;
let repo: Repository<Row>;
let service: Scoped;
let created = false;
beforeAll(async () => {
  source = new DataSource({
    type: 'postgres',
    url: testDatabaseUrl(),
    entities: [Row],
    subscribers: [Observer],
    synchronize: false,
    logging: false,
    extra: { max: 6, connectionTimeoutMillis: 5000, statement_timeout: 5000 },
  });
  try {
    await source.initialize();
    await source.query('CREATE SCHEMA "' + schema + '"');
    created = true;
    await source.query(
      'CREATE TABLE "' +
        schema +
        '"."records" (id integer PRIMARY KEY, partition text NOT NULL, state text NOT NULL, "deletedAt" timestamptz NULL)',
    );
    repo = source.getRepository(Row);
  } catch (error) {
    if (source.isInitialized) {
      try {
        if (created) await source.query('DROP SCHEMA "' + schema + '" CASCADE');
      } finally {
        created = false;
        await source.destroy();
      }
    }
    throw error;
  }
});
afterAll(async () => {
  if (!source?.isInitialized) return;
  try {
    if (created) await source.query('DROP SCHEMA "' + schema + '" CASCADE');
    const result: Array<{ count: string }> = await source.query(
      'SELECT count(*) FROM pg_namespace WHERE nspname = $1',
      [schema],
    );
    expect(result[0].count).toBe('0');
  } finally {
    await source.destroy();
  }
});
beforeEach(async () => {
  await repo.clear();
  await repo.insert([
    { id: 1, partition: 'a', state: 'active' },
    { id: 2, partition: 'b', state: 'active' },
    { id: 3, partition: 'a', state: 'pending' },
    { id: 4, partition: 'b', state: 'pending' },
  ]);
  service = new Scoped(repo);
});
describe('PostgreSQL real scope isolation', () => {
  it('list returns only A', async () => {
    expect((await service.find()).data.map((r) => r.id).sort()).toEqual([1, 3]);
  });
  it('findByPk excludes B', async () => {
    expect(await service.findByPk(2)).toBeNull();
    expect((await service.findByPk(1))?.partition).toBe('a');
  });
  it('findOneBy excludes B', async () => {
    expect(await service.findOneBy('id', 2)).toBeNull();
    expect((await service.findOneBy('id', 1))?.id).toBe(1);
  });
  it('count excludes B', async () => {
    expect(await service.count()).toBe(2);
  });
  it('exists excludes B', async () => {
    expect(await service.exists({ partition: 'b' })).toBe(false);
    expect(await service.exists({ state: 'active' })).toBe(true);
  });
  it('OR intersects every caller branch with scope', async () => {
    expect(
      (
        await service.find({
          or: JSON.stringify([{ partition: 'b' }, { state: 'pending' }]),
        })
      ).data.map((r) => r.id),
    ).toEqual([3]);
  });
  it('caller cannot replace the read predicate', async () => {
    expect((await service.find({ partition: 'b' })).data).toEqual([]);
  });
  it('create imposes contextual authority', async () => {
    const row = await service.create({ id: 5, partition: 'b', state: 'new' });
    expect(row.partition).toBe('a');
    expect((await repo.findOneBy({ id: 5 }))?.partition).toBe('a');
  });
  it('create cannot upsert a natural key belonging to B', async () => {
    await expect(service.create({ id: 2, state: 'changed' })).rejects.toThrow();
    expect((await repo.findOneBy({ id: 2 }))?.state).toBe('active');
  });
  it('update inside A cannot change PK or authority', async () => {
    const row = await service.updateByPk(1, {
      id: 2,
      partition: 'b',
      state: 'changed',
    });
    expect(row).toMatchObject({ id: 1, partition: 'a', state: 'changed' });
    expect((await repo.findOneBy({ id: 2 }))?.state).toBe('active');
  });
  it('update outside A affects nothing', async () => {
    expect(await service.updateByPk(2, { state: 'changed' })).toBeNull();
    expect((await repo.findOneBy({ id: 2 }))?.state).toBe('active');
  });
  it('unique-column mutations remain scoped', async () => {
    expect(
      await service.updateByUniqueColumn('id', 2, { state: 'changed' }),
    ).toBeNull();
    expect(await service.removeByUniqueColumn('id', 2)).toBe(false);
  });
  it('delete inside/outside A', async () => {
    expect(await service.removeByPk(2)).toBe(false);
    expect(await service.removeByPk(1)).toBe(true);
    expect(await repo.findOneBy({ id: 1 })).toBeNull();
    expect(await repo.findOneBy({ id: 2 })).not.toBeNull();
  });
  it('soft delete and restore preserve both partitions', async () => {
    expect(await service.softDeleteByPk(2)).toBe(false);
    expect(await service.softDeleteByPk(1)).toBe(true);
    expect(await service.findByPk(1)).toBeNull();
    expect(await service.restoreByPk(1)).toBe(true);
    await repo.softDelete({ id: 2 });
    expect(await service.restoreByPk(2)).toBe(false);
    expect(await repo.findOneBy({ id: 2 })).toBeNull();
    expect(await service.findByPk(1)).not.toBeNull();
  });
  it('manager observes uncommitted writes without global repository fallback', async () => {
    await source.transaction(async (manager) => {
      await service.create({ id: 5, state: 'transactional' }, { manager });
      expect(await service.findByPk(5)).toBeNull();
      expect((await service.findByPk(5, { manager }))?.state).toBe(
        'transactional',
      );
      expect(await service.count({}, { manager })).toBe(3);
      expect(await service.exists({ id: 5 }, { manager })).toBe(true);
      expect((await service.find({}, { manager })).data).toHaveLength(3);
      expect((await service.findOne(5, {}, { manager }))?.id).toBe(5);
      expect((await service.findOneBy('id', 5, { manager }))?.id).toBe(5);
      expect(
        await service.updateByPk(2, { state: 'bad' }, { manager }),
      ).toBeNull();
      await service.updateByPk(5, { state: 'updated' }, { manager });
      expect((await service.findByPk(5, { manager }))?.state).toBe('updated');
    });
    expect((await service.findByPk(5))?.state).toBe('updated');
  });
  it('real rollback undoes scoped creation, update and deletion', async () => {
    await expect(
      source.transaction(async (manager) => {
        await service.create({ id: 5, state: 'new' }, { manager });
        await service.updateByPk(1, { state: 'updated' }, { manager });
        await service.removeByPk(3, { manager });
        expect(await service.findByPk(3, { manager })).toBeNull();
        throw new Error('deliberate rollback');
      }),
    ).rejects.toThrow('deliberate rollback');
    expect(await service.findByPk(5)).toBeNull();
    expect((await service.findByPk(1))?.state).toBe('active');
    expect(await service.findByPk(3)).not.toBeNull();
  });
  it('missing required scope fails before writes', async () => {
    service.scope = undefined;
    await expect(service.find()).rejects.toThrow('requires a scope');
    await expect(service.removeByPk(2)).rejects.toThrow('requires a scope');
    expect(await repo.count()).toBe(4);
  });
  it('concurrent services cannot modify the other partition', async () => {
    const other = new Scoped(repo);
    other.scope = { partition: 'b' };
    const results = await Promise.all([
      source.transaction((manager) =>
        service.updateByPk(1, { state: 'a-updated' }, { manager }),
      ),
      source.transaction((manager) =>
        other.updateByPk(2, { state: 'b-updated' }, { manager }),
      ),
      service.updateByPk(2, { state: 'bad' }),
      other.updateByPk(1, { state: 'bad' }),
    ]);
    expect(results[2]).toBeNull();
    expect(results[3]).toBeNull();
    expect((await repo.findOneBy({ id: 1 }))?.state).toBe('a-updated');
    expect((await repo.findOneBy({ id: 2 }))?.state).toBe('b-updated');
  });
  it('prepareMutation cannot remove the final authority constraint', async () => {
    class Hook extends Scoped {
      protected override prepareMutation(data: DeepPartial<Row>) {
        return { ...data, partition: 'b' };
      }
    }
    const hook = new Hook(repo);
    expect((await hook.create({ id: 5, state: 'new' })).partition).toBe('a');
    expect((await hook.updateByPk(1, { state: 'changed' }))?.partition).toBe(
      'a',
    );
  });
  it('scope alternatives preserve authority and reject reassignment', async () => {
    service.scope = [
      { partition: 'a', state: 'active' },
      { partition: 'a', state: 'pending' },
    ];
    expect((await service.find()).data).toHaveLength(2);
    await expect(service.updateByPk(1, { state: 'pending' })).rejects.toThrow(
      'Cannot reassign',
    );
    await expect(service.create({ id: 5, state: 'other' })).rejects.toThrow(
      'Creation must satisfy',
    );
    expect((await service.create({ id: 5, state: 'pending' })).partition).toBe(
      'a',
    );
  });
});

it('documents direct insert/update listener and subscriber lifecycle', async () => {
  lifecycle.length = 0;
  await service.create({ id: 5, state: 'new' });
  expect(lifecycle).toEqual(['entity-insert', 'subscriber-insert']);
  lifecycle.length = 0;
  await service.updateByPk(5, { state: 'updated' });
  expect(lifecycle).toEqual(['subscriber-update']);
});
