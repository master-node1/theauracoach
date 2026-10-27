import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../auth/decorators';
import type { SqlExecutor } from '../events/sql';
import { subscribe, type Subscription } from '../events/stream-consumer';
import { ProblemException } from '../http/problem';

/**
 * While an account waits out its deletion grace period, the user's requests are refused with
 * 423 ACCOUNT_PENDING_DELETION (auth LLD §error codes). Every service except profile-service keeps
 * a replica of that state in its `AccountState` table, fed by AccountDeletionRequested and
 * AccountRestored, so it never has to ask profile-service.
 */

export const ACCOUNT_STATE_DB = Symbol('ACCOUNT_STATE_DB');
export const ALLOW_PENDING_DELETION = 'aura:allow-pending-deletion';

/** Route stays usable while the account is pending deletion (status, restore, export). */
export const AllowPendingDeletion = () => SetMetadata(ALLOW_PENDING_DELETION, true);

export function pendingDeletionProblem(): ProblemException {
  return new ProblemException(
    HttpStatus.LOCKED,
    'ACCOUNT_PENDING_DELETION',
    'This account is scheduled for deletion',
    'Restore the account to use it again.',
  );
}

/** True when the replica says the user's account is pending deletion. */
export async function isPendingDeletion(db: SqlExecutor, userId: string): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ pendingDeletion: boolean }[]>(
    `SELECT "pendingDeletion" FROM "AccountState" WHERE "userId" = $1::uuid`,
    userId,
  );
  return rows[0]?.pendingDeletion === true;
}

/**
 * Runs after the auth guard (interceptors always run after guards), so `request.user` is set on
 * user routes. Internal and public routes have no user and pass through.
 */
@Injectable()
export class AccountStateInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Optional() @Inject(ACCOUNT_STATE_DB) private readonly db?: SqlExecutor,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http' || !this.db) return next.handle();
    const user = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (!user) return next.handle();
    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_DELETION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowed && (await isPendingDeletion(this.db, user.userId))) {
      throw pendingDeletionProblem();
    }
    return next.handle();
  }
}

/**
 * Keeps the replica. Streams are not ordered with each other, so a row only changes when the event
 * is newer than the one that last set it (a restore must not be undone by a late request).
 */
async function setAccountState(
  tx: SqlExecutor,
  userId: string,
  pendingDeletion: boolean,
  deletionDueAt: string | null,
  eventAt: string,
): Promise<boolean> {
  const changed = await tx.$executeRawUnsafe(
    `INSERT INTO "AccountState" ("userId", "pendingDeletion", "deletionDueAt", "eventAt")
     VALUES ($1::uuid, $2, $3::timestamp(3), $4::timestamp(3))
     ON CONFLICT ("userId") DO UPDATE
       SET "pendingDeletion" = EXCLUDED."pendingDeletion",
           "deletionDueAt" = EXCLUDED."deletionDueAt",
           "eventAt" = EXCLUDED."eventAt"
       WHERE "AccountState"."eventAt" < EXCLUDED."eventAt"`,
    userId,
    pendingDeletion,
    deletionDueAt,
    eventAt,
  );
  return changed > 0;
}

/** Subscriptions every participant service adds to its worker to keep `AccountState`. */
export function accountStateSubscriptions<Tx extends SqlExecutor = SqlExecutor>(
  hooks: {
    /** Extra work in the same transaction when the state changes, e.g. pausing notifications. */
    onPending?: (tx: Tx, userId: string, at: Date) => Promise<void>;
    onRestored?: (tx: Tx, userId: string, at: Date) => Promise<void>;
  } = {},
): Subscription[] {
  return [
    subscribe<'AccountDeletionRequested@1', Tx>('AccountDeletionRequested@1', async (event, tx) => {
      const { userId, deletionDueAt } = event.data;
      if (await setAccountState(tx, userId, true, deletionDueAt, event.occurredAt)) {
        await hooks.onPending?.(tx, userId, new Date(event.occurredAt));
      }
    }),
    subscribe<'AccountRestored@1', Tx>('AccountRestored@1', async (event, tx) => {
      const { userId } = event.data;
      if (await setAccountState(tx, userId, false, null, event.occurredAt)) {
        await hooks.onRestored?.(tx, userId, new Date(event.occurredAt));
      }
    }),
  ] as Subscription[];
}
