import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { BrandMark } from '../../tenant/BrandMark';
import { sanitizePublicUrl } from '../../tenant/branding';
import { defaultHomeContent, sanitizeHomeContent } from '../../tenant/homeContent';
import { useTenant } from '../../tenant/TenantProvider';

export function LandingPage() {
  const { appUser } = useAuth();
  const { branding, config } = useTenant();
  const applicationName = branding?.applicationName ?? config?.name ?? 'Application';
  const supportEmail = branding?.supportEmail;
  const supportPhone = branding?.supportPhone;
  const hasLogo = Boolean(sanitizePublicUrl(branding?.logoUrl ?? null));
  const home = sanitizeHomeContent(
    branding?.homeContent ?? defaultHomeContent(applicationName),
    applicationName,
  );
  const signedInCta =
    appUser?.role === 'admin'
      ? { to: '/admin', label: 'Open admin dashboard' }
      : appUser
        ? { to: '/app', label: 'Open my account' }
        : { to: '/login', label: home.footerLogin };

  const nav = [
    { href: '#home', label: home.navHome },
    { href: '#about', label: home.navAbout },
    { href: '#banking', label: home.navBanking },
    { href: '#philosophy', label: home.navLoans },
    { href: '#why', label: home.navInvesting },
    { href: '#banking', label: home.navCards },
    { href: '#contact', label: home.navContact },
  ];

  return (
    <div className="landing landing--rich">
      <div className="landing-topbar">
        <div className="landing-topbar-inner">
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          ) : (
            <span>{applicationName}</span>
          )}
          <span className="landing-topbar-hours">{home.topBarHours}</span>
          {supportPhone ? <a href={`tel:${supportPhone.replace(/\s+/g, '')}`}>{supportPhone}</a> : null}
        </div>
      </div>

      <div
        id="home"
        className="landing-hero"
        style={{ backgroundImage: "url('/landing-hero.jpg')" }}
        role="img"
        aria-label={`${applicationName} banking`}
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
                <div className="shell-brand-tag">{home.tagline}</div>
              </div>
            ) : (
              <div className="shell-brand-tag">{home.tagline}</div>
            )}
          </div>
          <nav className="landing-nav" aria-label="Home sections">
            {nav.map((item) => (
              <a key={`${item.href}-${item.label}`} href={item.href}>
                {item.label}
              </a>
            ))}
            <Link className="landing-nav-login" to={signedInCta.to}>
              {signedInCta.label}
            </Link>
          </nav>
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
          <p className="landing-hero-kicker">{home.heroHeadline}</p>
          <p className="landing-support">{home.heroSupport}</p>
          <Link className="landing-login-btn" to={signedInCta.to} aria-label={signedInCta.label}>
            <span className="landing-login-icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="12" cy="8" r="3.2" />
                <path d="M5.5 19.2c1.6-3.2 4-4.8 6.5-4.8s4.9 1.6 6.5 4.8" strokeLinecap="round" />
              </svg>
            </span>
            <span className="landing-login-label">{signedInCta.label}</span>
          </Link>
        </div>
      </div>

      <section id="banking" className="landing-section" aria-labelledby="landing-banking-title">
        <div className="landing-section-inner landing-split">
          <div>
            <p className="landing-eyebrow">{home.navBanking}</p>
            <h2 id="landing-banking-title">{home.bankingTitle}</h2>
            <p className="landing-section-lead">{home.bankingLead}</p>
            <p>{home.bankingBody}</p>
            <p className="muted">{home.bankingSecondary}</p>
          </div>
          <div className="landing-panel">
            <h3>Opening your account is just the beginning</h3>
            <p>
              Build credit, earn rewards, and plan what&apos;s next with guidance from {applicationName}.
            </p>
            <Link className="btn btn-primary" to={signedInCta.to}>
              {appUser ? signedInCta.label : 'Open online banking'}
            </Link>
          </div>
        </div>
      </section>

      <section id="philosophy" className="landing-section landing-section-alt" aria-labelledby="landing-philosophy-title">
        <div className="landing-section-inner landing-split">
          <div className="landing-philosophy-visual" aria-hidden />
          <div>
            <h2 id="landing-philosophy-title">{home.philosophyTitle}</h2>
            <p className="landing-section-lead">{home.philosophyLead}</p>
            <p>{home.philosophyBody}</p>
            <p className="landing-callout">{home.philosophyHighlight}</p>
          </div>
        </div>
      </section>

      <section id="why" className="landing-section" aria-labelledby="landing-why-title">
        <div className="landing-section-inner">
          <p className="landing-eyebrow">{home.whyTitle}</p>
          <h2 id="landing-why-title">{home.whySubtitle}</h2>
          <div className="landing-why-grid">
            <article>
              <h3>{home.visionTitle}</h3>
              <p>{home.visionBody}</p>
            </article>
            <article>
              <h3>{home.missionTitle}</h3>
              <p>{home.missionBody}</p>
            </article>
            <article>
              <h3>{home.philosophySectionTitle}</h3>
              <p>{home.philosophySectionBody}</p>
            </article>
          </div>
          <ul className="landing-metrics" aria-label="Capability focus">
            {home.metrics.map((metric) => (
              <li key={metric.label}>
                <div className="landing-metric-head">
                  <strong>{metric.label}</strong>
                  <span>{metric.percent}%</span>
                </div>
                <div className="landing-metric-track" aria-hidden>
                  <div className="landing-metric-fill" style={{ width: `${metric.percent}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="about" className="landing-section landing-section-alt" aria-labelledby="landing-about-title">
        <div className="landing-section-inner landing-split">
          <div>
            <h2 id="landing-about-title">{home.aboutTitle}</h2>
            <p className="landing-section-lead">{home.aboutBody}</p>
          </div>
          <dl className="landing-hours">
            <div>
              <dt>Online banking</dt>
              <dd>{home.hoursOnline}</dd>
            </div>
            <div>
              <dt>Customer support</dt>
              <dd>{home.hoursSupport}</dd>
            </div>
            <div>
              <dt>Branch services</dt>
              <dd>{home.hoursBranch}</dd>
            </div>
            <div>
              <dt>Saturday</dt>
              <dd>{home.hoursSaturday}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section id="contact" className="landing-section" aria-labelledby="landing-contact-title">
        <div className="landing-section-inner landing-split">
          <div>
            <h2 id="landing-contact-title">{home.navContact}</h2>
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
              <li>
                <strong>{home.headOfficeTitle}</strong>
                <span>{home.headOfficeAddress}</span>
              </li>
            </ul>
          </div>
          <div className="landing-panel">
            <h3>{home.footerNewAccounts}</h3>
            <p>Sign in to manage accounts, transfers, and statements.</p>
            <Link className="btn btn-primary" to={signedInCta.to}>
              {signedInCta.label}
            </Link>
          </div>
        </div>
      </section>

      <footer className="landing-footer landing-footer--rich">
        <div className="landing-footer-brand">
          <BrandMark applicationName={applicationName} logoUrl={branding?.logoUrl} size="wordmark" />
          <strong>{applicationName}</strong>
        </div>
        <div className="landing-footer-cols">
          <div>
            <h3>{home.aboutTitle}</h3>
            <a href="#about">{home.footerMission}</a>
            <a href="#philosophy">{home.footerBorrowing}</a>
            <a href="#why">{home.footerInvestments}</a>
            <a href="#contact">{home.footerContact}</a>
          </div>
          <div>
            <h3>Quick links</h3>
            <a href="#why">{home.footerPolicy}</a>
            <a href="#contact">{home.footerTerms}</a>
            <Link to={signedInCta.to}>{signedInCta.label}</Link>
            {!appUser ? <Link to="/login">{home.footerNewAccounts}</Link> : null}
          </div>
          <div>
            <h3>{home.headOfficeTitle}</h3>
            <p>{home.headOfficeAddress}</p>
            {supportEmail ? <a href={`mailto:${supportEmail}`}>{supportEmail}</a> : null}
            {supportPhone ? (
              <a href={`tel:${supportPhone.replace(/\s+/g, '')}`}>{supportPhone}</a>
            ) : null}
          </div>
        </div>
        <div className="landing-footer-base">
          <span>
            {home.copyrightNote} · {applicationName}
          </span>
          <Link to={signedInCta.to}>{appUser ? signedInCta.label : 'Customer login'}</Link>
        </div>
      </footer>
    </div>
  );
}
