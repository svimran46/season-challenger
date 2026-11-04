import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Platform } from 'react-native';
import { AuthProvider, useAuth } from '../src/auth';
import { useTheme } from '../src/theme';
import { Loading, Screen } from '../src/ui';

// On web, Google sign-in opens a popup that comes back to this app. When this page is that popup,
// this hands Google's answer to the sign-in screen that opened it and closes the popup. It sits
// here, not on the sign-in screen, because routes load lazily on web and the popup lands on `/`.
if (Platform.OS === 'web') WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="auto" />
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
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: t.surface },
        headerTintColor: t.text,
        contentStyle: { backgroundColor: t.background },
      }}
    >
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="fixture/[id]" options={{ title: 'Match' }} />
        <Stack.Screen name="squad/[contestId]" options={{ title: 'Pick your squad' }} />
        <Stack.Screen name="verify" options={{ title: 'Verify your ID', presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" options={{ title: 'Sign in' }} />
        <Stack.Screen name="sign-in-code" options={{ title: 'Enter your code' }} />
      </Stack.Protected>
    </Stack>
  );
}
