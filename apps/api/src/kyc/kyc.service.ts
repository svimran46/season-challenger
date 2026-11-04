import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ageOn, dhakaDate, isCalendarDate, VOUCHER_RULES } from '@season/wallet';
import { randomUUID } from 'node:crypto';
import { CLOCK, type Clock } from '../common/tokens';
import { WalletService } from '../economy/wallet.service';
import { documentHash } from './identity-hash';
import {
  PendingSubmissionError,
  SIDES_FOR,
  type CaptureLayout,
  type DocumentType,
  type DocumentVault,
  type IdSubmission,
  type ImageSide,
  type ImageType,
  type KycStore,
  type StoredImage,
  type SubmissionStatus,
} from './kyc.types';
import { openText, sealText } from './vault';

export const KYC_STORE = Symbol('KYC_STORE');
export const DOCUMENT_VAULT = Symbol('DOCUMENT_VAULT');
export const KYC_SETTINGS = Symbol('KYC_SETTINGS');

export interface KycSettings {
  /** 32-byte key for the typed document number while it waits for review. */
  sealKey: Buffer;
  /** Header value the reviewer routes need; unset turns them off. */
  reviewerToken?: string;
  /** Photos are deleted this many days after the decision. */
  retentionDays: number;
}

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export type KycErrorCode =
  | 'already_verified'
  | 'review_pending'
  | 'identity_in_use'
  | 'under_18'
  | 'bad_birth_date'
  | 'bad_image'
  | 'missing_image'
  | 'not_found'
  | 'already_decided';

const STATUS: Record<KycErrorCode, HttpStatus> = {
  already_verified: HttpStatus.CONFLICT,
  review_pending: HttpStatus.CONFLICT,
  identity_in_use: HttpStatus.CONFLICT,
  under_18: HttpStatus.UNPROCESSABLE_ENTITY,
  bad_birth_date: HttpStatus.BAD_REQUEST,
  bad_image: HttpStatus.BAD_REQUEST,
  missing_image: HttpStatus.BAD_REQUEST,
  not_found: HttpStatus.NOT_FOUND,
  already_decided: HttpStatus.CONFLICT,
};

/** An ID-check failure the app can act on: { statusCode, error: code, message }. */
export class KycError extends HttpException {
  constructor(
    readonly code: KycErrorCode,
    message: string,
  ) {
    super({ statusCode: STATUS[code], error: code, message }, STATUS[code]);
  }
}

/** A photo as the upload middleware hands it over. */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
}

export interface SubmissionInput {
  documentType: DocumentType;
  layout: CaptureLayout;
  birthDate: string;
  documentNumber: string;
}

/** Recognises the photo formats phones produce from their first bytes, whatever the client says. */
export function sniffImage(data: Buffer): ImageType | undefined {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return 'image/jpeg';
  }
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (
    data.subarray(0, 4).toString('latin1') === 'RIFF' &&
    data.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (data.subarray(4, 8).toString('latin1') === 'ftyp') {
    const brand = data.subarray(8, 12).toString('latin1');
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand))
      return 'image/heic';
  }
  return undefined;
}

/** What the player sees about their newest submission. */
function publicSubmission(s: IdSubmission) {
  return {
    id: s.id,
    documentType: s.documentType,
    layout: s.layout,
    submittedAt: s.submittedAt,
    reviewedAt: s.reviewedAt,
    rejectionReason: s.rejectionReason,
  };
}

/**
 * The document upload and its review. Approval goes through WalletService.recordVerification,
 * which enforces one ID per account.
 */
