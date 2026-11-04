import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/** About 32 MiB of memory per attempt, so guessing stolen hashes in bulk is expensive. */
const COST = { N: 2 ** 15, r: 8, p: 1 };
const KEY_BYTES = 32;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 12;

function derive(
  password: string,
  salt: Buffer,
  cost: { N: number; r: number; p: number },
  keyBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // Node refuses more than 32 MiB unless told otherwise; this cost sits exactly at that line.
    const maxmem = 256 * cost.N * cost.r;
    scrypt(password, salt, keyBytes, { ...cost, maxmem }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Stored as scrypt$N$r$p$salt$key, so the cost can rise later without breaking old hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST, KEY_BYTES);
  return [
    'scrypt',
    COST.N,
    COST.r,
    COST.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(
    password,
    Buffer.from(salt, 'base64url'),
    { N: Number(n), r: Number(r), p: Number(p) },
    expected.length,
  );
  return timingSafeEqual(actual, expected);
}

/**
 * Spends the same time as checking a real password, so sign-in does not reveal whether an account
 * exists by answering faster for an unknown email.
 */
const dummyHash = hashPassword(randomBytes(32).toString('base64url'));
export async function burnPasswordCheck(password: string): Promise<void> {
  await verifyPassword(password, await dummyHash);
}
