import { Kysely } from 'kysely';
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

describe('the D1 dialect', () => {
  const connect = () => new Kysely<TestDatabase>({ dialect: new D1Dialect({ database: db.database }) });

  it('inserts and reads back a row', async () => {
    const kysely = connect();

    await kysely.insertInto('kv').values({ key: 'a', value: '1' }).execute();

    expect(await kysely.selectFrom('kv').selectAll().execute()).toEqual([{ key: 'a', value: '1' }]);
  });

  it('reports the number of affected rows', async () => {
    const kysely = connect();
    await kysely.insertInto('kv').values({ key: 'a', value: '1' }).execute();

    const updated = await kysely.updateTable('kv').set({ value: '2' }).where('key', '=', 'a').executeTakeFirst();

    expect(updated.numUpdatedRows).toBe(1n);
  });

  it('returns the rows of a returning clause', async () => {
    const kysely = connect();

    const rows = await kysely.insertInto('kv').values({ key: 'a', value: '1' }).returning('key').execute();

    expect(rows).toEqual([{ key: 'a' }]);
  });

  it('refuses to start a transaction', async () => {
    const kysely = connect();

    await expect(
      kysely.transaction().execute(async (trx) => {
        await trx.insertInto('kv').values({ key: 'a', value: '1' }).execute();
      })
    ).rejects.toThrow('Transactions are not supported yet.');

    expect(await countRows(db.database, 'kv')).toBe(0);
  });
});
