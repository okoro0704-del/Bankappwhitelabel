import { Navigate, Outlet } from 'react-router-dom';
import { isOnPlatformHost } from '../auth/homePath';

/**
 * Web Finance (/master) is only available on the platform apex host.
 * Tenant subdomains must never render the Master console.
 */
export function MasterHostGate() {
  if (!isOnPlatformHost()) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
