import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Linking,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  api,
  ApiError,
  requestId,
  type DepositInvoice,
  type MoneyRules,
  type MyVoucher,
  type PayoutChannel,
  type VoucherOffer,
  type WalletActivity,
  type WithdrawalRequest,
} from '../../src/api';
import { formatCoins, formatDay } from '../../src/format';
import { useTheme } from '../../src/theme';
import {
  Button,
  Card,
  Chip,
  Loading,
  Message,
  Screen,
  SectionTitle,
  Segmented,
} from '../../src/ui';

const ACTIVITY_LABELS: Record<WalletActivity['kind'], string> = {
  sign_up_bonus: 'Welcome bonus',
  promotion: 'Promotion',
  reward: 'Reward',
  contest_entry: 'Tournament entry',
  entry_refund: 'Entry refunded',
  contest_settlement: 'Tournament prize',
  voucher_redemption: 'Voucher',
  voucher_refund: 'Voucher refunded',
  deposit: 'Deposit · coins bought',
  deposit_refund: 'Deposit refunded',
  redeem: 'Cash → coins',
  coin_to_cash: 'Coins → cash',
  withdraw_hold: 'Cash-out requested',
  withdraw_release: 'Cash-out reversed',
  withdraw_paid: 'Cash-out paid',
};

const REASONS: Record<string, string> = {
  not_verified: 'Verify your ID to redeem',
  under_age: 'Vouchers are for 18+',
  insufficient_winnings: 'Win more coins to redeem',
  limit_reached: 'Monthly limit reached',
  out_of_stock: 'Sold out',
  redemptions_blocked: 'Redemptions paused',
  offer_unavailable: 'Not available',
  insufficient_cash: 'Not enough cash on your balance',
  insufficient_funds: 'Not enough coins',
  invalid_payout: 'Check the wallet number and amount',
};

const CHANNEL_LABELS: Record<PayoutChannel, string> = {
  bkash: 'bKash',
  nagad: 'Nagad',
  rocket: 'Rocket',
  upay: 'Upay',
  bank: 'Bank',
};

const WITHDRAWAL_TONES: Record<WithdrawalRequest['status'], 'done' | 'todo' | 'live' | 'muted'> = {
  pending: 'todo',
  approved: 'live',
  paid: 'done',
  rejected: 'muted',
  failed: 'muted',
};

type MoneySheetKind = 'deposit' | 'withdraw' | 'redeem' | 'convert';

const taka = (n: number) => `৳${n.toLocaleString('en-US')}`;

