import { Tabs } from 'expo-router';
import { Text, type ColorValue } from 'react-native';
import { useTheme } from '../../src/theme';

// Simple glyph icons until an icon set is chosen.
const icon = (glyph: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;
  };

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarLabelStyle: { lineHeight: 16 },
        tabBarStyle: { backgroundColor: t.solid, borderTopColor: t.border },
        headerStyle: { backgroundColor: t.solid },
        headerTintColor: t.text,
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Matches', tabBarIcon: icon('⚽') }} />
      <Tabs.Screen name="mastery" options={{ title: 'Mastery', tabBarIcon: icon('◎') }} />
      <Tabs.Screen name="leagues" options={{ title: 'Tournaments', tabBarIcon: icon('☰') }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet', tabBarIcon: icon('◈') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('●') }} />
    </Tabs>
  );
}
