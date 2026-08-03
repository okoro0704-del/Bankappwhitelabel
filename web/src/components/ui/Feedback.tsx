import { useEffect, useId, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`card ${padded ? 'card-pad' : ''} ${className}`.trim()}>{children}</div>;
}

export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';
}) {
  const toneClass = tone === 'neutral' ? '' : `badge-${tone}`;
  return <span className={`badge ${toneClass}`.trim()}>{children}</span>;
}

function ErrorPopupAlert({
  title,
  children,
  onClose,
}: {
  title?: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="error-popup-backdrop" role="presentation" onClick={onClose}>
      <div
        className="error-popup"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="error-popup-close" aria-label="Close error" onClick={onClose}>
          <span aria-hidden>✕</span>
        </button>
        <div className="error-popup-icon" aria-hidden>
          !
        </div>
        <h2 id={titleId}>{title || 'Something went wrong'}</h2>
        <div id={bodyId}>{children}</div>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function Alert({
  children,
  tone = 'info',
  title,
}: {
  children: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
  }, [children, title, tone]);

  if (tone === 'error' && !dismissed) {
    return (
      <ErrorPopupAlert title={title} onClose={() => setDismissed(true)}>
        {children}
      </ErrorPopupAlert>
    );
  }

  if (tone === 'error' && dismissed) {
    return null;
  }

  return (
    <div className={`alert alert-${tone}`} role="alert">
      {title ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Something went wrong',
  description,
  onRetry,
}: {
  title?: string;
  description: string;
  onRetry?: () => void;
}) {
  return (
    <div className="error-state">
      <h3>{title}</h3>
      <p className="muted">{description}</p>
      {onRetry ? (
        <button className="btn btn-secondary btn-sm" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number | string; width?: number | string }) {
  return <span className="skeleton" style={{ height, width, display: 'inline-block' }} />;
}
