import { useState } from 'react';
import { sanitizePublicUrl, brandInitial } from './branding';

export function BrandMark({
  applicationName,
  logoUrl,
  className = '',
}: {
  applicationName: string;
  logoUrl?: string | null;
  className?: string;
}) {
  const safeLogo = sanitizePublicUrl(logoUrl ?? null);
  const [logoFailed, setLogoFailed] = useState(false);

  if (safeLogo && !logoFailed) {
    return (
      <img
        src={safeLogo}
        alt=""
        className={`shell-brand-logo ${className}`.trim()}
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
