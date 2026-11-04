import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { CLOCK, type Clock } from '../common/tokens';
import type { AuthStore } from './auth.store';
import type { GoogleVerifier } from './google';
import { maskPhone, normalizeBdPhone } from './phone';
import type { SmsSender } from './sms';

export const AUTH_STORE = Symbol('AUTH_STORE');
export const SMS_SENDER = Symbol('SMS_SENDER');
export const AUTH_SETTINGS = Symbol('AUTH_SETTINGS');
export const GOOGLE_VERIFIER = Symbol('GOOGLE_VERIFIER');

export interface AuthSettings {
  /** Key for hashing sign-in codes. Long and random outside development. */
  secret: string;
  /** How long a code works. */
  codeSeconds: number;
  /** Wait before another code can go to the same number. */
  resendSeconds: number;
  /** Codes per number per rolling hour. */
  codesPerHour: number;
  /** Codes per client address per rolling hour, against SMS pumping. */
  codesPerAddressPerHour: number;
  /** Wrong guesses before a code stops working. */
  maxAttempts: number;
  /** How long a sign-in lasts on a device. */
  sessionDays: number;
  /** Off when no SMS provider can deliver codes (production without one). */
  phoneEnabled: boolean;
}

export const DEFAULT_AUTH_SETTINGS: AuthSettings = {
  secret: 'dev-only-auth-secret',
  codeSeconds: 5 * 60,
  resendSeconds: 60,
  codesPerHour: 5,
  codesPerAddressPerHour: 20,
  maxAttempts: 5,
  sessionDays: 90,
  phoneEnabled: true,
};

export type AuthErrorCode =
  | 'invalid_phone'
  | 'too_many_codes'
  | 'sms_failed'
  | 'wrong_code'
  | 'code_expired'
  | 'too_many_attempts'
  | 'signed_out'
  | 'phone_unavailable'
  | 'google_rejected'
  | 'google_unavailable';

const STATUS: Record<AuthErrorCode, HttpStatus> = {
  invalid_phone: HttpStatus.BAD_REQUEST,
  too_many_codes: HttpStatus.TOO_MANY_REQUESTS,
  sms_failed: HttpStatus.BAD_GATEWAY,
  wrong_code: HttpStatus.UNAUTHORIZED,
  code_expired: HttpStatus.GONE,
  too_many_attempts: HttpStatus.TOO_MANY_REQUESTS,
  signed_out: HttpStatus.UNAUTHORIZED,
  phone_unavailable: HttpStatus.SERVICE_UNAVAILABLE,
  google_rejected: HttpStatus.UNAUTHORIZED,
  google_unavailable: HttpStatus.SERVICE_UNAVAILABLE,
};

/** A sign-in failure the app can act on: { statusCode, error: code, message, ...extra }. */
export class AuthError extends HttpException {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    extra: Record<string, number> = {},
  ) {
    super({ statusCode: STATUS[code], error: code, message, ...extra }, STATUS[code]);
  }
}

const HOUR = 60 * 60 * 1000;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const newUserId = () => `u_${randomBytes(12).toString('base64url')}`;
const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/**
 * Phone number + one-time code sign-in. A code is six digits, stored only as a keyed hash, works
 * once, for five minutes, and stops after five wrong guesses. A correct code returns a session
 * token (256 random bits; the server keeps its hash) that the app sends as a bearer token.
 */
@Injectable()
export class AuthService {
  /** Recent code requests per client address. Per instance; enough until there are several. */
  private readonly byAddress = new Map<string, number[]>();

  constructor(
    @Inject(AUTH_STORE) private readonly store: AuthStore,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(GOOGLE_VERIFIER) private readonly google: GoogleVerifier | null,
  ) {}

  /** Which sign-in methods this server offers, so the app shows only those. */
  methods() {
    return {
      phone: this.settings.phoneEnabled,
      google: this.google ? { webClientId: this.google.webClientId } : null,
    };
  }

  get smsProvider(): string {
    return this.sms.name;
  }

  private phoneOrThrow(input: string): string {
    const phone = normalizeBdPhone(input);
    if (!phone) {
      throw new AuthError('invalid_phone', 'Enter a Bangladesh mobile number, like 01712 345678.');
    }
    return phone;
  }

  private codeHash(challengeId: string, code: string): string {
    return createHmac('sha256', this.settings.secret)
      .update(`${challengeId}:${code}`)
      .digest('hex');
  }

  private limitAddress(address: string | undefined, now: number) {
    if (!address) return;
    const recent = (this.byAddress.get(address) ?? []).filter((t) => t > now - HOUR);
    if (recent.length >= this.settings.codesPerAddressPerHour) {
      throw new AuthError('too_many_codes', 'Too many codes from this network. Try again later.', {
        retryAfterSeconds: seconds(recent[0]! + HOUR - now),
      });
    }
    recent.push(now);
    this.byAddress.set(address, recent);
    if (this.byAddress.size > 50_000) this.byAddress.clear();
  }

