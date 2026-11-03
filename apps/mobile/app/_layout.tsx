import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useTheme } from '../src/theme';

export default function RootLayout() {
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }),
  );
  const t = useTheme();
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar style="auto" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: t.surface },
          headerTintColor: t.text,
          contentStyle: { backgroundColor: t.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="fixture/[id]" options={{ title: 'Match' }} />
        <Stack.Screen name="squad/[contestId]" options={{ title: 'Pick your squad' }} />
        <Stack.Screen name="verify" options={{ title: 'Verify your ID', presentation: 'modal' }} />
      </Stack>
    </QueryClientProvider>
  );
}
