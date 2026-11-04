import { createApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';

async function main() {
  const config = loadConfig();
  const database = config.databaseUrl ? createDatabase(config.databaseUrl) : undefined;
  const app = await createApp({ database, workerSeconds: config.workerSeconds });
  await app.listen(config.port);
  console.log(
    `Season Challenger API listening on http://localhost:${config.port} (${
      database ? 'Postgres' : 'in memory'
    })`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
