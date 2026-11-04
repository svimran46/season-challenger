import {
  PendingSubmissionError,
  type IdSubmission,
  type KycStore,
  type SubmissionDecision,
  type SubmissionStatus,
} from './kyc.types';

const copy = <T>(value: T): T => structuredClone(value);

/** ID check submissions in memory, for development and tests. See KycStore. */
export class MemoryKycStore implements KycStore {
  private readonly submissions = new Map<string, IdSubmission>();

  async insert(submission: IdSubmission): Promise<void> {
    for (const s of this.submissions.values()) {
      if (s.userId === submission.userId && s.status === 'pending') {
        throw new PendingSubmissionError();
      }
    }
    if (this.submissions.has(submission.id)) {
      throw new Error(`Submission ${submission.id} already exists`);
    }
    this.submissions.set(submission.id, copy(submission));
  }

  async get(id: string): Promise<IdSubmission | undefined> {
    const s = this.submissions.get(id);
    return s && copy(s);
  }

  async latestFor(userId: string): Promise<IdSubmission | undefined> {
    let latest: IdSubmission | undefined;
    for (const s of this.submissions.values()) {
      if (s.userId === userId && (!latest || s.submittedAt >= latest.submittedAt)) latest = s;
    }
    return latest && copy(latest);
  }

  async list(filter: { status: SubmissionStatus; limit: number }): Promise<IdSubmission[]> {
    const rows = [...this.submissions.values()].filter((s) => s.status === filter.status);
    rows.sort((a, b) =>
      filter.status === 'pending'
        ? a.submittedAt.localeCompare(b.submittedAt)
        : (b.reviewedAt ?? '').localeCompare(a.reviewedAt ?? ''),
    );
    return rows.slice(0, filter.limit).map(copy);
  }

  async decide(id: string, decision: SubmissionDecision): Promise<boolean> {
    const s = this.submissions.get(id);
    if (!s || s.status !== 'pending') return false;
    s.status = decision.status;
    s.reviewedAt = decision.reviewedAt;
    s.reviewedBy = decision.reviewedBy;
    s.rejectionReason = decision.rejectionReason;
    s.documentNumberSealed = null;
    if (decision.birthDate !== undefined) s.birthDate = decision.birthDate;
    if (decision.documentHash !== undefined) s.documentHash = decision.documentHash;
    return true;
  }

  async decidedBefore(cutoff: string, limit: number): Promise<IdSubmission[]> {
    return [...this.submissions.values()]
      .filter(
        (s) =>
          s.status !== 'pending' &&
          s.reviewedAt !== null &&
          s.reviewedAt < cutoff &&
          s.imagesPurgedAt === null,
      )
      .sort((a, b) => a.reviewedAt!.localeCompare(b.reviewedAt!))
      .slice(0, limit)
      .map(copy);
  }

  async markPurged(id: string, at: string): Promise<void> {
    const s = this.submissions.get(id);
    if (s) s.imagesPurgedAt = at;
  }
}
