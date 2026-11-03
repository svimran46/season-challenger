import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { api, ApiError } from '../src/api';
import { useTheme } from '../src/theme';
import { Button, Card, Screen } from '../src/ui';

/**
 * ID check. In development this records the details directly; in production an ID-check
 * provider captures the document and a selfie and calls the API back.
 */
export default function VerifyScreen() {
  const t = useTheme();
  const router = useRouter();
  const qc = useQueryClient();
  const [birthDate, setBirthDate] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const verify = useMutation({
    mutationFn: () => api.verify(birthDate.trim(), documentNumber.trim()),
    onSuccess: async () => {
      await qc.invalidateQueries();
      router.back();
    },
  });
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(birthDate.trim());
  const input = [
    styles.input,
    { color: t.text, borderColor: t.border, backgroundColor: t.surface },
  ];
  return (
    <Screen>
      <Stack.Screen options={{ title: 'Verify your ID' }} />
      <ScrollView contentContainerStyle={{ paddingTop: 16 }}>
        <Card>
          <Text style={{ color: t.text, lineHeight: 20 }}>
            Vouchers are for players aged 18 and over, and each person can verify one account. We
            keep your date of birth and a scrambled fingerprint of your ID number, never the number
            itself.
          </Text>
          <Text style={[styles.label, { color: t.muted }]}>Date of birth (YYYY-MM-DD)</Text>
          <TextInput
            style={input}
            value={birthDate}
            onChangeText={setBirthDate}
            placeholder="1998-05-10"
            placeholderTextColor={t.muted}
            inputMode="numeric"
            autoComplete="birthdate-full"
          />
          <Text style={[styles.label, { color: t.muted }]}>National ID or passport number</Text>
          <TextInput
            style={input}
            value={documentNumber}
            onChangeText={setDocumentNumber}
            placeholderTextColor={t.muted}
            autoCapitalize="characters"
          />
          {verify.error ? (
            <Text style={{ color: t.live, marginTop: 8 }}>
              {verify.error instanceof ApiError ? verify.error.message : 'Something went wrong.'}
            </Text>
          ) : null}
          <Text style={{ color: t.muted, fontSize: 12, marginTop: 12 }}>
            Test mode: the live app checks your document with an ID-verification partner.
          </Text>
          <Button
            label="Verify"
            disabled={!validDate || documentNumber.trim().length < 6}
            busy={verify.isPending}
            onPress={() => verify.mutate()}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, minHeight: 44, fontSize: 16 },
});
