const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'season-partner-token';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export interface Identity {
  staff: { name: string; email: string; role: 'owner' | 'cashier' };
  partner: { id: string; name: string; category: 'shop' | 'travel' };
}

export interface CheckedVoucher {
  code: string;
  title: string;
  discountText: string;
  terms: string;
  expiresAt: string;
  status: 'active' | 'used' | 'expired' | 'cancelled';
  canAccept: boolean;
  usedAt: string | null;
  usedReference: string | null;
}

export interface AcceptedVoucher {
  code: string;
  title: string;
  discountText: string;
  usedAt: string;
  usedReference: string;
  acceptedBy: string | null;
}

// A till is a shared device, so a shift's session ends with the browser tab, not on disk.
export const session = {
  token: () => sessionStorage.getItem(TOKEN_KEY),
  set: (token: string) => sessionStorage.setItem(TOKEN_KEY, token),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = session.token();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as {
    error?: string;
    message?: unknown;
    retryAfterSeconds?: number;
  };
  if (!res.ok) {
    throw new ApiError(
      res.status,
      body.error,
      typeof body.message === 'string' ? body.message : 'Something went wrong. Please try again.',
      body.retryAfterSeconds,
    );
  }
  return body as T;
}

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  login: (email: string, password: string) =>
    request<Identity & { token: string }>('/v1/partner/auth/login', post({ email, password })),
  logout: () => request<void>('/v1/partner/auth/logout', post()),
  me: () => request<Identity>('/v1/partner/me'),
  check: (code: string, presentCode: string) =>
    request<CheckedVoucher>('/v1/partner/vouchers/check', post({ code, presentCode })),
  accept: (input: { code: string; presentCode: string; reference: string; requestId: string }) =>
    request<AcceptedVoucher>('/v1/partner/vouchers/accept', post(input)),
  history: (cursor?: string) =>
    request<{ items: AcceptedVoucher[]; nextCursor: string | null }>(
      `/v1/partner/vouchers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
    ),
};
