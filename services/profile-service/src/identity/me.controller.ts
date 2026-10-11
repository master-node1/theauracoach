import { Controller, Get, HttpStatus } from '@nestjs/common';
import { CurrentUser, ProblemException, type AuthenticatedUser } from '@aura/service-kit';
import { UserProvisioningService, type UserWithAccess } from './user-provisioning.service';

/** `Me` in docs/api/openapi.yaml. The profile section is added with the onboarding slice. */
export interface MeResponse {
  id: string;
  email: string;
  displayName: string | null;
  timezone: string;
  locale: string;
  onboardingComplete: boolean;
  status: 'ACTIVE' | 'PENDING_DELETION';
  roles: string[];
}

@Controller('v1/me')
export class MeController {
  constructor(private readonly provisioning: UserProvisioningService) {}

  @Get()
  async me(@CurrentUser() identity: AuthenticatedUser): Promise<MeResponse> {
    const user = await this.provisioning.ensureUser(identity);
    if (user.status === 'DELETED') {
      throw new ProblemException(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_DELETED',
        'This account has been deleted',
      );
    }
    return toMe(user);
  }
}

export function toMe(user: UserWithAccess): MeResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    timezone: user.timezone,
    locale: user.locale,
    onboardingComplete: user.onboarding?.status === 'READY',
    status: user.status === 'PENDING_DELETION' ? 'PENDING_DELETION' : 'ACTIVE',
    roles: ['user', ...user.roles.map((r) => r.roleId).filter((r) => r !== 'user')],
  };
}
