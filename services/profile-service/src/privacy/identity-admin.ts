import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { ServiceConfig } from '../config';

/** Removes a person's sign-in identity once their data is gone (users LLD §4). */
export interface IdentityAdmin {
  /** Deletes the identity whose subject is `userId`. Deleting one that is already gone succeeds. */
  deleteUser(userId: string): Promise<void>;
}

export const IDENTITY_ADMIN = Symbol('IDENTITY_ADMIN');

/**
 * Cognito: find the user by `sub` (federated users have a username like `google_123`, not the
 * sub), then AdminDeleteUser. Needs cognito-idp:ListUsers and AdminDeleteUser on the pool.
 */
export class CognitoIdentityAdmin implements IdentityAdmin {
  constructor(
    private readonly client: CognitoIdentityProviderClient,
    private readonly userPoolId: string,
  ) {}

  async deleteUser(userId: string): Promise<void> {
    if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('Not a user id');
    const found = await this.client.send(
      new ListUsersCommand({ UserPoolId: this.userPoolId, Filter: `sub = "${userId}"`, Limit: 1 }),
    );
    const username = found.Users?.[0]?.Username;
    if (!username) return;
    try {
      await this.client.send(
        new AdminDeleteUserCommand({ UserPoolId: this.userPoolId, Username: username }),
      );
    } catch (err) {
      if ((err as { name?: string }).name !== 'UserNotFoundException') throw err;
    }
  }
}

/** Local stand-in: tools/dev-auth `POST /admin/delete-user`. */
export class DevAuthIdentityAdmin implements IdentityAdmin {
  constructor(
    private readonly baseUrl: string,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  async deleteUser(userId: string): Promise<void> {
    const res = await this.doFetch(`${this.baseUrl.replace(/\/$/, '')}/admin/delete-user`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sub: userId }),
    });
    if (!res.ok) throw new Error(`dev-auth delete-user returned ${res.status}`);
  }
}

/** Unit and integration tests that do not run an identity provider. */
export class NoIdentityAdmin implements IdentityAdmin {
  readonly deleted: string[] = [];

  deleteUser(userId: string): Promise<void> {
    this.deleted.push(userId);
    return Promise.resolve();
  }
}

export function createIdentityAdmin(config: ServiceConfig): IdentityAdmin {
  switch (config.IDENTITY_ADMIN) {
    case 'cognito':
      return new CognitoIdentityAdmin(
        new CognitoIdentityProviderClient({ region: config.AWS_REGION }),
        config.COGNITO_USER_POOL_ID as string,
      );
    case 'dev-auth':
      return new DevAuthIdentityAdmin(config.DEV_AUTH_URL);
    case 'none':
      return new NoIdentityAdmin();
  }
}
