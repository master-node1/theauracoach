import { Controller, Get, HttpStatus, Param, ParseUUIDPipe } from '@nestjs/common';
import type { UserContextResponse } from '@aura/contracts';
import { InternalOnly, ProblemException } from '@aura/service-kit';
import { toPreferences } from '../profile/mappers';
import { PrismaService } from '../prisma.service';
import { ageBand } from './age-band';

/** What coach-service may know about a user. No name, email or date of birth (ai-coach LLD §5). */
@Controller('internal/v1/users')
export class UserContextController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/context')
  @InternalOnly('coach-service')
  async context(@Param('id', new ParseUUIDPipe()) id: string): Promise<UserContextResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { profile: true, preference: true },
    });
    if (!user || user.status === 'DELETED') {
      throw new ProblemException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'User not found');
    }
    return {
      userId: user.id,
      ageBand: user.profile ? ageBand(user.profile.dateOfBirth) : null,
      unitSystem: user.profile?.unitSystem ?? 'METRIC',
      timezone: user.timezone,
      locale: user.locale,
      coachTone: toPreferences(user.preference).coachTone,
    };
  }
}
