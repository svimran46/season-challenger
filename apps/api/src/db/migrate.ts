import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** Key for the advisory lock that makes two deploys take turns. */
const MIGRATE_LOCK = 7_301_002;

/** The drizzle folder sits beside dist/ in a build, and two levels above src/db in the repo. */
function migrationsFolder(): string {
  const folder = [join(__dirname, '../drizzle'), join(__dirname, '../../drizzle')].find((path) =>
    existsSync(join(path, 'meta/_journal.json')),
  );
  if (!folder) throw new Error(`No drizzle folder found near ${__dirname}.`);
  return folder;
}

/**
 * Applies any migration the database has not had yet and returns how many it now has. Already
 * applied ones are skipped, so running this again changes nothing. It reads only DATABASE_URL,
 * so a deploy can migrate before the rest of the API's settings exist.
 */
export async function runMigrations(url: string, folder = migrationsFolder()): Promise<number> {
  // A single connection, so the lock and the migrator share one session. Closing it unlocks.
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const db = drizzle(client);
    await db.execute(sql`select pg_advisory_lock(${MIGRATE_LOCK})`);
    await migrate(db, { migrationsFolder: folder });
    const [row] = await db.execute<{ count: string }>(
      sql`select count(*) as count from drizzle.__drizzle_migrations`,
    );
    return Number(row?.count);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL must be set to run migrations.');
    process.exit(1);
  }
  runMigrations(url)
    .then((count) => console.log(`Database is up to date: ${count} migration(s) applied.`))
    .catch((error: unknown) => {
      console.error(`Migration failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
