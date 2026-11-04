import {
  createParamDecorator,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { PartnerAuthService } from './partner-auth.service';
import type { SessionRecord } from './partner.store';

interface PartnerRequest {
  headers: Record<string, string | string[] | undefined>;
  partnerSession?: SessionRecord;
  partnerToken?: string;
}

const notSignedIn = () =>
  new UnauthorizedException({ error: 'not_signed_in', message: 'Please sign in again.' });

/** Partner portal routes only. It knows nothing of players, and player sign-in knows nothing of it. */
@Injectable()
export class PartnerAuthGuard implements CanActivate {
  constructor(@Inject(PartnerAuthService) private readonly auth: PartnerAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<PartnerRequest>();
    const header = req.headers.authorization;
    const token = typeof header === 'string' ? /^Bearer (\S+)$/.exec(header)?.[1] : undefined;
    if (!token) throw notSignedIn();
    const session = await this.auth.authenticate(token);
    if (!session) throw notSignedIn();
    req.partnerSession = session;
    req.partnerToken = token;
    return true;
  }
}

export const CurrentPartner = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): SessionRecord => {
    const session = ctx.switchToHttp().getRequest<PartnerRequest>().partnerSession;
    if (!session) throw notSignedIn();
    return session;
  },
);

export const PartnerToken = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const token = ctx.switchToHttp().getRequest<PartnerRequest>().partnerToken;
  if (!token) throw notSignedIn();
  return token;
});
