import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { CLOCK, PARTNER_LIMITS, PARTNER_STORE, type Clock } from '../common/tokens';
import { AttemptThrottle, type ThrottlePolicy } from './attempt-throttle';
import { burnPasswordCheck, verifyPassword } from './password';
import type { PartnerStore, SessionRecord } from './partner.store';
import { tooManyAttempts } from './partner.errors';

export interface PartnerLimits {
  signInPerAccount: ThrottlePolicy;
  signInPerIp: ThrottlePolicy;
  voucherPerStaff: ThrottlePolicy;
  voucherPerIp: ThrottlePolicy;
}

/** Shops share addresses through mobile networks and malls, so per-IP limits are the looser ones. */
export const DEFAULT_PARTNER_LIMITS: PartnerLimits = {
  signInPerAccount: { maxAttempts: 5, windowSeconds: 15 * 60 },
  signInPerIp: { maxAttempts: 30, windowSeconds: 15 * 60 },
  voucherPerStaff: { maxAttempts: 10, windowSeconds: 5 * 60 },
  voucherPerIp: { maxAttempts: 40, windowSeconds: 5 * 60 },
};

/** A shift at the till. */
const SESSION_HOURS = 12;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** Partner sign-in. Entirely separate from how players sign in. */
@Injectable()
export class PartnerAuthService {
  private readonly perAccount: AttemptThrottle;
  private readonly perIp: AttemptThrottle;

  constructor(
    @Inject(PARTNER_STORE) private readonly store: PartnerStore,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(PARTNER_LIMITS) limits: PartnerLimits,
  ) {
    this.perAccount = new AttemptThrottle(clock, limits.signInPerAccount);
    this.perIp = new AttemptThrottle(clock, limits.signInPerIp);
  }

  /** One answer for an unknown email, a wrong password and a deactivated account. */
  async login(email: string, password: string, ip: string) {
    // Counted for addresses that do not exist too, so being throttled says nothing about them.
    const wait = Math.max(this.perAccount.attempt(email), this.perIp.attempt(ip));
    if (wait > 0) throw tooManyAttempts(wait);

    const staff = await this.store.findStaffByEmail(email);
    if (!staff) await burnPasswordCheck(password);
    const passwordOk = staff ? await verifyPassword(password, staff.passwordHash) : false;
    const partner = staff ? await this.store.findPartner(staff.partnerId) : null;
    if (!staff || !partner || !passwordOk || !staff.active || !partner.active) {
      throw new UnauthorizedException({
        error: 'invalid_credentials',
        message: 'That email and password do not match an active account.',
      });
    }
    this.perAccount.forgive(email);
    this.perIp.forgive(ip);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(
      this.clock().getTime() + SESSION_HOURS * 60 * 60 * 1000,
    ).toISOString();
    await this.store.createSession({ tokenHash: hashToken(token), staffId: staff.id, expiresAt });
    return { token, expiresAt, ...identityView({ staff, partner }) };
  }

  /** Null unless the token is live and both the staff member and the partner are still active. */
  async authenticate(token: string): Promise<SessionRecord | null> {
    const session = await this.store.findSession(hashToken(token));
    if (!session || session.revokedAt) return null;
    if (this.clock().getTime() >= Date.parse(session.expiresAt)) return null;
    if (!session.staff.active || !session.partner.active) return null;
    return session;
  }

  logout(token: string) {
    return this.store.revokeSession(hashToken(token), this.clock());
  }
}

export function identityView({ staff, partner }: Pick<SessionRecord, 'staff' | 'partner'>) {
  return {
    staff: { name: staff.name, email: staff.email, role: staff.role },
    partner: { id: partner.id, name: partner.name, category: partner.category },
  };
}
