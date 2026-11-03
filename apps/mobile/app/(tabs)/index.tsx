import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, type FixtureSummary } from '../../src/api';
import { countdown, formatKickoff } from '../../src/format';
import { useTheme } from '../../src/theme';
import { Card, Chip, Loading, Message, Screen } from '../../src/ui';

export default function MatchesScreen() {
  const t = useTheme();
  const season = useQuery({ queryKey: ['season'], queryFn: api.season });
  const [gameweek, setGameweek] = useState<number>();

  useEffect(() => {
    if (season.data && gameweek === undefined) setGameweek(season.data.currentGameweek);
  }, [season.data, gameweek]);

  const fixtures = useQuery({
    queryKey: ['fixtures', gameweek],
    queryFn: () => api.fixtures(gameweek!),
    enabled: gameweek !== undefined,
  });

  if (season.isError) {
    return (
      <Message
        title="Can't reach the Season Challenger API"
        body="Start it with `pnpm dev:api` and set EXPO_PUBLIC_API_URL if it isn't on localhost:3000."
      />
    );
  }
  if (!season.data || gameweek === undefined) return <Loading />;

  const last = season.data.gameweeks;
  return (
    <Screen>
      <View style={styles.switcher}>
        <Pressable disabled={gameweek <= 1} onPress={() => setGameweek(gameweek - 1)} hitSlop={12}>
          <Text style={[styles.arrow, { color: gameweek <= 1 ? t.border : t.text }]}>‹</Text>
        </Pressable>
        <Text style={[styles.gameweek, { color: t.text }]}>
          Gameweek {gameweek} of {last}
        </Text>
        <Pressable
          disabled={gameweek >= last}
          onPress={() => setGameweek(gameweek + 1)}
          hitSlop={12}
        >
          <Text style={[styles.arrow, { color: gameweek >= last ? t.border : t.text }]}>›</Text>
        </Pressable>
      </View>
      {fixtures.isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={fixtures.data ?? []}
          keyExtractor={(f) => f.id}
          renderItem={({ item }) => <FixtureCard fixture={item} />}
          refreshing={fixtures.isRefetching}
          onRefresh={() => fixtures.refetch()}
        />
      )}
    </Screen>
  );
}

function FixtureCard({ fixture }: { fixture: FixtureSummary }) {
  const t = useTheme();
  const scheduled = fixture.status === 'scheduled';
  return (
    <Link href={{ pathname: '/fixture/[id]', params: { id: fixture.id } }} asChild>
      <Pressable>
        <Card>
          <View style={styles.row}>
            <ClubName name={fixture.home.name} colour={fixture.home.colour} />
            {fixture.score ? (
              <Text style={[styles.score, { color: t.text }]}>
                {fixture.score.home} – {fixture.score.away}
              </Text>
            ) : (
              <Text style={[styles.vs, { color: t.muted }]}>v</Text>
            )}
            <ClubName name={fixture.away.name} colour={fixture.away.colour} alignRight />
          </View>
          <View style={[styles.row, styles.meta]}>
            <Text style={{ color: t.muted }}>{formatKickoff(fixture.kickoffAt)}</Text>
            {scheduled ? (
              <Text style={{ color: t.text, fontWeight: '600' }}>
                Locks in {countdown(fixture.kickoffAt)}
              </Text>
            ) : (
              <Chip
                label={fixture.status === 'live' ? 'Live' : 'Full time'}
                tone={fixture.status === 'live' ? 'live' : 'muted'}
              />
            )}
          </View>
          {scheduled ? (
            <View style={[styles.row, styles.chips]}>
              <Chip label="Squad: to do" tone="todo" />
              <Chip label="Analysis card: to do" tone="todo" />
            </View>
          ) : null}
        </Card>
      </Pressable>
    </Link>
  );
}

function ClubName({
  name,
  colour,
  alignRight,
}: {
  name: string;
  colour: string;
  alignRight?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={[styles.club, alignRight && styles.clubRight]}>
      <View style={[styles.dot, { backgroundColor: colour }]} />
      <Text style={[styles.clubName, { color: t.text }]} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  switcher: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  arrow: { fontSize: 28, fontWeight: '300' },
  gameweek: { fontSize: 17, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  meta: { marginTop: 12 },
  chips: { marginTop: 12, justifyContent: 'flex-start', gap: 8 },
  vs: { marginHorizontal: 8 },
  score: { marginHorizontal: 8, fontSize: 18, fontWeight: '700', fontVariant: ['tabular-nums'] },
  club: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  clubRight: { flexDirection: 'row-reverse' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  clubName: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
});
