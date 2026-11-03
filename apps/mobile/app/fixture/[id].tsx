import type { Player, Position } from '@season/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { countdown, formatKickoff, formatPoints } from '../../src/format';
import { useTheme } from '../../src/theme';
import { Card, Chip, Loading, Message, Screen } from '../../src/ui';

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
              <View style={styles.games}>
                <Chip label="Fantasy squad: Phase 3" tone="muted" />
                <Chip label="Analysis card: Phase 4" tone="muted" />
              </View>
            </Card>
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

const styles = StyleSheet.create({
  header: { paddingTop: 16 },
  title: { fontSize: 18, fontWeight: '700' },
  games: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
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
