import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, useTheme } from '../../src/theme';

const icon = (name: ComponentProps<typeof Ionicons>['name']) =>
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} size={size - 2} color={color as string} />;
  };

export default function TabsLayout() {
  const t = useTheme();
  const { bottom } = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarLabelStyle: { lineHeight: 16, flexShrink: 0 },
        tabBarStyle: {
          backgroundColor: t.solid,
          borderTopColor: t.border,
          height: 60 + bottom,
          paddingTop: 2,
          paddingBottom: bottom + 2,
        },
        headerStyle: { backgroundColor: t.solid },
        headerTintColor: t.text,
        headerTitleStyle: { fontFamily: font.display, fontSize: 20 },
        headerShadowVisible: false,
        sceneStyle: { backgroundColor: 'transparent' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Matches', tabBarIcon: icon('football-outline') }}
      />
      <Tabs.Screen
        name="mastery"
        options={{ title: 'Mastery', tabBarIcon: icon('analytics-outline') }}
      />
      <Tabs.Screen
        name="leagues"
        options={{ title: 'Tournaments', tabBarIcon: icon('trophy-outline') }}
      />
      <Tabs.Screen
        name="wallet"
        options={{ title: 'Wallet', tabBarIcon: icon('wallet-outline') }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profile', tabBarIcon: icon('person-outline') }}
      />
    </Tabs>
  );
}