export default function WalletScreen() {
  const t = useTheme();
  const qc = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: api.wallet });
  const [category, setCategory] = useState<'shop' | 'travel'>('shop');
  const offers = useQuery({ queryKey: ['offers', category], queryFn: () => api.offers(category) });
  const vouchers = useQuery({ queryKey: ['my-vouchers'], queryFn: api.myVouchers });
  const activity = useQuery({ queryKey: ['activity'], queryFn: () => api.activity(10) });
  const money = useQuery({ queryKey: ['money'], queryFn: api.money });
  const withdrawals = useQuery({ queryKey: ['withdrawals'], queryFn: api.myWithdrawals });
  const refreshAll = () => qc.invalidateQueries();
  // Which money form is open; an API without the money module keeps the coin-only wallet.
  const [sheet, setSheet] = useState<MoneySheetKind | null>(null);

  const checkIn = useMutation({ mutationFn: api.checkIn, onSuccess: refreshAll });

  if (wallet.isError) {
    return (
      <Message
        title="Can't load your wallet"
        body="Start the API with `pnpm dev:api`, then pull to refresh."
      />
    );
  }
  if (!wallet.data) return <Loading />;
  const w = wallet.data;
  const rules = money.data?.rules;

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={wallet.isRefetching} onRefresh={refreshAll} />}
      >
        <Card>
          <Text style={[styles.label, { color: t.muted }]}>Your coins</Text>
          <Text style={[styles.total, { color: t.text }]}>{w.total.toLocaleString('en-US')}</Text>
          <View style={styles.split}>
            <View style={styles.half}>
              <Text style={[styles.amount, { color: t.text }]}>
                {w.bonus.toLocaleString('en-US')}
              </Text>
              <Text style={{ color: t.muted }}>Bonus coins · entries only</Text>
            </View>
            <View style={styles.half}>
              <Text style={[styles.amount, { color: t.accent }]}>
                {w.winnings.toLocaleString('en-US')}
              </Text>
              <Text style={{ color: t.muted }}>Won coins · vouchers or cash</Text>
            </View>
          </View>
        </Card>

        {rules?.enabled ? (
          <>
            <Card>
              <Text style={[styles.label, { color: t.muted }]}>Your cash</Text>
              <Text style={[styles.total, { color: t.text }]}>{taka(w.cash)}</Text>
              <View style={styles.split}>
                <View style={styles.half}>
                  <Text style={[styles.amount, { color: t.accent }]}>
                    {taka(money.data?.pendingWithdrawals ?? 0)}
                  </Text>
                  <Text style={{ color: t.muted }}>Waiting for payout review</Text>
                </View>
                <View style={styles.half}>
                  {w.verified ? (
                    <Text style={{ color: t.muted, marginTop: 6 }}>
                      Cash comes from won coins. Withdrawals are paid by hand, one by one.
                    </Text>
                  ) : (
                    <Link href="/verify" asChild>
                      <Button
                        label="Verify to withdraw"
                        kind="secondary"
                        onPress={() => undefined}
                      />
                    </Link>
                  )}
                </View>
              </View>
              <View style={styles.actions}>
                <View style={styles.actionRow}>
                  <Button label="Add coins" onPress={() => setSheet('deposit')} />
                  <Button label="Withdraw" kind="secondary" onPress={() => setSheet('withdraw')} />
                </View>
                <View style={styles.actionRow}>
                  <Button
                    label="Cash → coins"
                    kind="secondary"
                    onPress={() => setSheet('redeem')}
                  />
                  <Button
                    label="Coins → cash"
                    kind="secondary"
                    onPress={() => setSheet('convert')}
                  />
                </View>
              </View>
              {sheet ? (
                <MoneySheet key={sheet} kind={sheet} rules={rules} onDone={() => setSheet(null)} />
              ) : null}
            </Card>

            {(withdrawals.data?.length ?? 0) > 0 ? (
              <>
                <SectionTitle>Cash-out requests</SectionTitle>
                <Card>
                  {withdrawals.data!.map((r, i) => (
                    <View
                      key={r.id}
                      style={[
                        styles.activity,
                        i > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderColor: t.border,
                        },
                      ]}
                    >
                      <View>
                        <Text style={{ color: t.text }}>
                          {taka(r.amountBdt)} · {CHANNEL_LABELS[r.channel]}
                        </Text>
                        <Text style={{ color: t.muted, fontSize: 12 }}>
                          {formatDay(r.createdAt)}
                        </Text>
                      </View>
                      <Chip label={r.status} tone={WITHDRAWAL_TONES[r.status]} />
                    </View>
                  ))}
                  <Text style={{ color: t.muted, fontSize: 12, marginTop: 8 }}>
                    Rejected and failed requests put the held cash straight back on your balance.
                  </Text>
                </Card>
              </>
            ) : null}
          </>
        ) : null}

        <Card>
          <View style={styles.rowBetween}>
            <View style={{ flexShrink: 1 }}>
              <Text style={[styles.heading, { color: t.text }]}>Daily reward</Text>
              <Text style={{ color: t.muted, marginTop: 2 }}>
                {w.checkIn.checkedIn
                  ? `Day ${w.checkIn.streak} streak. Come back tomorrow.`
                  : w.checkIn.streak > 0
                    ? `Day ${w.checkIn.streak} streak. Every 7th day pays extra.`
                    : 'Open the app daily. Every 7th day in a row pays extra.'}
              </Text>
            </View>
            {w.checkIn.checkedIn ? (
              <Chip label="Claimed" tone="done" />
            ) : (
              <Button
                label={`Claim ${w.checkIn.nextReward}`}
                busy={checkIn.isPending}
                onPress={() => checkIn.mutate()}
              />
            )}
          </View>
        </Card>

        <SectionTitle>Vouchers</SectionTitle>
        <Segmented
          options={[
            { value: 'shop', label: 'Shops' },
            { value: 'travel', label: 'Travel' },
          ]}
          value={category}
          onChange={setCategory}
        />
        {!w.verified ? (
          <Card>
            <Text style={[styles.heading, { color: t.text }]}>Verify your ID to redeem</Text>
            <Text style={{ color: t.muted, marginTop: 4, marginBottom: 12 }}>
              Vouchers are for players aged 18 and over, one account per person.
            </Text>
            <Link href="/verify" asChild>
              <Button label="Verify ID" kind="secondary" onPress={() => undefined} />
            </Link>
          </Card>
        ) : null}
        {offers.data?.length === 0 ? (
          <Card>
            <Text style={[styles.heading, { color: t.text }]}>Vouchers are coming soon</Text>
            <Text style={{ color: t.muted, marginTop: 4 }}>
              Keep winning coins: shop and travel partners will appear here.
            </Text>
          </Card>
        ) : null}
        {offers.data?.map((o) => (
          <OfferCard key={o.id} offer={o} onRedeemed={refreshAll} />
        ))}

        {vouchers.data && vouchers.data.length > 0 ? (
          <>
            <SectionTitle>My vouchers</SectionTitle>
            {vouchers.data.map((v) => (
              <VoucherCard key={v.id} voucher={v} />
            ))}
          </>
        ) : null}

        <SectionTitle>Recent activity</SectionTitle>
        <Card>
          {(activity.data ?? []).map((a, i) => (
            <View
              key={a.id}
              style={[
                styles.activity,
                i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.border },
              ]}
            >
              <View>
                <Text style={{ color: t.text }}>{ACTIVITY_LABELS[a.kind]}</Text>
                <Text style={{ color: t.muted, fontSize: 12 }}>{formatDay(a.createdAt)}</Text>
              </View>
              <Text
                style={{
                  color: a.cash + a.bonus + a.winnings >= 0 ? t.accent : t.text,
                  fontWeight: '600',
                  fontVariant: ['tabular-nums'],
                }}
              >
                {activityDelta(a)}
              </Text>
            </View>
          ))}
        </Card>

        <Text style={[styles.footnote, { color: t.muted }]}>
          {rules?.enabled
            ? 'Coins bought with an e-wallet are entry money: they play tournaments but never become cash. Cash only comes from won coins, and every cash-out is reviewed by a person before it is sent to your wallet.'
            : 'Coins have no cash value. They are never sold for money or paid out as money. Vouchers are discounts at partner shops and travel companies, tied to your account.'}
        </Text>
      </ScrollView>
    </Screen>
  );
}

