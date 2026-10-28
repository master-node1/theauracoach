import { Controller, Get } from '@nestjs/common';
import type { MeResponse } from '@aura/contracts';
import { CurrentUser, type AuthenticatedUser } from '@aura/service-kit';
import { toMe } from '../profile/mappers';
import { UserProvisioningService } from './user-provisioning.service';

@Controller('v1/me')
export class MeController {
  constructor(private readonly provisioning: UserProvisioningService) {}

  @Get()
  async me(@CurrentUser() identity: AuthenticatedUser): Promise<MeResponse> {
    const user = await this.provisioning.activeUser(identity);
    await this.provisioning.touchActivity(user);
    return toMe(user);
  }
}
