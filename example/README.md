# example

An example Kysely project using kysely-d1.

## Setup

**First, create a D1 database:**

```bash
npx wrangler d1 create kysely-test
```

Take note of the name and UUID of the database.

**Then, update the binding in `wrangler.toml` to use your D1 database.**

```toml
[[ d1_databases ]]
binding = "DB" # i.e. available in your Worker on env.DB
database_name = "kysely-test"
database_id = "<YOUR ID>"
```

**Then, run the migration script:**

```bash
npx wrangler d1 execute kysely-test --file ./setup.sql --local
```

## Running locally

After setup, run the project locally:

```bash
npx wrangler dev --local --persist
```
