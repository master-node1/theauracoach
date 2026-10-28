import { z } from 'zod';

/**
 * Email sign-up, verification and password reset (auth LLD §2, TAC-8). The web BFF validates
 * request bodies with these schemas; the mobile app runs the same checks before calling the
 * identity provider, so both apps accept and reject the same input.
 */

/** Mirrors the Cognito user pool password policy (security architecture §2). */
export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 256,
  requireLowercase: true,
  requireUppercase: true,
  requireNumber: true,
} as const;

/** Sign-up and reset codes: six digits, valid for 15 minutes, single use. */
export const AUTH_CODE_TTL_SECONDS = 15 * 60;

/** Emails are compared and stored trimmed and lower-cased, so `Priya@X.com ` is `priya@x.com`. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** What is wrong with a password, as short phrases for one sentence ("Use at least …"). */
export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_POLICY.minLength) {
    problems.push(`${PASSWORD_POLICY.minLength} characters`);
  }
  if (!/[a-z]/.test(password)) problems.push('a lower-case letter');
  if (!/[A-Z]/.test(password)) problems.push('an upper-case letter');
  if (!/[0-9]/.test(password)) problems.push('a number');
  return problems;
}

/** One sentence for the password field, or null when the password meets the policy. */
export function passwordHint(password: string): string | null {
  if (password.length > PASSWORD_POLICY.maxLength) return 'That password is too long.';
  const problems = passwordProblems(password);
  if (problems.length === 0) return null;
  const list =
    problems.length === 1
      ? problems[0]
      : `${problems.slice(0, -1).join(', ')} and ${problems[problems.length - 1]}`;
  return `Use at least ${list}.`;
}

export const emailSchema = z
  .string()
  .max(254)
  .transform(normaliseEmail)
  .pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .max(PASSWORD_POLICY.maxLength)
  .refine((p) => passwordProblems(p).length === 0, 'Password does not meet the policy');

export const authCodeSchema = z
  .string()
  .transform((c) => c.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'));

export const signUpSchema = z.object({ email: emailSchema, password: passwordSchema });
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(PASSWORD_POLICY.maxLength),
  returnTo: z.string().max(2048).optional(),
});
export const confirmSignUpSchema = z.object({ email: emailSchema, code: authCodeSchema });
export const emailOnlySchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z.object({
  email: emailSchema,
  code: authCodeSchema,
  password: passwordSchema,
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type ConfirmSignUpInput = z.infer<typeof confirmSignUpSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Error codes the auth flows return (as the problem `code` from the BFF, or `IdentityError.code`
 * on mobile). Named after the Cognito exceptions without the `Exception` suffix.
 */
export const IDENTITY_ERROR_CODES = [
  'UsernameExists',
  'CodeMismatch',
  'ExpiredCode',
  'LimitExceeded',
  'TooManyRequests',
  'InvalidPassword',
  'NotAuthorized',
  'UserNotConfirmed',
  'InvalidParameter',
  'ChallengeRequired',
  'Unavailable',
] as const;
export type IdentityErrorCode = (typeof IDENTITY_ERROR_CODES)[number];

export function isIdentityErrorCode(value: unknown): value is IdentityErrorCode {
  return typeof value === 'string' && (IDENTITY_ERROR_CODES as readonly string[]).includes(value);
}
