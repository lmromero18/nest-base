/* eslint-disable @typescript-eslint/await-thenable -- Bun's rejects matcher waits for a promise at runtime. */
import { describe, expect, it } from 'bun:test';
import { FindOperator } from 'typeorm';
import type { EntityManager, Repository } from 'typeorm';
import { BaseService } from '../../../src/common/services/base.service';
import type {
  ScopeContext,
  ScopeWhere,
} from '../../../src/common/services/base.service';

interface Row {
  id: number;
  partition: string;
  state: string;
  deletedAt?: Date | null;
  detail?: { label: string };
}
type Where = Record<string, unknown> | Record<string, unknown>[];

function matchesValue(actual: unknown, expected: unknown): boolean {
  if (expected instanceof FindOperator) {
    if (expected.type === 'and')
      return (expected.value as unknown[]).every((v) =>
        matchesValue(actual, v),
      );
    if (expected.type === 'equal') return matchesValue(actual, expected.value);
    if (expected.type === 'in')
      return (expected.value as unknown[]).includes(actual);
    throw new Error('Unsupported fixture operator: ' + expected.type);
  }
  if (expected instanceof Date)
    return actual instanceof Date && actual.getTime() === expected.getTime();
  if (expected && typeof expected === 'object')
    return matches(actual as Record<string, unknown>, expected as Where);
  return actual === expected;
}
function matches(row: Record<string, unknown>, where: Where): boolean {
  if (Array.isArray(where)) return where.some((branch) => matches(row, branch));
  return Object.entries(where).every(([key, value]) =>
    matchesValue(row[key], value),
  );
}

function fixture() {
  const rows: Row[] = [
    { id: 1, partition: 'a', state: 'active', detail: { label: 'same' } },
    { id: 2, partition: 'b', state: 'active', detail: { label: 'same' } },
    { id: 3, partition: 'a', state: 'pending', detail: { label: 'same' } },
    { id: 4, partition: 'a', state: 'archived', deletedAt: new Date(0) },
  ];
  const calls: string[] = [];
  const predicates: Where[] = [];
  let beforeUpdate: (() => void) | undefined;
  const columns = ['id', 'partition', 'state', 'deletedAt'].map(
    (propertyName) => ({
      propertyName,
      type: propertyName === 'id' ? 'int' : 'varchar',
      isSelect: true,
      isGenerated: false,
      isDeleteDate: propertyName === 'deletedAt',
    }),
  );
  const select = (options: { where: Where; withDeleted?: boolean }) =>
    rows.filter(
      (row) =>
        (options.withDeleted || !row.deletedAt) &&
        matches(row as unknown as Record<string, unknown>, options.where),
    );
  const repository = {
    target: 'Row',
    metadata: {
      name: 'Row',
      columns,
      primaryColumns: [columns[0]],
      deleteDateColumn: columns[3],
      relations: [
        {
          propertyName: 'detail',
          inverseEntityMetadata: {
            columns: [{ propertyName: 'label', isSelect: true }],
            relations: [],
          },
        },
      ],
    },
    find: async (options: { where: Where }) => {
      await Promise.resolve();
      calls.push('find');
      predicates.push(options.where);
      return select(options);
    },
    findAndCount: async (options: { where: Where }) => {
      await Promise.resolve();
      calls.push('findAndCount');
      predicates.push(options.where);
      const data = select(options);
      return [data, data.length];
    },
    findOne: async (options: { where: Where; withDeleted?: boolean }) => {
      await Promise.resolve();
      calls.push('findOne');
      predicates.push(options.where);
      return select(options)[0] ?? null;
    },
    count: async (options: { where: Where }) => {
      await Promise.resolve();
      calls.push('count');
      return select(options).length;
    },
    exists: async (options: { where: Where }) => {
      await Promise.resolve();
      calls.push('exists');
      return select(options).length > 0;
    },
    create: (data: Row) => ({ ...data }),
    save: async (data: Row) => {
      await Promise.resolve();
      calls.push('save');
      rows.push(data);
      return data;
    },
    insert: async (data: Row) => {
      await Promise.resolve();
      calls.push('insert');
      if (rows.some((row) => row.id === data.id))
        throw new Error('duplicate key');
      const id = data.id ?? 5;
      rows.push({ ...data, id });
      return { generatedMaps: [], identifiers: [{ id }] };
    },
    update: async (where: Where, data: Partial<Row>) => {
      await Promise.resolve();
      calls.push('update');
      predicates.push(where);
      beforeUpdate?.();
      const found = rows.filter((row) =>
        matches(row as unknown as Record<string, unknown>, where),
      );
      found.forEach((row) => Object.assign(row, data));
      return { affected: found.length };
    },
    delete: async (where: Where) => {
      await Promise.resolve();
      calls.push('delete');
      predicates.push(where);
      const found = rows.filter((row) =>
        matches(row as unknown as Record<string, unknown>, where),
      );
      found.forEach((row) => rows.splice(rows.indexOf(row), 1));
      return { affected: found.length };
    },
    softDelete: async (where: Where) => {
      await Promise.resolve();
      calls.push('softDelete');
      predicates.push(where);
      const found = rows.filter((row) =>
        matches(row as unknown as Record<string, unknown>, where),
      );
      found.forEach((row) => (row.deletedAt = new Date()));
      return { affected: found.length };
    },
    restore: async (where: Where) => {
      await Promise.resolve();
      calls.push('restore');
      predicates.push(where);
      const found = rows.filter((row) =>
        matches(row as unknown as Record<string, unknown>, where),
      );
      found.forEach((row) => (row.deletedAt = null));
      return { affected: found.length };
    },
  };
  const repo = repository as unknown as Repository<Row>;
  return {
    rows,
    calls,
    predicates,
    repo,
    race: (fn: () => void) => {
      beforeUpdate = fn;
    },
  };
}
class ScopedService extends BaseService<Row> {
  protected override readonly requireScope: boolean;
  public contexts: ScopeContext[] = [];
  constructor(
    repo: Repository<Row>,
    public scope: ScopeWhere<Row> | readonly ScopeWhere<Row>[] | undefined = {
      partition: 'a',
    },
    required = true,
  ) {
    super(repo);
    this.requireScope = required;
  }
  protected override buildScope(context: ScopeContext) {
    this.contexts.push(context);
    return this.scope;
  }
}
function setup() {
  const f = fixture();
  return { ...f, service: new ScopedService(f.repo) };
}

