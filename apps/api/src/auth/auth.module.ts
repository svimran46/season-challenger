import { Global, Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CLOCK, type Clock } from '../common/tokens';
import { IdentityGuard } from '../common/auth';
import { AccountController, AuthController } from './auth.controller';
import {
  AUTH_SETTINGS,
  AUTH_STORE,
  AuthService,
  DEFAULT_AUTH_SETTINGS,
  SMS_SENDER,
  type AuthSettings,
} from './auth.service';
import { MemoryAuthStore, type AuthStore } from './auth.store';
import { ConsoleSmsSender, type SmsSender } from './sms';

export interface AuthOptions {
  clock?: Clock;
  /** Codes, phone numbers and sessions; in memory unless given (PgAuthStore). */
  store?: AuthStore;
  /** Where codes go; ConsoleSmsSender (the server log) unless given. */
  sms?: SmsSender;
  settings?: Partial<AuthSettings>;
}

/** Phone sign-in. Global, so every module's routes can use the sign-in guards. */
@Global()
@Module({})
export class AuthModule {
  static register(options: AuthOptions = {}): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController, AccountController],
      providers: [
        { provide: AUTH_STORE, useValue: options.store ?? new MemoryAuthStore() },
        { provide: SMS_SENDER, useValue: options.sms ?? new ConsoleSmsSender() },
        { provide: AUTH_SETTINGS, useValue: { ...DEFAULT_AUTH_SETTINGS, ...options.settings } },
        { provide: CLOCK, useValue: options.clock ?? (() => new Date()) },
        AuthService,
        { provide: APP_GUARD, useClass: IdentityGuard },
      ],
      exports: [AuthService],
    };
  }
}
