import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { FixturesService } from './fixtures.service';

const listQuery = z.object({
  gameweek: z.coerce.number().int().positive().optional(),
  status: z.enum(['scheduled', 'live', 'finished']).optional(),
});

@Controller()
export class FixturesController {
  constructor(@Inject(FixturesService) private readonly fixtures: FixturesService) {}

  @Get('season')
  season() {
    return this.fixtures.getSeason();
  }

  @Get('fixtures')
  list(@Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.fixtures.list(query);
  }

  @Get('fixtures/:id')
  get(@Param('id') id: string) {
    return this.fixtures.get(id);
  }

  @Get('fixtures/:id/points')
  points(@Param('id') id: string) {
    return this.fixtures.points(id);
  }
}