describe('BaseService scope: all entry points', () => {
  it('preserves unscoped behavior', async () => {
    const f = fixture();
    const service = new ScopedService(f.repo, undefined, false);
    service.scope = undefined;
    expect((await service.find()).total).toBe(3);
    expect((await service.findByPk(2))?.partition).toBe('b');
  });
  it('scopes paginated and unpaginated lists', async () => {
    const { service } = setup();
    expect((await service.find()).data.map((r) => r.id)).toEqual([1, 3]);
    expect((await service.find({ perPage: 0 })).data.map((r) => r.id)).toEqual([
      1, 3,
    ]);
  });
  it('composes AND without modifying caller filters', async () => {
    const { service } = setup();
    const query = Object.freeze({ state: 'active' });
    expect((await service.find(query)).data.map((r) => r.id)).toEqual([1]);
    expect(query).toEqual({ state: 'active' });
  });
  it('applies scope to every caller OR branch', async () => {
    const { service } = setup();
    const result = await service.find({
      or: JSON.stringify([{ state: 'active' }, { state: 'pending' }]),
    });
    expect(result.data.map((r) => r.id)).toEqual([1, 3]);
  });
  it('ANDs scope alternatives with caller alternatives', async () => {
    const { service } = setup();
    service.scope = [
      { partition: 'a', state: 'pending' },
      { partition: 'b', state: 'pending' },
    ];
    expect(
      (
        await service.find({
          or: JSON.stringify([{ state: 'active' }, { state: 'pending' }]),
        })
      ).data.map((r) => r.id),
    ).toEqual([3]);
  });
  it('contradictory caller authority field cannot override scope', async () => {
    const { service } = setup();
    expect((await service.find({ partition: 'b' })).total).toBe(0);
    expect(
      (
        await service.find({
          or: JSON.stringify([{ partition: 'b' }, { state: 'pending' }]),
        })
      ).data.map((r) => r.id),
    ).toEqual([3]);
  });
  it('findByPk rejects an out-of-scope row', async () => {
    expect(await setup().service.findByPk(2)).toBeNull();
  });
  it('findOne rejects an out-of-scope row', async () => {
    expect(await setup().service.findOne(2, { with: 'detail' })).toBeNull();
  });
  it('findOneBy rejects an out-of-scope unique value', async () => {
    expect(await setup().service.findOneBy('id', 2)).toBeNull();
  });
  it('count is scoped', async () => {
    expect(await setup().service.count({ state: 'active' })).toBe(1);
  });
  it('exists is scoped', async () => {
    expect(await setup().service.exists({ partition: 'b' })).toBe(false);
  });
  it('update outside scope never writes', async () => {
    const { service, calls, rows } = setup();
    expect(await service.updateByPk(2, { state: 'changed' })).toBeNull();
    expect(calls).not.toContain('update');
    expect(rows[1].state).toBe('active');
  });
  it('unique-column update cannot bypass scope', async () => {
    const { service, calls } = setup();
    expect(
      await service.updateByUniqueColumn('id', 2, { state: 'changed' }),
    ).toBeNull();
    expect(calls).not.toContain('update');
  });
  it('scoped update writes and returns the updated row', async () => {
    const { service } = setup();
    expect(
      (await service.updateByUniqueColumn('id', 1, { state: 'changed' }))
        ?.state,
    ).toBe('changed');
  });
  it('update retains scope in the final predicate after a racing change', async () => {
    const { service, rows, race } = setup();
    race(() => (rows[0].partition = 'b'));
    expect(await service.updateByPk(1, { state: 'changed' })).toBeNull();
    expect(rows[0].state).toBe('active');
  });
  it('delete outside scope cannot remove a row', async () => {
    const { service, rows } = setup();
    expect(await service.removeByPk(2)).toBe(false);
    expect(rows.some((r) => r.id === 2)).toBe(true);
  });
  it('unique-column delete cannot bypass scope', async () => {
    expect(await setup().service.removeByUniqueColumn('id', 2)).toBe(false);
  });
  it('delete inside scope succeeds', async () => {
    expect(await setup().service.removeByPk(1)).toBe(true);
  });
  it('soft delete respects scope', async () => {
    const { service, rows } = setup();
    expect(await service.softDeleteByPk(2)).toBe(false);
    expect(await service.softDeleteByPk(1)).toBe(true);
    expect(rows[1].deletedAt).toBeUndefined();
  });
  it('restore respects scope and can address deleted rows', async () => {
    const { service } = setup();
    expect(await service.restoreByPk(2)).toBe(false);
    expect(await service.restoreByPk(4)).toBe(true);
    expect((await service.findByPk(4))?.deletedAt).toBeNull();
  });
  it('scoped create overwrites controlled values without mutating input', async () => {
    const { service, calls } = setup();
    const input = Object.freeze({ id: 5, partition: 'b', state: 'active' });
    expect((await service.create(input)).partition).toBe('a');
    expect(input.partition).toBe('b');
    expect(calls).toContain('insert');
    expect(calls).not.toContain('save');
  });
  it('create never upserts an existing natural key outside scope', async () => {
    const { service, rows } = setup();
    await expect(
      service.create({ id: 2, partition: 'b', state: 'changed' }),
    ).rejects.toThrow('duplicate key');
    expect(rows[1].state).toBe('active');
  });
  it('scoped update cannot change controlled fields or natural PK', async () => {
    const { service, rows } = setup();
    await service.updateByPk(1, { id: 2, partition: 'b', state: 'changed' });
    expect(rows[0]).toMatchObject({ id: 1, partition: 'a', state: 'changed' });
    expect(rows[1].state).toBe('active');
  });
  it('scope alternatives require an explicit valid create candidate', async () => {
    const { service } = setup();
    service.scope = [{ partition: 'a' }, { partition: 'b' }];
    await expect(service.create({ state: 'active' })).rejects.toThrow(
      'explicit scope alternative',
    );
    expect(
      (await service.create({ partition: 'b', state: 'active' })).partition,
    ).toBe('b');
  });
  it('updates cannot move authority fields across alternatives', async () => {
    const { service } = setup();
    service.scope = [{ partition: 'a' }, { partition: 'b' }];
    await expect(service.updateByPk(1, { partition: 'b' })).rejects.toThrow(
      'reassign',
    );
  });
  it('specialization can reject input before scope enforcement', async () => {
    class Rejecting extends ScopedService {
      protected override prepareMutation(data: Partial<Row>): Partial<Row> {
        if (data.partition !== undefined && data.partition !== 'a')
          throw new Error('Context mismatch');
        return data;
      }
    }
    const f = fixture();
    await expect(
      new Rejecting(f.repo).create({ partition: 'b' }),
    ).rejects.toThrow('Context mismatch');
    expect(f.calls).toHaveLength(0);
  });
  it('relation filtering and eager selection cannot bypass root scope', async () => {
    const { service } = setup();
    expect(
      (await service.find({ 'detail.label': 'same', with: 'detail' })).data.map(
        (r) => r.id,
      ),
    ).toEqual([1, 3]);
    expect(await service.findOne(2, { with: 'detail' })).toBeNull();
  });
  it('scoped graph mutations fail explicitly', async () => {
    const { service } = setup();
    await expect(service.create({ detail: { label: 'x' } })).rejects.toThrow(
      'graph writes',
    );
    await expect(
      service.updateByPk(1, { detail: { label: 'x' } }),
    ).rejects.toThrow('graph writes');
  });
  it('runtime read options cannot override guarded where', async () => {
    const { service } = setup();
    const hostile = { where: { id: 2 } } as unknown as Parameters<
      typeof service.findByPk
    >[1];
    expect((await service.findByPk(1, hostile))?.id).toBe(1);
  });
  it('scope is deterministic and rebuilt for the current context', async () => {
    const { service, predicates } = setup();
    const a = await service.find();
    const b = await service.find();
    expect(a).toEqual(b);
    expect(predicates[0]).toEqual(predicates[1]);
    service.scope = { partition: 'b' };
    expect((await service.find()).data.map((r) => r.id)).toEqual([2]);
  });
});

