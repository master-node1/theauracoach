/**
 * The identity provider calls profile-service makes (auth LLD §2). Cognito and dev-auth speak the
 * same `cognito-idp` JSON API, so one implementation serves both and the endpoint is config.
 * Admin calls that need AWS credentials (TAC-7's account deletion) extend this port.
 */
export interface IdentityProvider {
  /** Invalidates every refresh token of the user who owns `accessToken`. */
  globalSignOut(accessToken: string): Promise<void>;
}

export const IDENTITY_PROVIDER = Symbol('IDENTITY_PROVIDER');

export class IdentityProviderError extends Error {
  constructor(readonly type: string) {
    super(`Identity provider returned ${type}`);
    this.name = 'IdentityProviderError';
  }
}

export class CognitoIdentityProvider implements IdentityProvider {
  constructor(
    private readonly endpoint: string,
    private readonly doFetch: typeof fetch = fetch,
  ) {}

  async globalSignOut(accessToken: string): Promise<void> {
    const res = await this.doFetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': 'AWSCognitoIdentityProviderService.GlobalSignOut',
      },
      body: JSON.stringify({ AccessToken: accessToken }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { __type?: string };
      const type = body.__type ?? res.headers.get('x-amzn-errortype') ?? String(res.status);
      throw new IdentityProviderError(type.slice(type.lastIndexOf('#') + 1));
    }
  }
}
