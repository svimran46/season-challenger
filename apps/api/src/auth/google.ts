import { OAuth2Client } from 'google-auth-library';

export interface GoogleProfile {
  /** Google's stable id for the person. */
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

/** Checks a Google ID token from the app and returns who it belongs to, or throws. */
export interface GoogleVerifier {
  readonly webClientId: string;
  verify(idToken: string): Promise<GoogleProfile>;
}

/**
 * Verifies ID tokens with Google's published keys: signature, expiry, issuer
 * (accounts.google.com) and audience. The Android app and the web app both ask Google for a
 * token addressed to the web client id, so that is the audience we accept.
 */
export class GoogleIdTokenVerifier implements GoogleVerifier {
  private readonly client = new OAuth2Client();

  constructor(readonly webClientId: string) {}

  async verify(idToken: string): Promise<GoogleProfile> {
    const ticket = await this.client.verifyIdToken({ idToken, audience: this.webClientId });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new Error('Google token has no subject');
    return {
      subject: payload.sub,
      email: payload.email ?? null,
      emailVerified: payload.email_verified === true,
    };
  }
}
