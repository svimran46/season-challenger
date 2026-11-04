import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/api';
import { codeRequestError, localNumber, looksValid } from '../src/phone';
import { useTheme } from '../src/theme';
import { Button, Card, Screen } from '../src/ui';

/** Phone entry: the first step of sign-in. */
export default function SignInScreen() {
  const t = useTheme();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const send = useMutation({
    mutationFn: () => api.requestCode(localNumber(phone)),
    onSuccess: (sent) => {
      router.push({
        pathname: '/sign-in-code',
        params: {
          phone: sent.phone,
          maskedPhone: sent.maskedPhone,
          resendInSeconds: String(sent.resendInSeconds),
        },
      });
    },
  });
  const valid = looksValid(phone);
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 16 }} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={[styles.heading, { color: t.text }]}>Welcome to Season Challenger</Text>
          <Text style={{ color: t.muted, lineHeight: 20 }}>
            Enter your mobile number and we will text you a 6-digit code to sign in. New here? The
            same code creates your account.
          </Text>
          <Text style={[styles.label, { color: t.muted }]}>Mobile number</Text>
          <View style={[styles.field, { borderColor: t.border, backgroundColor: t.surface }]}>
            <Text style={[styles.prefix, { color: t.text, borderRightColor: t.border }]}>+880</Text>
            <TextInput
              style={[styles.input, { color: t.text }]}
              value={phone}
              onChangeText={(text) => {
                setPhone(text.replace(/[^\d]/g, ''));
                if (send.error) send.reset();
              }}
              placeholder="1712 345678"
              placeholderTextColor={t.muted}
              keyboardType="phone-pad"
              inputMode="tel"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={11}
              autoFocus
              returnKeyType="send"
              onSubmitEditing={() => valid && !send.isPending && send.mutate()}
              accessibilityLabel="Mobile number"
            />
          </View>
          {send.error ? (
            <Text style={{ color: t.live, marginTop: 8 }}>{codeRequestError(send.error)}</Text>
          ) : null}
          <View style={{ marginTop: 16 }}>
            <Button
              label="Send code"
              disabled={!valid}
              busy={send.isPending}
              onPress={() => send.mutate()}
            />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
  },
  prefix: {
    fontSize: 16,
    fontWeight: '600',
    paddingHorizontal: 12,
    borderRightWidth: 1,
    alignSelf: 'stretch',
    textAlignVertical: 'center',
    lineHeight: 44,
  },
  input: { flex: 1, paddingHorizontal: 12, minHeight: 44, fontSize: 16 },
});
