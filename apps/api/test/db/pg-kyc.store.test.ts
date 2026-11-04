import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../../src/db/client';
import { PendingSubmissionError, type IdSubmission } from '../../src/kyc/kyc.types';
import { PgKycStore } from '../../src/kyc/pg-kyc.store';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to run the database tests.');
const { db, close } = createDatabase(url);
const store = new PgKycStore(db);

const submission = (id: string, over: Partial<IdSubmission> = {}): IdSubmission => ({
  id,
  userId: 'u1',
  documentType: 'nid',
  layout: 'front_back',
  images: [
    { side: 'front', key: `${id}/front`, contentType: 'image/jpeg', bytes: 1200 },
    { side: 'back', key: `${id}/back`, contentType: 'image/jpeg', bytes: 1100 },
  ],
  birthDate: '1998-05-10',
  documentNumberSealed: 'sealed-number',
  documentHash: 'hash-1',
  status: 'pending',
  submittedAt: '2026-09-01T07:00:00.000Z',
  reviewedAt: null,
  reviewedBy: null,
  rejectionReason: null,
  imagesPurgedAt: null,
  ...over,
});

beforeEach(async () => {
  await db.execute(sql`truncate id_submission`);
});
afterAll(close);

describe('PgKycStore', () => {
  it('stores a submission and reads it back unchanged', async () => {
    const s = submission('s1');
    await store.insert(s);
    expect(await store.get('s1')).toEqual(s);
    expect(await store.get('missing')).toBeUndefined();
  });

  it('allows one pending submission per player', async () => {
    await store.insert(submission('s1'));
    await expect(store.insert(submission('s2'))).rejects.toBeInstanceOf(PendingSubmissionError);
    await store.insert(submission('s3', { userId: 'u2' }));
    // Once decided, the player can send another.
    await store.decide('s1', {
      status: 'rejected',
      reviewedAt: '2026-09-01T08:00:00.000Z',
      reviewedBy: 'reviewer',
      rejectionReason: 'Blurry photo.',
    });
    await store.insert(submission('s4', { submittedAt: '2026-09-01T09:00:00.000Z' }));
    expect((await store.latestFor('u1'))?.id).toBe('s4');
    expect(await store.latestFor('nobody')).toBeUndefined();
  });

  it('decides a pending submission once and wipes the typed number', async () => {
    await store.insert(submission('s1'));
    const decision = {
      status: 'approved' as const,
      reviewedAt: '2026-09-01T08:00:00.000Z',
      reviewedBy: 'reviewer',
      rejectionReason: null,
      birthDate: '1998-05-11',
      documentHash: 'hash-corrected',
    };
    const [first, second] = await Promise.all([
      store.decide('s1', decision),
      store.decide('s1', { ...decision, status: 'rejected', rejectionReason: 'no' }),
    ]);
    expect([first, second].sort()).toEqual([false, true]);
    const decided = (await store.get('s1'))!;
    expect(decided.documentNumberSealed).toBeNull();
    expect(decided.reviewedBy).toBe('reviewer');
    if (decided.status === 'approved') {
      expect(decided).toMatchObject({ birthDate: '1998-05-11', documentHash: 'hash-corrected' });
    }
    expect(await store.decide('missing', decision)).toBe(false);
  });

  it('lists the queue oldest first and decisions newest first', async () => {
    await store.insert(submission('late', { userId: 'a', submittedAt: '2026-09-01T09:00:00Z' }));
    await store.insert(submission('early', { userId: 'b', submittedAt: '2026-09-01T07:00:00Z' }));
    await store.insert(submission('c1', { userId: 'c' }));
    await store.insert(submission('d1', { userId: 'd' }));
    const reject = (at: string) => ({
      status: 'rejected' as const,
      reviewedAt: at,
      reviewedBy: 'r',
      rejectionReason: 'x',
    });
    await store.decide('c1', reject('2026-09-02T07:00:00.000Z'));
    await store.decide('d1', reject('2026-09-03T07:00:00.000Z'));
    const pending = await store.list({ status: 'pending', limit: 10 });
    expect(pending.map((s) => s.id)).toEqual(['early', 'late']);
    const rejected = await store.list({ status: 'rejected', limit: 10 });
    expect(rejected.map((s) => s.id)).toEqual(['d1', 'c1']);
    expect(await store.list({ status: 'pending', limit: 1 })).toHaveLength(1);
  });

  it('finds decided submissions whose photos are due for deletion', async () => {
    await store.insert(submission('old', { userId: 'a' }));
    await store.insert(submission('new', { userId: 'b' }));
    await store.insert(submission('waiting', { userId: 'c' }));
    const approve = (at: string) => ({
      status: 'approved' as const,
      reviewedAt: at,
      reviewedBy: 'r',
      rejectionReason: null,
    });
    await store.decide('old', approve('2026-06-01T00:00:00.000Z'));
    await store.decide('new', approve('2026-09-01T00:00:00.000Z'));
    const due = await store.decidedBefore('2026-08-01T00:00:00.000Z', 10);
    expect(due.map((s) => s.id)).toEqual(['old']);
    await store.markPurged('old', '2026-08-01T00:00:00.000Z');
    await store.markPurged('old', '2026-08-05T00:00:00.000Z');
    expect((await store.get('old'))?.imagesPurgedAt).toBe('2026-08-01T00:00:00.000Z');
    expect(await store.decidedBefore('2026-12-01T00:00:00.000Z', 10)).toEqual([
      expect.objectContaining({ id: 'new' }),
    ]);
  });
});
