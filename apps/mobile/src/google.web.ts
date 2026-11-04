import { useIdTokenAuthRequest } from 'expo-auth-session/providers/google';
import { useCallback } from 'react';
import { GoogleSignInError } from './google.types';
import type { UseGoogleSignIn } from './google.types';

/**
 * Google sign-in in the browser: a Google popup that returns an ID token straight to the page
 * (OAuth implicit flow, response_type=id_token). The popup comes back to the app's origin, where
 * app/_layout.tsx calls WebBrowser.maybeCompleteAuthSession() to hand the result to this page.
 */

export const googleSignInSupported = true;

export const useGoogleSignIn: UseGoogleSignIn = (webClientId) => {
  const [request, , promptAsync] = useIdTokenAuthRequest({ webClientId, selectAccount: true });
  const signIn = useCallback(async () => {
    const result = await promptAsync();
    if (result.type === 'success') {
      const idToken = result.params.id_token;
      if (!idToken) {
        throw new GoogleSignInError('Google did not send back your sign-in details. Try again.');
      }
      return idToken;
    }
    if (result.type === 'error') {
      throw new GoogleSignInError('Google sign-in did not work. Try again.');
    }
    // cancel, dismiss (popup closed), or locked (another prompt is already open).
    return null;
  }, [promptAsync]);
  return { ready: request !== null, signIn };
};
