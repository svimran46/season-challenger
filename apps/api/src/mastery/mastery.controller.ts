import { Body, Controller, Get, Inject, Param, Put, Query, UseGuards } from '@nestjs/common';
import type { Answer } from '@season/shared';
import { z } from 'zod';
import { CurrentUser, OptionalUser, SignedInGuard } from '../common/auth';
import { ZodPipe } from '../common/zod.pipe';
import { MasteryService } from './mastery.service';

const cardQuery = z.object({ fixtureId: z.string().min(1) });
const answer = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('outcome'),
    pick: z.enum(['home', 'draw', 'away']),
    confidence: z.number(),
  }),
  z.object({ kind: z.literal('halfTimeLeader'), pick: z.enum(['home', 'draw', 'away']) }),
  z.object({ kind: z.literal('range'), min: z.number(), max: z.number() }),
  z.object({ kind: z.literal('comparison'), pick: z.enum(['home', 'away']) }),
  z.object({ kind: z.literal('playerDuel'), pick: z.enum(['a', 'b']) }),
  z.object({ kind: z.literal('topPlayer'), playerId: z.string().min(1) }),
]);
const answersBody = z.object({
  answers: z.array(z.object({ questionId: z.string().uuid(), answer })).max(8),
});

@Controller()
export class MasteryController {
  constructor(@Inject(MasteryService) private readonly mastery: MasteryService) {}

  @Get('mastery/cards')
  card(
    @Query(new ZodPipe(cardQuery)) q: z.infer<typeof cardQuery>,
    @OptionalUser() userId?: string,
  ) {
    return this.mastery.cardForFixture(q.fixtureId, userId);
  }

  /** Answers the whole card at once. It can be changed until kick-off. */
  @Put('mastery/cards/:id/answers')
  @UseGuards(SignedInGuard)
  submit(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body(new ZodPipe(answersBody)) body: z.infer<typeof answersBody>,
  ) {
    return this.mastery.submit(
      userId,
      id,
      body.answers as { questionId: string; answer: Answer }[],
    );
  }

  @Get('mastery/leaderboard')
  leaderboard(@OptionalUser() userId?: string) {
    return this.mastery.leaderboard(userId);
  }

  @Get('me/mastery')
  @UseGuards(SignedInGuard)
  mine(@CurrentUser() userId: string) {
    return this.mastery.mine(userId);
  }
}
