import { Kysely, sql } from 'kysely';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { D1Dialect } from '../src';
import { CountingD1Database, countRows, createTestDatabase, TestDatabase } from './helpers';

let db: CountingD1Database;
let dispose: () => Promise<void>;

beforeEach(async () => {
  ({ db, dispose } = await createTestDatabase());
});

afterEach(async () => {
  await dispose();
});

describe('the batch transaction mode', () => {
  const connect = () => new Kysely<TestDatabase>({ dialect: new D1Dialect({ database: db.database, transactionMode: 'batch' }) });

  it('commits every write in the transaction as a single batch', async () => {
    const kysely = connect();

    await kysely.transaction().execute(async (trx) => {
      await trx.insertInto('kv').values({ key: 'a', value: '1' }).execute();
      await trx.insertInto('kv').values({ key: 'b', value: '2' }).execute();
      await trx.updateTable('kv').set({ value: '3' }).where('key', '=', 'a').execute();
    });

    expect(await kysely.selectFrom('kv').selectAll().orderBy('key').execute()).toEqual([
      { key: 'a', value: '3' },
      { key: 'b', value: '2' },
    ]);
    expect(db.batchCalls).toBe(1);
    expect(db.batchedStatements).toBe(3);
  });

  it('persists nothing when a later statement in the transaction violates a constraint', async () => {
    const kysely = connect();

    await expect(
      kysely.transaction().execute(async (trx) => {
        await trx.insertInto('audit').values({ key: 'a', note: 'clean' }).execute();
        await trx.insertInto('kv').values({ key: 'a', value: '1' }).execute();
        await trx.insertInto('kv').values({ key: 'b', value: '1' }).execute();
      })
    ).rejects.toThrow(/constraint/i);

    expect(await countRows(db.database, 'kv')).toBe(0);
    expect(await countRows(db.database, 'audit')).toBe(0);
  });

  it('executes nothing when the transaction is rolled back', async () => {
    const kysely = connect();

    await expect(
      kysely.transaction().execute(async (trx) => {
        await trx.insertInto('kv').values({ key: 'a', value: '1' }).execute();
        throw new Error('rolled back on purpose');
      })
    ).rejects.toThrow('rolled back on purpose');

    expect(await countRows(db.database, 'kv')).toBe(0);
    expect(db.batchCalls).toBe(0);
  });

  it('runs reads inside a transaction immediately, so they do not see the buffered writes', async () => {
    const kysely = connect();
    await kysely.insertInto('kv').values({ key: 'committed', value: '0' }).execute();

    let readInsideTransaction: { key: string; value: string }[] = [];
    await kysely.transaction().execute(async (trx) => {
      await trx.insertInto('kv').values({ key: 'buffered', value: '1' }).execute();
      readInsideTransaction = await trx.selectFrom('kv').selectAll().orderBy('key').execute();
    });

    expect(readInsideTransaction).toEqual([{ key: 'committed', value: '0' }]);
    expect(await countRows(db.database, 'kv')).toBe(2);
  });

  it('reports a buffered write as one affected row and no insert id', async () => {
    const kysely = connect();

    let result: { insertId: bigint | undefined; numInsertedOrUpdatedRows: bigint | undefined } | undefined;
    await kysely.transaction().execute(async (trx) => {
      const inserted = await trx.insertInto('kv').values({ key: 'a', value: '1' }).executeTakeFirst();
      result = { insertId: inserted.insertId, numInsertedOrUpdatedRows: inserted.numInsertedOrUpdatedRows };
    });

    expect(result).toEqual({ insertId: undefined, numInsertedOrUpdatedRows: 1n });
  });

  it('reports a buffered update and delete as one affected row', async () => {
    const kysely = connect();
    await kysely.insertInto('kv').values({ key: 'a', value: '1' }).execute();

    let updated: bigint | undefined;
    let deleted: bigint | undefined;
    await kysely.transaction().execute(async (trx) => {
      updated = (await trx.updateTable('kv').set({ value: '2' }).where('key', '=', 'a').executeTakeFirst()).numUpdatedRows;
      deleted = (await trx.deleteFrom('kv').where('key', '=', 'a').executeTakeFirst()).numDeletedRows;
    });

    expect(updated).toBe(1n);
    expect(deleted).toBe(1n);
  });

  it('refuses a returning clause inside a transaction instead of silently dropping the rows', async () => {
    const kysely = connect();

    await expect(
      kysely.transaction().execute(async (trx) => {
        await trx.insertInto('kv').values({ key: 'a', value: '1' }).returning('key').execute();
      })
    ).rejects.toThrow(/returning/i);
  });

  it('refuses a raw returning clause inside a transaction', async () => {
    const kysely = connect();

    await expect(
      kysely.transaction().execute(async (trx) => {
        await sql`insert into kv (key, value) values ('a', '1') returning key`.execute(trx);
      })
    ).rejects.toThrow(/returning/i);
  });

  it('refuses a raw common table expression inside a transaction, because it cannot be classified', async () => {
    const kysely = connect();

    await expect(
      kysely.transaction().execute(async (trx) => {
        await sql`with source as (select 'a' as key) insert into kv (key, value) select key, '1' from source`.execute(trx);
      })
    ).rejects.toThrow(/classif/i);
  });

  it('defers a common table expression write built with the query builder', async () => {
    const kysely = connect();

    await kysely.transaction().execute(async (trx) => {
      await trx
        .with('source', (qb) => qb.selectFrom('audit').select('key'))
        .insertInto('kv')
        .values({ key: 'a', value: '1' })
        .execute();
    });

    expect(db.batchCalls).toBe(1);
    expect(await countRows(db.database, 'kv')).toBe(1);
  });

  it('leaves writes outside a transaction untouched', async () => {
    const kysely = connect();

    const inserted = await kysely.insertInto('kv').values({ key: 'a', value: '1' }).executeTakeFirst();

    expect(inserted.numInsertedOrUpdatedRows).toBe(1n);
    expect(await countRows(db.database, 'kv')).toBe(1);
    expect(db.batchCalls).toBe(0);
  });

  it('returns rows for a returning clause used outside a transaction', async () => {
    const kysely = connect();

    const rows = await kysely.insertInto('kv').values({ key: 'a', value: '1' }).returning('key').execute();

    expect(rows).toEqual([{ key: 'a' }]);
  });
});
