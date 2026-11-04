// The design set on sample cards: one card per app area, using designSources.ts.
// Data on the cards is made up for the samples.

import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import type { SkRuntimeEffect } from '@shopify/react-native-skia';
import { HoloPlayerSample } from './cards';
import { designEffects as fx } from './designSources';
import { rgb } from './sources';
import { ShaderView } from './ShaderView';

const NAVY = rgb('#0b1120');
const GREEN = rgb('#22c55e');
const GOLD = rgb('#facc15');

function Panel({
  effect,
  uniforms,
  style,
  children,
  radius = 20,
}: {
  effect: SkRuntimeEffect;
  uniforms: Record<string, number | readonly number[]>;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  radius?: number;
}) {
  return (
    <ShaderView effect={effect} uniforms={uniforms} radius={radius} style={style}>
      {children}
    </ShaderView>
  );
}

export function SignInDesign() {
  return (
    <Panel
      effect={fx.lightStreams}
      uniforms={{ bg: NAVY, ca: GREEN, cb: GOLD }}
      style={[s.pad, { height: 300, justifyContent: 'flex-end' }]}
    >
      <Text style={s.hero}>Season Challenger</Text>
      <Text style={s.body}>Read the game. Prove it all season.</Text>
      <View style={s.whiteButton}>
        <Text style={s.whiteButtonText}>Continue with Google</Text>
      </View>
    </Panel>
  );
}

export function MatchesListDesign() {
  return (
    <Panel effect={fx.dotPanels} uniforms={{ bg: NAVY, c: GREEN }} style={[s.pad, { gap: 10 }]}>
      {[
        ['Dhaka Lions', 'Chattogram Kings', 'Today 20:00'],
        ['Sylhet Tigers', 'Khulna United', 'Tomorrow 18:30'],
        ['Rajshahi Royals', 'Barishal FC', 'Sat 17:00'],
      ].map(([home, away, when]) => (
        <View key={home} style={s.row}>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>
              {home} vs {away}
            </Text>
            <Text style={s.rowSub}>{when}</Text>
          </View>
          <Text style={s.rowAction}>Pick ›</Text>
        </View>
      ))}
    </Panel>
  );
}

export function MatchCardDesign() {
  return (
    <Panel
      effect={fx.gridscape}
      uniforms={{ bg: NAVY, line: GREEN, glow: GOLD }}
      style={[s.pad, { height: 210 }]}
    >
      <Text style={s.overline}>TODAY · 20:00</Text>
      <Text style={s.title}>Dhaka Lions vs Chattogram Kings</Text>
      <Text style={s.body}>4 tournaments · Analysis card open</Text>
    </Panel>
  );
}

export function TournamentsListDesign() {
  return (
    <Panel
      effect={fx.tunnel}
      uniforms={{ bg: NAVY, ca: GOLD, cb: GREEN }}
      style={[s.pad, { height: 170, justifyContent: 'center' }]}
    >
      <Text style={s.overline}>TOURNAMENTS</Text>
      <Text style={s.title}>Road to the final</Text>
      <Text style={s.body}>12 open · 3 you've joined</Text>
    </Panel>
  );
}

export function LiveTournamentDesign() {
  return (
    <Panel
      effect={fx.slashes}
      uniforms={{ bg: rgb('#0f0a14'), ca: rgb('#ef4444'), cb: rgb('#f97316') }}
      style={[s.pad, { gap: 4 }]}
    >
      <Text style={[s.overline, { color: '#fca5a5' }]}>● LIVE · CLOSES IN 12:40</Text>
      <Text style={s.title}>Weekend Mega Contest</Text>
      <Text style={s.body}>Entry 50 coins · Prize pool 2,000 coins</Text>
      <Text style={s.body}>312 of 500 joined</Text>
    </Panel>
  );
}

