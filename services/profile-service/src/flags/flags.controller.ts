import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Put,
} from '@nestjs/common';
import {
  FEATURE_FLAGS,
  flagRuleUpdateSchema,
  isFlagKey,
  permissionsFor,
  type FlagDocument,
  type FlagKey,
  type FlagRule,
  type FlagsResponse,
} from '@aura/contracts';
import {
  CurrentUser,
  FeatureFlags,
  FlagsReadOnlyError,
  ProblemException,
  ZodValidationPipe,
  type AuthenticatedUser,
} from '@aura/service-kit';

export interface AdminFlagsResponse {
  /** Whether this environment accepts changes here (local and dev flag files only). */
  writable: boolean;
  catalogue: typeof FEATURE_FLAGS;
  document: FlagDocument;
}

/** Feature flags for the apps (`/v1/me/flags`) and for admins (`/v1/admin/flags`). */
@Controller('v1')
export class FlagsController {
  private readonly logger = new Logger('Flags');

  constructor(private readonly flags: FeatureFlags) {}

  /** The caller's evaluated flags. Web and mobile read every flag from here. */
  @Get('me/flags')
  mine(@CurrentUser() identity: AuthenticatedUser): FlagsResponse {
    return { flags: this.flags.evaluate(identity.userId) };
  }

  @Get('admin/flags')
  list(@CurrentUser() identity: AuthenticatedUser): AdminFlagsResponse {
    requireFlagAdmin(identity);
    return {
      writable: this.flags.writable,
      catalogue: FEATURE_FLAGS,
      document: this.flags.document(),
    };
  }

  /**
   * Sets one flag's rule. Only the local and dev flag files are writable; in AWS the flag document
   * is an AppConfig deployment (Terraform or the console), so this answers 409 FLAGS_READ_ONLY.
   */
  @Put('admin/flags/:key')
  async put(
    @CurrentUser() identity: AuthenticatedUser,
    @Param('key') key: string,
    @Body(new ZodValidationPipe(flagRuleUpdateSchema)) rule: FlagRule,
  ): Promise<FlagRule> {
    requireFlagAdmin(identity);
    await this.write(identity, flagKey(key), rule);
    return rule;
  }

  /** Removes a flag's rule, so the default applies again. */
  @Delete('admin/flags/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() identity: AuthenticatedUser, @Param('key') key: string) {
    requireFlagAdmin(identity);
    await this.write(identity, flagKey(key), null);
  }

  private async write(identity: AuthenticatedUser, key: FlagKey, rule: FlagRule | null) {
    try {
      await this.flags.setRule(key, rule);
    } catch (err) {
      if (err instanceof FlagsReadOnlyError) {
        throw new ProblemException(
          HttpStatus.CONFLICT,
          'FLAGS_READ_ONLY',
          'Flags are managed in AWS AppConfig in this environment',
        );
      }
      throw err;
    }
    // Flag changes join the audit trail with the admin audit work (TAC-32); until then, the log.
    this.logger.log({ actor: identity.userId, flag: key, removed: rule === null }, 'Flag changed');
  }
}

function requireFlagAdmin(identity: AuthenticatedUser): void {
  if (!permissionsFor(identity.groups).has('flag:write')) {
    throw new ProblemException(HttpStatus.FORBIDDEN, 'FORBIDDEN', 'Not allowed');
  }
}

function flagKey(key: string): FlagKey {
  if (!isFlagKey(key))
    throw new ProblemException(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'No such flag');
  return key;
}
