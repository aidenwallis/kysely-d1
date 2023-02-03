/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

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
    const db = new Kysely<Database>({
      dialect: new D1Dialect({ database: env.DB }),
    });

    switch (action) {
      case 'get': {
        if (!key) {
          return new Response('Key is not defined.', { status: 400 });
        }
        const result = await db.selectFrom('kv').selectAll().where('key', '=', key).executeTakeFirst();
        if (!result) {
          return new Response('', { status: 404 });
        }
        return new Response(result.value);
      }

      case 'set': {
        if (!(key && value)) {
          return new Response('Key and value must be defined.', { status: 400 });
        }
        try {
          await db
            .insertInto('kv')
            .values([{ key, value }])
            .onConflict((oc) => oc.column('key').doUpdateSet({ value }))
            .execute();
        } catch (err) {
          console.log(err);
          console.log((err as any).cause);
          throw err;
        }
        return new Response(value, { status: 200 });
      }

      case 'delete': {
        if (!key) {
          return new Response('Key is not defined.', { status: 400 });
        }
        await db.deleteFrom('kv').where('key', '=', key).execute();
        return new Response('', { status: 200 });
      }
    }

    return new Response(`Action must be get/set/delete`, { status: 400 });
  },
};
