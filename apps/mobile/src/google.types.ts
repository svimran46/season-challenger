/** Shared shape of the Google sign-in hook. Each platform file (google.native.ts, google.web.ts) implements it. */

export interface GoogleSignIn {
  /** False until the sign-in prompt can be opened. */
  ready: boolean;
  /** Opens Google's sign-in. Resolves to a Google ID token, or null if the player cancelled. */
  signIn: () => Promise<string | null>;
}

export type UseGoogleSignIn = (webClientId: string) => GoogleSignIn;

/** A Google sign-in failure whose message can be shown to the player as is. */
export class GoogleSignInError extends Error {}
