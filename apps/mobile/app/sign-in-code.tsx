import { useMutation } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../src/api';
import { useAuth } from '../src/auth';
import { codeRequestError } from '../src/phone';
import { useTheme } from '../src/theme';
import { Button, Card, Screen } from '../src/ui';

/** Errors after which this code can no longer be used, so the player needs a new one. */
const NEEDS_NEW_CODE = new Set(['code_expired', 'too_many_attempts', 'invalid_phone']);

function verifyError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'We could not reach the server. Check your connection.';
  switch (error.code) {
    case 'wrong_code': {
      const left = error.attemptsLeft;
      if (left === undefined)
        return 'That code is not right. Check the text message and try again.';
      if (left <= 0)
        return 'That code is not right, and there are no tries left. Ask for a new one.';
      return `That code is not right. You have ${left} ${left === 1 ? 'try' : 'tries'} left.`;
    }
    case 'code_expired':
      return 'That code has expired. Ask for a new one.';
    case 'too_many_attempts':
      return 'Too many wrong tries for this code. Ask for a new one.';
    case 'invalid_phone':
      return 'Something is wrong with that number. Go back and enter it again.';
    default:
      return error.message;
  }
}

/** Second step of sign-in: the 6-digit code from the text message. */
export default function SignInCodeScreen() {
  const t = useTheme();
  const router = useRouter();
  const { signIn } = useAuth();
  const params = useLocalSearchParams<{
    phone: string;
    maskedPhone: string;
    resendInSeconds: string;
  }>();
  const phone = params.phone ?? '';
  const [maskedPhone, setMaskedPhone] = useState(params.maskedPhone ?? phone);
  const [code, setCode] = useState('');
  const [resendAt, setResendAt] = useState(
    () => Date.now() + (Number(params.resendInSeconds) || 60) * 1000,
  );
  const [now, setNow] = useState(() => Date.now());
  const wait = Math.max(0, Math.ceil((resendAt - now) / 1000));

  useEffect(() => {
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= resendAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendAt]);

  const backToNumber = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/sign-in');
  };

  const verify = useMutation({
    mutationFn: (value: string) => api.verifyCode(phone, value),
    onSuccess: async (result) => {
      // The layout swaps to the signed-in screens once the token is held.
      await signIn(result.token);
    },
  });

  const resend = useMutation({
    mutationFn: () => api.requestCode(phone),
    onSuccess: (sent) => {
      setMaskedPhone(sent.maskedPhone);
      setResendAt(Date.now() + sent.resendInSeconds * 1000);
      setNow(Date.now());
      setCode('');
      verify.reset();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.retryAfterSeconds) {
        setResendAt(Date.now() + error.retryAfterSeconds * 1000);
        setNow(Date.now());
      }
    },
  });

  const verifyCode =
    verify.error instanceof ApiError ? verify.error.code : verify.error ? 'network' : undefined;
  const needsNewCode =
    (verifyCode !== undefined && NEEDS_NEW_CODE.has(verifyCode)) ||
    (verify.error instanceof ApiError &&
      verify.error.code === 'wrong_code' &&
      verify.error.attemptsLeft === 0);
  const complete = /^\d{6}$/.test(code);

  const submit = (value: string) => {
    if (/^\d{6}$/.test(value) && !verify.isPending && !needsNewCode) verify.mutate(value);
  };

  if (!phone) {
    return (
      <Screen>
        <View style={{ paddingTop: 16 }}>
          <Card>
            <Text style={{ color: t.text, marginBottom: 12 }}>
              We lost track of your number. Enter it again to get a code.
            </Text>
            <Button label="Enter number" onPress={backToNumber} />
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingTop: 16 }} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={{ color: t.text, lineHeight: 20 }}>
            Code sent to <Text style={{ fontWeight: '700' }}>{maskedPhone}</Text>
          </Text>
          <Text style={[styles.label, { color: t.muted }]}>6-digit code</Text>
          <TextInput
            style={[
              styles.input,
              { color: t.text, borderColor: t.border, backgroundColor: t.surface },
            ]}
            value={code}
            onChangeText={(text) => {
              const digits = text.replace(/\D/g, '').slice(0, 6);
              setCode(digits);
              if (verify.error && !needsNewCode) verify.reset();
              // Sign in as soon as the code is complete, including when the phone fills it in.
              if (digits.length === 6 && digits !== code) submit(digits);
            }}
            placeholder="123456"
            placeholderTextColor={t.muted}
            keyboardType="number-pad"
            inputMode="numeric"
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            maxLength={6}
            autoFocus
            editable={!needsNewCode}
            accessibilityLabel="6-digit code"
          />
          {__DEV__ ? (
            <Text style={{ color: t.muted, fontSize: 12, marginTop: 6 }}>
              Test mode: the code is printed in the API server log.
            </Text>
          ) : null}
          {verify.error ? (
            <Text style={{ color: t.live, marginTop: 8 }}>{verifyError(verify.error)}</Text>
          ) : null}
          {resend.error ? (
            <Text style={{ color: t.live, marginTop: 8 }}>{codeRequestError(resend.error)}</Text>
          ) : null}
          <View style={{ marginTop: 16, gap: 8 }}>
            {needsNewCode ? (
              <Button label="Get a new code" onPress={backToNumber} />
            ) : (
              <>
                <Button
                  label="Sign in"
                  disabled={!complete}
                  busy={verify.isPending}
                  onPress={() => submit(code)}
                />
                <Button
                  kind="secondary"
                  label={wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
                  disabled={wait > 0}
                  busy={resend.isPending}
                  onPress={() => resend.mutate()}
                />
                <Button kind="secondary" label="Change number" onPress={backToNumber} />
              </>
            )}
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 48,
    fontSize: 22,
    letterSpacing: 6,
  },
});
