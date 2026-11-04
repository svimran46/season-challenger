import { useMutation, useQuery } from '@tanstack/react-query';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../../src/api';
import { useAuth } from '../../src/auth';
import { useTheme } from '../../src/theme';
import { Button, Card, Screen, SectionTitle } from '../../src/ui';

export default function ProfileScreen() {
  const t = useTheme();
  const { signOut } = useAuth();
  const me = useQuery({ queryKey: ['me'], queryFn: api.me });
  const leave = useMutation({ mutationFn: signOut });
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 16 }}>
        <SectionTitle>Account</SectionTitle>
        <Card>
          <Text style={[styles.label, { color: t.muted }]}>Signed in as</Text>
          <Text style={[styles.phone, { color: t.text }]}>
            {me.data
              ? (me.data.email ?? me.data.phone ?? 'Your account')
              : me.isError
                ? 'Could not load your account'
                : 'Loading…'}
          </Text>
          <View style={{ marginTop: 16 }}>
            <Button
              kind="secondary"
              label="Sign out"
              busy={leave.isPending}
              onPress={() => leave.mutate()}
            />
          </View>
        </Card>
        <Text style={[styles.soon, { color: t.muted }]}>
          Your favourite club, badges and season history are coming soon.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', marginBottom: 4 },
  phone: { fontSize: 18, fontWeight: '700' },
  soon: { fontSize: 13, textAlign: 'center', marginHorizontal: 24, marginTop: 4, lineHeight: 18 },
});
