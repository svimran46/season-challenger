import { Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { CurrentUser, SignedInGuard, OptionalUser } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { ContestsService } from './contests.service';

const listQuery = z.object({ fixtureId: z.string().min(1) });
const privateBody = z.object({
  fixtureId: z.string().min(1),
  name: z.string().trim().min(3).max(40),
  entryFee: z.number().int().min(1).max(10_000),
  capacity: z.number().int().min(2).max(50),
});
const entryBody = z.object({
  playerIds: z.array(z.string().min(1)).max(30),
  captainId: z.string().min(1),
  viceCaptainId: z.string().min(1),
});

@Controller('contests')
export class ContestsController {
  constructor(@Inject(ContestsService) private readonly contests: ContestsService) {}

  @Get()
  list(@Query(new ZodPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.contests.listForFixture(q.fixtureId);
  }

  @Get('invite/:code')
  byInvite(@Param('code') code: string) {
    return this.contests.byInviteCode(code);
  }

  @Get(':id')
  get(@Param('id') id: string, @OptionalUser() userId?: string) {
    return this.contests.get(id, userId);
  }

  @Post()
  @UseGuards(SignedInGuard)
  createPrivate(
    @CurrentUser() userId: string,
    @Body(new ZodPipe(privateBody)) body: z.infer<typeof privateBody>,
  ) {
    return this.contests.createPrivate(userId, body);
  }

  @Post(':id/entries')
  @UseGuards(SignedInGuard)
  join(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodPipe(entryBody)) body: z.infer<typeof entryBody>,
  ) {
    return this.contests.join(userId, id, body);
  }
}
