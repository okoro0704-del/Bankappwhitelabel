import type { ReactNode } from 'react';

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

export function Alert({
  children,
  tone = 'info',
  title,
}: {
  children: ReactNode;
  tone?: 'info' | 'success' | 'warning' | 'error';
  title?: string;
}) {
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
