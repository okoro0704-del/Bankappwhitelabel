import { Link } from 'react-router-dom';
import { BrandMark } from '../../tenant/BrandMark';
import { useTenant } from '../../tenant/TenantProvider';

export function LandingPage() {
  const { branding, config } = useTenant();
  const applicationName = branding?.applicationName ?? config?.name ?? 'Application';
  const headline = branding?.loginHeadline ?? applicationName;
  const subtitle =
    branding?.loginSubtitle ?? 'Secure access to your accounts, transfers, and statements.';

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
          <div className="shell-brand landing-brand">
            <BrandMark applicationName={applicationName} logoUrl={branding?.logoUrl} />
            <div>
              <div className="shell-brand-name">{applicationName}</div>
              <div className="shell-brand-tag">Personal banking</div>
            </div>
          </div>
        </header>

        <div className="landing-hero-content">
          <h1 className="landing-brand-title">{applicationName}</h1>
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
    </div>
  );
}
