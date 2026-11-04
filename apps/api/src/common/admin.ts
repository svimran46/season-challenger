import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

/**
 * Guards the operator endpoints ("/v1/admin/*") with a shared token in the x-admin-token
 * header. The token stands for the people reviewing payouts, like Game of 11's back-office
 * login; every review also records who ran it in the request body's `operator` field.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const header = req.headers['x-admin-token'];
    const given = typeof header === 'string' ? header : undefined;
    const expected = process.env.ADMIN_TOKEN ?? 'dev-admin-token';
    if (!given || !sameToken(given, expected)) {
      throw new UnauthorizedException({
        error: 'admin_token',
        message: 'Send the review token in the x-admin-token header.',
      });
    }
    return true;
  }
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
