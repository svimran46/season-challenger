# Development guide

Season Challenger is a pnpm monorepo in TypeScript.

| Path              | What it is                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared` | Domain types and pure game rules: squad validation, fantasy points, contest ranking, Season Mastery grading, ratings and tiers |
| `packages/feed`   | `FootballFeed` interface plus `FakeFeed`, an offline league of eight fictional clubs                                           |
| `packages/wallet` | Coin ledger, rewards, tournament categories, prize tables and settlement, voucher redemption rules                             |
| `apps/api`        | NestJS REST API and the Drizzle database schema                                                                                |
| `apps/mobile`     | Expo (React Native) app with Expo Router                                                                                       |

## Requirements

- Node 22 (see `.nvmrc`) and pnpm 10 (`corepack enable` picks the pinned version)
- Docker, for Postgres (optional: without `DATABASE_URL` the API keeps everything in memory)

## First run

```bash
pnpm install
cp .env.example .env
pnpm test            # all unit and API tests
pnpm dev:api         # API on http://localhost:3000
pnpm dev:mobile      # Expo dev server; press w for web, or scan the QR code with Expo Go
```

The app signs in as `EXPO_PUBLIC_DEV_PLAYER_ID` (default `dev-player`) until phone sign-in is
built; give each test phone its own id to play against each other.

On a physical phone, set `EXPO_PUBLIC_API_URL` to your computer's LAN address, for example
`http://192.168.1.20:3000`, because `localhost` on the phone is the phone itself.

## The fake feed

`FOOTBALL_FEED=fake` (the default) serves a deterministic league: same seed, same clubs, players,
fixtures and match stats on every machine. Its season starts five weeks before today, so there are
always finished fixtures with points and upcoming fixtures with open deadlines.

With `DATABASE_URL` set, the API reads football data from Postgres and a worker inside the API
syncs it from the provider every `WORKER_SECONDS`. Only the sync calls the provider. Stats
snapshots are append-only by version, and an advisory lock lets one instance write at a time.

## API

| Method | Path                             | Notes                                             |
| ------ | -------------------------------- | ------------------------------------------------- |
| GET    | `/health`                        | Status and active feed                            |
| GET    | `/v1/season`                     | Season info and current gameweek                  |
| GET    | `/v1/fixtures?gameweek=&status=` | Fixtures with both clubs                          |
| GET    | `/v1/fixtures/:id`               | Fixture with both squads                          |
| GET    | `/v1/fixtures/:id/points`        | Fantasy points per player, finished fixtures only |
| POST   | `/v1/squads/validate`            | Checks a squad; locked once the fixture kicks off |

### Coins, tournaments and vouchers

Signed-in routes need `x-user-id` until phone sign-in is built. This works in development only
(`AUTH_MODE=dev`, the default outside production); production refuses those routes.

| Method | Path                            | Notes                                                               |
| ------ | ------------------------------- | ------------------------------------------------------------------- |
| GET    | `/v1/economy`                   | How coins work: bonus, rewards, categories, voucher rules           |
| GET    | `/v1/me/wallet`                 | Bonus and won coins, check-in streak; first call pays the 500 bonus |
| GET    | `/v1/me/wallet/activity`        | Coin history, newest first                                          |
| POST   | `/v1/me/check-in`               | Daily reward, once per Dhaka calendar day                           |
| POST   | `/v1/me/verification`           | Dev stand-in for the ID-check provider (birth date, document no.)   |
| GET    | `/v1/me/entries`                | Your tournament entries with points, rank and prize                 |
| GET    | `/v1/me/vouchers`               | Your vouchers with status                                           |
| GET    | `/v1/contests?fixtureId=`       | Public tournaments for a match; full ones are replaced by a copy    |
| GET    | `/v1/contests/:id`              | Tournament with its leaderboard once locked                         |
| GET    | `/v1/contests/invite/:code`     | Find a private tournament                                           |
| POST   | `/v1/contests`                  | Create a private tournament                                         |
| POST   | `/v1/contests/:id/entries`      | Enter a squad; pays the fee in coins                                |
| GET    | `/v1/vouchers/offers?category=` | Shop and travel offers; signed in, says whether you can redeem      |
| POST   | `/v1/vouchers/redeem`           | `{ offerId, requestId }`; won coins only, retry-safe                |

Tournaments lock at kick-off (cancelled and refunded if they did not reach their minimum) and
pay out when the match is final. Today the API keeps players, tournaments and vouchers in
memory; the coin ledger already has a Postgres store (`PgLedgerStore`) and the tables are in the
schema, so they move to the database with phone sign-in and the feed sync.

## Database

```bash
docker compose up -d
pnpm --filter @season/api db:migrate     # apply migrations
pnpm --filter @season/api db:generate    # after editing apps/api/src/db/schema.ts
```

CI fails if `schema.ts` changes without a matching migration. The ledger's Postgres tests
(concurrent entries, retries, rollback, double settlement) run with:

```bash
DATABASE_URL=postgres://season:season@localhost:5432/season_challenger pnpm --filter @season/api test:db
```

## Checks

```bash
pnpm format:check
pnpm typecheck
pnpm test
```

The same checks run in GitHub Actions on every push to `main`.
