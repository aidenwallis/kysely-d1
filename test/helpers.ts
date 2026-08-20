import { Miniflare } from 'miniflare';
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';

export interface TestDatabase {
  kv: { key: string; value: string };
  audit: { key: string; note: string };
}

/**
 * Wraps a real D1 binding, counting the calls made to `batch()` so tests can assert how many
 * round trips a transaction costs. Every call is delegated to the underlying database.
 */
export interface CountingD1Database {
  database: D1Database;
  batchCalls: number;
  batchedStatements: number;
}

export async function createTestDatabase(): Promise<{ db: CountingD1Database; dispose: () => Promise<void> }> {
  const mf = new Miniflare({
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
    d1Databases: { DB: ':memory:' },
    compatibilityDate: '2025-01-01',
  });

  const database = (await mf.getD1Database('DB')) as unknown as D1Database;
  await database.exec('CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  await database.exec('CREATE UNIQUE INDEX kv_value ON kv (value)');
  await database.exec('CREATE TABLE audit (key TEXT PRIMARY KEY, note TEXT NOT NULL)');

  const counting: CountingD1Database = { database, batchCalls: 0, batchedStatements: 0 };
  counting.database = new Proxy(database, {
    get(target, property, receiver) {
      if (property === 'batch') {
        return (statements: D1PreparedStatement[]) => {
          counting.batchCalls += 1;
          counting.batchedStatements += statements.length;
          return target.batch(statements);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return { db: counting, dispose: () => mf.dispose() };
}

export async function countRows(database: D1Database, table: 'kv' | 'audit'): Promise<number> {
  const row = await database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
  return row?.n ?? 0;
}
