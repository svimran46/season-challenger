import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, type FixtureSummary } from '../../src/api';
import { countdown, formatKickoff } from '../../src/format';
import { font, useTheme } from '../../src/theme';
import { kitLight } from '../../src/shaders/looks';
import { ShaderSurface } from '../../src/shaders/ShaderSurface';
import { Chip, ClubCrest, Loading, Message, Screen } from '../../src/ui';

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

  const entries = useQuery({ queryKey: ['my-entries'], queryFn: api.myEntries });
  const entered = new Set(entries.data?.map((e) => e.fixture?.id));

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous gameweek"
          disabled={gameweek <= 1}
          onPress={() => setGameweek(gameweek - 1)}
          hitSlop={12}
        >
          <Ionicons name="chevron-back" size={22} color={gameweek <= 1 ? t.border : t.accent} />
        </Pressable>
        <View style={styles.week}>
          <Text style={[styles.weekLabel, { color: t.accent }]}>GAMEWEEK</Text>
          <Text style={[styles.gameweek, { color: t.text }]}>
            {gameweek} <Text style={{ color: t.muted }}>of {last}</Text>
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next gameweek"
          disabled={gameweek >= last}
          onPress={() => setGameweek(gameweek + 1)}
          hitSlop={12}
        >
          <Ionicons
            name="chevron-forward"
            size={22}
            color={gameweek >= last ? t.border : t.accent}
          />
        </Pressable>
      </View>
      {fixtures.isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={fixtures.data ?? []}
          keyExtractor={(f) => f.id}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <FixtureCard fixture={item} index={index} entered={entered.has(item.id)} />
          )}
          refreshing={fixtures.isRefetching}
          onRefresh={() => fixtures.refetch()}
        />
      )}
    </Screen>
  );
}

function FixtureCard({
  fixture,
  index,
  entered,
}: {
  fixture: FixtureSummary;
  index: number;
  entered: boolean;
}) {
  const t = useTheme();
  const scheduled = fixture.status === 'scheduled';
  const card = useQuery({
    queryKey: ['mastery', 'card', fixture.id],
    queryFn: () => api.masteryCard(fixture.id),
    enabled: scheduled,
  });
  return (
    <Link href={{ pathname: '/fixture/[id]', params: { id: fixture.id } }} asChild>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`${fixture.home.name} against ${fixture.away.name}`}
        style={StyleSheet.flatten([styles.match, { borderColor: t.border }])}
      >
        {/* A still frame: a whole list of moving shaders would cost too much battery. */}
        <ShaderSurface
          look="clash"
          animated={false}
          seed={11 + index * 3}
          colours={{ home: kitLight(fixture.home.colour), away: kitLight(fixture.away.colour) }}
        />
        <View style={styles.veil} />
        <View style={styles.matchBody}>
          <View style={styles.teams}>
            <Team
              name={fixture.home.name}
              shortName={fixture.home.shortName}
              colour={fixture.home.colour}
            />
            <View style={styles.middle}>
              {fixture.score ? (
                <Text style={[styles.score, { color: t.text }]}>
                  {fixture.score.home}–{fixture.score.away}
                </Text>
              ) : (
                <Text style={[styles.vs, { color: t.text }]}>VS</Text>
              )}
              <Text style={[styles.when, { color: t.text }]}>
                {formatKickoff(fixture.kickoffAt).replace(/, (?=\d+:)/, '\n')}
              </Text>
            </View>
            <Team
              name={fixture.away.name}
              shortName={fixture.away.shortName}
              colour={fixture.away.colour}
            />
          </View>
          <View style={styles.footer}>
            {scheduled ? (
              <>
                <Text style={[styles.locks, { color: t.text }]}>
                  Locks in {countdown(fixture.kickoffAt)}
                </Text>
                <View style={styles.chips}>
                  <Chip label={entered ? 'Squad in' : 'Squad'} tone={entered ? 'done' : 'todo'} />
                  <Chip
                    label={card.data?.submittedAt ? 'Card in' : 'Card'}
                    tone={card.data?.submittedAt ? 'done' : 'todo'}
                  />
                </View>
              </>
            ) : (
              <Chip
                label={fixture.status === 'live' ? 'Live' : 'Full time'}
                tone={fixture.status === 'live' ? 'live' : 'muted'}
              />
            )}
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

function Team({ name, shortName, colour }: { name: string; shortName: string; colour: string }) {
  const t = useTheme();
  return (
    <View style={styles.team}>
      <ClubCrest shortName={shortName} colour={colour} />
      <Text style={[styles.teamName, { color: t.text }]} numberOfLines={2}>
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
    paddingVertical: 14,
  },
  week: { alignItems: 'center' },
  weekLabel: { fontSize: 11, fontFamily: font.title, letterSpacing: 2 },
  gameweek: { fontSize: 20, fontFamily: font.display, marginTop: 2 },
  list: { paddingBottom: 24 },
  match: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: '#0c0d12',
  },
  veil: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(5, 5, 8, 0.34)' },
  matchBody: { padding: 16 },
  teams: { flexDirection: 'row', alignItems: 'flex-start' },
  team: { flex: 1, alignItems: 'center', gap: 8 },
  teamName: { fontSize: 14, fontFamily: font.title, textAlign: 'center' },
  middle: { width: 96, alignItems: 'center', paddingTop: 6 },
  vs: { fontSize: 22, fontFamily: font.heavy, letterSpacing: 1 },
  score: { fontSize: 28, fontFamily: font.heavy, fontVariant: ['tabular-nums'] },
  when: { fontSize: 12, textAlign: 'center', marginTop: 4, lineHeight: 16 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    minHeight: 28,
  },
  locks: { fontSize: 13, fontFamily: font.title },
  chips: { flexDirection: 'row', gap: 6 },
});
