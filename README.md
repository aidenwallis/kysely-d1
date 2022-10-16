# kysely-d1

[![ci](https://github.com/aidenwallis/kysely-d1/actions/workflows/ci.yaml/badge.svg)](https://github.com/aidenwallis/kysely-d1/actions/workflows/ci.yaml)

```bash
npm install kysely-d1
```

An adapter for [Cloudflare D1](https://blog.cloudflare.com/introducing-d1/) using [Kysely](https://github.com/koskimas/kysely).

This project was largely adapted from [kysely-planetscale](https://github.com/depot/kysely-planetscale).

## Usage

Pass your D1 binding into the dialect in order to configure the Kysely client. Follow the private D1 beta docs to setup a D1 binding to your worker.

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
    const action = searchParams.get('action');
    const key = searchParams.get('key');
    const value = searchParams.get('value');
    const db = new Kysely<Database>({ dialect: new D1Dialect({ database: env.DB }) });
  },
};
```

There is a working [example](example) also included, that implements a K/V style store using D1.
