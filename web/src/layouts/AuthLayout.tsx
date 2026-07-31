import { Outlet } from 'react-router-dom';
import { BrandMark } from '../tenant/BrandMark';
import { useTenant } from '../tenant/TenantProvider';

export function AuthLayout() {
  const { branding, config } = useTenant();
  const applicationName = branding?.applicationName ?? config?.name ?? 'Application';
  const headline = branding?.loginHeadline ?? `Welcome to ${applicationName}`;
  const subtitle =
    branding?.loginSubtitle ?? 'Sign in to manage your account.';

  return (
    <div className="auth-layout">
      <section className="auth-visual" aria-label={`${applicationName} branding`}>
        <div className="shell-brand">
          <BrandMark applicationName={applicationName} logoUrl={branding?.logoUrl} />
          <div>
            <div className="shell-brand-name">{applicationName}</div>
            <div className="shell-brand-tag">Secure account access</div>
          </div>
        </div>
        <div className="auth-visual-copy">
          <h1>{headline}</h1>
          <p>{subtitle}</p>
        </div>
        {branding?.supportEmail || branding?.supportPhone ? (
          <p
            className="muted"
            style={{ color: 'rgba(238,244,243,0.7)', position: 'relative', zIndex: 1 }}
          >
            Support
            {branding.supportEmail ? `: ${branding.supportEmail}` : ''}
            {branding.supportEmail && branding.supportPhone ? ' · ' : ''}
            {branding.supportPhone ?? ''}
          </p>
        ) : null}
      </section>
      <section className="auth-panel">
        <Outlet />
      </section>
    </div>
  );
}
