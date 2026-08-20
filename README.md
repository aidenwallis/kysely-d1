# kysely-d1

[![ci](https://github.com/aidenwallis/kysely-d1/actions/workflows/ci.yaml/badge.svg)](https://github.com/aidenwallis/kysely-d1/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/kysely-d1.svg)](https://www.npmjs.com/package/kysely-d1)

[Kysely](https://github.com/koskimas/kysely) adapter for [Cloudflare D1](https://developers.cloudflare.com/d1/).

```bash
npm i kysely-d1
```

This project was largely adapted from [kysely-planetscale](https://github.com/depot/kysely-planetscale).

## Usage

Pass your D1 binding into the dialect in order to configure the Kysely client. Follow [these docs](https://developers.cloudflare.com/d1/get-started/#4-bind-your-worker-to-your-d1-database) for instructions on how to do so.

```typescript
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';

export interface Env {
  DB: D1Database;
}

interface KvTable {
  key: string;
  value: string;
}

interface Database {
  kv: KvTable;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');
    if (!key) {
      return new Response('No key defined.', { status: 400 });
    }

    // Create Kysely instance with kysely-d1
    const db = new Kysely<Database>({ dialect: new D1Dialect({ database: env.DB }) });
    
    // Read row from D1 table
    const result = await db.selectFrom('kv').selectAll().where('key', '=', key).executeTakeFirst();
    if (!result) {
      return new Response('No value found', { status: 404 });
    }

    return new Response(result.value);
  },
};
```

There is a working [example](example) also included, which implements a K/V style store using D1.

## Transactions

D1 has no `BEGIN`/`COMMIT`, so `db.transaction()` is rejected by default. It does have
[`batch()`](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), which runs a list of statements as a
single atomic unit and rolls all of them back if any one of them fails. Opt in with `transactionMode: 'batch'` to have
transactions built on top of it:

```typescript
const db = new Kysely<Database>({
  dialect: new D1Dialect({ database: env.DB, transactionMode: 'batch' }),
});

// Both rows are written, or neither is.
await db.transaction().execute(async (trx) => {
  await trx.insertInto('kv').values({ key: 'a', value: '1' }).execute();
  await trx.insertInto('kv').values({ key: 'b', value: '2' }).execute();
});
```

Writes are buffered until the transaction commits, and the commit sends them as one `batch()` call. That is what makes
the transaction atomic, and it is also where the trade-offs come from. Inside a transaction:

- Reads run immediately, so they do **not** see the writes buffered before them.
- A buffered write reports `numAffectedRows` as `1` and no `insertId`, because the real counts only exist once the batch
  has run.
- A write with a `returning` clause is rejected, since its rows cannot be produced up front.
- A raw query that is neither a `select` nor an `insert`/`update`/`delete` is rejected, because the dialect cannot tell
  whether it has to be deferred to stay atomic. Build it with the query builder instead.
- Schema changes run immediately and are not part of the batch.
- Errors surface from the commit rather than from the statement that caused them.

If your code needs read-your-writes inside a transaction, or exact affected-row counts, stay on the default mode.
