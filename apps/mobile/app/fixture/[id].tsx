import type { Player, Position } from '@season/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { api, type Contest } from '../../src/api';
import { countdown, formatCoins, formatKickoff, formatPoints } from '../../src/format';
import { useTheme } from '../../src/theme';
import { Button, Card, Chip, Loading, Message, Screen, SectionTitle } from '../../src/ui';

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
            <Card>
              <Text style={[styles.title, { color: t.text }]}>
                {f.home.name} {f.score ? `${f.score.home} – ${f.score.away}` : 'v'} {f.away.name}
              </Text>
              <Text style={{ color: t.muted, marginTop: 4 }}>
                {formatKickoff(f.kickoffAt)}
                {f.status === 'scheduled' ? ` · locks in ${countdown(f.kickoffAt)}` : ''}
              </Text>
            </Card>
            {scheduled && contests.data ? (
              <>
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
        <View style={{ flexShrink: 1 }}>
          <Text style={[styles.contestName, { color: t.text }]}>{c.name}</Text>
          <Text style={{ color: t.muted, marginTop: 2 }}>
            Top prize {formatCoins(c.topPrize)} ·{' '}
            {paid === 1 ? 'winner takes all' : `top ${paid} win`}
          </Text>
        </View>
        {c.guaranteed ? <Chip label="Guaranteed" tone="done" /> : null}
      </View>
      <View style={[styles.contestTop, { marginTop: 12 }]}>
        <Text style={{ color: t.muted }}>
          {c.entries} of {c.capacity.toLocaleString('en-US')} joined
        </Text>
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
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: 16 },
  contestTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  contestName: { fontSize: 16, fontWeight: '700' },
  title: { fontSize: 18, fontWeight: '700' },
  section: {
    fontSize: 13,
    fontWeight: '600',
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
