# example

An example Kysely project using [kysely-d1](https://github.com/aidenwallis/kysely-d1) and [Cloudflare D1](https://blog.cloudflare.com/introducing-d1/).

## Setup

**First, create a D1 database:**

```bash
npm run create-db
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
npm run setup
```

## Running locally

After setup, run the project locally:

```bash
npm run start
```
