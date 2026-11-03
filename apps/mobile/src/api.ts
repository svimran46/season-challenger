import type {
  Club,
  Fixture,
  Player,
  PlayerPoints,
  Season,
  SquadPick,
  SquadValidation,
} from '@season/shared';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export interface FixtureSummary extends Fixture {
  home: Club;
  away: Club;
  /** Final score once the match is finished; null before then. */
  score: { home: number; away: number } | null;
}

export interface FixtureDetail extends FixtureSummary {
  players: Player[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  season: () => request<Season & { currentGameweek: number }>('/v1/season'),
  fixtures: (gameweek: number) => request<FixtureSummary[]>(`/v1/fixtures?gameweek=${gameweek}`),
  fixture: (id: string) => request<FixtureDetail>(`/v1/fixtures/${id}`),
  points: (id: string) =>
    request<{ fixtureId: string; version: number; players: PlayerPoints[] }>(
      `/v1/fixtures/${id}/points`,
    ),
  validateSquad: (squad: SquadPick) =>
    request<SquadValidation>('/v1/squads/validate', {
      method: 'POST',
      body: JSON.stringify(squad),
    }),
};
