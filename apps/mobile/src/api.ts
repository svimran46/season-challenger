import type {
  Club,
  Fixture,
  Player,
  PlayerPoints,
  Season,
  SquadPick,
  SquadValidation,
} from '@season/shared';
import { Platform } from 'react-native';
import { clearToken, currentToken } from './session';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** A failed request, with the API's error code (e.g. insufficient_funds) when it sent one. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    /** The whole error body, for extra fields such as retryAfterSeconds or attemptsLeft. */
    readonly body: Record<string, unknown> = {},
  ) {
    super(message);
  }

  /** Seconds to wait before asking again (too_many_codes). */
  get retryAfterSeconds(): number | undefined {
    return typeof this.body.retryAfterSeconds === 'number'
      ? this.body.retryAfterSeconds
      : undefined;
  }

  /** Tries left before the code is used up (wrong_code). */
  get attemptsLeft(): number | undefined {
    return typeof this.body.attemptsLeft === 'number' ? this.body.attemptsLeft : undefined;
  }
}

export interface FixtureSummary extends Fixture {
  home: Club;
  away: Club;
  /** Final score once the match is finished; null before then. */
  score: { home: number; away: number } | null;
}

export interface FixtureDetail extends FixtureSummary {
  players: Player[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = currentToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      // FormData sets its own multipart Content-Type, with the boundary.
      ...(init?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // The session has ended on the server (expired or signed out elsewhere): sign out here too.
    // Only if this request used the token still held, so a late reply cannot undo a new sign-in.
    if (res.status === 401 && token !== null && currentToken() === token) void clearToken();
    const raw: unknown = await res.json().catch(() => ({}));
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const message =
      typeof body.message === 'string'
        ? body.message
        : `${init?.method ?? 'GET'} ${path} failed with ${res.status}`;
    throw new ApiError(
      res.status,
      typeof body.error === 'string' ? body.error : undefined,
      message,
      body,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

export interface Wallet {
  bonus: number;
  winnings: number;
  total: number;
  redeemable: number;
  checkIn: { today: string; checkedIn: boolean; streak: number; nextReward: number };
  verified: boolean;
}

export interface WalletActivity {
  id: string;
  kind:
    | 'sign_up_bonus'
    | 'promotion'
    | 'reward'
    | 'contest_entry'
    | 'entry_refund'
    | 'contest_settlement'
    | 'voucher_redemption'
    | 'voucher_refund';
  createdAt: string;
  bonus: number;
  winnings: number;
  meta: Record<string, string | number>;
}

export type ContestFormat = 'head_to_head' | 'small_league' | 'mega' | 'private';

export interface Contest {
  id: string;
  fixtureId: string;
  name: string;
  format: ContestFormat;
  formatLabel: string;
  status: 'open' | 'locked' | 'settled' | 'cancelled';
  entryFee: number;
  capacity: number;
  entries: number;
  spotsLeft: number;
  minEntries: number;
  guaranteed: boolean;
  prizeTable: { fromRank: number; toRank: number; amount: number }[];
  topPrize: number;
  inviteCode: string | null;
}

export interface MyEntry {
  entryId: string;
  points: number | null;
  rank: number | null;
  prize: number | null;
  joinedAt: string;
  fixture?: {
    id: string;
    kickoffAt: string;
    status: 'scheduled' | 'live' | 'finished';
    home: string;
    away: string;
  };
  contest: Contest;
}

export interface VoucherOffer {
  id: string;
  partnerName: string;
  category: 'shop' | 'travel';
  title: string;
  discountText: string;
  terms: string;
  costCoins: number;
  validForDays: number;
  stockLeft: number | null;
  canRedeem?: boolean;
  reason?: string | null;
}

export interface MyVoucher {
  id: string;
  code: string;
  partnerName: string;
  category: 'shop' | 'travel';
  title: string;
  discountText: string;
  costCoins: number;
  issuedAt: string;
  expiresAt: string;
  status: 'active' | 'used' | 'expired' | 'cancelled';
}

/** A random id for a redemption, so a retried tap never charges twice. */
export function requestId(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const h = hex.join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export interface CodeSent {
  /** The number in +880 form; send this back with the code. */
  phone: string;
  /** For display, e.g. "+880 1712-***678". */
  maskedPhone: string;
  expiresInSeconds: number;
  resendInSeconds: number;
}

export interface SignedIn {
  token: string;
  expiresAt: string;
  user: { id: string; phone: string | null; email?: string | null; isNew: boolean };
}

/** The sign-in methods this server offers. */
export interface AuthMethods {
  /** False when the server cannot send text messages, so phone sign-in is hidden. */
  phone: boolean;
  /** Null when Google sign-in is not configured on the server. */
  google: { webClientId: string } | null;
}

export interface Me {
  id: string;
  phone: string | null;
  email: string | null;
}

export type DocumentType = 'nid' | 'passport';
/** front_back: one photo per side. single: the whole document in one photo. */
export type CaptureLayout = 'front_back' | 'single';
export type ImageSide = 'front' | 'back' | 'single';

export interface VerificationStatus {
  status: 'unverified' | 'pending' | 'approved' | 'rejected';
  verifiedAt: string | null;
  submission: {
    id: string;
    documentType: DocumentType;
    layout: CaptureLayout;
    submittedAt: string;
    reviewedAt: string | null;
    rejectionReason: string | null;
  } | null;
}

/** A photo picked on the device: a file:// URI on a phone, a blob: or data: URI on the web. */
export interface PickedImage {
  uri: string;
  /** e.g. image/jpeg; guessed from the file name when the picker does not say. */
  mimeType?: string | null;
  fileName?: string | null;
}

export interface IdDocumentsInput {
  documentType: DocumentType;
  layout: CaptureLayout;
  birthDate: string;
  documentNumber: string;
  images: Partial<Record<ImageSide, PickedImage>>;
}

function imageType(image: PickedImage): string {
  if (image.mimeType) return image.mimeType;
  const ext = /\.(\w+)$/.exec(image.fileName ?? image.uri)?.[1]?.toLowerCase();
  return { png: 'image/png', webp: 'image/webp', heic: 'image/heic' }[ext ?? ''] ?? 'image/jpeg';
}

async function idDocumentsForm(input: IdDocumentsInput): Promise<FormData> {
  const form = new FormData();
  form.append('documentType', input.documentType);
  form.append('layout', input.layout);
  form.append('birthDate', input.birthDate);
  form.append('documentNumber', input.documentNumber);
  for (const [side, image] of Object.entries(input.images)) {
    if (!image) continue;
    const type = imageType(image);
    const name = `${side}.${type.split('/')[1] ?? 'jpg'}`;
    if (Platform.OS === 'web') {
      form.append(side, await (await fetch(image.uri)).blob(), name);
    } else {
      // React Native's FormData uploads the file at `uri`.
      form.append(side, { uri: image.uri, name, type } as unknown as Blob);
    }
  }
  return form;
}

export interface PresentCode {
  code: string;
  validForSeconds: number;
  expiresAt: string;
}

export type MasteryAnswer =
  | { kind: 'outcome'; pick: 'home' | 'draw' | 'away'; confidence: number }
  | { kind: 'halfTimeLeader'; pick: 'home' | 'draw' | 'away' }
  | { kind: 'range'; min: number; max: number }
  | { kind: 'comparison'; pick: 'home' | 'away' }
  | { kind: 'playerDuel'; pick: 'a' | 'b' }
  | { kind: 'topPlayer'; playerId: string };

export interface MasteryCall {
  id: string;
  position: number;
  kind: MasteryAnswer['kind'];
  prompt: string;
  options: { value: string; label: string; detail: string | null }[];
  range: { floor: number; ceiling: number; maxWidth: number; start: number } | null;
  answer: MasteryAnswer | null;
  result: {
    summary: string;
    correctOptions: string[];
    accuracy: number | null;
    weight: number | null;
  } | null;
}

export interface MasteryCard {
  id: string;
  fixtureId: string;
  status: 'open' | 'locked' | 'graded';
  locksAt: string;
  rewardCoins: number;
  submittedAt: string | null;
  score: number | null;
  fixture: { kickoffAt: string; home: { shortName: string }; away: { shortName: string } };
  calls: MasteryCall[];
}

export interface MyMastery {
  rating: number;
  tier: string;
  cardsCompleted: number;
  cardsForLeaderboard: number;
  next: {
    next: string;
    rating: { have: number; need: number };
    cards: { have: number; need: number };
    share: number;
  } | null;
  history: { fixtureId: string; home: string; away: string; score: number }[];
}

export interface MasteryLeaderboard {
  minCards: number;
  entries: {
    rank: number;
    displayName: string;
    rating: number;
    tier: string;
    cardsCompleted: number;
    isYou: boolean;
  }[];
}

export const api = {
  authMethods: () =>
    request<AuthMethods>('/v1/auth/methods').catch((error: unknown) => {
      // A server from before Google sign-in has no such route; it only offers phone sign-in.
      if (error instanceof ApiError && error.status === 404) {
        return { phone: true, google: null } satisfies AuthMethods;
      }
      throw error;
    }),
  signInWithGoogle: (idToken: string) => request<SignedIn>('/v1/auth/google', post({ idToken })),
  requestCode: (phone: string) => request<CodeSent>('/v1/auth/code', post({ phone })),
  verifyCode: (phone: string, code: string) =>
    request<SignedIn>('/v1/auth/verify', post({ phone, code })),
  signOut: () => request<void>('/v1/auth/sign-out', post()),
  me: () => request<Me>('/v1/me'),

  season: () => request<Season & { currentGameweek: number }>('/v1/season'),
  fixtures: (gameweek: number) => request<FixtureSummary[]>(`/v1/fixtures?gameweek=${gameweek}`),
  fixture: (id: string) => request<FixtureDetail>(`/v1/fixtures/${id}`),
  points: (id: string) =>
    request<{ fixtureId: string; version: number; players: PlayerPoints[] }>(
      `/v1/fixtures/${id}/points`,
    ),
  validateSquad: (squad: SquadPick) =>
    request<SquadValidation>('/v1/squads/validate', {
      method: 'POST',
      body: JSON.stringify(squad),
    }),

  wallet: () => request<Wallet>('/v1/me/wallet'),
  activity: (limit = 20) => request<WalletActivity[]>(`/v1/me/wallet/activity?limit=${limit}`),
  checkIn: () =>
    request<{ today: string; streak: number; coins: number; alreadyCheckedIn: boolean }>(
      '/v1/me/check-in',
      post(),
    ),
  verificationStatus: () => request<VerificationStatus>('/v1/me/verification'),
  submitIdDocuments: async (input: IdDocumentsInput) =>
    request<VerificationStatus>('/v1/me/verification/documents', {
      method: 'POST',
      body: await idDocumentsForm(input),
    }),

  contests: (fixtureId: string) =>
    request<Contest[]>(`/v1/contests?fixtureId=${encodeURIComponent(fixtureId)}`),
  contest: (id: string) => request<Contest>(`/v1/contests/${encodeURIComponent(id)}`),
  contestByInvite: (code: string) =>
    request<Contest>(`/v1/contests/invite/${encodeURIComponent(code.trim())}`),
  createPrivate: (input: { fixtureId: string; name: string; entryFee: number; capacity: number }) =>
    request<Contest>('/v1/contests', post(input)),
  join: (contestId: string, squad: Omit<SquadPick, 'fixtureId'>) =>
    request<{ entryId: string; contest: Contest }>(
      `/v1/contests/${encodeURIComponent(contestId)}/entries`,
      post(squad),
    ),
  myEntries: () => request<MyEntry[]>('/v1/me/entries'),

  offers: (category?: 'shop' | 'travel') =>
    request<VoucherOffer[]>(`/v1/vouchers/offers${category ? `?category=${category}` : ''}`),
  redeem: (offerId: string, id: string) =>
    request<MyVoucher>('/v1/vouchers/redeem', post({ offerId, requestId: id })),
  myVouchers: () => request<MyVoucher[]>('/v1/me/vouchers'),
  presentCode: (voucherId: string) =>
    request<PresentCode>(`/v1/me/vouchers/${voucherId}/present`, post()),

  masteryCard: (fixtureId: string) =>
    request<MasteryCard>(`/v1/mastery/cards?fixtureId=${encodeURIComponent(fixtureId)}`),
  submitMasteryCard: (cardId: string, answers: { questionId: string; answer: MasteryAnswer }[]) =>
    request<MasteryCard>(`/v1/mastery/cards/${cardId}/answers`, {
      method: 'PUT',
      body: JSON.stringify({ answers }),
    }),
  myMastery: () => request<MyMastery>('/v1/me/mastery'),
  masteryLeaderboard: () => request<MasteryLeaderboard>('/v1/mastery/leaderboard'),
};