  /** Texts a new code to the number, within the resend and hourly limits. */
  async requestCode(input: string, address?: string) {
    if (!this.settings.phoneEnabled) {
      throw new AuthError('phone_unavailable', 'Phone sign-in is not available. Use Google.');
    }
    const phone = this.phoneOrThrow(input);
    const now = this.clock();
    const recent = await this.store.recentChallenges(phone, new Date(now.getTime() - HOUR));
    const last = recent[0];
    const wait = last
      ? last.createdAt.getTime() + this.settings.resendSeconds * 1000 - now.getTime()
      : 0;
    if (wait > 0) {
      throw new AuthError(
        'too_many_codes',
        'A code was just sent. Wait a moment before asking again.',
        {
          retryAfterSeconds: seconds(wait),
        },
      );
    }
    if (recent.length >= this.settings.codesPerHour) {
      const oldest = recent[recent.length - 1]!;
      throw new AuthError('too_many_codes', 'Too many codes for this number. Try again later.', {
        retryAfterSeconds: seconds(oldest.createdAt.getTime() + HOUR - now.getTime()),
      });
    }
    this.limitAddress(address, now.getTime());

    const id = randomBytes(16).toString('hex');
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.store.insertChallenge({
      id,
      phone,
      codeHash: this.codeHash(id, code),
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.settings.codeSeconds * 1000),
      attempts: 0,
      consumedAt: null,
    });
    const minutes = Math.round(this.settings.codeSeconds / 60);
    try {
      await this.sms.send(
        phone,
        `${code} is your Season Challenger code. It expires in ${minutes} minutes. Never share it.`,
      );
    } catch {
      throw new AuthError('sms_failed', 'We could not send the text. Try again in a minute.');
    }
    return {
      phone,
      maskedPhone: maskPhone(phone),
      expiresInSeconds: this.settings.codeSeconds,
      resendInSeconds: this.settings.resendSeconds,
    };
  }

  /** Checks the code; on success links the number to a player and starts a session. */
  async verifyCode(input: string, code: string) {
    const phone = this.phoneOrThrow(input);
    const now = this.clock();
    const challenge = await this.store.latestOpenChallenge(phone);
    if (!challenge || challenge.expiresAt <= now) {
      throw new AuthError('code_expired', 'That code has expired. Ask for a new one.');
    }
    if (challenge.attempts >= this.settings.maxAttempts) {
      throw new AuthError('too_many_attempts', 'Too many wrong codes. Ask for a new one.');
    }
    const expected = Buffer.from(challenge.codeHash, 'hex');
    const given = Buffer.from(this.codeHash(challenge.id, code), 'hex');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      const attempts = await this.store.recordFailedAttempt(challenge.id);
      const attemptsLeft = this.settings.maxAttempts - attempts;
      if (attemptsLeft <= 0) {
        throw new AuthError('too_many_attempts', 'Too many wrong codes. Ask for a new one.');
      }
      throw new AuthError('wrong_code', "That code isn't right. Check the text and try again.", {
        attemptsLeft,
      });
    }
    if (!(await this.store.consumeChallenge(challenge.id, now, this.settings.maxAttempts))) {
      throw new AuthError('code_expired', 'That code was already used. Ask for a new one.');
    }

    const candidate = newUserId();
    const identity =
      (await this.store.findIdentity(phone)) ??
      (await this.store.createIdentity({ phone, userId: candidate, createdAt: now }));

    const session = await this.startSession(identity.userId, now);
    return {
      ...session,
      user: { id: identity.userId, phone, email: null, isNew: identity.userId === candidate },
    };
  }

  /** Signs in with a Google ID token; the first sign-in creates the player. */
  async signInWithGoogle(idToken: string) {
    if (!this.google) {
      throw new AuthError('google_unavailable', 'Google sign-in is not set up on this server.');
    }
    let profile;
    try {
      profile = await this.google.verify(idToken);
    } catch {
      throw new AuthError('google_rejected', 'Google sign-in failed. Try again.');
    }
    const email = profile.emailVerified ? profile.email : null;
    const now = this.clock();
    const candidate = newUserId();
    const existing = await this.store.findExternalIdentity('google', profile.subject);
    const identity =
      existing ??
      (await this.store.createExternalIdentity({
        provider: 'google',
        subject: profile.subject,
        userId: candidate,
        email,
        createdAt: now,
      }));
    if (existing && existing.email !== email) {
      await this.store.updateExternalEmail('google', profile.subject, email);
    }
    const session = await this.startSession(identity.userId, now);
    return {
      ...session,
      user: { id: identity.userId, phone: null, email, isNew: identity.userId === candidate },
    };
  }

  private async startSession(userId: string, now: Date) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + this.settings.sessionDays * 24 * HOUR);
    await this.store.insertSession({
      tokenHash: sha256(token),
      userId,
      createdAt: now,
      expiresAt,
      revokedAt: null,
    });
    return { token, expiresAt: expiresAt.toISOString() };
  }

  /** The player a session token belongs to, or undefined if it is unknown, expired or revoked. */
  async userForToken(token: string): Promise<string | undefined> {
    const session = await this.store.findSession(sha256(token));
    if (!session || session.revokedAt !== null || session.expiresAt <= this.clock())
      return undefined;
    return session.userId;
  }

  async signOut(token: string): Promise<void> {
    await this.store.revokeSession(sha256(token), this.clock());
  }

  async account(userId: string) {
    const [phone, google] = await Promise.all([
      this.store.findIdentityByUser(userId),
      this.store.findExternalIdentityByUser(userId),
    ]);
    return { id: userId, phone: phone?.phone ?? null, email: google?.email ?? null };
  }
}
