// Sample cards that show where shader effects could sit in Season Challenger. The data on them
// is made up for the samples; the real screens would pass their own.

import { TIER_THRESHOLDS, type Tier } from '@season/shared';
import { StyleSheet, Text, View } from 'react-native';
import { effects, rgb } from './sources';
import { ShaderView } from './ShaderView';

/** Wallet header: drifting mesh gradient behind the coin balance. */
export function WalletHeaderSample({ animated }: { animated?: boolean }) {
  return (
    <ShaderView
      effect={effects.meshGradient}
      animated={animated}
      radius={22}
      uniforms={{ c1: rgb('#064e3b'), c2: rgb('#d4a017'), c3: rgb('#0f766e'), c4: rgb('#0b1120') }}
      style={styles.wallet}
    >
      <Text style={styles.overline}>YOUR COINS</Text>
      <Text style={styles.balance}>1,240</Text>
      <View style={styles.row}>
        <Pill label="Won 340" />
        <Pill label="Bonus 900" />
        <Pill label="Daily reward ready" bright />
      </View>
    </ShaderView>
  );
}

/** Player card with holographic foil. Drag a finger across it to move the light. */
export function HoloPlayerSample({
  name,
  role,
  club,
  credits,
  base,
  seed,
  animated,
}: {
  name: string;
  role: string;
  club: string;
  credits: string;
  base: string;
  seed?: number;
  animated?: boolean;
}) {
  return (
    <ShaderView
      effect={effects.holoFoil}
      interactive
      animated={animated}
      seed={seed}
      radius={18}
      uniforms={{ base: rgb(base) }}
      style={styles.player}
    >
      <View style={styles.playerTop}>
        <Text style={styles.role}>{role}</Text>
        <Text style={styles.credits}>{credits}</Text>
      </View>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials(name)}</Text>
      </View>
      <Text style={styles.playerName}>{name}</Text>
      <Text style={styles.club}>{club}</Text>
    </ShaderView>
  );
}

const TIER_LOOK: Record<Tier, { tint: string; shade: string; ink: string; aurora?: boolean }> = {
  Scout: { tint: '#8fa3b8', shade: '#2b3644', ink: '#f8fafc' },
  Analyst: { tint: '#f0b98a', shade: '#7a3e17', ink: '#2a1305' },
  Tactician: { tint: '#eef2f7', shade: '#5b6675', ink: '#0f172a' },
  Master: { tint: '#ffe08a', shade: '#8a5a00', ink: '#2a1a00' },
  Grandmaster: {
    tint: '#a78bfa',
    shade: '#22d3ee',
    ink: '#f5f3ff',
    aurora: true,
  },
};

/** Season Mastery tier badge card: brushed metal per tier, aurora for Grandmaster. */
export function TierSample({
  tier,
  rating,
  animated,
  seed,
}: {
  tier: Tier;
  rating: number;
  animated?: boolean;
  seed?: number;
}) {
  const look = TIER_LOOK[tier];
  const need = TIER_THRESHOLDS[tier];
  const blurb = need.cards ? `Rating ${need.rating}+, ${need.cards} cards` : 'Starting out';
  return (
    <ShaderView
      effect={look.aurora ? effects.aurora : effects.brushedMetal}
      animated={animated}
      seed={seed}
      radius={16}
      uniforms={
        look.aurora
          ? { ca: rgb(look.tint), cb: rgb(look.shade) }
          : { tint: rgb(look.tint), shade: rgb(look.shade), sheen: 1 }
      }
      style={styles.tier}
    >
      <View>
        <Text style={[styles.tierName, { color: look.ink }]}>{tier}</Text>
        <Text style={[styles.tierBlurb, { color: look.ink }]}>{blurb}</Text>
      </View>
      <Text style={[styles.tierRating, { color: look.ink }]}>{rating}</Text>
    </ShaderView>
  );
}

