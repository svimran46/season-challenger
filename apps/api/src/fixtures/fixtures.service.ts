import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { FixtureFilter, FootballFeed } from '@season/feed';
import {
  scorePlayer,
  type Club,
  type Fixture,
  type Player,
  type PlayerPoints,
} from '@season/shared';
import { FOOTBALL_FEED } from '../common/tokens';

export interface FixtureSummary extends Fixture {
  home: Club;
  away: Club;
}

export interface FixtureDetail extends FixtureSummary {
  players: Player[];
}

@Injectable()
export class FixturesService {
  constructor(@Inject(FOOTBALL_FEED) private readonly feed: FootballFeed) {}

  async getSeason() {
    const season = await this.feed.getSeason();
    const upcoming = await this.feed.listFixtures({ status: 'scheduled' });
    const currentGameweek = upcoming[0]?.gameweek ?? season.gameweeks;
    return { ...season, currentGameweek };
  }

  async list(filter: FixtureFilter): Promise<FixtureSummary[]> {
    const [fixtures, clubs] = await Promise.all([
      this.feed.listFixtures(filter),
      this.feed.listClubs(),
    ]);
    return fixtures.map((f) => this.withClubs(f, clubs));
  }

  async get(fixtureId: string): Promise<FixtureDetail> {
    const fixture = await this.feed.getFixture(fixtureId);
    if (!fixture) throw new NotFoundException(`Fixture ${fixtureId} not found`);
    const [clubs, players] = await Promise.all([
      this.feed.listClubs(),
      this.feed.listPlayers([fixture.homeClubId, fixture.awayClubId]),
    ]);
    return { ...this.withClubs(fixture, clubs), players };
  }

  /** Fantasy points per player, highest first. Only available once the match is finished. */
  async points(
    fixtureId: string,
  ): Promise<{ fixtureId: string; version: number; players: PlayerPoints[] }> {
    const detail = await this.get(fixtureId);
    const stats = await this.feed.getStats(fixtureId);
    if (!stats) throw new NotFoundException(`No stats yet for fixture ${fixtureId}`);
    const positionOf = new Map(detail.players.map((p) => [p.id, p.position]));
    const players = stats.players
      .filter((s) => positionOf.has(s.playerId))
      .map((s) => scorePlayer(positionOf.get(s.playerId)!, s))
      .sort((a, b) => b.points - a.points);
    return { fixtureId, version: stats.version, players };
  }

  private withClubs(fixture: Fixture, clubs: Club[]): FixtureSummary {
    const find = (id: string) => {
      const club = clubs.find((c) => c.id === id);
      if (!club) throw new Error(`Feed returned unknown club ${id}`);
      return club;
    };
    return { ...fixture, home: find(fixture.homeClubId), away: find(fixture.awayClubId) };
  }
}
