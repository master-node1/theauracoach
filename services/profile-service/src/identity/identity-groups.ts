import {
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { DEV_IDENTITY_ENDPOINT, type ServiceConfig } from '../config';

/**
 * Mirrors role grants to identity-provider groups, which become the `cognito:groups` claim every
 * service reads (auth LLD §4). Cognito and dev-auth speak the same API, so one adapter serves both.
 */
export interface IdentityGroups {
  addUserToGroup(userId: string, group: string): Promise<void>;
  removeUserFromGroup(userId: string, group: string): Promise<void>;
}

export const IDENTITY_GROUPS = Symbol('IDENTITY_GROUPS');

/** The cognito-idp admin client for Cognito, or for dev-auth locally (same API). */
export function identityProviderClient(config: ServiceConfig): CognitoIdentityProviderClient {
  const local = config.NODE_ENV !== 'production';
  return new CognitoIdentityProviderClient({
    region: config.AWS_REGION,
    endpoint: config.IDENTITY_ENDPOINT ?? DEV_IDENTITY_ENDPOINT,
    maxAttempts: 3,
    // dev-auth does not check signatures; deployed pods use their IAM role (default chain).
    ...(local && !config.COGNITO_USER_POOL_ID
      ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
      : {}),
  });
}

/** dev-auth has one pool and ignores the id. */
export function userPoolId(config: ServiceConfig): string {
  return config.COGNITO_USER_POOL_ID ?? 'local';
}

export class CognitoIdentityGroups implements IdentityGroups {
  private readonly client: CognitoIdentityProviderClient;
  private readonly poolId: string;

  constructor(config: ServiceConfig) {
    this.poolId = userPoolId(config);
    this.client = identityProviderClient(config);
  }

  async addUserToGroup(userId: string, group: string): Promise<void> {
    // Our user id is the Cognito sub, which Cognito accepts as the username.
    await this.client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: this.poolId,
        Username: userId,
        GroupName: group,
      }),
    );
  }

  async removeUserFromGroup(userId: string, group: string): Promise<void> {
    await this.client.send(
      new AdminRemoveUserFromGroupCommand({
        UserPoolId: this.poolId,
        Username: userId,
        GroupName: group,
      }),
    );
  }
}
