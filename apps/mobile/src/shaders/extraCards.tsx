// Second batch of sample cards. Made-up data, as in cards.tsx.

import { StyleSheet, Text, View } from 'react-native';
import { moreEffects } from './extraSources';
import { rgb } from './sources';
import { ShaderView } from './ShaderView';

/** Daily reward: sun rays behind the coin amount. */
export function DailyRewardSample() {
  return (
    <ShaderView
      effect={moreEffects.sunburst}
      radius={22}
      uniforms={{ ca: rgb('#fbbf24'), cb: rgb('#7c2d12') }}
      style={styles.reward}
    >
      <Text style={styles.rewardDay}>DAY 7 STREAK</Text>
      <Text style={styles.rewardAmount}>+50</Text>
      <Text style={styles.rewardUnit}>coins</Text>
      <View style={styles.claim}>
        <Text style={styles.claimText}>Claim reward</Text>
      </View>
    </ShaderView>
  );
}

/** Season progress: the tank fills as the player gets closer to the next tier. */
export function SeasonProgressSample({ progress = 0.64 }: { progress?: number }) {
  return (
    <ShaderView
      effect={moreEffects.liquidFill}
      radius={20}
      uniforms={{ progress, ca: rgb('#34d399'), cb: rgb('#065f46') }}
      style={styles.progress}
    >
      <Text style={styles.overline}>SEASON PROGRESS</Text>
      <Text style={styles.big}>{Math.round(progress * 100)}%</Text>
      <Text style={styles.sub}>18 of 28 analysis cards to reach Master</Text>
    </ShaderView>
  );
}

/** Captain pick: flames rising behind the player. */
export function CaptainSample() {
  return (
    <ShaderView
      effect={moreEffects.flame}
      radius={20}
      uniforms={{ base: rgb('#120806') }}
      style={styles.captain}
    >
      <View style={styles.rowBetween}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>C</Text>
        </View>
        <Text style={styles.double}>2× points</Text>
      </View>
      <View>
        <Text style={styles.big}>R. Hasan</Text>
        <Text style={styles.sub}>On fire · scored in 3 matches running</Text>
      </View>
    </ShaderView>
  );
}

/** Pre-match analysis card: calm water light, for the thinking part of the app. */
export function AnalysisSample() {
  return (
    <ShaderView
      effect={moreEffects.caustics}
      radius={20}
      uniforms={{ deep: rgb('#0c4a6e'), shallow: rgb('#0e7490') }}
      style={styles.analysis}
    >
      <Text style={styles.overline}>PRE-MATCH ANALYSIS</Text>
      <Text style={styles.title}>Dhaka Lions vs Chattogram Kings</Text>
      {['Both teams score', 'Over 2.5 goals', 'First goal before 30 min'].map((call, i) => (
        <View key={call} style={styles.call}>
          <Text style={styles.callText}>{call}</Text>
          <Text style={styles.callPick}>{['Yes', 'No', '—'][i]}</Text>
        </View>
      ))}
      <Text style={styles.sub}>2 of 6 calls made · Locks at kick-off</Text>
    </ShaderView>
  );
}

/** Sign-in / onboarding hero: a wave of dots. */
export function SignInHeroSample() {
  return (
    <ShaderView
      effect={moreEffects.halftoneWave}
      radius={24}
      uniforms={{ bg: rgb('#0b1120'), ca: rgb('#22c55e'), cb: rgb('#facc15') }}
      style={styles.hero}
    >
      <Text style={styles.heroTitle}>Season Challenger</Text>
      <Text style={styles.heroSub}>Read the game. Prove it all season.</Text>
      <View style={styles.heroButton}>
        <Text style={styles.heroButtonText}>Continue with Google</Text>
      </View>
    </ShaderView>
  );
}

/** Kick-off countdown: radar rings pulse while the clock runs down. */
export function KickoffSample() {
  return (
    <ShaderView
      effect={moreEffects.radarPulse}
      radius={20}
      uniforms={{ bg: rgb('#03140b'), c: rgb('#4ade80') }}
      style={styles.kickoff}
    >
      <Text style={styles.overline}>KICKS OFF IN</Text>
      <Text style={styles.clock}>08:12</Text>
      <Text style={styles.sub}>Your squad is locked in · 3 tournaments joined</Text>
    </ShaderView>
  );
}

const shadow = {
  textShadowColor: 'rgba(0,0,0,0.5)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
};

const styles = StyleSheet.create({
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  overline: { color: '#e2e8f0', fontSize: 12, fontWeight: '800', letterSpacing: 1.5, ...shadow },
  big: { color: '#fff', fontSize: 30, fontWeight: '900', ...shadow },
  title: { color: '#fff', fontSize: 18, fontWeight: '800', marginTop: 4, ...shadow },
  sub: { color: 'rgba(255,255,255,0.88)', fontSize: 13, marginTop: 4, ...shadow },

  reward: { height: 230, alignItems: 'center', justifyContent: 'center' },
  rewardDay: { color: '#fff7ed', fontWeight: '800', letterSpacing: 2, fontSize: 12, ...shadow },
  rewardAmount: { color: '#fff', fontSize: 56, fontWeight: '900', ...shadow },
  rewardUnit: { color: '#fff7ed', fontSize: 16, fontWeight: '700', marginTop: -6, ...shadow },
  claim: {
    marginTop: 16,
    backgroundColor: '#fff',
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
  },
  claimText: { color: '#7c2d12', fontWeight: '800', fontSize: 15 },

  progress: { height: 170, padding: 18, justifyContent: 'flex-end' },

  captain: { height: 190, padding: 18, justifyContent: 'space-between' },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#facc15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#1a1200', fontWeight: '900', fontSize: 18 },
  double: { color: '#fde68a', fontWeight: '800', fontSize: 14, ...shadow },

  analysis: { padding: 18, gap: 6 },
  call: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.25)',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  callText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  callPick: { color: '#a5f3fc', fontSize: 14, fontWeight: '800' },

  hero: { height: 260, padding: 22, justifyContent: 'flex-end' },
  heroTitle: { color: '#fff', fontSize: 30, fontWeight: '900', ...shadow },
  heroSub: { color: '#e2e8f0', fontSize: 15, marginTop: 4, ...shadow },
  heroButton: {
    marginTop: 18,
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingVertical: 13,
    alignItems: 'center',
  },
  heroButtonText: { color: '#0f172a', fontWeight: '800', fontSize: 15 },

  kickoff: { height: 150, padding: 18, justifyContent: 'center' },
  clock: {
    color: '#fff',
    fontSize: 44,
    fontWeight: '900',
    fontVariant: ['tabular-nums'],
    ...shadow,
  },
});
