'use client';

import {
  AUTH_CODE_TTL_SECONDS,
  PASSWORD_POLICY,
  isIdentityErrorCode,
  passwordIssues,
} from '@aura/api-client';
import { formatList } from '@aura/i18n';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';

/**
 * The email forms (TAC-8). Each posts JSON to its BFF route and follows the `redirect` it
 * answers with; the BFF sets the session cookies, so no token ever reaches this code.
 */

type Result = { redirect?: string } | { code: string };

async function post(path: string, body: unknown): Promise<Result> {
  try {
    const res = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { redirect?: string; code?: string };
    if (res.ok) return json.redirect ? { redirect: json.redirect } : {};
    return { code: json.code ?? 'Unavailable' };
  } catch {
    return { code: 'Unavailable' };
  }
}

function useSubmit(path: string) {
  // Busy until hydrated: a click before React takes over would submit the form natively and
  // reload the page with the typed values gone.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(body: unknown, onDone?: () => void): Promise<string | null> {
    setBusy(true);
    setError(null);
    const result = await post(path, body);
    if ('code' in result) {
      setBusy(false);
      setError(result.code);
      return result.code;
    }
    if (result.redirect) {
      window.location.assign(result.redirect);
    } else {
      setBusy(false);
      onDone?.();
    }
    return null;
  }
  return { busy, disabled: busy || !ready, error, setError, submit };
}

function Field(props: {
  label: string;
  type: 'email' | 'password' | 'text';
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  hint?: ReactNode;
  inputMode?: 'numeric';
}) {
  const id = useId();
  return (
    <div className="auth-field">
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        className="input"
        type={props.type}
        value={props.value}
        required
        autoComplete={props.autoComplete}
        {...(props.inputMode ? { inputMode: props.inputMode, maxLength: 6 } : {})}
        aria-describedby={props.hint ? `${id}-hint` : undefined}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.hint ? (
        <span id={`${id}-hint`} className="auth-hint">
          {props.hint}
        </span>
      ) : null}
    </div>
  );
}

const MINUTES = AUTH_CODE_TTL_SECONDS / 60;
const MIN = PASSWORD_POLICY.minLength;

/** What the password still needs, or the policy while the field is empty. */
function usePasswordHint(password: string): { hint: string; ok: boolean } {
  const t = useTranslations('auth.password');
  const locale = useLocale();
  const issues = passwordIssues(password);
  if (!password) return { hint: t('policy', { min: MIN }), ok: false };
  if (issues.length === 0) return { hint: t('policy', { min: MIN }), ok: true };
  if (issues.includes('tooLong')) return { hint: t('tooLong'), ok: false };
  const list = formatList(
    issues.map((issue) => t(`issues.${issue as Exclude<typeof issue, 'tooLong'>}`, { min: MIN })),
    { locale },
  );
  return { hint: t('hint', { list }), ok: false };
}

function ErrorText({ code, children }: { code: string | null; children?: ReactNode }) {
  const t = useTranslations('auth.identityErrors');
  if (!code) return null;
  return (
    <p className="auth-error" role="alert">
      {t(isIdentityErrorCode(code) ? code : 'Unavailable', { min: MIN })} {children}
    </p>
  );
}

export function SignInForm({ returnTo }: { returnTo: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, disabled, error, submit } = useSubmit('sign-in');
  const t = useTranslations('auth.signIn');
  const f = useTranslations('auth.fields');
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit({ email, password, returnTo });
  };
  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      <Field
        label={f('email')}
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />
      <Field
        label={f('password')}
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
      />
      <ErrorText code={error}>
        {error === 'UserNotConfirmed' ? <Link href="/auth/verify">{t('enterCode')}</Link> : null}
      </ErrorText>
      <button className="button primary" type="submit" disabled={disabled}>
        {busy ? t('busy') : t('submit')}
      </button>
    </form>
  );
}

export function SignUpForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, disabled, error, setError, submit } = useSubmit('sign-up');
  const t = useTranslations('auth.signUp');
  const f = useTranslations('auth.fields');
  const hint = usePasswordHint(password);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!hint.ok) {
      setError('InvalidPassword');
      return;
    }
    void submit({ email, password });
  };
  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      <Field
        label={f('email')}
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />
      <Field
        label={f('password')}
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={hint.hint}
      />
      <ErrorText code={error}>
        {error === 'UsernameExists' ? <Link href="/auth/sign-in">{t('signIn')}</Link> : null}
      </ErrorText>
      <button className="button primary" type="submit" disabled={disabled}>
        {busy ? t('busy') : t('submit')}
      </button>
    </form>
  );
}

export function VerifyForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [resent, setResent] = useState(false);
  const verify = useSubmit('verify');
  const resend = useSubmit('resend');
  const t = useTranslations('auth');
  const f = useTranslations('auth.fields');
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void verify.submit({ email, code });
  };
  const onResend = () => {
    setResent(false);
    void resend.submit({ email }, () => setResent(true));
  };
  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      <Field
        label={f('email')}
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />
      <Field
        label={f('code')}
        type="text"
        inputMode="numeric"
        value={code}
        onChange={setCode}
        autoComplete="one-time-code"
        hint={t('codeHint', { minutes: MINUTES })}
      />
      <ErrorText code={verify.error ?? resend.error} />
      {resent ? (
        <p className="auth-hint" role="status">
          {t('notices.codeResent')}
        </p>
      ) : null}
      <button className="button primary" type="submit" disabled={verify.disabled}>
        {verify.busy ? t('verify.busy') : t('verify.submit')}
      </button>
      <button
        className="button"
        type="button"
        onClick={onResend}
        disabled={resend.disabled || !email}
      >
        {t('verify.resend')}
      </button>
    </form>
  );
}

export function ForgotForm() {
  const [email, setEmail] = useState('');
  const { busy, disabled, error, submit } = useSubmit('forgot');
  const t = useTranslations('auth.forgot');
  const f = useTranslations('auth.fields');
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void submit({ email });
  };
  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      <Field
        label={f('email')}
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />
      <ErrorText code={error} />
      <button className="button primary" type="submit" disabled={disabled}>
        {busy ? t('busy') : t('submit')}
      </button>
    </form>
  );
}

export function ResetForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const { busy, disabled, error, setError, submit } = useSubmit('reset');
  const t = useTranslations('auth');
  const f = useTranslations('auth.fields');
  const hint = usePasswordHint(password);
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!hint.ok) {
      setError('InvalidPassword');
      return;
    }
    void submit({ email, code, password });
  };
  return (
    <form className="auth-form" onSubmit={onSubmit} noValidate>
      <Field
        label={f('email')}
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
      />
      <Field
        label={f('code')}
        type="text"
        inputMode="numeric"
        value={code}
        onChange={setCode}
        autoComplete="one-time-code"
        hint={t('resetCodeHint', { minutes: MINUTES })}
      />
      <Field
        label={f('newPassword')}
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={hint.hint}
      />
      <ErrorText code={error}>
        {error === 'ExpiredCode' ? <Link href="/auth/forgot">{t('reset.resend')}</Link> : null}
      </ErrorText>
      <button className="button primary" type="submit" disabled={disabled}>
        {busy ? t('reset.busy') : t('reset.submit')}
      </button>
    </form>
  );
}
