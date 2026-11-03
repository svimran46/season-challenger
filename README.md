# Season Challenger

A fantasy football app in the spirit of Dream11, with one extra category: **Season Mastery**.

## Core idea

- **Fantasy contests**: build a squad for each match, earn points from real player performance, and compete in leagues.
- **Season Mastery (the extra category)**: a season-long track that rewards how well you _analyse_ football matches, not just who you pick. Before each match you make analytical calls (formations, key battles, possession and shot trends, likely game state), and after the match you are scored on how accurate your reads were. Your mastery level grows across the season, so the leaderboard shows who truly understands the game.

## Status

Phase 1 (foundation) is in place: a TypeScript monorepo with the shared game rules, an offline
fake football feed, a NestJS API, the Expo app shell and the Postgres schema.

The coin economy is built in `packages/wallet` and served by the API. **No money goes in or out:**
players get 500 bonus coins at sign-up plus daily and Season Mastery rewards, spend coins on
tournaments (head-to-head, small league, mega, private), and redeem coins they _won_ for shop and
travel discount vouchers. Vouchers are discounts only, tied to an ID-verified 18+ account, and
never convert back to taka.

| Layer         | Choice                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| Mobile        | Expo (React Native) with Expo Router                                          |
| API           | NestJS, Zod validation                                                        |
| Database      | PostgreSQL 16 with Drizzle migrations; Redis for leaderboards and queues      |
| Football data | Licensed provider behind a `FootballFeed` adapter; `FakeFeed` for development |

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) to run it locally.
