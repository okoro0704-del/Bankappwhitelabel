import { Link } from 'react-router-dom';
import { BrandMark } from '../../tenant/BrandMark';
import { sanitizePublicUrl } from '../../tenant/branding';
import { useTenant } from '../../tenant/TenantProvider';

export function LandingPage() {
  const { branding, config } = useTenant();
  const applicationName = branding?.applicationName ?? config?.name ?? 'Application';
  const headline = branding?.loginHeadline ?? applicationName;
  const subtitle =
    branding?.loginSubtitle ?? 'Secure access to your accounts, transfers, and statements.';
  const supportEmail = branding?.supportEmail;
  const supportPhone = branding?.supportPhone;
  const hasLogo = Boolean(sanitizePublicUrl(branding?.logoUrl ?? null));

  return (
    <div className="landing">
      <div
        className="landing-hero"
        style={{ backgroundImage: "url('/landing-hero.jpg')" }}
        role="img"
        aria-label="Bankers assisting customers in a modern branch"
      >
        <div className="landing-hero-shade" />
        <header className="landing-top">
          <div className={`shell-brand landing-brand${hasLogo ? ' shell-brand--logo' : ''}`}>
            <BrandMark
              applicationName={applicationName}
              logoUrl={branding?.logoUrl}
              size="wordmark"
            />
            {!hasLogo ? (
              <div>
                <div className="shell-brand-name">{applicationName}</div>
                <div className="shell-brand-tag">Personal banking</div>
              </div>
            ) : (
              <div className="shell-brand-tag">Personal banking</div>
            )}
          </div>
        </header>

        <div className="landing-hero-content">
          {hasLogo ? (
            <div className="landing-hero-logo">
              <BrandMark
                applicationName={applicationName}
                logoUrl={branding?.logoUrl}
                size="hero"
              />
            </div>
          ) : (
            <h1 className="landing-brand-title">{applicationName}</h1>
          )}
          <p className="landing-support">{subtitle}</p>
          <Link className="landing-login-btn" to="/login" aria-label="Customer account login">
            <span className="landing-login-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5.5 19.2c1.6-3.2 4-4.8 6.5-4.8s4.9 1.6 6.5 4.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="landing-login-label">Log in</span>
          </Link>
          <p className="landing-hint">{headline}</p>
        </div>
      </div>

      <section className="landing-section" aria-labelledby="landing-offerings-title">
        <div className="landing-section-inner">
          <h2 id="landing-offerings-title">What we offer</h2>
          <p className="landing-section-lead">
            Everyday banking tools designed for clear balances, controlled transfers, and reliable
            account access.
          </p>
          <ul className="landing-offer-list">
            <li>
              <strong>Account overview</strong>
              <span>View balances, statements, and recent activity in one place.</span>
            </li>
            <li>
              <strong>Secure transfers</strong>
              <span>Send funds with verification steps matched to your account type.</span>
            </li>
            <li>
              <strong>Personal support</strong>
              <span>Reach your bank team for account questions and transfer assistance.</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="landing-section landing-section-alt" aria-labelledby="landing-hours-title">
        <div className="landing-section-inner landing-hours-grid">
          <div>
            <h2 id="landing-hours-title">Service hours</h2>
            <p className="landing-section-lead">
              Online banking is available around the clock. Branch and support desks follow these
              hours.
            </p>
          </div>
          <dl className="landing-hours">
            <div>
              <dt>Online banking</dt>
              <dd>24 hours · 7 days</dd>
            </div>
            <div>
              <dt>Customer support</dt>
              <dd>Monday–Friday · 8:00–18:00</dd>
            </div>
            <div>
              <dt>Branch services</dt>
              <dd>Monday–Friday · 9:00–16:00</dd>
            </div>
            <div>
              <dt>Saturday</dt>
              <dd>Support desk · 9:00–13:00</dd>
            </div>
          </dl>
        </div>
      </section>

      {(supportEmail || supportPhone) && (
        <section className="landing-section" aria-labelledby="landing-contact-title">
          <div className="landing-section-inner">
            <h2 id="landing-contact-title">Contact</h2>
            <p className="landing-section-lead">
              Need help before you sign in? Reach {applicationName} using the details below.
            </p>
            <ul className="landing-contact-list">
              {supportEmail ? (
                <li>
                  <strong>Email</strong>
                  <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
                </li>
              ) : null}
              {supportPhone ? (
                <li>
                  <strong>Phone</strong>
                  <a href={`tel:${supportPhone.replace(/\s+/g, '')}`}>{supportPhone}</a>
                </li>
              ) : null}
            </ul>
          </div>
        </section>
      )}

      <footer className="landing-footer">
        <span>{applicationName}</span>
        <Link to="/login">Customer login</Link>
      </footer>
    </div>
  );
}
