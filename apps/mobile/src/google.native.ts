import { useCallback } from 'react';
import { Platform } from 'react-native';
import { GoogleSignInError } from './google.types';
import type { UseGoogleSignIn } from './google.types';

type GoogleModule = typeof import('@react-native-google-signin/google-signin');

/**
 * Google sign-in on phones, through the native Google Sign-In SDK. Android only for now: iOS also
 * needs an iOS OAuth client id and the iosUrlScheme config plugin option.
 */
export const googleSignInSupported = Platform.OS === 'android';

let loaded: Promise<GoogleModule | null> | undefined;

/**
 * Loaded on first use, not at app start: the module throws on import when the native code is not
 * in the build (for example in Expo Go), and phone sign-in should still work there.
 */
function loadModule(): Promise<GoogleModule | null> {
  loaded ??= import('@react-native-google-signin/google-signin').catch(() => null);
  return loaded;
}

async function signInWithGoogle(webClientId: string): Promise<string | null> {
  const google = await loadModule();
  if (!google) {
    throw new GoogleSignInError('Google sign-in is not available in this version of the app.');
  }
  const { GoogleSignin, isErrorWithCode, statusCodes } = google;
  try {
    // The ID token's audience is the web client id, which is what the API checks.
    GoogleSignin.configure({ webClientId });
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Forget the account picked last time, so a player who signed out can choose another one.
    if (GoogleSignin.hasPreviousSignIn()) await GoogleSignin.signOut().catch(() => null);
    const result = await GoogleSignin.signIn();
    if (result.type === 'cancelled') return null;
    if (!result.data.idToken) {
      throw new GoogleSignInError('Google did not send back your sign-in details. Try again.');
    }
    return result.data.idToken;
  } catch (error) {
    if (error instanceof GoogleSignInError) throw error;
    if (isErrorWithCode(error)) {
      switch (error.code) {
        case statusCodes.SIGN_IN_CANCELLED:
        case statusCodes.IN_PROGRESS:
          return null;
        case statusCodes.PLAY_SERVICES_NOT_AVAILABLE:
          throw new GoogleSignInError(
            'Google sign-in needs Google Play services, which this phone does not have or needs to update. Use your mobile number instead.',
          );
        case '10': // DEVELOPER_ERROR: the app's package name or SHA-1 is not set up in Google Cloud.
          throw new GoogleSignInError(
            __DEV__
              ? 'Google sign-in is not set up for this build (DEVELOPER_ERROR). Add an Android OAuth client with this package name and signing SHA-1 in Google Cloud.'
              : 'Google sign-in is not working in this version of the app. Use your mobile number instead.',
          );
      }
    }
    throw new GoogleSignInError('Google sign-in did not work. Try again.');
  }
}

export const useGoogleSignIn: UseGoogleSignIn = (webClientId) => {
  const signIn = useCallback(() => signInWithGoogle(webClientId), [webClientId]);
  return { ready: true, signIn };
};
