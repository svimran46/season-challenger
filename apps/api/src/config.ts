import { z } from 'zod';

const blankToUndefined = (value: unknown) => (value === '' ? undefined : value);

const schema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().int().min(0).max(65_535).default(3000),
  DATABASE_URL: z.preprocess(blankToUndefined, z.string().url().optional()),
  /** How often the worker syncs the feed and moves tournaments along. */
  WORKER_SECONDS: z.coerce.number().int().min(5).default(60),
  /** Where football data comes from: the offline fake league or API-Football. */
  FOOTBALL_FEED: z.enum(['fake', 'api-football']).default('fake'),
  API_FOOTBALL_KEY: z.preprocess(blankToUndefined, z.string().optional()),
  /** API-Football league id; 39 is the Premier League. */
  API_FOOTBALL_LEAGUE: z.coerce.number().int().positive().default(39),
  /** Season by starting year: 2026 is 2026/27. */
  API_FOOTBALL_SEASON: z.coerce.number().int().min(2000).default(2026),
});

export type FeedConfig =
  { kind: 'fake' } | { kind: 'api-football'; apiKey: string; leagueId: number; season: number };

export interface Config {
  port: number;
  databaseUrl: string | undefined;
  workerSeconds: number;
  feed: FeedConfig;
  /** Why the configured feed could not be used, when the fake league stands in for it. */
  feedWarning?: string;
}

/** Reads the environment once at boot and refuses to start on a setting that would lose data. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const problems: string[] = [];
  if (parsed.NODE_ENV === 'production' && !parsed.DATABASE_URL) {
    problems.push('DATABASE_URL must be set in production: without it everything is in memory.');
  }
  let feed: FeedConfig = { kind: 'fake' };
  let feedWarning: string | undefined;
  if (parsed.FOOTBALL_FEED === 'api-football') {
    if (parsed.API_FOOTBALL_KEY) {
      feed = {
        kind: 'api-football',
        apiKey: parsed.API_FOOTBALL_KEY,
        leagueId: parsed.API_FOOTBALL_LEAGUE,
        season: parsed.API_FOOTBALL_SEASON,
      };
    } else if (parsed.NODE_ENV === 'production') {
      problems.push('FOOTBALL_FEED=api-football needs API_FOOTBALL_KEY.');
    } else {
      feedWarning = 'API_FOOTBALL_KEY is not set, so the fake league is used instead.';
    }
  }
  if (problems.length > 0) throw new Error(`Bad configuration:\n- ${problems.join('\n- ')}`);
  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    workerSeconds: parsed.WORKER_SECONDS,
    feed,
    feedWarning,
  };
}
