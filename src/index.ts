import {
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
import type { MutatingQueryNode, RootOperationNode } from 'kysely';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * How the dialect implements `db.transaction()`.
 *
 * - `none` (default): transactions are rejected, because D1 has no `BEGIN`/`COMMIT`.
 * - `batch`: writes are buffered until commit and then sent as a single {@link D1Database.batch}
 *   call, which D1 runs as one atomic unit and rolls back entirely if any statement fails.
 *
 * `batch` trades a few guarantees for that atomicity, so it is opt-in. Inside a transaction:
 *
 * - Reads run immediately and do **not** see the writes buffered before them.
 * - A buffered write reports `numAffectedRows` as `1` and no `insertId`, because the real counts
 *   only exist once the batch has run.
 * - A write with a `returning` clause is rejected, since its rows cannot be produced up front.
 * - A raw query that is neither a `select` nor an `insert`/`update`/`delete` is rejected, because
 *   the dialect cannot tell whether it must be deferred to stay atomic.
 * - Schema changes run immediately and are not part of the batch.
 * - Errors surface from `commit`, not from the statement that caused them.
 */
export type D1TransactionMode = 'none' | 'batch';

/**
 * Config for the D1 dialect. Pass your D1 instance to this object that you bound in `wrangler.toml`.
 */
export interface D1DialectConfig {
  database: D1Database;

  /**
   * Defaults to `none`. See {@link D1TransactionMode} for what `batch` changes.
   *
   * ```typescript
   * new D1Dialect({
   *   database: env.DB,
   *   transactionMode: 'batch',
   * })
   * ```
   */
  transactionMode?: D1TransactionMode;
}

const leadingWrite = /^\s*(?:insert|update|delete)\b/i;
const leadingRead = /^\s*select\b/i;
const rawReturning = /\breturning\b/i;

const returningNotSupported =
  "A 'returning' clause cannot be used inside a 'batch' transaction, because the rows are only known once the " +
  'transaction commits. Run the query outside of a transaction, or drop the clause.';

function asMutatingQuery(node: RootOperationNode): MutatingQueryNode | undefined {
  if (node.kind === 'InsertQueryNode' || node.kind === 'UpdateQueryNode' || node.kind === 'DeleteQueryNode') {
    return node;
  }
  return undefined;
}

/**
 * Decides whether a query has to be buffered until commit for the transaction to stay atomic.
 * Queries built with the query builder are classified from their operation node; raw queries can
 * only be classified from their SQL, and anything that is not clearly a read or a write is
 * rejected rather than silently run outside the batch.
 */
function isDeferredWrite(compiledQuery: CompiledQuery): boolean {
  const mutatingQuery = asMutatingQuery(compiledQuery.query);
  if (mutatingQuery) {
    if (mutatingQuery.returning) {
      throw new Error(returningNotSupported);
    }
    return true;
  }

  if (compiledQuery.query.kind !== 'RawNode') {
    return false;
  }

  if (leadingWrite.test(compiledQuery.sql)) {
    if (rawReturning.test(compiledQuery.sql)) {
      throw new Error(returningNotSupported);
    }
    return true;
  }

  if (leadingRead.test(compiledQuery.sql)) {
    return false;
  }

  throw new Error(
    `Could not classify this query as a read or a write, so it cannot be run in a 'batch' transaction: ${compiledQuery.sql}. ` +
      'Build it with the Kysely query builder, or run it outside of a transaction.'
  );
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

class D1Connection implements DatabaseConnection {
  #config: D1DialectConfig;
  #bufferedWrites: CompiledQuery[] | null = null;

  constructor(config: D1DialectConfig) {
    this.#config = config;
  }

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    if (this.#bufferedWrites !== null && isDeferredWrite(compiledQuery)) {
      this.#bufferedWrites.push(compiledQuery);

      // The batch has not run yet, so the real counts do not exist. One affected row is the
      // optimistic answer, and it is corrected by the commit failing if it turns out to be wrong.
      return { rows: [], numAffectedRows: BigInt(1) };
    }

    const results = await this.#config.database
      .prepare(compiledQuery.sql)
      .bind(...compiledQuery.parameters)
      .all();
    if (results.error) {
      throw new Error(results.error);
    }

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

  async beginTransaction() {
    this.#assertBatchTransactions();
    this.#bufferedWrites = [];
  }

  async commitTransaction() {
    this.#assertBatchTransactions();
    const writes = this.#bufferedWrites;
    if (!writes) throw new Error('No transaction to commit');
    this.#bufferedWrites = null;
    if (!writes.length) return;

    // D1 runs a batch as a single transaction, and rolls all of it back if any statement fails.
    await this.#config.database.batch(writes.map((write) => this.#config.database.prepare(write.sql).bind(...write.parameters)));
  }

  async rollbackTransaction() {
    this.#assertBatchTransactions();

    // Kysely also rolls back when the commit itself failed, and throwing here would replace the
    // error that D1 reported with a less useful one. Dropping the buffer is the whole rollback:
    // the batch either ran atomically or never ran at all.
    this.#bufferedWrites = null;
  }

  #assertBatchTransactions() {
    if (this.#config.transactionMode !== 'batch') {
      throw new Error('Transactions are not supported yet.');
    }
  }

  async *streamQuery<O>(_compiledQuery: CompiledQuery, _chunkSize: number): AsyncIterableIterator<QueryResult<O>> {
    throw new Error('D1 Driver does not support streaming');
  }
}
