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
import { D1Api } from './d1-api';

export interface D1DialectConfig {
  apiKey: string;
  accountId: string;
  databaseName: string;
}

export class D1APIDialect implements Dialect {
  #config;

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
    const apiClient = new D1Api(this.#config.apiKey, this.#config.accountId);
    const database = await apiClient.databseFromName(this.#config.databaseName);

    if (!database) {
      throw new Error(`Database ${this.#config.databaseName} not found`);
    }

    return new D1Connection({
      apiClient: apiClient,
      databaseId: database.uuid,
    });
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

interface D1ConnectionConfig {
  apiClient: D1Api;
  databaseId: string;
}

class D1Connection implements DatabaseConnection {
  #config;
  //   #transactionClient?: D1Connection

  constructor(config: D1ConnectionConfig) {
    this.#config = config;
  }

  async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
    // Transactions are not supported yet.
    // if (this.#transactionClient) return this.#transactionClient.executeQuery(compiledQuery)

    const queryResult = await this.#config.apiClient.queryDatabase(
      this.#config.databaseId,
      compiledQuery.sql,
      compiledQuery.parameters
    );
    if (queryResult.success === false) {
      throw new Error(queryResult.error);
    }

    const result = queryResult.data.result[0];

    return {
      insertId: result.meta.last_row_id !== null ? BigInt(result.meta.last_row_id) : undefined,
      rows: (result?.results as O[]) ?? [],
      numUpdatedOrDeletedRows: result.meta.changes > 0 ? BigInt(result.meta.changes) : undefined,
    };
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
