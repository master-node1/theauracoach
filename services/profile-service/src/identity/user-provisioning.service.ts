import { HttpStatus, Injectable } from '@nestjs/common';
import { ProblemException, writeOutbox, type AuthenticatedUser } from '@aura/service-kit';
import { Prisma, type Profile, type User, type UserPreference } from '../generated/prisma';
import { PrismaService } from '../prisma.service';

export type UserWithAccess = User & {
  roles: { roleId: string }[];
  onboarding: { status: string } | null;
  profile: Profile | null;
  preference: UserPreference | null;
};

const include = {
  roles: { select: { roleId: true } },
  onboarding: { select: { status: true } },
  profile: true,
  preference: true,
} as const;

/**
 * Creates the AuraCoach user the first time a Cognito identity calls the API (auth LLD §1),
 * and publishes UserRegistered in the same transaction.
 */
@Injectable()
export class UserProvisioningService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's account, created on first use. Deleted accounts get 403 on every route. */
  async activeUser(identity: AuthenticatedUser): Promise<UserWithAccess> {
    const user = await this.ensureUser(identity);
    if (user.status === 'DELETED') {
      throw new ProblemException(
        HttpStatus.FORBIDDEN,
        'ACCOUNT_DELETED',
        'This account has been deleted',
      );
    }
    return user;
  }

  /**
   * Records that the user opened the app, at most once an hour, for the admin console's daily
   * active users. The apps call /v1/me on start, so this is the activity signal.
   */
  async touchActivity(user: Pick<User, 'id' | 'lastActiveAt'>, now = new Date()): Promise<void> {
    const hourAgo = new Date(now.getTime() - 3_600_000);
    if (user.lastActiveAt && user.lastActiveAt > hourAgo) return;
    await this.prisma.user.updateMany({
      where: { id: user.id, OR: [{ lastActiveAt: null }, { lastActiveAt: { lt: hourAgo } }] },
      data: { lastActiveAt: now },
    });
  }

  async ensureUser(identity: AuthenticatedUser): Promise<UserWithAccess> {
    const existing = await this.prisma.user.findUnique({ where: { id: identity.userId }, include });
    if (existing) return existing;
    if (!identity.email) {
      // Cognito's pre-token-generation trigger adds `email` to access tokens. Without it we cannot create the account.
      throw new ProblemException(
        HttpStatus.FORBIDDEN,
        'EMAIL_CLAIM_MISSING',
        'Sign-in token has no email',
      );
    }
    const email = identity.email;
    try {
      return await this.prisma.$transaction(async (tx) => {
        // User.id is the Cognito sub; cognitoSub is kept separately in case the identity provider ever changes.
        const user = await tx.user.create({
          data: { id: identity.userId, cognitoSub: identity.userId, email },
          include,
        });
        await writeOutbox(tx, {
          producer: 'profile-service',
          key: 'UserRegistered@1',
          userId: user.id,
          data: { userId: user.id, timezone: user.timezone, locale: user.locale },
        });
        return user;
      });
    } catch (err) {
      // Two first requests raced: the other one created the user.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const user = await this.prisma.user.findUnique({ where: { id: identity.userId }, include });
        if (user) return user;
      }
      throw err;
    }
  }
}
