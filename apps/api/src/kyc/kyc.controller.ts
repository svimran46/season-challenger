import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UnauthorizedException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { CurrentUser, SignedInGuard, type AuthedRequest } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import {
  KYC_SETTINGS,
  KycService,
  MAX_IMAGE_BYTES,
  type KycSettings,
  type UploadedImage,
} from './kyc.service';
import { CAPTURE_LAYOUTS, DOCUMENT_TYPES, type ImageSide } from './kyc.types';

const submissionBody = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  layout: z.enum(CAPTURE_LAYOUTS),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  documentNumber: z
    .string()
    .trim()
    .min(6)
    .max(40)
    .regex(/^[A-Za-z0-9 -]+$/, 'Letters, digits, spaces and dashes only.'),
});

type Files = Partial<Record<ImageSide, UploadedImage[]>>;

/** The player's own ID check. */
@Controller('me/verification')
@UseGuards(SignedInGuard)
export class VerificationController {
  constructor(@Inject(KycService) private readonly kyc: KycService) {}

  @Get()
  status(@CurrentUser() userId: string) {
    return this.kyc.status(userId);
  }

  /** multipart/form-data: the fields of submissionBody plus front + back, or single. */
  @Post('documents')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'front', maxCount: 1 },
        { name: 'back', maxCount: 1 },
        { name: 'single', maxCount: 1 },
      ],
      { limits: { fileSize: MAX_IMAGE_BYTES, files: 3, fields: 8, fieldSize: 1024, parts: 12 } },
    ),
  )
  submit(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(submissionBody)) body: z.infer<typeof submissionBody>,
    @UploadedFiles() files: Files | undefined,
  ) {
    const one = (side: ImageSide) => files?.[side]?.[0];
    return this.kyc.submit(userId, body, {
      ...(one('front') ? { front: one('front') } : {}),
      ...(one('back') ? { back: one('back') } : {}),
      ...(one('single') ? { single: one('single') } : {}),
    });
  }
}

const digest = (value: string) => createHash('sha256').update(value).digest();

/** Lets a request through with the reviewer token; the routes do not exist without one set. */
@Injectable()
export class ReviewerGuard implements CanActivate {
  constructor(@Inject(KYC_SETTINGS) private readonly settings: KycSettings) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.settings.reviewerToken;
    if (!expected) throw new NotFoundException();
    const given = context.switchToHttp().getRequest<AuthedRequest>().headers['x-reviewer-token'];
    if (typeof given !== 'string' || !timingSafeEqual(digest(given), digest(expected))) {
      throw new UnauthorizedException({
        error: 'bad_reviewer_token',
        message: 'Wrong reviewer token.',
      });
    }
    return true;
  }
}

const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const idParam = z.string().uuid();
const sideParam = z.enum(['front', 'back', 'single']);
const reviewer = z.string().trim().min(1).max(60);
const approveBody = z.object({
  reviewer,
  birthDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  documentNumber: z.string().trim().min(6).max(40).optional(),
});
const rejectBody = z.object({ reviewer, reason: z.string().trim().min(3).max(300) });

/** Manual review of ID submissions, for the review page at /review. */
@Controller('review/verifications')
@UseGuards(ReviewerGuard)
export class ReviewController {
  constructor(@Inject(KycService) private readonly kyc: KycService) {}

  @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.kyc.list(q.status, q.limit);
  }

  @Get(':id')
  get(@Param('id', new ZodPipe(idParam)) id: string) {
    return this.kyc.get(id);
  }

  @Get(':id/images/:side')
  async image(
    @Param('id', new ZodPipe(idParam)) id: string,
    @Param('side', new ZodPipe(sideParam)) side: ImageSide,
    @Res()
    res: {
      set(headers: Record<string, string>): void;
      send(body: Buffer): void;
    },
  ) {
    const { data, contentType } = await this.kyc.image(id, side);
    res.set({
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': 'inline',
    });
    res.send(data);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Param('id', new ZodPipe(idParam)) id: string,
    @Body(new ZodPipe(approveBody)) body: z.infer<typeof approveBody>,
  ) {
    return this.kyc.approve(id, body);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id', new ZodPipe(idParam)) id: string,
    @Body(new ZodPipe(rejectBody)) body: z.infer<typeof rejectBody>,
  ) {
    return this.kyc.reject(id, body);
  }
}
