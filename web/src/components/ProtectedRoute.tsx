import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { homePathForUser } from '../auth/homePath';
import { Alert, Skeleton } from './ui/Feedback';
import { Button } from './ui/Button';

export function ProtectedRoute({ role }: { role?: 'admin' | 'user' }) {
  const { loading, session, appUser, error, signOut, refreshAppUser } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="auth-panel">
        <div className="stack" style={{ width: 'min(24rem, 100%)' }}>
          <Skeleton height={28} width="60%" />
          <Skeleton height={120} />
          <Skeleton height={40} />
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <Navigate
        to={role === 'admin' ? '/admin/login' : '/login'}
        replace
        state={{ from: location.pathname }}
      />
    );
  }

  // Session exists but profile failed to load — stay put instead of bouncing to login.
  if (!appUser) {
    return (
      <div className="auth-panel">
        <div className="auth-card stack">
          <Alert tone="error" title="Could not load your account">
            {error ?? 'Your session is active but the account profile could not be loaded.'}
          </Alert>
          <div className="row">
            <Button type="button" onClick={() => void refreshAppUser()}>
              Try again
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await signOut();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (role === 'admin' && appUser.role !== 'admin') {
    return <Navigate to="/app" replace />;
  }

  if (role === 'user' && appUser.role === 'admin') {
    return <Navigate to="/admin" replace />;
  }

  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { loading, session, appUser } = useAuth();

  if (loading) {
    return (
      <div className="auth-panel">
        <Skeleton height={160} width="min(24rem, 100%)" />
      </div>
    );
  }

  if (session && appUser) {
    return <Navigate to={homePathForUser(appUser)} replace />;
  }

  // Session without profile: let login pages render (and show auth errors).
  return <Outlet />;
}
