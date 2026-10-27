import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import type { IdentityProviderName } from '@/lib/config';

const PROVIDER_LABELS: Record<IdentityProviderName, string> = {
  Google: 'Continue with Google',
  SignInWithApple: 'Continue with Apple',
};

/** The frame every sign-in, sign-up and reset page shares. */
export function AuthCard(props: {
  title: string;
  lede?: string;
  notice?: { text: string; tone: 'info' | 'warning' } | null;
  children: ReactNode;
}) {
  return (
    <main className="welcome">
      <div className="welcome-card">
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <Logo size={56} />
        </div>
        <h1>{props.title}</h1>
        {props.lede ? <p>{props.lede}</p> : null}
        {props.notice ? (
          <div
            className={props.notice.tone === 'warning' ? 'card warning' : 'card'}
            role={props.notice.tone === 'warning' ? 'alert' : 'status'}
          >
            <p>{props.notice.text}</p>
          </div>
        ) : null}
        {props.children}
        <p className="fine-print">Not medical advice · Privacy · Terms</p>
      </div>
    </main>
  );
}

/**
 * "Continue with Google / Apple": the hosted flow straight to that provider. Only the providers
 * configured in IDENTITY_PROVIDERS are shown, so nothing appears until the IdP apps exist.
 */
export function ProviderButtons(props: { providers: IdentityProviderName[]; returnTo: string }) {
  if (props.providers.length === 0) return null;
  return (
    <>
      {props.providers.map((p) => (
        <a
          key={p}
          className="button"
          href={`/api/auth/login?provider=${p}&returnTo=${encodeURIComponent(props.returnTo)}`}
        >
          {PROVIDER_LABELS[p]}
        </a>
      ))}
      <div className="auth-divider">or with email</div>
    </>
  );
}
