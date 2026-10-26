import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ACCOUNT_FIELDS,
  PROFILE_SHARED_FIELDS,
  type ProfileChangedV1,
  type ProfileResponse,
  type ProfileSharedField,
  type ProfileUpdate,
} from '@aura/contracts';
import { ProblemException, writeOutbox, type AuthenticatedUser } from '@aura/service-kit';
import { Prisma } from '../generated/prisma';
import { UserProvisioningService } from '../identity/user-provisioning.service';
import { PrismaService } from '../prisma.service';
import { toProfile } from './mappers';

type AccountField = (typeof ACCOUNT_FIELDS)[number];
type ProfileField = Exclude<keyof ProfileUpdate, AccountField>;

const isAccountField = (field: string): field is AccountField =>
  (ACCOUNT_FIELDS as readonly string[]).includes(field);
const isSharedField = (field: string): field is ProfileSharedField =>
  (PROFILE_SHARED_FIELDS as readonly string[]).includes(field);

/** Column name when it differs from the API field name. */
const COLUMN: Partial<Record<ProfileField, string>> = { equipment: 'equipmentCodes' };

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Prisma.Decimal) return a.equals(b as number);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * `PATCH /v1/me/profile` (users LLD §2). Account fields (name, time zone, locale) can change at any
 * time; profile fields need the profile onboarding creates. Changes other services keep a copy of
 * are published as one ProfileChanged in the same transaction; unchanged values publish nothing.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provisioning: UserProvisioningService,
  ) {}

  async update(
    identity: AuthenticatedUser,
    update: ProfileUpdate,
  ): Promise<{ profile: ProfileResponse | null }> {
    const user = await this.provisioning.activeUser(identity);
    const account: Partial<Record<AccountField, string>> = {};
    const profile: Partial<ProfileUpdate> = {};
    for (const [field, value] of Object.entries(update)) {
      if (isAccountField(field)) account[field] = value as string;
      else (profile as Record<string, unknown>)[field] = value;
    }
    if (Object.keys(profile).length > 0 && !user.profile) {
      throw new ProblemException(
        HttpStatus.CONFLICT,
        'PROFILE_NOT_CREATED',
        'Complete onboarding before changing profile details',
      );
    }

    const changed: ProfileSharedField[] = [];
    const changes: ProfileChangedV1['changes'] = {};
    for (const [field, value] of Object.entries(account)) {
      if (!sameValue(user[field as AccountField], value) && isSharedField(field)) {
        changed.push(field);
        (changes as Record<string, unknown>)[field] = value;
      }
    }
    const profileData: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(profile)) {
      const column = COLUMN[field as ProfileField] ?? field;
      if (sameValue((user.profile as Record<string, unknown> | null)?.[column], value)) continue;
      profileData[column] = value;
      if (isSharedField(field)) {
        changed.push(field);
        (changes as Record<string, unknown>)[field] = value;
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (Object.keys(account).length > 0) {
        await tx.user.update({ where: { id: user.id }, data: account });
      }
      const saved =
        Object.keys(profileData).length > 0
          ? await tx.profile.update({ where: { userId: user.id }, data: profileData })
          : user.profile;
      if (changed.length > 0) {
        await writeOutbox(tx, {
          producer: 'profile-service',
          key: 'ProfileChanged@1',
          userId: user.id,
          data: { userId: user.id, fields: changed, changes },
        });
      }
      return { profile: saved ? toProfile(saved) : null };
    });
  }
}
