import {
  createParamDecorator,
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { AuthError, AuthService } from '../auth/auth.service';

/**
 * "dev" also accepts an `x-user-id` header as sign-in, so tests and local tools can act as any
 * player without a code. Production never does: there, only a session token from phone sign-in
 * signs a request in.
 */
export function authMode(): 'dev' | 'none' {
  const mode = process.env.AUTH_MODE ?? (process.env.NODE_ENV === 'production' ? 'none' : 'dev');
  return mode === 'dev' ? 'dev' : 'none';
}

const USER_ID = /^[A-Za-z0-9_-]{3,64}$/;

export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  userId?: string;
  /** The bearer token the request signed in with, for sign-out. */
  sessionToken?: string;
}

/** The bearer token in an Authorization header, if there is one. */
export function bearerToken(req: AuthedRequest): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const match = /^Bearer\s+([A-Za-z0-9_-]{20,200})$/i.exec(header.trim());
  return match?.[1];
}

/**
 * Runs on every request (registered as a global guard) and works out who is signed in, from a
 * session token or, in development, x-user-id. It never refuses a request: SignedInGuard does.
 */
@Injectable()
export class IdentityGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const token = bearerToken(req);
    if (token) {
      const userId = await this.auth.userForToken(token);
      if (userId) {
        req.userId = userId;
        req.sessionToken = token;
      }
      return true;
    }
    const id = req.headers['x-user-id'];
    if (authMode() === 'dev' && typeof id === 'string' && USER_ID.test(id)) req.userId = id;
    return true;
  }
}

/** Refuses the route unless IdentityGuard found a signed-in player. */
export class SignedInGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.userId) {
      throw new AuthError('signed_out', 'Sign in with your phone number to continue.');
    }
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const userId = ctx.switchToHttp().getRequest<AuthedRequest>().userId;
  if (!userId) throw new AuthError('signed_out', 'Sign in with your phone number to continue.');
  return userId;
});

/** The signed-in player if the request has one, for routes that also work signed out. */
export const OptionalUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<AuthedRequest>().userId,
);
