import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { authSession, externalIdentity, otpChallenge, phoneIdentity } from '../db/schema';
import type {
  AuthStore,
  ExternalIdentity,
  OtpChallenge,
  PhoneIdentity,
  SessionRecord,
} from './auth.store';

type ChallengeRow = typeof otpChallenge.$inferSelect;
type IdentityRow = typeof phoneIdentity.$inferSelect;
type SessionRow = typeof authSession.$inferSelect;

/** OTP challenges, phone identities and sessions in Postgres. See AuthStore. */
export class PgAuthStore implements AuthStore {
  constructor(private readonly db: Database) {}

  // ------------------------------------------------------------ codes

  async insertChallenge(challenge: OtpChallenge): Promise<void> {
    await this.db.insert(otpChallenge).values({
      id: challenge.id,
      phone: challenge.phone,
      codeHash: challenge.codeHash,
      createdAt: challenge.createdAt,
      expiresAt: challenge.expiresAt,
      attempts: challenge.attempts,
      consumedAt: challenge.consumedAt,
    });
  }

  async recentChallenges(phone: string, since: Date): Promise<OtpChallenge[]> {
    const rows = await this.db
      .select()
      .from(otpChallenge)
      .where(and(eq(otpChallenge.phone, phone), gte(otpChallenge.createdAt, since)))
      .orderBy(desc(otpChallenge.createdAt));
    return rows.map(toChallenge);
  }

  async latestOpenChallenge(phone: string): Promise<OtpChallenge | undefined> {
    const [row] = await this.db
      .select()
      .from(otpChallenge)
      .where(and(eq(otpChallenge.phone, phone), isNull(otpChallenge.consumedAt)))
      .orderBy(desc(otpChallenge.createdAt))
      .limit(1);
    return row ? toChallenge(row) : undefined;
  }

  async recordFailedAttempt(id: string): Promise<number> {
    const [row] = await this.db
      .update(otpChallenge)
      .set({ attempts: sql`${otpChallenge.attempts} + 1` })
      .where(eq(otpChallenge.id, id))
      .returning({ attempts: otpChallenge.attempts });
    return row?.attempts ?? 0;
  }

  async consumeChallenge(id: string, at: Date, maxAttempts: number): Promise<boolean> {
    const rows = await this.db
      .update(otpChallenge)
      .set({ consumedAt: at })
      .where(
        and(
          eq(otpChallenge.id, id),
          isNull(otpChallenge.consumedAt),
          lt(otpChallenge.attempts, maxAttempts),
        ),
      )
      .returning({ id: otpChallenge.id });
    return rows.length > 0;
  }

  // ------------------------------------------------------------ identities

  async findIdentity(phone: string): Promise<PhoneIdentity | undefined> {
    const [row] = await this.db.select().from(phoneIdentity).where(eq(phoneIdentity.phone, phone));
    return row ? toIdentity(row) : undefined;
  }

  async findIdentityByUser(userId: string): Promise<PhoneIdentity | undefined> {
    const [row] = await this.db
      .select()
      .from(phoneIdentity)
      .where(eq(phoneIdentity.userId, userId));
    return row ? toIdentity(row) : undefined;
  }

  async createIdentity(identity: PhoneIdentity): Promise<PhoneIdentity> {
    await this.db
      .insert(phoneIdentity)
      .values({ phone: identity.phone, userId: identity.userId, createdAt: identity.createdAt })
      .onConflictDoNothing({ target: phoneIdentity.phone });
    return (await this.findIdentity(identity.phone))!;
  }

  // ------------------------------------------------------------ sessions

  async findExternalIdentity(
    provider: ExternalIdentity['provider'],
    subject: string,
  ): Promise<ExternalIdentity | undefined> {
    const [row] = await this.db
      .select()
      .from(externalIdentity)
      .where(and(eq(externalIdentity.provider, provider), eq(externalIdentity.subject, subject)));
    return row ? toExternal(row) : undefined;
  }

  async findExternalIdentityByUser(userId: string): Promise<ExternalIdentity | undefined> {
    const [row] = await this.db
      .select()
      .from(externalIdentity)
      .where(eq(externalIdentity.userId, userId))
      .limit(1);
    return row ? toExternal(row) : undefined;
  }

  async createExternalIdentity(identity: ExternalIdentity): Promise<ExternalIdentity> {
    await this.db
      .insert(externalIdentity)
      .values(identity)
      .onConflictDoNothing({ target: [externalIdentity.provider, externalIdentity.subject] });
    return (await this.findExternalIdentity(identity.provider, identity.subject))!;
  }

  async updateExternalEmail(
    provider: ExternalIdentity['provider'],
    subject: string,
    email: string | null,
  ): Promise<void> {
    await this.db
      .update(externalIdentity)
      .set({ email })
      .where(and(eq(externalIdentity.provider, provider), eq(externalIdentity.subject, subject)));
  }

  async insertSession(session: SessionRecord): Promise<void> {
    await this.db.insert(authSession).values({
      tokenHash: session.tokenHash,
      userId: session.userId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
    });
  }

  async findSession(tokenHash: string): Promise<SessionRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(authSession)
      .where(eq(authSession.tokenHash, tokenHash));
    return row ? toSession(row) : undefined;
  }

  async revokeSession(tokenHash: string, at: Date): Promise<void> {
    await this.db
      .update(authSession)
      .set({ revokedAt: at })
      .where(and(eq(authSession.tokenHash, tokenHash), isNull(authSession.revokedAt)));
  }
}

const toChallenge = (r: ChallengeRow): OtpChallenge => ({
  id: r.id,
  phone: r.phone,
  codeHash: r.codeHash,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  attempts: r.attempts,
  consumedAt: r.consumedAt,
});

const toIdentity = (r: IdentityRow): PhoneIdentity => ({
  phone: r.phone,
  userId: r.userId,
  createdAt: r.createdAt,
});

const toSession = (r: SessionRow): SessionRecord => ({
  tokenHash: r.tokenHash,
  userId: r.userId,
  createdAt: r.createdAt,
  expiresAt: r.expiresAt,
  revokedAt: r.revokedAt,
});

const toExternal = (r: typeof externalIdentity.$inferSelect): ExternalIdentity => ({
  provider: r.provider as ExternalIdentity['provider'],
  subject: r.subject,
  userId: r.userId,
  email: r.email,
  createdAt: r.createdAt,
});
