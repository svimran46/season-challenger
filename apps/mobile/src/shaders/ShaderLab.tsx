import { TIERS } from '@season/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { SectionTitle, Segmented } from '../ui';
import {
  HoloPlayerSample,
  LiveTournamentSample,
  MatchSample,
  TierSample,
  WalletHeaderSample,
} from './cards';
import {
  AnalysisSample,
  CaptainSample,
  DailyRewardSample,
  KickoffSample,
  SeasonProgressSample,
  SignInHeroSample,
} from './extraCards';
import {
  AnalysisDesign,
  DailyRewardDesign,
  LiveTournamentDesign,
  MatchCardDesign,
  MatchesListDesign,
  PlayerRarityDesigns,
  ProfileDesign,
  SignInDesign,
  TierDesigns,
  TournamentsListDesign,
  VouchersDesign,
  WalletDesign,
  WinDesign,
} from './designCards';
import { ShaderMotion } from './ShaderView';

type Tab = 'design' | 'earlier';

// One app area per section of the design set, in the order of design/shaders-picks.md.
const DESIGN_SET: [string, () => React.JSX.Element][] = [
  ['Sign-in hero · light streams', SignInDesign],
  ['Matches list · dot panels', MatchesListDesign],
  ['Match card · grid pitch', MatchCardDesign],
  ['Tournaments list · tunnel', TournamentsListDesign],
  ['Live tournament · slashes', LiveTournamentDesign],
  ['Wallet header · corner glow', WalletDesign],
  ['Daily reward · small burst', DailyRewardDesign],
  ['Season Mastery tiers', TierDesigns],
  ['Pre-match analysis · signal lines', AnalysisDesign],
  ['Player cards · foil by rarity', PlayerRarityDesigns],
  ['Vouchers shop · chevrons', VouchersDesign],
  ['Profile header · eclipse', ProfileDesign],
  ['Win moment · fireworks', WinDesign],
];

/** A gallery of shader effects on sample cards, to choose which ones go into the real screens. */
export default function ShaderLab() {
  const t = useTheme();
  const [animate, setAnimate] = useState(true);
  const [tab, setTab] = useState<Tab>('design');
  // Browsers cap WebGL contexts (about 16 per page), so the web preview can show a slice of the
  // design set with ?from=&to=. Phones draw all of them.
  const { from, to } = useLocalSearchParams<{ from?: string; to?: string }>();
  const shown = DESIGN_SET.slice(Number(from ?? 0), to ? Number(to) : undefined);
  return (
    <ShaderMotion.Provider value={animate}>
      <ScrollView style={{ backgroundColor: t.background }} contentContainerStyle={styles.content}>
        <View style={[styles.toggle, { backgroundColor: t.surface, borderColor: t.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.toggleTitle, { color: t.text }]}>Animate effects</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>
              Off shows one still frame, as a low-end phone or battery saver would.
            </Text>
          </View>
          <Switch value={animate} onValueChange={setAnimate} />
        </View>
        <View style={styles.pad}>
          <Segmented<Tab>
            options={[
              { value: 'design', label: 'Design set' },
              { value: 'earlier', label: 'Earlier samples' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </View>

        {tab === 'design' ? (
          shown.map(([title, Design]) => (
            <View key={title}>
              <SectionTitle>{title}</SectionTitle>
              <View style={styles.pad}>
                <Design />
              </View>
            </View>
          ))
        ) : (
          <>
            <SectionTitle>Wallet header · mesh gradient</SectionTitle>
            <View style={styles.pad}>
              <WalletHeaderSample />
            </View>

            <SectionTitle>Player cards · holographic foil</SectionTitle>
            <Text style={[styles.hint, { color: t.muted }]}>
              Drag across a card to move the light.
            </Text>
            <View style={[styles.pad, styles.row]}>
              <HoloPlayerSample
                name="R. Hasan"
                role="FWD"
                club="Dhaka Lions"
                credits="9.5 cr"
                base="#1e1b4b"
              />
              <HoloPlayerSample
                name="T. Ahmed"
                role="GK"
                club="Chattogram Kings"
                credits="8.0 cr"
                base="#134e4a"
                seed={7}
              />
            </View>

            <SectionTitle>Season Mastery tiers · brushed metal and aurora</SectionTitle>
            <View style={styles.pad}>
              {TIERS.map((tier, i) => (
                <TierSample
                  key={tier}
                  tier={tier}
                  rating={[22, 47, 61, 72, 84][i] ?? 0}
                  seed={i * 1.3}
                />
              ))}
            </View>

            <SectionTitle>Live tournament · running neon border</SectionTitle>
            <View style={styles.pad}>
              <LiveTournamentSample />
            </View>

            <SectionTitle>Match card · floodlit pitch</SectionTitle>
            <View style={styles.pad}>
              <MatchSample />
            </View>
            <SectionTitle>Daily reward · sunburst</SectionTitle>
            <View style={styles.pad}>
              <DailyRewardSample />
            </View>

            <SectionTitle>Season progress · liquid fill</SectionTitle>
            <View style={styles.pad}>
              <SeasonProgressSample />
            </View>

            <SectionTitle>Captain pick · flames</SectionTitle>
            <View style={styles.pad}>
              <CaptainSample />
            </View>

            <SectionTitle>Analysis card · water light</SectionTitle>
            <View style={styles.pad}>
              <AnalysisSample />
            </View>

            <SectionTitle>Kick-off countdown · radar pulse</SectionTitle>
            <View style={styles.pad}>
              <KickoffSample />
            </View>

            <SectionTitle>Sign-in hero · halftone wave</SectionTitle>
            <View style={styles.pad}>
              <SignInHeroSample />
            </View>
          </>
        )}
      </ScrollView>
    </ShaderMotion.Provider>
  );
}

const styles = StyleSheet.create({
  content: { paddingVertical: 16, paddingBottom: 48 },
  pad: { paddingHorizontal: 16, marginBottom: 8 },
  row: { flexDirection: 'row', gap: 12 },
  hint: { fontSize: 12, marginHorizontal: 16, marginTop: -4, marginBottom: 8 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toggleTitle: { fontSize: 15, fontWeight: '700', marginBottom: 2 },
});
