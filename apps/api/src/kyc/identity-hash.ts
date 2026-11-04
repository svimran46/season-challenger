import { createHmac } from 'node:crypto';

/** Spaces and case do not make a different ID. (Hashes already stored depend on this.) */
export function normalizeDocumentNumber(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/**
 * Keyed hash of an ID document number: the one-ID-per-account check compares these, and the
 * number itself is never stored. ID_HASH_SECRET must be set in production.
 */
export function documentHash(documentNumber: string): string {
  const secret = process.env.ID_HASH_SECRET;
  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('ID_HASH_SECRET must be set in production.');
  }
  return createHmac('sha256', secret ?? 'dev-only-secret')
    .update(normalizeDocumentNumber(documentNumber))
    .digest('hex');
}
