import { MIN_CARDS_FOR_LEADERBOARD, TIERS, TIER_THRESHOLDS } from '@season/shared';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../src/theme';
import { Card, Screen } from '../../src/ui';

// Until accounts and grading land (Phase 4), show a new player's starting state.
const rating = 0;
const cardsCompleted = 0;

export default function MasteryScreen() {
  const t = useTheme();
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Card>
          <Text style={[styles.label, { color: t.muted }]}>Season rating</Text>
          <Text style={[styles.rating, { color: t.text }]}>{rating}</Text>
          <Text style={{ color: t.muted }}>
            {cardsCompleted} of {MIN_CARDS_FOR_LEADERBOARD} cards needed to join the season
            leaderboard
          </Text>
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
          {TIERS.map((tier) => {
            const need = TIER_THRESHOLDS[tier];
            return (
              <View key={tier} style={[styles.tier, { borderColor: t.border }]}>
                <Text style={[styles.tierName, { color: t.text }]}>{tier}</Text>
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
  label: { fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5 },
  rating: { fontSize: 44, fontWeight: '700', marginVertical: 4 },
  heading: { fontSize: 17, fontWeight: '600', marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22 },
  tier: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  tierName: { fontSize: 15, fontWeight: '600' },
});
