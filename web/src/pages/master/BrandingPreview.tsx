import type { TenantBranding } from '../../types/tenant';
import { sanitizeBranding } from '../../tenant/branding';

export function BrandingPreview({ branding }: { branding: TenantBranding }) {
  const safe = sanitizeBranding(branding);
  const style = {
    ['--bp-primary' as string]: safe.primaryColor,
    ['--bp-secondary' as string]: safe.secondaryColor,
    ['--bp-accent' as string]: safe.accentColor,
  };

  return (
    <div className="card card-pad branding-preview" style={style}>
      <div className="card-header">
        <h2 style={{ fontSize: '1.05rem' }}>Live preview</h2>
        <span className="badge">Unsaved-safe</span>
      </div>

      <div className="bp-frame" aria-label="Branding preview">
        <header className="bp-header">
          <div className="bp-brand">
            {safe.logoUrl ? (
              <img src={safe.logoUrl} alt="" className="bp-logo" />
            ) : (
              <span className="bp-mark" aria-hidden>
                {(safe.applicationName || 'A').slice(0, 1).toUpperCase()}
              </span>
            )}
            <strong>{safe.applicationName || 'Application'}</strong>
          </div>
          <nav className="bp-nav" aria-hidden>
            <span>Home</span>
            <span>Account</span>
            <span className="bp-nav-active">Transfer</span>
          </nav>
        </header>

        <section className="bp-login">
          <h3>{safe.loginHeadline || 'Welcome'}</h3>
          <p>{safe.loginSubtitle || 'Sign in to continue.'}</p>
          <div className="bp-field">
            <span>Email</span>
            <div className="bp-input" />
          </div>
          <div className="bp-field">
            <span>Password</span>
            <div className="bp-input" />
          </div>
          <button type="button" className="bp-btn" tabIndex={-1}>
            Sign in
          </button>
          {safe.supportEmail ? (
            <p className="bp-support">Support: {safe.supportEmail}</p>
          ) : null}
        </section>

        <section className="bp-cards">
          <article className="bp-card">
            <div className="bp-card-label">Available balance</div>
            <div className="bp-card-value">$12,480.00</div>
            <span className="bp-status">Active</span>
          </article>
          <article className="bp-card">
            <div className="bp-card-label">Recent activity</div>
            <div className="bp-card-line" />
            <div className="bp-card-line short" />
            <button type="button" className="bp-btn bp-btn-secondary" tabIndex={-1}>
              View details
            </button>
          </article>
        </section>
      </div>
    </div>
  );
}
