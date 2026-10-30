import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { Logo } from '@/components/Logo';
import type { IdentityProviderName } from '@/lib/config';

/** The frame every sign-in, sign-up and reset page shares. */
export function AuthCard(props: {
  title: string;
  lede?: string;
  notice?: { text: string; tone: 'info' | 'warning' } | null;
  children: ReactNode;
}) {
  const t = useTranslations('common');
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
        <p className="fine-print">{t('legalLinks')}</p>
      </div>
    </main>
  );
}

/**
 * "Continue with Google / Apple": the hosted flow straight to that provider. Only the providers
 * configured in IDENTITY_PROVIDERS are shown, so nothing appears until the IdP apps exist.
 */
export function ProviderButtons(props: { providers: IdentityProviderName[]; returnTo: string }) {
  const t = useTranslations('auth');
  if (props.providers.length === 0) return null;
  return (
    <>
      {props.providers.map((p) => (
        <a
          key={p}
          className="button"
          href={`/api/auth/login?provider=${p}&returnTo=${encodeURIComponent(props.returnTo)}`}
        >
          {t(`providers.${p}`)}
        </a>
      ))}
      <div className="auth-divider">{t('orWithEmail')}</div>
    </>
  );
}
