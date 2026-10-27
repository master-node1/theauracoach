import { Body, Controller, Get, Patch } from '@nestjs/common';
import {
  preferencesUpdateSchema,
  profileUpdateSchema,
  type PreferencesResponse,
  type PreferencesUpdate,
  type ProfileUpdate,
  type ProfileUpdateResponse,
} from '@aura/contracts';
import { CurrentUser, ZodValidationPipe, type AuthenticatedUser } from '@aura/service-kit';
import { UserProvisioningService } from '../identity/user-provisioning.service';
import { PrismaService } from '../prisma.service';
import { toPreferences } from './mappers';
import { ProfileService } from './profile.service';

@Controller('v1/me')
export class ProfileController {
  constructor(
    private readonly profiles: ProfileService,
    private readonly provisioning: UserProvisioningService,
    private readonly prisma: PrismaService,
  ) {}

  @Patch('profile')
  async updateProfile(
    @CurrentUser() identity: AuthenticatedUser,
    @Body(new ZodValidationPipe(profileUpdateSchema)) body: ProfileUpdate,
  ): Promise<ProfileUpdateResponse> {
    const { profile } = await this.profiles.update(identity, body);
    return { profile, proposals: [] };
  }

  @Get('preferences')
  async preferences(@CurrentUser() identity: AuthenticatedUser): Promise<PreferencesResponse> {
    return toPreferences((await this.provisioning.activeUser(identity)).preference);
  }

  @Patch('preferences')
  async updatePreferences(
    @CurrentUser() identity: AuthenticatedUser,
    @Body(new ZodValidationPipe(preferencesUpdateSchema)) body: PreferencesUpdate,
  ): Promise<PreferencesResponse> {
    const user = await this.provisioning.activeUser(identity);
    const saved = await this.prisma.userPreference.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...body },
      update: body,
    });
    return toPreferences(saved);
  }
}
