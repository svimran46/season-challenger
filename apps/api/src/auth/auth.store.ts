/*
 * Storage port for phone sign-in. MemoryAuthStore backs development and tests, PgAuthStore
 * (pg-auth.store.ts) backs the API when DATABASE_URL is set. Codes and session tokens are
 * stored only as keyed hashes, never in the clear.
 */

export interface OtpChallenge {
  id: string;
  phone: string;
  codeHash: string;
  createdAt: Date;
  expiresAt: Date;
  /** Wrong guesses so far. */
  attempts: number;
  consumedAt: Date | null;
}

export interface PhoneIdentity {
  phone: string;
  userId: string;
  createdAt: Date;
}

export interface ExternalIdentity {
  provider: 'google';
  subject: string;
  userId: string;
  email: string | null;
  createdAt: Date;
}

export interface SessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface AuthStore {
  // ------------------------------------------------------------ codes
  insertChallenge(challenge: OtpChallenge): Promise<void>;
  /** Codes sent to this number at or after `since`, newest first. */
  recentChallenges(phone: string, since: Date): Promise<OtpChallenge[]>;
  /** The newest unconsumed code for this number, expired or not. */
  latestOpenChallenge(phone: string): Promise<OtpChallenge | undefined>;
  /** Counts a wrong guess atomically; returns the new count. */
  recordFailedAttempt(id: string): Promise<number>;
  /**
   * Marks the code used, only if it is still unused and under `maxAttempts` wrong guesses.
   * Returns false when another request used it first, so one code signs in once.
   */
  consumeChallenge(id: string, at: Date, maxAttempts: number): Promise<boolean>;

  // ------------------------------------------------------------ identities
  findIdentity(phone: string): Promise<PhoneIdentity | undefined>;
  findIdentityByUser(userId: string): Promise<PhoneIdentity | undefined>;
  /** Links the number to `userId` unless it already has a player; returns the stored link. */
  createIdentity(identity: PhoneIdentity): Promise<PhoneIdentity>;

  findExternalIdentity(
    provider: ExternalIdentity['provider'],
    subject: string,
  ): Promise<ExternalIdentity | undefined>;
  findExternalIdentityByUser(userId: string): Promise<ExternalIdentity | undefined>;
  /** Links the account to `userId` unless it already has a player; returns the stored link. */
  createExternalIdentity(identity: ExternalIdentity): Promise<ExternalIdentity>;
  updateExternalEmail(
    provider: ExternalIdentity['provider'],
    subject: string,
    email: string | null,
  ): Promise<void>;

  // ------------------------------------------------------------ sessions
  insertSession(session: SessionRecord): Promise<void>;
  findSession(tokenHash: string): Promise<SessionRecord | undefined>;
  revokeSession(tokenHash: string, at: Date): Promise<void>;
}

export class MemoryAuthStore implements AuthStore {
  private readonly challenges: OtpChallenge[] = [];
  private readonly identities = new Map<string, PhoneIdentity>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly external = new Map<string, ExternalIdentity>();

  async insertChallenge(challenge: OtpChallenge) {
    this.challenges.push({ ...challenge });
  }

  async recentChallenges(phone: string, since: Date) {
    return this.challenges
      .filter((c) => c.phone === phone && c.createdAt >= since)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((c) => ({ ...c }));
  }

  async latestOpenChallenge(phone: string) {
    const open = this.challenges
      .filter((c) => c.phone === phone && c.consumedAt === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return open[0] ? { ...open[0] } : undefined;
  }

  async recordFailedAttempt(id: string) {
    const c = this.challenges.find((x) => x.id === id);
    if (!c) return 0;
    c.attempts += 1;
    return c.attempts;
  }

  async consumeChallenge(id: string, at: Date, maxAttempts: number) {
    const c = this.challenges.find((x) => x.id === id);
    if (!c || c.consumedAt !== null || c.attempts >= maxAttempts) return false;
    c.consumedAt = at;
    return true;
  }

  async findIdentity(phone: string) {
    const i = this.identities.get(phone);
    return i ? { ...i } : undefined;
  }

  async findIdentityByUser(userId: string) {
    for (const i of this.identities.values()) if (i.userId === userId) return { ...i };
    return undefined;
  }

  async createIdentity(identity: PhoneIdentity) {
    if (!this.identities.has(identity.phone)) {
      this.identities.set(identity.phone, { ...identity });
    }
    return { ...this.identities.get(identity.phone)! };
  }

  async findExternalIdentity(provider: ExternalIdentity['provider'], subject: string) {
    const i = this.external.get(`${provider}:${subject}`);
    return i ? { ...i } : undefined;
  }

  async findExternalIdentityByUser(userId: string) {
    for (const i of this.external.values()) if (i.userId === userId) return { ...i };
    return undefined;
  }

  async createExternalIdentity(identity: ExternalIdentity) {
    const key = `${identity.provider}:${identity.subject}`;
    if (!this.external.has(key)) this.external.set(key, { ...identity });
    return { ...this.external.get(key)! };
  }

  async updateExternalEmail(
    provider: ExternalIdentity['provider'],
    subject: string,
    email: string | null,
  ) {
    const i = this.external.get(`${provider}:${subject}`);
    if (i) i.email = email;
  }

  async insertSession(session: SessionRecord) {
    this.sessions.set(session.tokenHash, { ...session });
  }

  async findSession(tokenHash: string) {
    const s = this.sessions.get(tokenHash);
    return s ? { ...s } : undefined;
  }

  async revokeSession(tokenHash: string, at: Date) {
    const s = this.sessions.get(tokenHash);
    if (s && s.revokedAt === null) s.revokedAt = at;
  }
}
