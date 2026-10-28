// Cognito pre-token-generation trigger (event version V2_0).
// Adds the user's email to the access token: profile-service refuses to create
// an account without it (docs/modules/authentication/LLD.md). Permissions stay
// derived from the cognito:groups claim by each service, so groups are not
// copied here.
export const handler = async (event) => {
  const attributes = event.request?.userAttributes ?? {};
  if (attributes.email) {
    event.response = {
      claimsAndScopeOverrideDetails: {
        accessTokenGeneration: {
          claimsToAddOrOverride: {
            email: attributes.email,
            email_verified: attributes.email_verified === 'true',
          },
        },
      },
    };
  }
  return event;
};
