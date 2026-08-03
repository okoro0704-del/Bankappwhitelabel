import { useState } from 'react';
import { sanitizePublicUrl, brandInitial } from './branding';

export function BrandMark({
  applicationName,
  logoUrl,
  className = '',
  size = 'default',
}: {
  applicationName: string;
  logoUrl?: string | null;
  className?: string;
  /** `wordmark` for horizontal logos on login/landing; `default` for compact shells. */
  size?: 'default' | 'wordmark' | 'hero';
}) {
  const safeLogo = sanitizePublicUrl(logoUrl ?? null);
  const [logoFailed, setLogoFailed] = useState(false);

  if (safeLogo && !logoFailed) {
    const sizeClass =
      size === 'hero' ? 'shell-brand-logo--hero' : size === 'wordmark' ? 'shell-brand-logo--wordmark' : '';
    return (
      <img
        src={safeLogo}
        alt={applicationName}
        className={`shell-brand-logo ${sizeClass} ${className}`.trim()}
        onError={() => setLogoFailed(true)}
      />
    );
  }

  return (
    <div className={`shell-brand-mark ${className}`.trim()} aria-hidden>
      {brandInitial(applicationName)}
    </div>
  );
}