/** The taka and coin parts of an activity row, like "৳+1,000 · −60,000 coins". */
function activityDelta(a: WalletActivity): string {
  const coins = a.bonus + a.winnings;
  const parts: string[] = [];
  if (a.cash !== 0) parts.push(`${a.cash > 0 ? '+' : ''}${taka(a.cash)}`);
  if (coins !== 0) parts.push(`${coins > 0 ? '+' : ''}${coins.toLocaleString('en-US')} coins`);
  return parts.join(' · ') || '—';
}

/** The one open money form: buy coins, withdraw, redeem cash into coins, or convert coins. */
function MoneySheet({
  kind,
  rules,
  onDone,
}: {
  kind: MoneySheetKind;
  rules: MoneyRules;
  onDone: () => void;
}) {
  const t = useTheme();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(kind === 'convert' ? '3000' : '500');
  const [channel, setChannel] = useState<PayoutChannel>('bkash');
  const [destination, setDestination] = useState('');
  const [payment, setPayment] = useState<DepositInvoice | null>(null);
  // One id per attempt, so a double tap or retry never moves money twice.
  const attemptId = useRef(requestId());

  const refresh = () => qc.invalidateQueries();
  const friendly = (e: unknown) =>
    e instanceof ApiError
      ? e.code === 'not_verified'
        ? 'Verify your ID first (see above).'
        : (e.code !== undefined && REASONS[e.code]) || e.message
      : undefined;
  const intAmount = Number.parseInt(amount, 10);
  const coins = Number.parseInt(amount, 10);

  const depositSheet = kind === 'deposit';
  const withdrawSheet = kind === 'withdraw';
  const redeemSheet = kind === 'redeem';
  const convertSheet = kind === 'convert';

  const depositValid =
    depositSheet && intAmount >= rules.deposit.minBdt && intAmount <= rules.deposit.maxBdt;
  const withdrawValid =
    withdrawSheet &&
    intAmount >= rules.withdraw.minBdt &&
    intAmount <= rules.withdraw.maxBdt &&
    (channel === 'bank'
      ? /^\d{6}[\d- ]{0,18}\d$/.test(destination.trim())
      : /^01[3-9]\d{8}$/.test(destination.trim()));
  const redeemValid = redeemSheet && intAmount >= rules.redeem.minBdt;
  const convertValid =
    convertSheet &&
    coins > 0 &&
    Math.floor(coins / rules.coinToCash.coinsPerBdt) >= rules.coinToCash.minBdt;

  const depositMutation = useMutation({
    mutationFn: () => api.deposit(intAmount, channel),
    onSuccess: (invoice) => {
      setPayment(invoice);
      // The hosted checkout opens outside the app; the coins land once it confirms.
      void Linking.openURL(invoice.paymentUrl).catch(() => undefined);
      refresh();
    },
  });
  const withdrawMutation = useMutation({
    mutationFn: () =>
      api.requestWithdrawal({
        amountBdt: intAmount,
        channel,
        destination: destination.trim(),
        requestId: attemptId.current,
      }),
    onSuccess: () => {
      attemptId.current = requestId();
      refresh();
      onDone();
    },
  });
  const redeemMutation = useMutation({
    mutationFn: () => api.redeemCash(intAmount, attemptId.current),
    onSuccess: () => {
      attemptId.current = requestId();
      refresh();
      onDone();
    },
  });
  const convertMutation = useMutation({
    mutationFn: () => api.convertCoins(coins, attemptId.current),
    onSuccess: () => {
      attemptId.current = requestId();
      refresh();
      onDone();
    },
  });

  const busy =
    depositMutation.isPending ||
    withdrawMutation.isPending ||
    redeemMutation.isPending ||
    convertMutation.isPending;
  const error = friendly(
    depositMutation.error ??
      withdrawMutation.error ??
      redeemMutation.error ??
      convertMutation.error,
  );

  if (depositSheet && payment) {
    return (
      <View style={styles.sheet}>
        <Text style={[styles.heading, { color: t.text }]}>Payment started</Text>
        <Text style={{ color: t.muted, marginTop: 4 }}>
          Finish paying {taka(payment.amountBdt)} in{' '}
          {CHANNEL_LABELS[payment.channel as PayoutChannel]}. The{' '}
          {payment.coins.toLocaleString('en-US')} coins land as soon as the gateway confirms — pull
          to refresh after paying.
        </Text>
        <View style={styles.actionRow}>
          <Button label="Done" kind="secondary" onPress={onDone} />
        </View>
      </View>
    );
  }

  const redeemCoins = intAmount * rules.redeem.coinsPerBdt;

  return (
    <View style={styles.sheet}>
      <Text style={[styles.heading, { color: t.text }]}>
        {depositSheet
          ? `Add coins — ${rules.deposit.coinsPerBdt} per taka`
          : withdrawSheet
            ? `Withdraw — ${taka(rules.withdraw.minBdt)} to ${taka(rules.withdraw.maxBdt)}`
            : redeemSheet
              ? `Cash → coins — ${rules.redeem.coinsPerBdt} per taka`
              : `Coins → cash — ${rules.coinToCash.coinsPerBdt} coins per taka`}
      </Text>

      {withdrawSheet ? (
        <>
          <Segmented
            options={(Object.keys(CHANNEL_LABELS) as PayoutChannel[]).map((c) => ({
              value: c,
              label: CHANNEL_LABELS[c],
            }))}
            value={channel}
            onChange={setChannel}
          />
          <Text style={[styles.fieldLabel, { color: t.muted }]}>
            {channel === 'bank'
              ? 'Bank account number'
              : `${CHANNEL_LABELS[channel]} wallet number`}
          </Text>
          <TextInput
            style={[
              styles.input,
              { color: t.text, borderColor: t.border, backgroundColor: t.background },
            ]}
            value={destination}
            onChangeText={(text) => setDestination(text.replace(/[^\d]/g, '').slice(0, 24))}
            placeholder={channel === 'bank' ? 'e.g. 1520473390' : 'e.g. 01712345678'}
            placeholderTextColor={t.muted}
            keyboardType="number-pad"
          />
        </>
      ) : null}

      {depositSheet || redeemSheet || withdrawSheet ? (
        <>
          <Text style={[styles.fieldLabel, { color: t.muted }]}>
            {depositSheet ? 'Pay (taka)' : withdrawSheet ? 'Cash out (taka)' : 'Redeem (taka)'}
          </Text>
          {depositSheet ? (
            <Segmented
              options={[20, 50, 100, 500, 1000].map((n) => ({
                value: String(n),
                label: String(n),
              }))}
              value={amount}
              onChange={setAmount}
            />
          ) : null}
          <TextInput
            style={[
              styles.input,
              { color: t.text, borderColor: t.border, backgroundColor: t.background },
            ]}
            value={amount}
            onChangeText={(text) => setAmount(text.replace(/\D/g, '').slice(0, 6))}
            placeholder={String(
              depositSheet
                ? rules.deposit.minBdt
                : redeemSheet
                  ? rules.redeem.minBdt
                  : rules.withdraw.minBdt,
            )}
            placeholderTextColor={t.muted}
            keyboardType="number-pad"
          />
        </>
      ) : null}

      {convertSheet ? (
        <>
          <Text style={[styles.fieldLabel, { color: t.muted }]}>Won coins to convert</Text>
          <TextInput
            style={[
              styles.input,
              { color: t.text, borderColor: t.border, backgroundColor: t.background },
            ]}
            value={amount}
            onChangeText={(text) => setAmount(text.replace(/\D/g, '').slice(0, 9))}
            placeholder={`min ${rules.coinToCash.coinsPerBdt * rules.coinToCash.minBdt}`}
            placeholderTextColor={t.muted}
            keyboardType="number-pad"
          />
          <Text style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>
            Leftover coins stay winnings. Bonus coins cannot convert. Minimum{' '}
            {taka(rules.coinToCash.minBdt)}.
          </Text>
        </>
      ) : null}

      <View style={styles.actionRow}>
        {depositSheet ? (
          <Button
            label={`Pay with ${CHANNEL_LABELS[channel]}`}
            disabled={!depositValid}
            busy={depositMutation.isPending}
            onPress={() => depositMutation.mutate()}
          />
        ) : withdrawSheet ? (
          <Button
            label="Request cash out"
            disabled={!withdrawValid}
            busy={busy}
            onPress={() => withdrawMutation.mutate()}
          />
        ) : redeemSheet ? (
          <Button
            label={
              redeemCoins > 0 ? `Redeem for ${redeemCoins.toLocaleString('en-US')} coins` : 'Redeem'
            }
            disabled={!redeemValid}
            busy={busy}
            onPress={() => redeemMutation.mutate()}
          />
        ) : (
          <Button
            label={`Convert to ${convertValid ? taka(Math.floor(coins / rules.coinToCash.coinsPerBdt)) : 'cash'}`}
            disabled={!convertValid}
            busy={busy}
            onPress={() => convertMutation.mutate()}
          />
        )}
        <Button label="Cancel" kind="secondary" onPress={onDone} />
      </View>
      {error ? <Text style={{ color: t.live, marginTop: 8 }}>{error}</Text> : null}
    </View>
  );
}

