import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../src/api';
import { useAuth } from '../src/auth';
import { googleSignInSupported, useGoogleSignIn } from '../src/google';
import { GoogleSignInError } from '../src/google.types';
import { codeRequestError, localNumber, looksValid } from '../src/phone';
import { ShaderSurface } from '../src/shaders/ShaderSurface';
import { useTheme } from '../src/theme';
import { Button, Card, Loading, Screen } from '../src/ui';

function googleError(error: unknown, phoneOffered: boolean): string {
  if (error instanceof GoogleSignInError) return error.message;
  if (!(error instanceof ApiError)) return 'We could not reach the server. Check your connection.';
  switch (error.code) {
    case 'google_rejected':
      return 'Google could not confirm your account. Try again, or pick a different Google account.';
    case 'google_unavailable':
      return phoneOffered
        ? 'Google sign-in is not working on our side right now. Try again in a few minutes, or use your mobile number.'
        : 'Google sign-in is not working on our side right now. Try again in a few minutes.';
    default:
      return error.message;
  }
}

/** First step of sign-in: Google, or a mobile number to text a code to. */
export default function SignInScreen() {
  const t = useTheme();
  const methods = useQuery({ queryKey: ['auth-methods'], queryFn: api.authMethods });

  if (methods.isPending) {
    return (
      <Screen>
        <Loading />
      </Screen>
    );
  }

  if (methods.isError) {
    return (
      <Screen>
        <View style={{ paddingTop: 16 }}>
          <Card>
            <Text style={{ color: t.text, marginBottom: 12, lineHeight: 20 }}>
              We could not reach the server. Check your connection and try again.
            </Text>
            <Button
              label="Try again"
              busy={methods.isFetching}
              onPress={() => void methods.refetch()}
            />
          </Card>
        </View>
      </Screen>
    );
  }

  const google = googleSignInSupported ? methods.data.google : null;
  const phone = methods.data.phone;

  return (
    <Screen>
      <ShaderSurface look="floodlight" />
      <ScrollView contentContainerStyle={styles.hero} keyboardShouldPersistTaps="handled">
        <View style={styles.brand}>
          <Text style={[styles.kicker, { color: t.accent }]}>SEASON CHALLENGER</Text>
          <Text style={[styles.tagline, { color: t.text }]}>Read the game.{'\n'}Prove it.</Text>
        </View>
        <Card>
          {!google && !phone ? (
            <Text style={{ color: t.muted, lineHeight: 20 }}>
              Sign-in is not set up on this server yet. Please try again later.
            </Text>
          ) : null}
          {google ? (
            <GoogleSignInButton webClientId={google.webClientId} phoneOffered={phone} />
          ) : null}
          {google && phone ? (
            <View style={styles.divider}>
              <View style={[styles.rule, { backgroundColor: t.border }]} />
              <Text style={{ color: t.muted, marginHorizontal: 12 }}>
                or use your mobile number
              </Text>
              <View style={[styles.rule, { backgroundColor: t.border }]} />
            </View>
          ) : null}
          {phone ? <PhoneForm primary={!google} /> : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function GoogleSignInButton({
  webClientId,
  phoneOffered,
}: {
  webClientId: string;
  phoneOffered: boolean;
}) {
  const t = useTheme();
  const { signIn } = useAuth();
  const google = useGoogleSignIn(webClientId);
  const go = useMutation({
    mutationFn: async () => {
      const idToken = await google.signIn();
      // Cancelled: nothing to show.
      if (idToken === null) return null;
      return api.signInWithGoogle(idToken);
    },
    onSuccess: async (result) => {
      // The layout swaps to the signed-in screens once the token is held.
      if (result) await signIn(result.token);
    },
  });
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: t.muted, lineHeight: 20, marginBottom: 12 }}>
        Sign in with your Google account. New here? This creates your account.
      </Text>
      <Button
        label="Continue with Google"
        disabled={!google.ready}
        busy={go.isPending}
        onPress={() => go.mutate()}
      />
      {go.error ? (
        <Text style={{ color: t.live, marginTop: 8 }}>{googleError(go.error, phoneOffered)}</Text>
      ) : null}
    </View>
  );
}

function PhoneForm({ primary }: { primary: boolean }) {
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
    <>
      <Text style={{ color: t.muted, lineHeight: 20 }}>
        Enter your mobile number and we will text you a 6-digit code to sign in. New here? The same
        code creates your account.
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
          // Only when the number is the sole way in: the keyboard would hide the Google button.
          autoFocus={primary}
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
          kind={primary ? 'primary' : 'secondary'}
          disabled={!valid}
          busy={send.isPending}
          onPress={() => send.mutate()}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  hero: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 96, paddingBottom: 24 },
  brand: { paddingHorizontal: 24, marginBottom: 20 },
  kicker: { fontSize: 13, fontWeight: '700', letterSpacing: 2.4, marginBottom: 8 },
  tagline: { fontSize: 38, lineHeight: 42, fontWeight: '800', letterSpacing: -0.5 },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 16, marginBottom: 6 },
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
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
