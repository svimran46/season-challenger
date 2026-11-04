import { TIERS } from '@season/shared';
import { useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '../theme';
import { SectionTitle } from '../ui';
import {
  HoloPlayerSample,
  LiveTournamentSample,
  MatchSample,
  TierSample,
  WalletHeaderSample,
} from './cards';
import { ShaderMotion } from './ShaderView';

/** A gallery of shader effects on sample cards, to choose which ones go into the real screens. */
export default function ShaderLab() {
  const t = useTheme();
  const [animate, setAnimate] = useState(true);
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

        <SectionTitle>Wallet header · mesh gradient</SectionTitle>
        <View style={styles.pad}>
          <WalletHeaderSample />
        </View>

        <SectionTitle>Player cards · holographic foil</SectionTitle>
        <Text style={[styles.hint, { color: t.muted }]}>Drag across a card to move the light.</Text>
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
