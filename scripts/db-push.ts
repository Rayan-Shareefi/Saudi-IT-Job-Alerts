/**
 * Applies supabase/migrations/*.sql to the database.
 *
 * Needs a direct Postgres connection string, which the Supabase JS client
 * cannot substitute for -- it speaks PostgREST, and PostgREST does not run DDL.
 * Grab it from Project settings -> Database -> Connection string (URI) and set
 * it as SUPABASE_DB_URL.
 *
 *   npx tsx scripts/db-push.ts
 *   npx tsx scripts/db-push.ts --print   # just show the SQL to paste manually
 */
import "dotenv/config";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const DIR = "supabase/migrations";

function migrations(): Array<{ name: string; sql: string }> {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(DIR, name), "utf8") }));
}

async function main(): Promise<void> {
  const files = migrations();

  if (process.argv.includes("--print")) {
    for (const f of files) console.log(`-- ${f.name}\n${f.sql}\n`);
    return;
  }

  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error(
      "SUPABASE_DB_URL is not set.\n\n" +
        "Either set it (Supabase -> Project settings -> Database -> Connection string -> URI),\n" +
        "or run `npx tsx scripts/db-push.ts --print` and paste the output into the SQL editor.",
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    /*
     * Track what has been applied, and apply only what has not.
     *
     * This runner used to re-apply every file on every push. That held only
     * while each file stayed valid against today's data, and 0002 does not:
     * it re-adds an experience-band constraint that 0007 later widened, so a
     * full re-run fails on every row banded "0" or "1-2".
     */
    await client.query(
      "create table if not exists public.schema_migrations (" +
        "name text primary key, applied_at timestamptz not null default now())",
    );
    // Not readable through the public API; only this runner touches it.
    await client.query("alter table public.schema_migrations enable row level security");

    const { rows } = await client.query<{ name: string }>("select name from public.schema_migrations");
    const applied = new Set(rows.map((r) => r.name));

    if (applied.size === 0) {
      // A database the untracked runner built: everything up to the baseline is
      // already in place (verified 2026-10-13 - jobs has closes_at and the
      // widened band constraint, url_decisions exists).
      const legacy = await client.query<{ ok: boolean }>(
        "select to_regclass('public.jobs') is not null as ok",
      );
      if (legacy.rows[0]?.ok) {
        for (const f of files.filter((x) => x.name <= LEGACY_BASELINE)) {
          await client.query("insert into public.schema_migrations (name) values ($1) on conflict do nothing", [f.name]);
          applied.add(f.name);
        }
        console.log(`baseline: recorded ${applied.size} migration(s) applied before tracking began`);
      }
    }

    const pending = files.filter((f) => !applied.has(f.name));
    if (pending.length === 0) {
      console.log("database is up to date");
      return;
    }
    for (const f of pending) {
      process.stdout.write(`applying ${f.name} ... `);
      await client.query("begin");
      try {
        await client.query(f.sql);
        await client.query("insert into public.schema_migrations (name) values ($1)", [f.name]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
      console.log("ok");
    }
    console.log(`
applied ${pending.length} migration(s)`);
  } finally {
    await client.end();
  }
}

/** The last migration the old, untracked runner is known to have applied. */
const LEGACY_BASELINE = "0007_entry_bands.sql";

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
