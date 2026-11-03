# Development guide

Season Challenger is a pnpm monorepo in TypeScript.

| Path              | What it is                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared` | Domain types and pure game rules: squad validation, fantasy points, contest ranking, Season Mastery grading, ratings and tiers |
| `packages/feed`   | `FootballFeed` interface plus `FakeFeed`, an offline league of eight fictional clubs                                           |
| `apps/api`        | NestJS REST API and the Drizzle database schema                                                                                |
| `apps/mobile`     | Expo (React Native) app with Expo Router                                                                                       |

## Requirements

- Node 22 (see `.nvmrc`) and pnpm 10 (`corepack enable` picks the pinned version)
- Docker, for Postgres and Redis (only needed once the API uses the database)

## First run

```bash
pnpm install
cp .env.example .env
pnpm test            # all unit and API tests
pnpm dev:api         # API on http://localhost:3000
pnpm dev:mobile      # Expo dev server; press w for web, or scan the QR code with Expo Go
```

On a physical phone, set `EXPO_PUBLIC_API_URL` to your computer's LAN address, for example
`http://192.168.1.20:3000`, because `localhost` on the phone is the phone itself.

## The fake feed

`FOOTBALL_FEED=fake` (the default) serves a deterministic league: same seed, same clubs, players,
fixtures and match stats on every machine. Its season starts five weeks before today, so there are
always finished fixtures with points and upcoming fixtures with open deadlines.

## API

| Method | Path                             | Notes                                             |
| ------ | -------------------------------- | ------------------------------------------------- |
| GET    | `/health`                        | Status and active feed                            |
| GET    | `/v1/season`                     | Season info and current gameweek                  |
| GET    | `/v1/fixtures?gameweek=&status=` | Fixtures with both clubs                          |
| GET    | `/v1/fixtures/:id`               | Fixture with both squads                          |
| GET    | `/v1/fixtures/:id/points`        | Fantasy points per player, finished fixtures only |
| POST   | `/v1/squads/validate`            | Checks a squad; locked once the fixture kicks off |

## Database

```bash
docker compose up -d
pnpm --filter @season/api db:migrate     # apply migrations
pnpm --filter @season/api db:generate    # after editing apps/api/src/db/schema.ts
```

CI fails if `schema.ts` changes without a matching migration.

## Checks

```bash
pnpm format:check
pnpm typecheck
pnpm test
```

The same checks run in GitHub Actions on every push to `main`.
