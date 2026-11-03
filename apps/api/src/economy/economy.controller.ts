import { Controller, Get } from '@nestjs/common';
import {
  CONTEST_FORMATS,
  DEFAULT_PLATFORM_FEE_BPS,
  DEFAULT_REDEMPTION_LIMITS,
  DEFAULT_REWARDS,
  FORMAT_RULES,
  SIGN_UP_BONUS,
  VOUCHER_RULES,
} from '@season/wallet';

/** How coins work, for the app's explainer screen. Nothing here involves money. */
@Controller('economy')
export class EconomyController {
  @Get()
  rules() {
    return {
      currency: 'coins',
      moneyIn: false,
      moneyOut: false,
      signUpBonus: SIGN_UP_BONUS,
      rewards: DEFAULT_REWARDS,
      balances: {
        bonus: 'Sign-up bonus and rewards. Use them to enter tournaments.',
        winnings: 'Coins won in tournaments. Enter more tournaments or redeem them for vouchers.',
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
    };
  }
}
