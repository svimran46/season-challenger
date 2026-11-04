import { createApp } from './app';
import { loadConfig } from './config';
import { createDatabase } from './db/client';
import { createFeed } from './feed.module';

async function main() {
  const config = loadConfig();
  const database = config.databaseUrl ? createDatabase(config.databaseUrl) : undefined;
  if (config.feedWarning) console.warn(config.feedWarning);
  // The fake league is built by createApp, which pins its dates to what is already stored.
  const feed = config.feed.kind === 'fake' ? undefined : createFeed(config.feed);
  const app = await createApp({ database, feed, workerSeconds: config.workerSeconds });
  await app.listen(config.port);
  console.log(
    `Season Challenger API listening on http://localhost:${config.port} (${
      database ? 'Postgres' : 'in memory'
    }, ${feed?.name ?? 'fake'} feed)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