function OfferCard({ offer, onRedeemed }: { offer: VoucherOffer; onRedeemed: () => void }) {
  const t = useTheme();
  // One id per attempt, so a double tap or retry never charges twice.
  const attempt = useRef(requestId());
  const redeem = useMutation({
    mutationFn: () => api.redeem(offer.id, attempt.current),
    onSuccess: () => {
      attempt.current = requestId();
      onRedeemed();
    },
  });
  const blocked = offer.canRedeem === false;
  const error = redeem.error instanceof ApiError ? redeem.error.message : undefined;
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={{ flexShrink: 1, paddingRight: 12 }}>
          <Text style={{ color: t.muted, fontSize: 13 }}>{offer.partnerName}</Text>
          <Text style={[styles.heading, { color: t.text }]}>{offer.title}</Text>
          <Text style={{ color: t.text, marginTop: 2 }}>{offer.discountText}</Text>
        </View>
        <Text style={[styles.cost, { color: t.accent }]}>{offer.costCoins.toLocaleString()}</Text>
      </View>
      <Text style={{ color: t.muted, fontSize: 13, marginTop: 8 }}>
        {offer.terms} Valid {offer.validForDays} days.
        {offer.stockLeft !== null ? ` ${offer.stockLeft} left.` : ''}
      </Text>
      <View style={{ marginTop: 12 }}>
        <Button
          label={
            blocked
              ? (REASONS[offer.reason ?? ''] ?? 'Not available')
              : `Redeem for ${formatCoins(offer.costCoins)}`
          }
          disabled={blocked}
          busy={redeem.isPending}
          onPress={() => redeem.mutate()}
        />
      </View>
      {error ? <Text style={{ color: t.live, marginTop: 8 }}>{error}</Text> : null}
    </Card>
  );
}