export function WalletDesign() {
  return (
    <Panel
      effect={fx.cornerGlow}
      uniforms={{ bg: NAVY, c: GOLD, c2: GREEN }}
      style={[s.pad, { height: 170, justifyContent: 'flex-end' }]}
    >
      <Text style={s.overline}>YOUR COINS</Text>
      <Text style={s.big}>1,240</Text>
      <Text style={s.body}>Won 340 · Bonus 900</Text>
    </Panel>
  );
}

export function DailyRewardDesign() {
  return (
    <Panel
      effect={fx.fireworks}
      uniforms={{ bg: NAVY, ca: GOLD, cb: rgb('#fde68a'), bursts: 1, scale: 0.8 }}
      style={[s.pad, { height: 190, alignItems: 'center', justifyContent: 'center' }]}
    >
      <Text style={s.overline}>DAY 7 STREAK</Text>
      <Text style={s.big}>+50</Text>
      <View style={s.goldButton}>
        <Text style={s.goldButtonText}>Claim reward</Text>
      </View>
    </Panel>
  );
}

const TIERS: {
  name: string;
  need: string;
  rating: number;
  effect: SkRuntimeEffect;
  uniforms: Record<string, number | readonly number[]>;
}[] = [
  {
    name: 'Scout',
    need: 'Starting out',
    rating: 22,
    effect: fx.contours,
    uniforms: { bg: NAVY, c: GREEN },
  },
  {
    name: 'Analyst',
    need: 'Rating 40+, 5 cards',
    rating: 47,
    effect: fx.hexCells,
    uniforms: { bg: NAVY, ca: rgb('#22d3ee'), cb: GREEN },
  },
  {
    name: 'Tactician',
    need: 'Rating 55+, 10 cards',
    rating: 61,
    effect: fx.linkedRings,
    uniforms: { bg: NAVY, c: GREEN },
  },
  {
    name: 'Master',
    need: 'Rating 68+, 20 cards',
    rating: 72,
    effect: fx.dotSphere,
    uniforms: { bg: rgb('#0d0d12'), gold: GOLD },
  },
  {
    name: 'Grandmaster',
    need: 'Rating 78+, 30 cards',
    rating: 84,
    effect: fx.gem,
    uniforms: { deep: rgb('#2e1065'), light: rgb('#c084fc'), glint: GOLD },
  },
];

export function TierDesigns() {
  return (
    <View style={{ gap: 10 }}>
      {TIERS.map((t) => (
        <Panel key={t.name} effect={t.effect} uniforms={t.uniforms} radius={16} style={[s.tier]}>
          <View>
            <Text style={s.tierName}>{t.name}</Text>
            <Text style={s.rowSub}>{t.need}</Text>
          </View>
          <Text style={s.tierRating}>{t.rating}</Text>
        </Panel>
      ))}
    </View>
  );
}

export function AnalysisDesign() {
  return (
    <Panel
      effect={fx.signalLines}
      uniforms={{ bg: NAVY, c: rgb('#60a5fa') }}
      style={[s.pad, { gap: 8 }]}
    >
      <Text style={s.overline}>PRE-MATCH ANALYSIS</Text>
      <Text style={s.title}>Dhaka Lions vs Chattogram Kings</Text>
      {[
        ['Both teams score', 'Yes'],
        ['Over 2.5 goals', 'No'],
        ['First goal before 30 min', '—'],
      ].map(([call, pick]) => (
        <View key={call} style={s.call}>
          <Text style={s.callText}>{call}</Text>
          <Text style={s.callPick}>{pick}</Text>
        </View>
      ))}
      <Text style={s.rowSub}>2 of 6 calls made · Locks at kick-off</Text>
    </Panel>
  );
}

const RARITIES = [
  { label: 'Common', base: '#334155', name: 'S. Karim', role: 'DEF', credits: '6.5 cr' },
  { label: 'Rare', base: '#14532d', name: 'A. Rahman', role: 'MID', credits: '8.0 cr' },
  { label: 'Epic', base: '#3b0764', name: 'T. Ahmed', role: 'GK', credits: '8.5 cr' },
  { label: 'Legendary', base: '#713f12', name: 'R. Hasan', role: 'FWD', credits: '10 cr' },
];

