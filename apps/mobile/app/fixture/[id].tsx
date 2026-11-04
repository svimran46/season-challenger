import type { Player, Position } from '@season/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { api, type Contest } from '../../src/api';
import { countdown, formatCoins, formatKickoff, formatPoints } from '../../src/format';
import { kitLight } from '../../src/shaders/looks';
import { ShaderSurface } from '../../src/shaders/ShaderSurface';
import { font, useTheme } from '../../src/theme';
import {
  Button,
  Card,
  Chip,
  ClubCrest,
  Gauge,
  Loading,
  Message,
  Screen,
  SectionTitle,
} from '../../src/ui';

const ORDER: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
const POSITION_NAMES: Record<Position, string> = {
  GK: 'Goalkeepers',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};

export default function FixtureScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const [isFocused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  const fixture = useQuery({ queryKey: ['fixture', id], queryFn: () => api.fixture(id) });
  const finished = fixture.data?.status === 'finished';
  const points = useQuery({
    queryKey: ['points', id],
    queryFn: () => api.points(id),
    enabled: finished,
  });
  const scheduled = fixture.data?.status === 'scheduled';
  const contests = useQuery({
    queryKey: ['contests', id],
    queryFn: () => api.contests(id),
    enabled: scheduled,
  });
  const entries = useQuery({
    queryKey: ['my-entries'],
    queryFn: api.myEntries,
    enabled: scheduled,
  });
  const joined = new Set(entries.data?.map((e) => e.contest.id));

  if (fixture.isError) return <Message title="Couldn't load this match" />;
  if (!fixture.data) return <Loading />;

  const f = fixture.data;
  const pointsOf = new Map(points.data?.players.map((p) => [p.playerId, p.points]));
  const clubOf = (p: Player) => (p.clubId === f.homeClubId ? f.home.shortName : f.away.shortName);
  const sections = ORDER.map((position) => ({
    title: POSITION_NAMES[position],
    data: f.players
      .filter((p) => p.position === position)
      .sort((a, b) =>
        finished ? (pointsOf.get(b.id) ?? 0) - (pointsOf.get(a.id) ?? 0) : b.credits - a.credits,
      ),
  }));

  return (
    <Screen>
      <Stack.Screen options={{ title: `${f.home.shortName} v ${f.away.shortName}` }} />
      <SectionList
        sections={sections}
        keyExtractor={(p) => p.id}
        stickySectionHeadersEnabled={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={[styles.hero, { borderColor: t.border }]}>
              <ShaderSurface
                look="clash"
                animated={!!isFocused}
                colours={{ home: kitLight(f.home.colour), away: kitLight(f.away.colour) }}
              />
              <View style={styles.heroVeil} />
              <View style={styles.heroBody}>
                <View style={styles.heroTeams}>
                  <View style={styles.heroTeam}>
                    <ClubCrest shortName={f.home.shortName} colour={f.home.colour} size={64} />
                    <Text style={[styles.heroName, { color: t.text }]}>{f.home.name}</Text>
                  </View>
                  <Text style={[styles.heroScore, { color: t.text }]}>
                    {f.score ? `${f.score.home}–${f.score.away}` : 'VS'}
                  </Text>
                  <View style={styles.heroTeam}>
                    <ClubCrest shortName={f.away.shortName} colour={f.away.colour} size={64} />
                    <Text style={[styles.heroName, { color: t.text }]}>{f.away.name}</Text>
                  </View>
                </View>
                <Text style={[styles.heroWhen, { color: t.text }]}>
                  {formatKickoff(f.kickoffAt)}
                  {f.status === 'scheduled' ? ` · locks in ${countdown(f.kickoffAt)}` : ''}
                </Text>
              </View>
            </View>
            {scheduled && contests.data ? (
              <>
                <View style={styles.cta}>
                  <Button
                    label="Open analysis card"
                    onPress={() =>
                      router.push({ pathname: '/card/[fixtureId]', params: { fixtureId: id } })
                    }
                  />
                </View>
                <SectionTitle>Tournaments</SectionTitle>
                {contests.data.map((c) => (
                  <ContestCard key={c.id} contest={c} joined={joined.has(c.id)} />
                ))}
                <SectionTitle>Players</SectionTitle>
              </>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.section, { color: t.muted }]}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <View style={[styles.player, { borderColor: t.border, backgroundColor: t.surface }]}>
            <View style={styles.playerName}>
              <Text style={{ color: t.text, fontSize: 15 }}>{item.name}</Text>
              <Text style={{ color: t.muted, fontSize: 12 }}>{clubOf(item)}</Text>
            </View>
            <Text style={{ color: t.text, fontWeight: '600' }}>
              {finished
                ? formatPoints(pointsOf.get(item.id) ?? 0)
                : `${item.credits.toFixed(1)} cr`}
            </Text>
          </View>
        )}
      />
    </Screen>
  );
}

function ContestCard({ contest: c, joined }: { contest: Contest; joined: boolean }) {
  const t = useTheme();
  const router = useRouter();
  const paid = c.prizeTable.at(-1)?.toRank ?? 1;
  return (
    <Card>
      <View style={styles.contestTop}>
        <Text style={[styles.contestName, { color: t.text }]}>{c.name}</Text>
        {c.guaranteed ? <Chip label="Guaranteed" tone="done" /> : null}
      </View>
      <View style={styles.prizeRow}>
        <View style={{ flexShrink: 1 }}>
          <Text style={[styles.prize, { color: t.accent }]}>{formatCoins(c.topPrize)}</Text>
          <Text style={{ color: t.muted, marginTop: 2 }}>
            Top prize · {paid === 1 ? 'winner takes all' : `top ${paid} win`}
          </Text>
        </View>
        {joined ? (
          <Chip label="Joined" tone="done" />
        ) : (
          <Button
            label={`Join · ${c.entryFee}`}
            onPress={() =>
              router.push({ pathname: '/squad/[contestId]', params: { contestId: c.id } })
            }
          />
        )}
      </View>
      <View style={styles.fill}>
        <Gauge share={c.entries / c.capacity} />
        <Text style={{ color: t.muted, fontSize: 12, marginTop: 6 }}>
          {c.entries} of {c.capacity.toLocaleString('en-US')} joined
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#0c0d12',
  },
  heroVeil: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(5, 5, 8, 0.26)' },
  heroBody: { paddingVertical: 24, paddingHorizontal: 12 },
  heroTeams: { flexDirection: 'row', alignItems: 'center' },
  heroTeam: { flex: 1, alignItems: 'center', gap: 10 },
  heroName: { fontSize: 15, fontFamily: font.title, textAlign: 'center' },
  heroScore: { fontSize: 30, fontFamily: font.heavy, marginHorizontal: 8 },
  heroWhen: { fontSize: 13, textAlign: 'center', marginTop: 16 },
  cta: { marginHorizontal: 16, marginBottom: 8 },
  prizeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 8,
  },
  prize: { fontSize: 24, fontFamily: font.display },
  fill: { marginTop: 14 },
  header: { paddingTop: 16 },
  contestTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  contestName: { fontSize: 15, fontFamily: font.title, flexShrink: 1 },
  title: { fontSize: 18, fontWeight: '700' },
  section: {
    fontSize: 12,
    fontFamily: font.title,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 6,
  },
  player: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  playerName: { gap: 2 },
});
