# ADR-006: Amazon Cognito for identity; API validates JWTs

Status: Proposed · 2026-10-11

## Context
Need email/password, Google, Apple (required on iOS when other social logins exist), password recovery, MFA for admins, secure token handling on web and mobile.

## Options Considered
Self-built auth module (argon2id, refresh rotation); Cognito; Auth0/Clerk; Firebase Auth.

## Decision
Cognito user pool in `ap-south-1` with Google and Apple IdPs. Authorization Code + PKCE on mobile (`expo-auth-session`, tokens in `expo-secure-store`) and on web through a Next.js BFF that stores tokens in HttpOnly cookies. API validates access tokens against JWKS (`aws-jwt-verify`), provisions `User` on first call. Admin roles require TOTP MFA (Cognito group + app check).

## Consequences
+ No password storage in our DB; managed brute-force protection; in-region.
− Cognito hosted UI customisation is limited; we use our own screens with the SRP/OAuth flows.
− Vendor coupling; mitigated because the API only depends on standard OIDC claims (`sub`, `email`, `cognito:groups` mapped to our own roles table).

## Alternatives Rejected
Self-built (security burden); Auth0/Clerk (cost at scale, data outside India).
