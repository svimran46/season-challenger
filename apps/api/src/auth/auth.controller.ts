import { Body, Controller, Get, HttpCode, Inject, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, SignedInGuard, type AuthedRequest } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { AuthService } from './auth.service';

const codeBody = z.object({ phone: z.string().min(1).max(32) });
const verifyBody = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().regex(/^\d{6}$/, 'The code is six digits.'),
});

const googleBody = z.object({ idToken: z.string().min(20).max(4096) });

/** Sign-in: Google, or phone number + one-time code. */
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  /** Which sign-in methods the app should offer. */
  @Get('methods')
  methods() {
    return this.auth.methods();
  }

  /** Swaps a Google ID token for a session token. */
  @Post('google')
  @HttpCode(200)
  google(@Body(new ZodPipe(googleBody)) body: z.infer<typeof googleBody>) {
    return this.auth.signInWithGoogle(body.idToken);
  }

  /** Texts a sign-in code. Works for new and returning players alike. */
  @Post('code')
  @HttpCode(200)
  requestCode(
    @Body(new ZodPipe(codeBody)) body: z.infer<typeof codeBody>,
    @Req() req: { ip?: string },
  ) {
    return this.auth.requestCode(body.phone, req.ip);
  }

  /** Swaps a correct code for a session token. */
  @Post('verify')
  @HttpCode(200)
  verify(@Body(new ZodPipe(verifyBody)) body: z.infer<typeof verifyBody>) {
    return this.auth.verifyCode(body.phone, body.code);
  }

  /** Ends this device's session. */
  @Post('sign-out')
  @HttpCode(204)
  @UseGuards(SignedInGuard)
  async signOut(@Req() req: AuthedRequest) {
    if (req.sessionToken) await this.auth.signOut(req.sessionToken);
  }
}

/** The signed-in account. */
@Controller('me')
export class AccountController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Get()
  @UseGuards(SignedInGuard)
  me(@CurrentUser() userId: string) {
    return this.auth.account(userId);
  }
}