/** Live tournament card: a comet of light runs round the border. */
export function LiveTournamentSample({ animated }: { animated?: boolean }) {
  return (
    <ShaderView
      effect={effects.neonBorder}
      animated={animated}
      radius={20}
      uniforms={{ radius: 14, ca: rgb('#22c55e'), cb: rgb('#facc15'), fill: rgb('#0b1120') }}
      style={styles.tournament}
    >
      <View style={styles.rowBetween}>
        <Text style={styles.live}>● LIVE</Text>
        <Text style={styles.muted}>Closes in 12:40</Text>
      </View>
      <Text style={styles.tournamentTitle}>Weekend Mega Contest</Text>
      <Text style={styles.muted}>Entry 50 coins · Prize pool 2,000 coins</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: '62%' }]} />
      </View>
      <Text style={styles.muted}>312 of 500 joined</Text>
    </ShaderView>
  );
}

/** Match card: pitch under sweeping floodlights. */
export function MatchSample({ animated }: { animated?: boolean }) {
  return (
    <ShaderView
      effect={effects.floodlightPitch}
      animated={animated}
      radius={18}
      uniforms={{ grass: rgb('#1f7a3a') }}
      style={styles.match}
    >
      <Text style={styles.kickoff}>Today · 20:00</Text>
      <View style={styles.teams}>
        <Team code="DHK" name="Dhaka Lions" />
        <Text style={styles.vs}>vs</Text>
        <Team code="CTG" name="Chattogram Kings" />
      </View>
      <Text style={styles.matchFoot}>4 tournaments · Analysis card open</Text>
    </ShaderView>
  );
}

function Team({ code, name }: { code: string; name: string }) {
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <View style={styles.crest}>
        <Text style={styles.crestText}>{code}</Text>
      </View>
      <Text style={styles.teamName}>{name}</Text>
    </View>
  );
}

function Pill({ label, bright }: { label: string; bright?: boolean }) {
  return (
    <View style={[styles.pill, bright && styles.pillBright]}>
      <Text style={[styles.pillText, bright && { color: '#1a1200' }]}>{label}</Text>
    </View>
  );
}

function initials(name: string) {
  return name
    .split(/[\s.]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const shadow = {
  textShadowColor: 'rgba(0,0,0,0.45)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
};

const styles = StyleSheet.create({
  wallet: { padding: 20, minHeight: 170, justifyContent: 'flex-end' },
  overline: { color: '#fef3c7', fontSize: 12, fontWeight: '700', letterSpacing: 1.5, ...shadow },
  balance: { color: '#fff', fontSize: 44, fontWeight: '800', marginVertical: 2, ...shadow },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  pillBright: { backgroundColor: '#facc15', borderColor: '#facc15' },
  pillText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  player: { flex: 1, height: 230, padding: 12, alignItems: 'center' },
  playerTop: { flexDirection: 'row', justifyContent: 'space-between', alignSelf: 'stretch' },
  role: { color: '#fff', fontWeight: '800', fontSize: 13, ...shadow },
  credits: { color: '#fff', fontWeight: '700', fontSize: 13, ...shadow },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    marginTop: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.6)',
  },
  avatarText: { color: '#fff', fontSize: 26, fontWeight: '800', ...shadow },
  playerName: { color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 14, ...shadow },
  club: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2, ...shadow },

  tier: {
    height: 76,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  tierName: { fontSize: 20, fontWeight: '800' },
  tierBlurb: { fontSize: 12, opacity: 0.85, marginTop: 2 },
  tierRating: { fontSize: 30, fontWeight: '900' },

  tournament: { padding: 22, gap: 6 },
  live: { color: '#f87171', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  tournamentTitle: { color: '#f8fafc', fontSize: 20, fontWeight: '800', marginTop: 4 },
  muted: { color: '#94a3b8', fontSize: 13 },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1f2937',
    marginTop: 8,
    overflow: 'hidden',
  },
  progressFill: { height: 6, backgroundColor: '#22c55e' },

  match: { padding: 16, minHeight: 180, justifyContent: 'space-between' },
  kickoff: { color: '#fff', fontWeight: '700', fontSize: 13, ...shadow },
  teams: { flexDirection: 'row', alignItems: 'center' },
  vs: { color: '#fff', fontSize: 16, fontWeight: '800', ...shadow },
  crest: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(11,17,32,0.7)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  crestText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  teamName: { color: '#fff', fontWeight: '700', fontSize: 13, marginTop: 6, ...shadow },
  matchFoot: { color: '#d1fae5', fontSize: 12, fontWeight: '600', ...shadow },
});
