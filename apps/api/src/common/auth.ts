import {
  createParamDecorator,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';

/**
 * Stand-in sign-in until phone OTP accounts are built: in development the app sends a stable
 * per-device id in `x-user-id`. Production refuses every signed-in route until real auth
 * replaces this guard, so nobody can act as someone else by setting a header.
 */
export function authMode(): 'dev' | 'none' {
  const mode = process.env.AUTH_MODE ?? (process.env.NODE_ENV === 'production' ? 'none' : 'dev');
  return mode === 'dev' ? 'dev' : 'none';
}

const USER_ID = /^[A-Za-z0-9_-]{3,64}$/;

export class DevAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      userId?: string;
    }>();
    if (authMode() !== 'dev') {
      throw new UnauthorizedException('Sign-in is not available on this server yet.');
    }
    const id = req.headers['x-user-id'];
    if (typeof id !== 'string' || !USER_ID.test(id)) {
      throw new UnauthorizedException('Send x-user-id (3-64 letters, digits, - or _).');
    }
    req.userId = id;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const userId = ctx.switchToHttp().getRequest<{ userId?: string }>().userId;
  if (!userId) throw new UnauthorizedException();
  return userId;
});

/** The signed-in player if the request has one, for routes that also work signed out. */
export const OptionalUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    if (authMode() !== 'dev') return undefined;
    const id = ctx.switchToHttp().getRequest<{ headers: Record<string, unknown> }>().headers[
      'x-user-id'
    ];
    return typeof id === 'string' && USER_ID.test(id) ? id : undefined;
  },
);
