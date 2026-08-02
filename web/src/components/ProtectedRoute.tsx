import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { homePathForUser } from '../auth/homePath';
import { Skeleton } from './ui/Feedback';

export function ProtectedRoute({ role }: { role?: 'admin' | 'user' }) {
  const { loading, session, appUser } = useAuth();
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

  if (!session || !appUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
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

  return <Outlet />;
}
