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

export class CognitoIdentityGroups implements IdentityGroups {
  private readonly client: CognitoIdentityProviderClient;
  private readonly poolId: string;

  constructor(config: ServiceConfig) {
    const local = config.NODE_ENV !== 'production';
    this.poolId = config.COGNITO_USER_POOL_ID ?? 'local';
    this.client = new CognitoIdentityProviderClient({
      region: config.AWS_REGION,
      endpoint: config.IDENTITY_ENDPOINT ?? DEV_IDENTITY_ENDPOINT,
      maxAttempts: 3,
      // dev-auth does not check signatures; deployed pods use their IAM role (default chain).
      ...(local && !config.COGNITO_USER_POOL_ID
        ? { credentials: { accessKeyId: 'local', secretAccessKey: 'local' } }
        : {}),
    });
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
