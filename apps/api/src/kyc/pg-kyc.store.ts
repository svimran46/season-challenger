import { and, asc, desc, eq, isNull, lt, ne } from 'drizzle-orm';
import type { Database } from '../db/client';
import { idSubmission } from '../db/schema';
import { isUniqueViolation } from '../economy/pg-economy.repository';
import {
  PendingSubmissionError,
  type CaptureLayout,
  type DocumentType,
  type IdSubmission,
  type KycStore,
  type StoredImage,
  type SubmissionDecision,
  type SubmissionStatus,
} from './kyc.types';

type Row = typeof idSubmission.$inferSelect;

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function fromRow(row: Row): IdSubmission {
  return {
    id: row.id,
    userId: row.userId,
    documentType: row.documentType as DocumentType,
    layout: row.layout as CaptureLayout,
    images: row.images as StoredImage[],
    birthDate: row.birthDate,
    documentNumberSealed: row.documentNumberSealed,
    documentHash: row.documentHash,
    status: row.status as SubmissionStatus,
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: iso(row.reviewedAt),
    reviewedBy: row.reviewedBy,
    rejectionReason: row.rejectionReason,
    imagesPurgedAt: iso(row.imagesPurgedAt),
  };
}

/** ID check submissions in Postgres. See KycStore. */
export class PgKycStore implements KycStore {
  constructor(private readonly db: Database) {}

  async insert(s: IdSubmission): Promise<void> {
    try {
      await this.db.insert(idSubmission).values({
        id: s.id,
        userId: s.userId,
        documentType: s.documentType,
        layout: s.layout,
        status: s.status,
        images: s.images,
        birthDate: s.birthDate,
        documentNumberSealed: s.documentNumberSealed,
        documentHash: s.documentHash,
        submittedAt: new Date(s.submittedAt),
        reviewedAt: s.reviewedAt ? new Date(s.reviewedAt) : null,
        reviewedBy: s.reviewedBy,
        rejectionReason: s.rejectionReason,
        imagesPurgedAt: s.imagesPurgedAt ? new Date(s.imagesPurgedAt) : null,
      });
    } catch (error) {
      // The partial unique index allows one pending submission per player.
      if (isUniqueViolation(error) && s.status === 'pending') throw new PendingSubmissionError();
      throw error;
    }
  }

  async get(id: string): Promise<IdSubmission | undefined> {
    const [row] = await this.db.select().from(idSubmission).where(eq(idSubmission.id, id));
    return row && fromRow(row);
  }

  async latestFor(userId: string): Promise<IdSubmission | undefined> {
    const [row] = await this.db
      .select()
      .from(idSubmission)
      .where(eq(idSubmission.userId, userId))
      .orderBy(desc(idSubmission.submittedAt), desc(idSubmission.id))
      .limit(1);
    return row && fromRow(row);
  }

  async list(filter: { status: SubmissionStatus; limit: number }): Promise<IdSubmission[]> {
    const order =
      filter.status === 'pending'
        ? [asc(idSubmission.submittedAt), asc(idSubmission.id)]
        : [desc(idSubmission.reviewedAt), desc(idSubmission.id)];
    const rows = await this.db
      .select()
      .from(idSubmission)
      .where(eq(idSubmission.status, filter.status))
      .orderBy(...order)
      .limit(filter.limit);
    return rows.map(fromRow);
  }

  async decide(id: string, d: SubmissionDecision): Promise<boolean> {
    const updated = await this.db
      .update(idSubmission)
      .set({
        status: d.status,
        reviewedAt: new Date(d.reviewedAt),
        reviewedBy: d.reviewedBy,
        rejectionReason: d.rejectionReason,
        documentNumberSealed: null,
        ...(d.birthDate !== undefined ? { birthDate: d.birthDate } : {}),
        ...(d.documentHash !== undefined ? { documentHash: d.documentHash } : {}),
      })
      .where(and(eq(idSubmission.id, id), eq(idSubmission.status, 'pending')))
      .returning({ id: idSubmission.id });
    return updated.length > 0;
  }

  async decidedBefore(cutoff: string, limit: number): Promise<IdSubmission[]> {
    const rows = await this.db
      .select()
      .from(idSubmission)
      .where(
        and(
          ne(idSubmission.status, 'pending'),
          lt(idSubmission.reviewedAt, new Date(cutoff)),
          isNull(idSubmission.imagesPurgedAt),
        ),
      )
      .orderBy(asc(idSubmission.reviewedAt), asc(idSubmission.id))
      .limit(limit);
    return rows.map(fromRow);
  }

  async markPurged(id: string, at: string): Promise<void> {
    await this.db
      .update(idSubmission)
      .set({ imagesPurgedAt: new Date(at) })
      .where(and(eq(idSubmission.id, id), isNull(idSubmission.imagesPurgedAt)));
  }
}
