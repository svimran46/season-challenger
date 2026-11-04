/*
 * ID check (KYC) for voucher redemption: the player photographs a national ID card or passport,
 * front and back or in a single frame, and a reviewer approves or rejects it. Approval records
 * the birth date and a keyed hash of the document number on the player (one ID, one account).
 *
 * Storage ports, each with a memory implementation for development and tests:
 * - KycStore: the submissions (Postgres: PgKycStore).
 * - DocumentVault: the photos, encrypted at rest (EncryptedVault over a BlobBackend).
 * A real ID-check provider (Porichoy, Sumsub, Shufti Pro) can later replace the manual reviewer
 * by calling KycService.approve / reject from its callback.
 */

export const DOCUMENT_TYPES = ['nid', 'passport'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** front_back: two photos, one per side. single: one photo with the whole document in frame. */
export const CAPTURE_LAYOUTS = ['front_back', 'single'] as const;
export type CaptureLayout = (typeof CAPTURE_LAYOUTS)[number];

export type ImageSide = 'front' | 'back' | 'single';

export const SIDES_FOR: Record<CaptureLayout, readonly ImageSide[]> = {
  front_back: ['front', 'back'],
  single: ['single'],
};

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface StoredImage {
  side: ImageSide;
  /** Key in the DocumentVault. */
  key: string;
  contentType: ImageType;
  bytes: number;
}

export interface IdSubmission {
  id: string;
  userId: string;
  documentType: DocumentType;
  layout: CaptureLayout;
  images: StoredImage[];
  /** As typed by the player, YYYY-MM-DD; the reviewer checks it against the photo. */
  birthDate: string;
  /**
   * The typed document number, encrypted (see sealText in vault.ts), so the reviewer can compare
   * it with the photo. Wiped (null) once the submission is decided.
   */
  documentNumberSealed: string | null;
  /** Keyed hash of the typed number (identity-hash.ts), for the one-ID-per-account check. */
  documentHash: string;
  status: SubmissionStatus;
  submittedAt: string;
  reviewedAt: string | null;
  /** Reviewer name, or the provider's name once one is connected. */
  reviewedBy: string | null;
  /** Shown to the player when rejected. */
  rejectionReason: string | null;
  /** Set when the photos were deleted after the retention period. */
  imagesPurgedAt: string | null;
}

export interface SubmissionDecision {
  status: 'approved' | 'rejected';
  reviewedAt: string;
  reviewedBy: string;
  rejectionReason: string | null;
  /** On approval the reviewer may correct what the player typed. */
  birthDate?: string;
  documentHash?: string;
}

export interface KycStore {
  /** Throws PendingSubmissionError if the player already has a pending submission. */
  insert(submission: IdSubmission): Promise<void>;
  get(id: string): Promise<IdSubmission | undefined>;
  /** The player's newest submission. */
  latestFor(userId: string): Promise<IdSubmission | undefined>;
  /** Pending: oldest first (the review queue). Approved/rejected: newest decided first. */
  list(filter: { status: SubmissionStatus; limit: number }): Promise<IdSubmission[]>;
  /**
   * Decides a pending submission and wipes documentNumberSealed. Returns false (and changes
   * nothing) if it is not pending any more, so two reviewers cannot both decide it.
   */
  decide(id: string, decision: SubmissionDecision): Promise<boolean>;
  /** Decided before `cutoff` and photos not yet purged, oldest first. */
  decidedBefore(cutoff: string, limit: number): Promise<IdSubmission[]>;
  markPurged(id: string, at: string): Promise<void>;
}

export class PendingSubmissionError extends Error {
  constructor() {
    super('Your ID is already waiting for review.');
  }
}

/** Where photos of ID documents live. Implementations must encrypt at rest. */
export interface DocumentVault {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | undefined>;
  /** Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
}
