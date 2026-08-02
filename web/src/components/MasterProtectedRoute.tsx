import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { Alert, Skeleton } from './ui/Feedback';
import { Button } from './ui/Button';
import { Link } from 'react-router-dom';

function AuthLoading() {
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

/** Protects /master/* — requires session + server-reported isMasterAdmin. */
export function MasterProtectedRoute() {
  const { loading, session, appUser, signOut } = useAuth();
  const location = useLocation();

  if (loading) return <AuthLoading />;

  if (!session || !appUser) {
    return <Navigate to="/master/login" replace state={{ from: location.pathname }} />;
  }

  if (!appUser.isMasterAdmin) {
    return (
      <div className="auth-panel">
        <div className="auth-card master-unauthorized">
          <h2>Web Finance access required</h2>
          <p className="page-subtitle">
            Your account is signed in, but it is not authorized for the Web Finance console.
          </p>
          <Alert tone="error" title="Unauthorized">
            Console access is granted by the platform operator and enforced server-side. It cannot
            be enabled from this browser.
          </Alert>
          <div className="row" style={{ marginTop: '1rem' }}>
            <Button
              variant="secondary"
              onClick={async () => {
                await signOut();
              }}
            >
              Sign out
            </Button>
            <Link className="btn btn-primary" to="/login">
              Customer sign in
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <Outlet />;
}

/** /master/login — redirect authenticated Master Admins into the dashboard. */
export function MasterPublicOnlyRoute() {
  const { loading, session, appUser } = useAuth();

  if (loading) return <AuthLoading />;

  if (session && appUser?.isMasterAdmin) {
    return <Navigate to="/master" replace />;
  }

  return <Outlet />;
}