function VoucherCard({ voucher }: { voucher: MyVoucher }) {
  const t = useTheme();
  const active = voucher.status === 'active';
  return (
    <Card>
      <View style={styles.rowBetween}>
        <View style={{ flexShrink: 1 }}>
          <Text style={{ color: t.muted, fontSize: 13 }}>{voucher.partnerName}</Text>
          <Text style={[styles.heading, { color: t.text }]}>{voucher.title}</Text>
        </View>
        <Chip
          label={active ? `Until ${formatDay(voucher.expiresAt)}` : voucher.status}
          tone={active ? 'done' : 'muted'}
        />
      </View>
      <Text style={[styles.code, { color: t.text, borderColor: t.border }]}>{voucher.code}</Text>
      <Text style={{ color: t.muted, fontSize: 13 }}>
        {voucher.discountText}. Show this code in your app at the partner; it works only with your
        verified name.
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  content: { paddingTop: 16, paddingBottom: 32 },
  label: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  total: { fontSize: 40, fontWeight: '800', marginVertical: 4, fontVariant: ['tabular-nums'] },
  split: { flexDirection: 'row', gap: 16, marginTop: 8 },
  half: { flex: 1, gap: 2 },
  amount: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  heading: { fontSize: 16, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cost: { fontSize: 20, fontWeight: '800' },
  activity: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  actions: { gap: 8, marginTop: 12 },
  actionRow: { flexDirection: 'row', gap: 8 },
  sheet: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#8884',
    marginTop: 12,
    paddingTop: 12,
    gap: 8,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  code: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 8,
    paddingVertical: 10,
    marginVertical: 12,
    fontVariant: ['tabular-nums'],
  },
  footnote: { fontSize: 12, lineHeight: 18, marginHorizontal: 16, marginTop: 8 },
});
