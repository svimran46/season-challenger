import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import type { LookName } from '../../src/shaders/looks';
import { font, useTheme } from '../../src/theme';
import { Button, Card, MetalCard, Screen, SectionTitle } from '../../src/ui';

export default function ProfileScreen() {
  const t = useTheme();
  const { signOut } = useAuth();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  const mastery = useQuery({ queryKey: ['mastery', 'me'], queryFn: api.myMastery });
  const leave = useMutation({ mutationFn: signOut });
  const tier = mastery.data?.tier ?? 'Scout';
  const account = me.data
    ? (me.data.email ?? me.data.phone ?? 'Your account')
    : me.isError
      ? 'Could not load your account'
      : 'Loading…';

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <MetalCard look={tier as LookName}>
          <View style={styles.who}>
            <View style={[styles.avatar, { borderColor: t.accent }]}>
              <Ionicons name="person" size={26} color={t.accent} />
            </View>
            <View style={{ flexShrink: 1 }}>
              <Text style={[styles.tier, { color: t.accent }]}>{tier.toUpperCase()}</Text>
              <Text style={[styles.account, { color: t.text }]} numberOfLines={1}>
                {account}
              </Text>
            </View>
          </View>
          <View style={styles.stats}>
            <Stat
              label="Rating"
              value={mastery.data ? String(Math.round(mastery.data.rating)) : '–'}
            />
            <Stat label="Cards" value={mastery.data ? String(mastery.data.cardsCompleted) : '–'} />
            <Stat
              label="Coins"
              value={wallet.data ? wallet.data.total.toLocaleString('en-US') : '–'}
            />
          </View>
        </MetalCard>

        <SectionTitle>Account</SectionTitle>
        <Card>
          <Text style={[styles.soon, { color: t.muted }]}>
            Your favourite club, badges and season history are coming soon.
          </Text>
          <Button
            kind="secondary"
            label="Sign out"
            busy={leave.isPending}
            onPress={() => leave.mutate()}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color: t.text }]}>{value}</Text>
      <Text style={{ color: t.text, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 32 },
  who: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7, 8, 11, 0.6)',
  },
  tier: { fontSize: 12, fontFamily: font.title, letterSpacing: 2 },
  account: { fontSize: 18, fontFamily: font.display, marginTop: 2 },
  stats: { flexDirection: 'row', marginTop: 20 },
  stat: { flex: 1 },
  statValue: { fontSize: 24, fontFamily: font.display, fontVariant: ['tabular-nums'] },
  soon: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
});
