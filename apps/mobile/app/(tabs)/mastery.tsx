import { TIERS, TIER_THRESHOLDS } from '@season/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useTheme } from '../../src/theme';
import { Card, Chip, Loading, Message, Screen } from '../../src/ui';

export default function MasteryScreen() {
  const t = useTheme();
  const mine = useQuery({ queryKey: ['mastery', 'me'], queryFn: api.myMastery });
  const board = useQuery({ queryKey: ['mastery', 'leaderboard'], queryFn: api.masteryLeaderboard });

  if (mine.isError) return <Message title="Couldn't load your Season Mastery" />;
  if (!mine.data) return <Loading />;
  const { rating, tier, cardsCompleted, cardsForLeaderboard, next, history } = mine.data;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <View style={styles.spread}>
            <Text style={[styles.label, { color: t.muted }]}>Season rating</Text>
            <Chip label={tier} tone="done" />
          </View>
          <Text style={[styles.rating, { color: t.text }]}>{Math.round(rating)}</Text>
          {next ? (
            <>
              <View style={[styles.track, { backgroundColor: t.border }]}>
                <View
                  style={[
                    styles.fill,
                    { backgroundColor: t.accent, width: `${Math.round(next.share * 100)}%` },
                  ]}
                />
              </View>
              <Text style={{ color: t.muted }}>
                {next.next} needs rating {next.rating.need} and {next.cards.need} cards. You have{' '}
                {cardsCompleted}.
              </Text>
            </>
          ) : (
            <Text style={{ color: t.muted }}>You hold the top tier.</Text>
          )}
          {cardsCompleted < cardsForLeaderboard ? (
            <Text style={[styles.note, { color: t.muted }]}>
              {cardsCompleted} of {cardsForLeaderboard} cards needed to join the season leaderboard.
            </Text>
          ) : null}
        </Card>

        <Card>
          <Text style={[styles.heading, { color: t.text }]}>Your matches</Text>
          {history.length === 0 ? (
            <Text style={[styles.body, { color: t.muted }]}>
              No graded cards yet. Open an upcoming match and answer its analysis card before
              kick-off.
            </Text>
          ) : (
            history.map((h) => (
              <Link
                key={h.fixtureId}
                href={{ pathname: '/card/[fixtureId]', params: { fixtureId: h.fixtureId } }}
                asChild
              >
                <Pressable accessibilityRole="link" style={[styles.row, { borderColor: t.border }]}>
                  <Text style={{ color: t.text }}>
                    {h.home} v {h.away}
                  </Text>
                  <Text style={[styles.score, { color: t.text }]}>{Math.round(h.score)}</Text>
                </Pressable>
              </Link>
            ))
          )}
        </Card>

        <Card>
          <Text style={[styles.heading, { color: t.text }]}>Season leaderboard</Text>
          {board.isError ? (
            <Text style={{ color: t.muted }}>Couldn't load the leaderboard.</Text>
          ) : !board.data ? (
            <Text style={{ color: t.muted }}>Loading…</Text>
          ) : board.data.entries.length === 0 ? (
            <Text style={[styles.body, { color: t.muted }]}>
              Nobody has {board.data.minCards} graded cards yet.
            </Text>
          ) : (
            board.data.entries.map((e) => (
              <View key={e.rank + e.displayName} style={[styles.row, { borderColor: t.border }]}>
                <Text style={{ color: t.text, fontWeight: e.isYou ? '700' : '400' }}>
                  {e.rank}. {e.displayName}
                  {e.isYou ? ' (you)' : ''}
                </Text>
                <Text style={{ color: t.muted }}>
                  {e.tier} · {Math.round(e.rating)}
                </Text>
              </View>
            ))
          )}
        </Card>

        <Card>
          <Text style={[styles.heading, { color: t.text }]}>How Season Mastery works</Text>
          <Text style={[styles.body, { color: t.muted }]}>
            Before each match, answer an analysis card of 5 to 8 calls: the result and how sure you
            are, shot ranges, who leads at half time, key player battles. After full time every call
            is graded against the real match stats. Calls that go against the crowd count for more.
          </Text>
        </Card>

        <Card>
          <Text style={[styles.heading, { color: t.text }]}>Tiers</Text>
          {TIERS.map((name) => {
            const need = TIER_THRESHOLDS[name];
            return (
              <View key={name} style={[styles.row, { borderColor: t.border }]}>
                <Text style={[styles.tierName, { color: t.text }]}>{name}</Text>
                <Text style={{ color: t.muted }}>
                  {need.cards === 0
                    ? 'Where everyone starts'
                    : `Rating ${need.rating}+, ${need.cards} cards`}
                </Text>
              </View>
            );
          })}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16 },
  spread: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  rating: { fontSize: 44, fontWeight: '700', marginVertical: 4 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginBottom: 8 },
  fill: { height: 6 },
  note: { marginTop: 8 },
  heading: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  score: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  tierName: { fontWeight: '600' },
});
