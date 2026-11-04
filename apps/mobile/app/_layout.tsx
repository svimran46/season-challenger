import {
  Sora_600SemiBold,
  Sora_700Bold,
  Sora_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/sora';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth';
import { ShaderSurface } from '../src/shaders/ShaderSurface';
import { font, useTheme } from '../src/theme';
import { Loading, Screen } from '../src/ui';

// On web, Google sign-in opens a popup that comes back to this app. When this page is that popup,
// this hands Google's answer to the sign-in screen that opened it and closes the popup. It sits
// here, not on the sign-in screen, because routes load lazily on web and the popup lands on `/`.
if (Platform.OS === 'web') WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Sora_600SemiBold, Sora_700Bold, Sora_800ExtraBold });
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  // A failed font falls back to the system face, which is better than no app.
  if (!fontsLoaded && !fontError) return <View style={styles.waiting} />;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="light" />
        <RootStack />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function RootStack() {
  const t = useTheme();
  const { loading, signedIn } = useAuth();
  if (loading) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }
  return (
    <ThemeProvider value={navigationTheme}>
      <View style={[styles.root, { backgroundColor: t.background }]}>
        {/* One canvas behind every screen. Sign-in paints its own stadium over it, so it rests there. */}
        <ShaderSurface look="silk" animated={signedIn} />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.solid },
            headerTintColor: t.text,
            headerTitleStyle: { fontFamily: font.title },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: 'transparent' },
            animation: 'fade',
          }}
        >
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="fixture/[id]" options={{ title: 'Match' }} />
            <Stack.Screen name="squad/[contestId]" options={{ title: 'Pick your squad' }} />
            <Stack.Screen name="card/[fixtureId]" options={{ title: 'Analysis card' }} />
            <Stack.Screen
              name="verify"
              options={{ title: 'Verify your ID', presentation: 'modal' }}
            />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="sign-in" options={{ headerShown: false, title: 'Sign in' }} />
            <Stack.Screen name="sign-in-code" options={{ title: 'Enter your code' }} />
          </Stack.Protected>
        </Stack>
      </View>
    </ThemeProvider>
  );
}

// Navigators paint their own background otherwise, which would hide the silk.
const navigationTheme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: 'transparent' },
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  waiting: { flex: 1, backgroundColor: '#07080b' },
});
