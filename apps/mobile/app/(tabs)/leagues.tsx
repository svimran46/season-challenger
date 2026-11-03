import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError, type MyEntry } from '../../src/api';
import { countdown, formatCoins, formatKickoff, ordinal } from '../../src/format';
import { useTheme } from '../../src/theme';
import { Button, Card, Chip, Loading, Message, Screen, SectionTitle } from '../../src/ui';

export default function TournamentsScreen() {
  const t = useTheme();
  const router = useRouter();
  const entries = useQuery({ queryKey: ['my-entries'], queryFn: api.myEntries });
  const [code, setCode] = useState('');
  const find = useMutation({
    mutationFn: () => api.contestByInvite(code),
    onSuccess: (c) => router.push({ pathname: '/squad/[contestId]', params: { contestId: c.id } }),
  });

  if (entries.isError) return <Message title="Can't load your tournaments" />;
  if (!entries.data) return <Loading />;
  const upcoming = entries.data.filter((e) => e.contest.status === 'open');
  const past = entries.data.filter((e) => e.contest.status !== 'open');

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}
        refreshControl={
          <RefreshControl
            refreshing={entries.isRefetching}
            onRefresh={() => void entries.refetch()}
          />
        }
      >
        <Card>
          <Text style={[styles.heading, { color: t.text }]}>Join a private tournament</Text>
          <View style={styles.inviteRow}>
            <TextInput
              value={code}
              onChangeText={setCode}
              placeholder="Invite code"
              placeholderTextColor={t.muted}
              autoCapitalize="characters"
              style={[styles.input, { color: t.text, borderColor: t.border }]}
            />
            <Button
              label="Find"
              kind="secondary"
              disabled={code.trim().length < 4}
              busy={find.isPending}
              onPress={() => find.mutate()}
            />
          </View>
          {find.error ? (
            <Text style={{ color: t.live, marginTop: 8 }}>
              {find.error instanceof ApiError ? find.error.message : 'Something went wrong.'}
            </Text>
          ) : null}
        </Card>

        {entries.data.length === 0 ? (
          <Card>
            <Text style={[styles.heading, { color: t.text }]}>No tournaments yet</Text>
            <Text style={{ color: t.muted, marginTop: 4 }}>
              Open a match on the Matches tab, pick a tournament and build your squad. Your 500
              welcome coins cover your first entries.
            </Text>
          </Card>
        ) : null}
        {upcoming.length > 0 ? <SectionTitle>Upcoming</SectionTitle> : null}
        {upcoming.map((e) => (
          <EntryCard key={e.entryId} entry={e} />
        ))}
        {past.length > 0 ? <SectionTitle>Results</SectionTitle> : null}
        {past.map((e) => (
          <EntryCard key={e.entryId} entry={e} />
        ))}
      </ScrollView>
    </Screen>
  );
}

function EntryCard({ entry: e }: { entry: MyEntry }) {
  const t = useTheme();
  const c = e.contest;
  const match = e.fixture ? `${e.fixture.home} v ${e.fixture.away}` : c.fixtureId;
  let result: { label: string; tone: 'done' | 'todo' | 'live' | 'muted' };
  if (c.status === 'open') {
    result = {
      label: e.fixture ? `Locks in ${countdown(e.fixture.kickoffAt)}` : 'Open',
      tone: 'todo',
    };
  } else if (c.status === 'locked') result = { label: 'In play', tone: 'live' };
  else if (c.status === 'cancelled') result = { label: 'Cancelled · refunded', tone: 'muted' };
  else if ((e.prize ?? 0) > 0) result = { label: `Won ${formatCoins(e.prize!)}`, tone: 'done' };
  else result = { label: 'No prize', tone: 'muted' };

  return (
    <Card>
      <View style={styles.row}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color: t.muted, fontSize: 13 }}>
            {match}
            {e.fixture ? ` · ${formatKickoff(e.fixture.kickoffAt)}` : ''}
          </Text>
          <Text style={[styles.heading, { color: t.text }]}>{c.name}</Text>
        </View>
        <Chip label={result.label} tone={result.tone} />
      </View>
      <Text style={{ color: t.muted, marginTop: 8 }}>
        {c.status === 'settled' && e.rank !== null
          ? `${ordinal(e.rank)} of ${c.entries} · ${e.points} pts`
          : `${c.entries} of ${c.capacity.toLocaleString('en-US')} joined · entry ${formatCoins(c.entryFee)}`}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 16, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  inviteRow: { flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center' },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 16,
  },
});
