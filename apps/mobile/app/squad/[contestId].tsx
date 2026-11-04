import { DEFAULT_SQUAD_RULES, validateSquad, type Player, type Position } from '@season/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { api, ApiError } from '../../src/api';
import { countdown, formatCoins } from '../../src/format';
import { useTheme } from '../../src/theme';
import { Button, Card, Chip, Loading, Message, Screen } from '../../src/ui';

const ORDER: Position[] = ['GK', 'DEF', 'MID', 'FWD'];
const NAMES: Record<Position, string> = {
  GK: 'Goalkeeper',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
};

export default function SquadScreen() {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const { contestId } = useLocalSearchParams<{ contestId: string }>();
  const contest = useQuery({
    queryKey: ['contest', contestId],
    queryFn: () => api.contest(contestId),
  });
  const fixtureId = contest.data?.fixtureId;
  const fixture = useQuery({
    queryKey: ['fixture', fixtureId],
    queryFn: () => api.fixture(fixtureId!),
    enabled: !!fixtureId,
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [captainId, setCaptain] = useState<string>();
  const [viceId, setVice] = useState<string>();

  const join = useMutation({
    mutationFn: () =>
      api.join(contestId, { playerIds: picked, captainId: captainId!, viceCaptainId: viceId! }),
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.back();
    },
  });

  const players = fixture.data?.players ?? [];
  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const rules = DEFAULT_SQUAD_RULES;
  const chosen = picked.map((id) => byId.get(id)).filter((p): p is Player => !!p);
  const count = (pos: Position) => chosen.filter((p) => p.position === pos).length;
  const credits = Math.round(chosen.reduce((s, p) => s + p.credits, 0) * 10) / 10;
  const check =
    fixture.data && captainId && viceId
      ? validateSquad(
          { fixtureId: fixture.data.id, playerIds: picked, captainId, viceCaptainId: viceId },
          players,
        )
      : undefined;

  if (contest.isError || fixture.isError) return <Message title="Couldn't load this tournament" />;
  if (!contest.data || !fixture.data) return <Loading />;
  const c = contest.data;
  const f = fixture.data;
  if (c.status !== 'open' || f.status !== 'scheduled') {
    return <Message title="Entries are closed" body="This match has kicked off." />;
  }

  const toggle = (p: Player) => {
    if (picked.includes(p.id)) {
      setPicked(picked.filter((id) => id !== p.id));
      if (captainId === p.id) setCaptain(undefined);
      if (viceId === p.id) setVice(undefined);
    } else if (picked.length < rules.size && count(p.position) < rules.positions[p.position][1]) {
      setPicked([...picked, p.id]);
    }
  };
  const club = (p: Player) => (p.clubId === f.homeClubId ? f.home.shortName : f.away.shortName);

  const status =
    picked.length < rules.size
      ? `Pick ${rules.size - picked.length} more`
      : !captainId || !viceId
        ? 'Choose a captain (C) and vice-captain (VC)'
        : check && !check.valid
          ? check.errors[0]!.message
          : 'Ready';

  return (
    <Screen>
      <Stack.Screen options={{ title: `${f.home.shortName} v ${f.away.shortName}` }} />
      <SectionList
        sections={ORDER.map((pos) => ({
          title: pos,
          data: players.filter((p) => p.position === pos).sort((a, b) => b.credits - a.credits),
        }))}
        keyExtractor={(p) => p.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={{ paddingBottom: 140 }}
        ListHeaderComponent={
          <View style={{ paddingTop: 16 }}>
            <Card>
              <Text style={[styles.heading, { color: t.text }]}>{c.name}</Text>
              <Text style={{ color: t.muted, marginTop: 2 }}>
                Entry {formatCoins(c.entryFee)} · top prize {formatCoins(c.topPrize)} · locks in{' '}
                {countdown(f.kickoffAt)}
              </Text>
              <View style={styles.counts}>
                {ORDER.map((pos) => {
                  const [min, max] = rules.positions[pos];
                  const n = count(pos);
                  return (
                    <Chip
                      key={pos}
                      label={`${pos} ${n}/${min === max ? min : `${min}-${max}`}`}
                      tone={n >= min ? 'done' : 'todo'}
                    />
                  );
                })}
                <Chip
                  label={`${credits} / ${rules.maxCredits} cr`}
                  tone={credits > rules.maxCredits ? 'live' : 'muted'}
                />
              </View>
            </Card>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={[styles.section, { color: t.muted }]}>
            {NAMES[section.title as Position]}
          </Text>
        )}
        renderItem={({ item }) => {
          const on = picked.includes(item.id);
          return (
            <Pressable
              onPress={() => toggle(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={[
                styles.player,
                { borderColor: t.border, backgroundColor: on ? t.background : t.surface },
              ]}
            >
              <View
                style={[
                  styles.tick,
                  {
                    borderColor: on ? t.accent : t.border,
                    backgroundColor: on ? t.accent : 'transparent',
                  },
                ]}
              >
                {on ? <Text style={{ color: t.accentText, fontWeight: '800' }}>✓</Text> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 15 }}>{item.name}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>
                  {club(item)} · {item.credits.toFixed(1)} cr
                </Text>
              </View>
              {on ? (
                <View style={styles.roles}>
                  {(['C', 'VC'] as const).map((role) => {
                    const active = role === 'C' ? captainId === item.id : viceId === item.id;
                    return (
                      <Pressable
                        key={role}
                        hitSlop={6}
                        onPress={() => {
                          if (role === 'C') {
                            setCaptain(item.id);
                            if (viceId === item.id) setVice(undefined);
                          } else {
                            setVice(item.id);
                            if (captainId === item.id) setCaptain(undefined);
                          }
                        }}
                        style={[
                          styles.role,
                          {
                            borderColor: t.accent,
                            backgroundColor: active ? t.accent : 'transparent',
                          },
                        ]}
                      >
                        <Text
                          style={{ color: active ? t.accentText : t.accent, fontWeight: '700' }}
                        >
                          {role}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </Pressable>
          );
        }}
      />
      <View style={[styles.footer, { backgroundColor: t.solid, borderColor: t.border }]}>
        <Text style={{ color: join.error ? t.live : t.muted, marginBottom: 8 }} numberOfLines={2}>
          {join.error instanceof ApiError
            ? join.error.code === 'contest_full'
              ? 'This tournament just filled up. Go back and pick another.'
              : join.error.message
            : status}
        </Text>
        <Button
          label={`Join for ${formatCoins(c.entryFee)}`}
          disabled={!check?.valid}
          busy={join.isPending}
          onPress={() => join.mutate()}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700' },
  counts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 },
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
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roles: { flexDirection: 'row', gap: 6 },
  role: {
    borderWidth: 1,
    borderRadius: 999,
    minWidth: 36,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