export function PlayerRarityDesigns() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {RARITIES.map((r, i) => (
        <View key={r.label} style={{ width: '47%' }}>
          <HoloPlayerSample
            name={r.name}
            role={r.role}
            club={r.label}
            credits={r.credits}
            base={r.base}
            seed={i * 3}
          />
        </View>
      ))}
    </View>
  );
}

export function VouchersDesign() {
  return (
    <Panel
      effect={fx.chevrons}
      uniforms={{ bg: NAVY, gold: GOLD }}
      style={[s.pad, { height: 150, justifyContent: 'center' }]}
    >
      <Text style={s.overline}>VOUCHERS</Text>
      <Text style={s.title}>Spend your won coins</Text>
      <Text style={s.body}>Shop discounts and travel offers · coming soon</Text>
    </Panel>
  );
}

export function ProfileDesign() {
  return (
    <Panel
      effect={fx.eclipse}
      uniforms={{ bg: NAVY, ca: GREEN, cb: GOLD }}
      style={{ height: 280, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={s.avatar}>
        <Text style={s.avatarText}>MJ</Text>
      </View>
      <Text style={[s.rowTitle, { position: 'absolute', bottom: 18 }]}>
        Tactician · Season 2026/27
      </Text>
    </Panel>
  );
}

export function WinDesign() {
  return (
    <Panel
      effect={fx.fireworks}
      uniforms={{ bg: rgb('#070b16'), ca: GOLD, cb: GREEN, bursts: 3, scale: 1.3 }}
      style={[s.pad, { height: 260, alignItems: 'center', justifyContent: 'center' }]}
    >
      <Text style={s.overline}>YOU FINISHED 1ST</Text>
      <Text style={s.big}>+1,200</Text>
      <Text style={s.body}>Weekend Mega Contest</Text>
    </Panel>
  );
}

const shadow = {
  textShadowColor: 'rgba(0,0,0,0.6)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 5,
};

const s = StyleSheet.create({
  pad: { padding: 20 },
  hero: { color: '#fff', fontSize: 32, fontWeight: '900', ...shadow },
  big: { color: '#fff', fontSize: 46, fontWeight: '900', ...shadow },
  title: { color: '#fff', fontSize: 20, fontWeight: '800', marginTop: 2, ...shadow },
  body: { color: '#e2e8f0', fontSize: 14, marginTop: 4, ...shadow },
  overline: { color: '#fde68a', fontSize: 12, fontWeight: '800', letterSpacing: 1.5, ...shadow },
  whiteButton: {
    marginTop: 18,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  whiteButtonText: { color: '#0f172a', fontWeight: '800', fontSize: 15 },
  goldButton: {
    marginTop: 12,
    backgroundColor: '#facc15',
    borderRadius: 999,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  goldButtonText: { color: '#1a1200', fontWeight: '800', fontSize: 15 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17,24,39,0.85)',
    borderColor: '#1f2937',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  rowTitle: { color: '#f1f5f9', fontSize: 15, fontWeight: '700', ...shadow },
  rowSub: { color: '#cbd5e1', fontSize: 12, marginTop: 2, ...shadow },
  rowAction: { color: '#22c55e', fontWeight: '800' },
  tier: {
    height: 84,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tierName: { color: '#fff', fontSize: 20, fontWeight: '800', ...shadow },
  tierRating: { color: '#fff', fontSize: 30, fontWeight: '900', ...shadow },
  call: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(15,23,42,0.75)',
    borderColor: 'rgba(96,165,250,0.35)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  callText: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  callPick: { color: '#93c5fd', fontSize: 14, fontWeight: '800' },
  avatar: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#111827',
    borderWidth: 2,
    borderColor: 'rgba(250,204,21,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 30, fontWeight: '900' },
});
