import {
  Catch,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { WalletError, type WalletErrorCode } from '@season/wallet';

const STATUS: Record<WalletErrorCode, HttpStatus> = {
  invalid_amount: HttpStatus.BAD_REQUEST,
  invalid_contest: HttpStatus.BAD_REQUEST,
  invalid_reward: HttpStatus.BAD_REQUEST,
  invalid_offer: HttpStatus.BAD_REQUEST,
  not_verified: HttpStatus.FORBIDDEN,
  under_age: HttpStatus.FORBIDDEN,
  redemptions_blocked: HttpStatus.FORBIDDEN,
  insufficient_funds: HttpStatus.CONFLICT,
  insufficient_winnings: HttpStatus.CONFLICT,
  contest_full: HttpStatus.CONFLICT,
  offer_unavailable: HttpStatus.CONFLICT,
  out_of_stock: HttpStatus.CONFLICT,
  limit_reached: HttpStatus.CONFLICT,
  voucher_not_usable: HttpStatus.CONFLICT,
  // One answer for a wrong voucher code, a wrong present code and another partner's voucher.
  voucher_codes_invalid: HttpStatus.NOT_FOUND,
  idempotency_conflict: HttpStatus.CONFLICT,
  // These mean a bug produced a bad transaction, not a user mistake.
  unbalanced: HttpStatus.INTERNAL_SERVER_ERROR,
  empty: HttpStatus.INTERNAL_SERVER_ERROR,
  negative_balance: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Turns wallet rule failures into replies the app can act on: { error: code, message }. */
@Catch(WalletError)
export class WalletErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(WalletErrorFilter.name);

  catch(error: WalletError, host: ArgumentsHost) {
    const status = STATUS[error.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const internal = status === HttpStatus.INTERNAL_SERVER_ERROR;
    // These mean a bug, so someone has to be able to find out what happened.
    if (internal) this.logger.error(`${error.code}: ${error.message}`, error.stack);
    host
      .switchToHttp()
      .getResponse<{ status(code: number): { json(body: unknown): void } }>()
      .status(status)
      .json({
        statusCode: status,
        error: error.code,
        message: internal ? 'Something went wrong with that transaction.' : error.message,
      });
  }
}
