import { createApp } from './app';

async function main() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Season Challenger API listening on http://localhost:${port}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
