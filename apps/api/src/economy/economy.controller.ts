import { Controller, Get, Inject, Optional } from '@nestjs/common';
import {
  CONTEST_FORMATS,
  DEFAULT_PLATFORM_FEE_BPS,
  DEFAULT_REDEMPTION_LIMITS,
  DEFAULT_REWARDS,
  FORMAT_RULES,
  SIGN_UP_BONUS,
  VOUCHER_RULES,
} from '@season/wallet';
import { MONEY_SERVICE } from './money.tokens';
import type { MoneyService } from './money.service';

/**
 * How the economy works, for the app's explainer screen. Without the money module this
 * describes the coin-only economy; with it, the `money` section carries the live rates and
 * limits the app's deposit and cash-out screens are built from.
 */
@Controller('economy')
export class EconomyController {
  constructor(@Optional() @Inject(MONEY_SERVICE) private readonly money?: MoneyService) {}

  @Get()
  rules() {
    const money = this.money?.rules();
    return {
      currency: 'coins',
      moneyIn: money?.moneyIn ?? false,
      moneyOut: money?.moneyOut ?? false,
      signUpBonus: SIGN_UP_BONUS,
      rewards: DEFAULT_REWARDS,
      balances: {
        bonus:
          'Sign-up bonus and rewards. Use them to enter tournaments. Bought coins land here too.',
        winnings:
          'Coins won in tournaments. Enter more tournaments, redeem vouchers or convert to cash.',
        ...(money
          ? { cash: 'Taka you can withdraw or turn back into coins. It only comes from won coins.' }
          : {}),
      },
      platformFeeBps: DEFAULT_PLATFORM_FEE_BPS,
      formats: CONTEST_FORMATS.map((f) => {
        const { shape: _shape, ...rules } = FORMAT_RULES[f];
        return { format: f, ...rules };
      }),
      vouchers: {
        categories: ['shop', 'travel'],
        minimumAge: VOUCHER_RULES.minimumAge,
        idCheckRequired: true,
        limits: DEFAULT_REDEMPTION_LIMITS,
        transferable: false,
        cashValue: false,
      },
      ...(money ? { money } : {}),
    };
  }
}