describe('required scope and manager coverage', () => {
  const operations: Array<
    [
      string,
      (
        s: ScopedService,
        options?: { manager: EntityManager },
      ) => Promise<unknown>,
    ]
  > = [
    ['find', (s, o) => s.find({}, o)],
    ['findOne', (s, o) => s.findOne(2, {}, o)],
    ['findByPk', (s, o) => s.findByPk(2, o)],
    ['findOneBy', (s, o) => s.findOneBy('id', 2, o)],
    ['count', (s, o) => s.count({}, o)],
    ['exists', (s, o) => s.exists({}, o)],
    ['create', (s, o) => s.create({ id: 5, state: 'active' }, o)],
    ['update', (s, o) => s.updateByPk(2, { state: 'changed' }, o)],
    [
      'updateUnique',
      (s, o) => s.updateByUniqueColumn('id', 2, { state: 'changed' }, o),
    ],
    ['delete', (s, o) => s.removeByPk(2, o)],
    ['deleteUnique', (s, o) => s.removeByUniqueColumn('id', 2, o)],
    ['softDelete', (s, o) => s.softDeleteByPk(2, o)],
    ['restore', (s, o) => s.restoreByPk(2, o)],
  ];
  for (const [name, run] of operations) {
    it(name + ' fails closed with missing required scope', async () => {
      const f = setup();
      f.service.scope = undefined;
      await expect(run(f.service)).rejects.toThrow('requires a scope');
      expect(f.calls).toHaveLength(0);
    });
    it(
      name + ' uses the supplied manager and preserves isolation',
      async () => {
        const base = fixture(),
          transactional = fixture();
        const manager = {
          getRepository: () => transactional.repo,
        } as unknown as EntityManager;
        const service = new ScopedService(base.repo);
        await run(service, { manager });
        expect(base.calls).toHaveLength(0);
        expect(transactional.calls.length).toBeGreaterThan(0);
        expect(transactional.rows.find((r) => r.id === 2)).toMatchObject({
          partition: 'b',
          state: 'active',
        });
        expect(
          service.contexts.every((context) => context.manager === manager),
        ).toBe(true);
      },
    );
  }
  for (const invalid of [
    {},
    [],
    [{}],
    { partition: undefined },
    { partition: null },
    { partition: NaN },
    { partition: { nested: 'a' } },
    { missing: 'a' },
  ]) {
    it('rejects malformed scope ' + JSON.stringify(invalid), async () => {
      const f = setup();
      f.service.scope = invalid as unknown as ScopeWhere<Row>;
      await expect(f.service.find()).rejects.toThrow('Scope must contain');
      expect(f.calls).toHaveLength(0);
    });
  }
});
