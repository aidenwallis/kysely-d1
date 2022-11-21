const BASE_URL = 'https://api.cloudflare.com/client/v4';

export class D1Api {
  #apiToken;
  #accountId;

  constructor(apiToken: string, accountId: string) {
    this.#apiToken = apiToken;
    this.#accountId = accountId;
  }

  #fetch(input: Request | string, init?: RequestInit) {
    const headers = new Headers(init?.headers);

    headers.set('Authorization', `Bearer ${this.#apiToken}`);
    headers.set('Content-Type', 'application/json');
    return fetch(input, {
      ...init,
      headers: headers,
    });
  }

  async listDatabases() {
    const perPage = 10;
    const databases: { uuid: string; name: string }[] = [];
    let page = 1;
    while (databases.length % perPage === 0) {
      const params = new URLSearchParams({
        per_page: perPage.toString(),
        page: page.toString(),
      });
      const response = await this.#fetch(`${BASE_URL}/accounts/${this.#accountId}/d1/database?${params.toString()}`);
      const json = (await response.json()) as any;
      const results = json.result;
      databases.push(...results);
      page++;
      if (results.length < perPage) {
        break;
      }
    }
    return databases;
  }

  async databseFromName(name: string) {
    const allDBs = await this.listDatabases();
    const matchingDB = allDBs.find((db: { uuid: string; name: string }) => db.name === name);
    return matchingDB ?? null;
  }

  async queryDatabase(
    databaseId: string,
    query: string,
    params: readonly unknown[]
  ): Promise<{ success: true; data: any } | { success: false; error: any }> {
    try {
      const reply = await this.#fetch(`${BASE_URL}/accounts/${this.#accountId}/d1/database/${databaseId}/query`, {
        method: 'POST',
        body: JSON.stringify({ sql: query, params }),
      });
      if (reply.ok) {
        const jsonData = (await reply.json()) as any;
        return { success: true, data: jsonData };
      } else {
        try {
          const jsonData = (await reply.json()) as any;
          return { success: false, error: jsonData.errors[0].message };
        } catch (e) {
          return { success: false, error: reply.statusText };
        }
      }
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
}
