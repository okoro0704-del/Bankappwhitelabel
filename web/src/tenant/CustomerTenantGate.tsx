import { Outlet } from 'react-router-dom';
import { Alert, ErrorState, Skeleton } from '../components/ui/Feedback';
import { Button } from '../components/ui/Button';
import { useTenant } from './TenantProvider';

/**
 * Gates customer-facing routes on a successfully resolved, active tenant config.
 * Master Admin routes must not use this gate.
 */
export function CustomerTenantGate() {
  const { state, reload } = useTenant();

  if (state.status === 'loading') {
    return (
      <div className="auth-panel">
        <div className="stack" style={{ width: 'min(24rem, 100%)' }}>
          <Skeleton height={28} width="55%" />
          <Skeleton height={120} />
          <Skeleton height={40} />
        </div>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <div className="auth-panel">
        <div className="auth-card tenant-unavailable">
          <h2>Application unavailable</h2>
          <p className="page-subtitle">{state.message}</p>
          <Alert tone="warning" title="Unable to open this application">
            The platform could not load an active configuration for this host. Contact the
            application owner if you believe this is an error.
          </Alert>
          <div className="row" style={{ marginTop: '1rem' }}>
            <Button variant="secondary" onClick={() => void reload()}>
              Try again
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="auth-panel">
        <div className="auth-card">
          <ErrorState
            title="Could not load application configuration"
            description={state.message}
            onRetry={() => void reload()}
          />
        </div>
      </div>
    );
  }

  return <Outlet />;
}