@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    @Inject(KYC_STORE) private readonly store: KycStore,
    @Inject(DOCUMENT_VAULT) private readonly vault: DocumentVault,
    @Inject(KYC_SETTINGS) private readonly settings: KycSettings,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(WalletService) private readonly wallet: WalletService,
  ) {}

  async status(userId: string) {
    const [profile, latest] = await Promise.all([
      this.wallet.profile(userId),
      this.store.latestFor(userId),
    ]);
    let status: 'unverified' | SubmissionStatus = 'unverified';
    if (profile.idVerifiedAt) status = 'approved';
    else if (latest && latest.status !== 'approved') status = latest.status;
    return {
      status,
      verifiedAt: profile.idVerifiedAt,
      submission: latest ? publicSubmission(latest) : null,
    };
  }

  async submit(
    userId: string,
    input: SubmissionInput,
    files: Partial<Record<ImageSide, UploadedImage>>,
  ) {
    const profile = await this.wallet.profile(userId);
    if (profile.idVerifiedAt) {
      throw new KycError('already_verified', 'Your ID is already verified.');
    }
    if ((await this.store.latestFor(userId))?.status === 'pending') {
      throw new KycError('review_pending', 'Your ID is already waiting for review.');
    }
    this.checkBirthDate(input.birthDate);

    const sides = SIDES_FOR[input.layout];
    const extra = (Object.keys(files) as ImageSide[]).filter((s) => !sides.includes(s));
    if (extra.length > 0) {
      throw new KycError('bad_image', `Unexpected photo for this layout: ${extra.join(', ')}.`);
    }
    const images: { side: ImageSide; data: Buffer; contentType: ImageType }[] = [];
    for (const side of sides) {
      const file = files[side];
      if (!file || file.size === 0) {
        throw new KycError('missing_image', `Add a photo of the ${label(side)}.`);
      }
      if (file.size > MAX_IMAGE_BYTES) {
        throw new KycError('bad_image', 'Each photo must be 6 MB or smaller.');
      }
      const contentType = sniffImage(file.buffer);
      if (!contentType) {
        throw new KycError(
          'bad_image',
          `The ${label(side)} must be a JPEG, PNG, WebP or HEIC photo.`,
        );
      }
      images.push({ side, data: file.buffer, contentType });
    }

    const hash = documentHash(input.documentNumber);
    const holder = await this.wallet.playerWithDocument(hash);
    if (holder && holder.id !== userId) {
      throw new KycError('identity_in_use', 'This ID is already verified on another account.');
    }

    const id = randomUUID();
    const stored: StoredImage[] = [];
    try {
      for (const image of images) {
        const key = `${id}-${image.side}`;
        await this.vault.put(key, image.data, image.contentType);
        stored.push({
          side: image.side,
          key,
          contentType: image.contentType,
          bytes: image.data.length,
        });
      }
      const submission: IdSubmission = {
        id,
        userId,
        documentType: input.documentType,
        layout: input.layout,
        images: stored,
        birthDate: input.birthDate,
        documentNumberSealed: sealText(this.settings.sealKey, input.documentNumber.trim()),
        documentHash: hash,
        status: 'pending',
        submittedAt: this.clock().toISOString(),
        reviewedAt: null,
        reviewedBy: null,
        rejectionReason: null,
        imagesPurgedAt: null,
      };
      await this.store.insert(submission);
    } catch (error) {
      await Promise.all(stored.map((s) => this.vault.delete(s.key).catch(() => undefined)));
      if (error instanceof PendingSubmissionError) {
        throw new KycError('review_pending', error.message);
      }
      throw error;
    }
    return this.status(userId);
  }

  // ------------------------------------------------------------ review

  async list(status: SubmissionStatus, limit: number) {
    const rows = await this.store.list({ status, limit });
    return rows.map((s) => this.forReviewer(s));
  }

  async get(id: string) {
    return this.forReviewer(await this.mustGet(id));
  }

  async image(id: string, side: ImageSide) {
    const submission = await this.mustGet(id);
    const image = submission.images.find((i) => i.side === side);
    if (!image || submission.imagesPurgedAt) {
      throw new KycError('not_found', 'No such photo.');
    }
    const stored = await this.vault.get(image.key);
    if (!stored) throw new KycError('not_found', 'No such photo.');
    return stored;
  }

  async approve(
    id: string,
    input: { reviewer: string; birthDate?: string; documentNumber?: string },
  ) {
    const submission = await this.mustGet(id);
    if (submission.status !== 'pending') {
      throw new KycError('already_decided', `This submission was already ${submission.status}.`);
    }
    const birthDate = input.birthDate ?? submission.birthDate;
    if (input.birthDate) this.checkBirthDate(birthDate);
    const hash = input.documentNumber
      ? documentHash(input.documentNumber)
      : submission.documentHash;
    // Verify first: if the ID already verifies another account, the submission stays pending.
    await this.wallet.recordVerification(submission.userId, { birthDate, idDocumentHash: hash });
    await this.store.decide(id, {
      status: 'approved',
      reviewedAt: this.clock().toISOString(),
      reviewedBy: input.reviewer,
      rejectionReason: null,
      birthDate,
      documentHash: hash,
    });
    return this.get(id);
  }

  async reject(id: string, input: { reviewer: string; reason: string }) {
    const decided = await this.store.decide(id, {
      status: 'rejected',
      reviewedAt: this.clock().toISOString(),
      reviewedBy: input.reviewer,
      rejectionReason: input.reason,
    });
    if (!decided) {
      const submission = await this.mustGet(id);
      throw new KycError('already_decided', `This submission was already ${submission.status}.`);
    }
    return this.get(id);
  }

  /** Deletes photos past the retention period. Run by the worker; safe to repeat. */
  async purgeExpired(limit = 100): Promise<number> {
    const now = this.clock();
    const cutoff = new Date(now.getTime() - this.settings.retentionDays * 86_400_000);
    const due = await this.store.decidedBefore(cutoff.toISOString(), limit);
    for (const submission of due) {
      for (const image of submission.images) await this.vault.delete(image.key);
      await this.store.markPurged(submission.id, now.toISOString());
    }
    if (due.length > 0) this.logger.log(`Deleted ID photos of ${due.length} decided submissions.`);
    return due.length;
  }

  // ------------------------------------------------------------ helpers

  private checkBirthDate(birthDate: string) {
    const today = dhakaDate(this.clock());
    if (!isCalendarDate(birthDate) || birthDate > today || ageOn(birthDate, today) > 120) {
      throw new KycError('bad_birth_date', 'Enter your date of birth as on your ID.');
    }
    if (ageOn(birthDate, today) < VOUCHER_RULES.minimumAge) {
      throw new KycError(
        'under_18',
        `Vouchers are for players aged ${VOUCHER_RULES.minimumAge} and over.`,
      );
    }
  }

  private async mustGet(id: string) {
    const submission = await this.store.get(id);
    if (!submission) throw new KycError('not_found', 'No such submission.');
    return submission;
  }

  /** The typed number, or null once wiped (or if the key changed: the queue still loads). */
  private openNumber(s: IdSubmission): string | null {
    if (!s.documentNumberSealed) return null;
    try {
      return openText(this.settings.sealKey, s.documentNumberSealed);
    } catch {
      this.logger.error(`Could not decrypt the document number of submission ${s.id}.`);
      return null;
    }
  }

  private forReviewer(s: IdSubmission) {
    const today = dhakaDate(this.clock());
    return {
      id: s.id,
      userId: s.userId,
      documentType: s.documentType,
      layout: s.layout,
      status: s.status,
      birthDate: s.birthDate,
      age: isCalendarDate(s.birthDate) ? ageOn(s.birthDate, today) : null,
      documentNumber: this.openNumber(s),
      images: s.imagesPurgedAt ? [] : s.images.map((i) => ({ side: i.side, bytes: i.bytes })),
      submittedAt: s.submittedAt,
      reviewedAt: s.reviewedAt,
      reviewedBy: s.reviewedBy,
      rejectionReason: s.rejectionReason,
      imagesPurgedAt: s.imagesPurgedAt,
    };
  }
}

function label(side: ImageSide): string {
  return side === 'single' ? 'document' : `${side} of the document`;
}
