import {
  Compilable,
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  Dialect,
  Driver,
  Kysely,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  QueryCompiler,
  QueryResult,
} from 'kysely';
import type { D1Database, D1Result } from '@cloudflare/workers-types';

/**
 * Config for the D1 dialect. Pass your D1 instance to this object that you bound in `wrangler.toml`.
 */
export interface D1DialectConfig {
  database: D1Database;
}

/**
 * D1 dialect that adds support for [Cloudflare D1][0] in [Kysely][1].
 * The constructor takes the instance of your D1 database that you bound in `wrangler.toml`.
 *
 * ```typescript
 * new D1Dialect({
 *   database: env.DB,
 * })
 * ```
 *
 * [0]: https://blog.cloudflare.com/introducing-d1/
 * [1]: https://github.com/koskimas/kysely
 */
export class D1Dialect implements Dialect {
  #config: D1DialectConfig;

  constructor(config: D1DialectConfig) {
    this.#config = config;
  }

  createAdapter() {
    return new SqliteAdapter();
  }

  createDriver(): Driver {
    return new D1Driver(this.#config);
  }

  createQueryCompiler(): QueryCompiler {
    return new SqliteQueryCompiler();
  }

  createIntrospector(db: Kysely<any>): DatabaseIntrospector {
    return new SqliteIntrospector(db);
  }
}

class D1Driver implements Driver {
  #config: D1DialectConfig;

  constructor(config: D1DialectConfig) {
    this.#config = config;
  }

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new D1Connection(this.#config);
  }

  async beginTransaction(conn: D1Connection): Promise<void> {
    return await conn.beginTransaction();
  }

  async commitTransaction(conn: D1Connection): Promise<void> {
    return await conn.commitTransaction();
  }

  async rollbackTransaction(conn: D1Connection): Promise<void> {
    return await conn.rollbackTransaction();
  }

  async releaseConnection(_conn: D1Connection): Promise<void> {}

  async destroy(): Promise<void> {}
}

function transformD1ResultToKyselyQueryResult<O>(results: D1Result<unknown>): QueryResult<O> {
  const numAffectedRows = results.meta.changes > 0 ? BigInt(results.meta.changes) : undefined;

  return {
    insertId:
      results.meta.last_row_id === undefined || results.meta.last_row_id === null
        ? undefined
        : BigInt(results.meta.last_row_id),
    rows: (results?.results as O[]) || [],
    numAffectedRows,
    // @ts-ignore deprecated in kysely >= 0.23, keep for backward compatibility.
    numUpdatedOrDeletedRows: numAffectedRows,
  };
}

class D1Connection implements DatabaseConnection {
  #config: D1DialectConfig;
  //   #transactionClient?: D1Connection

  constructor(config: D1DialectConfig) {
    this.#config = config;
  }

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    // Transactions are not supported yet.
    // if (this.#transactionClient) return this.#transactionClient.executeQuery(compiledQuery)

    const results = await this.#config.database
      .prepare(compiledQuery.sql)
      .bind(...compiledQuery.parameters)
      .all();
    if (results.error) {
      throw new Error(results.error);
    }

    return transformD1ResultToKyselyQueryResult(results);
  }

  async beginTransaction() {
    // this.#transactionClient = this.#transactionClient ?? new PlanetScaleConnection(this.#config)
    // this.#transactionClient.#conn.execute('BEGIN')
    throw new Error('Transactions are not supported yet.');
  }

  async commitTransaction() {
    // if (!this.#transactionClient) throw new Error('No transaction to commit')
    // this.#transactionClient.#conn.execute('COMMIT')
    // this.#transactionClient = undefined
    throw new Error('Transactions are not supported yet.');
  }

  async rollbackTransaction() {
    // if (!this.#transactionClient) throw new Error('No transaction to rollback')
    // this.#transactionClient.#conn.execute('ROLLBACK')
    // this.#transactionClient = undefined
    throw new Error('Transactions are not supported yet.');
  }

  async *streamQuery<O>(_compiledQuery: CompiledQuery, _chunkSize: number): AsyncIterableIterator<QueryResult<O>> {
    throw new Error('D1 Driver does not support streaming');
  }
}

type QueryOutput<Q> = Q extends Compilable<infer O> ? O : never
/**
 * Helper function of [Batch statements][0]
 *
 * ```typescript
 * const results = await batch(env.DB, [
 *   db.updateTable('kv').set({ value: '1' }).where('key', '=', key1),
 *   db.updateTable('kv').set({ value: '2' }).where('key', '=', key2),
 *   db.selectFrom('kv').selectAll().where('key', 'in', [key1, key2]),
 * ] as const)
 * const { rows } = results[2]
 * ```
 *
 * [0]: https://developers.cloudflare.com/d1/build-with-d1/d1-client-api/#batch-statements
 */
export async function batch<Q extends readonly Compilable[]>(
  database: D1Database,
  queries: Q
): Promise<{ [P in keyof Q]: QueryResult<QueryOutput<Q[P]>> }> {
  if (queries.length === 0)
    return [] as { [P in keyof Q]: QueryResult<QueryOutput<Q[P]>> };

  const results = await database.batch(
    queries
      .map((query) => query.compile())
      .map(({ sql, parameters }) => database.prepare(sql).bind(...parameters))
  );

  const error = results.find((result) => result.error);
  if (error) throw new Error(error.error);

  return results.map(
    (result): QueryResult<unknown> => transformD1ResultToKyselyQueryResult(result)
  ) as { [P in keyof Q]: QueryResult<QueryOutput<Q[P]>> };
}
