import {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  DatabaseMetadataOptions,
  DEFAULT_MIGRATION_LOCK_TABLE,
  DEFAULT_MIGRATION_TABLE,
  Dialect,
  Driver,
  Kysely,
  QueryCompiler,
  QueryResult,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
  TableMetadata,
} from "kysely";
import type { D1Database } from "@cloudflare/workers-types";

/**
 * Config for the D1 dialect. Pass your D1 instance to this object that you bound in `wrangler.toml`.
 */
export interface D1DialectConfig {
  database: D1Database;
}

/**
 * A custom Kysely Introspector class for D1 that uses supported SQLite PRAGMA
 * statements to get the table metadata, instead of querying protected tables.
 */
class D1Introspector extends SqliteIntrospector {
  #config: D1DialectConfig;

  constructor(db: Kysely<any>, config: D1DialectConfig) {
    super(db);

    this.#config = config;
  }

  async #getTableMetadata(
    name: string,
    isView: boolean,
  ): Promise<TableMetadata> {
    const result = await this.#config.database.prepare(
      `PRAGMA table_info(${name})`,
    ).run();
    const rows = result.results as {
      name: string;
      type: string;
      notnull: 1 | 0;
      dflt_value: unknown;
    }[];

    return {
      name,
      isView,
      columns: rows.map((row) => ({
        name: row.name,
        dataType: row.type,
        isAutoIncrementing: false,
        isNullable: row.notnull === 0,
        hasDefaultValue: row.dflt_value !== null,
      })),
    };
  }

  async getTables(options?: DatabaseMetadataOptions): Promise<TableMetadata[]> {
    const result = await this.#config.database.prepare("PRAGMA table_list")
      .run();
    // We filter out tables that start with "_cf_", as they are internal tables
    // which will cause errors when trying to introspect them.
    let tables = (
      result.results as {
        name: string;
        type: "table" | "view";
      }[]
    ).filter(({ name }) => !name.startsWith("_cf_"));

    if (!options?.withInternalKyselyTables) {
      tables = tables.filter(
        ({ name }) =>
          name !== DEFAULT_MIGRATION_TABLE &&
          name !== DEFAULT_MIGRATION_LOCK_TABLE,
      );
    }

    return Promise.all(
      tables.map(({ name, type }) =>
        this.#getTableMetadata(name, type === "view")
      ),
    );
  }
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
    return new D1Introspector(db, this.#config);
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

    const numAffectedRows = results.meta.changes > 0
      ? BigInt(results.meta.changes)
      : undefined;

    return {
      insertId: results.meta.last_row_id === undefined ||
          results.meta.last_row_id === null
        ? undefined
        : BigInt(results.meta.last_row_id),
      rows: (results?.results as O[]) || [],
      numAffectedRows,
      // @ts-ignore deprecated in kysely >= 0.23, keep for backward compatibility.
      numUpdatedOrDeletedRows: numAffectedRows,
    };
  }

  async beginTransaction() {
    // this.#transactionClient = this.#transactionClient ?? new PlanetScaleConnection(this.#config)
    // this.#transactionClient.#conn.execute('BEGIN')
    throw new Error("Transactions are not supported yet.");
  }

  async commitTransaction() {
    // if (!this.#transactionClient) throw new Error('No transaction to commit')
    // this.#transactionClient.#conn.execute('COMMIT')
    // this.#transactionClient = undefined
    throw new Error("Transactions are not supported yet.");
  }

  async rollbackTransaction() {
    // if (!this.#transactionClient) throw new Error('No transaction to rollback')
    // this.#transactionClient.#conn.execute('ROLLBACK')
    // this.#transactionClient = undefined
    throw new Error("Transactions are not supported yet.");
  }

  async *streamQuery<O>(
    _compiledQuery: CompiledQuery,
    _chunkSize: number,
  ): AsyncIterableIterator<QueryResult<O>> {
    throw new Error("D1 Driver does not support streaming");
  }
}
