# Money in Season Challenger

The money layer mirrors the flows Game of 11 enforces on its server, adapted to this codebase's
double-entry coin ledger. One currency lesson drives everything: **coins bought with taka are
entry money, coins won in tournaments are the only thing that becomes withdrawable cash.**

## The three balances

Each player has two coin balances and one cash balance, all integer, all from the same ledger:

| Balance     | Account              | Comes from                                                  | Spends on                               |
| ----------- | -------------------- | ----------------------------------------------------------- | --------------------------------------- |
| Bonus coins | `user:<id>:bonus`    | 500 sign-up bonus, daily rewards, promos, **taka deposits** | Tournament entries only                 |
| Won coins   | `user:<id>:winnings` | Tournament prizes                                           | Entries, vouchers, **convert to cash**  |
| Cash (taka) | `user:<id>:cash`     | **Won coins converted**, nothing else                       | Withdrawals, converting back into coins |

Entries spend bonus coins first, then winnings. System accounts (`system:*`) mint and burn to
keep every transaction summing to zero; user and contest accounts can never go negative.

## The flows

### 1. Deposit — taka in, bought coins out

`POST /v1/me/deposits` with `{ amountBdt, channel }` creates a **pending invoice** and a hosted
checkout URL. The player pays over an e-wallet (bKash, Nagad, Rocket, Upay, or bank); the
gateway confirms with a **signed webhook**, and only then does the ledger credit
`coins = amountBdt × coinsPerBdt` (default 50, floor ৳20, ceiling ৳25,000 per invoice).

- Bought coins land in `bonus` against `system:coin_sales` — the taka side never meets the cash
  side, so **a deposit can never be withdrawn**; it can only play tournaments.
- Webhook credits are idempotent three ways: the ledger key `deposit:<invoiceId>` (one credit
  even across races), the stored `payment_webhook` row (one row per `(gateway, eventId)`), and
  the invoice status. A tampered signature is stored but refused; a mismatched amount is stored
  but never credited.

In development `PAYMENTS_GATEWAY=mock`: the checkout URL is this API's own page
(`/v1/payments/mock/checkout/<invoiceId>`) with "Pay now" and "Cancel" buttons that walk the
exact same signed-webhook path a real gateway would. A bKash/Nagad/Rocket/Upay adapter later
means implementing `PaymentGateway.createCheckout` — no new credit logic.

### 2. Redeem — cash back into coins

`POST /v1/me/redeem` turns cash into **bonus** coins at the same rate you bought them
(`minRedeemBdt`, default ৳1). This is the Game of 11 "redeem coin" move: a way back into the
game, never a way out.

### 3. Convert — won coins into cash

`POST /v1/me/convert` converts **won coins only** into cash:

```
cash = floor(coins / coinToCashCoinsPerBdt)        # default 60 coins per taka
```

Two rules make the loop unprofitable:

- **Only winnings convert.** `coin_to_cash` debits `user:<id>:winnings`; bonus coins (rewards
  and deposits) have no cash path at all.
- **Converting costs more than buying.** `coinToCashCoinsPerBdt` (60) must stay above
  `coinsPerBdt` (50) — the server refuses to start otherwise. Taka that goes out through the
  convert rate and back in through the deposit rate makes the house margin every cycle.
  Leftover coins below the floor stay winnings (`minConversionBdt`, default ৳10 per conversion).

### 4. Withdraw — held, queued, paid by a person

`POST /v1/me/withdrawals` with `{ amountBdt, channel, destination, requestId }`:

1. The player must be **ID-verified** (the same check vouchers need).
2. Limits: ৳500 minimum, ৳10,000 maximum per request; the destination must look like an
   11-digit e-wallet number (`01[3-9]xxxxxxxx`) or a bank account.
3. The cash is **held in the same transaction** that writes the request: the player's balance
   drops at once (`withdraw_hold` posting), and the taka waits in `system:withdraw_pending`.

The request then sits in the **payout review queue** with the player's details — user id,
sign-in phone, verification state, member-since date, amount, channel and destination number.
An operator (the same role Game of 11's back-office payout queue serves) reviews each one:

```
GET  /v1/admin/withdrawals?status=pending,approved     # the queue, x-admin-token guarded
POST /v1/admin/withdrawals/:id/review
     { action: "approve" | "paid" | "reject" | "fail",
       payoutReference?, reason?, operator? }
```

- **approve** — clears the request for payment (status `approved`), no money moves.
- **paid** — the operator has sent the taka over the e-wallet _outside this system_ and records
  the transaction id. The ledger books it (`withdraw_paid`), the row keeps the reference, the
  review reason and who ran it. The money can move to `paid` only once; racing reviews are
  serialised by the row lock.
- **reject / fail** — the held taka flows straight back to the player (`withdraw_release`) with
  the reason recorded.

Every step posts an immutable double-entry transaction; the review queue never sends money by
itself, it records the payout that a person made.

## Rates and limits

Defaults come from Game of 11's settings table; every value is an env override
(`MONEY_*` in `.env.example`):

| Setting                 | Default | Note                                            |
| ----------------------- | ------- | ----------------------------------------------- |
| `coinsPerBdt`           | 50      | Deposit and redeem rate                         |
| `minDepositBdt`         | 20      |                                                 |
| `maxDepositBdt`         | 25,000  | GO11 shows no cap; this is a safety rail        |
| `minRedeemBdt`          | 1       |                                                 |
| `coinToCashCoinsPerBdt` | 60      | Must stay above `coinsPerBdt`, enforced at boot |
| `minConversionBdt`      | 10      | Smallest coin→cash conversion                   |
| `minWithdrawBdt`        | 500     | Per cash-out request                            |
| `maxWithdrawBdt`        | 10,000  | Per cash-out request                            |

`GET /v1/me/money` returns the live settings plus the player's cash and how much of it is
parked in open cash-outs; the app's money screen is built from this.

## Storage

With `DATABASE_URL` set, three tables (migration `0003_sticky_patriot`) hold the money state next
to the ledger: `deposit_invoice` (checkout + credit state), `payment_webhook` (every delivery,
raw, with its signature verdict), and `withdrawal_request` (the payout queue with the review
trail). Without a database the same flows run in memory for development and tests.

`MONEY_ENABLED=false` removes the module entirely and returns the API to the coin-only economy
(vouchers stay the only non-coin reward).
