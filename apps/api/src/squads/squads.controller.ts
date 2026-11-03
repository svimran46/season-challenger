import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import { validateSquad, type SquadError } from '@season/shared';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { FixturesService } from '../fixtures/fixtures.service';

const squadBody = z.object({
  fixtureId: z.string().min(1),
  playerIds: z.array(z.string().min(1)).max(30),
  captainId: z.string().min(1),
  viceCaptainId: z.string().min(1),
});

@Controller('squads')
export class SquadsController {
  constructor(@Inject(FixturesService) private readonly fixtures: FixturesService) {}

  /**
   * Checks a squad without saving it. The app calls this before submit; saving squads arrives
   * with the database in Phase 3 and will run the same check server-side.
   */
  @Post('validate')
  @HttpCode(200)
  async validate(@Body(new ZodPipe(squadBody)) body: z.infer<typeof squadBody>) {
    const fixture = await this.fixtures.get(body.fixtureId);
    const result = validateSquad(body, fixture.players);
    if (fixture.status !== 'scheduled') {
      const locked: SquadError = {
        code: 'fixture_locked',
        message: 'This fixture has kicked off, so squads are locked.',
      };
      return { ...result, valid: false, errors: [locked, ...result.errors] };
    }
    return result;
  }
}
