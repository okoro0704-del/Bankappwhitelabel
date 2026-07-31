import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute } from './components/ProtectedRoute';
import {
  MasterProtectedRoute,
  MasterPublicOnlyRoute,
} from './components/MasterProtectedRoute';
import { AuthLayout } from './layouts/AuthLayout';
import { UserLayout } from './layouts/UserLayout';
import { AdminLayout } from './layouts/AdminLayout';
import { MasterLayout } from './layouts/MasterLayout';
import { LoginPage, ForgotPasswordPage } from './pages/auth/LoginPage';
import { UserDashboardPage } from './pages/user/DashboardPage';
import { AccountPage } from './pages/user/AccountPage';
import { TransactionsPage } from './pages/user/TransactionsPage';
import { ProfilePage } from './pages/user/ProfilePage';
import { TransferPage } from './pages/user/TransferPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminCreateUserPage } from './pages/admin/AdminCreateUserPage';
import { AdminUserDetailPage } from './pages/admin/AdminUserDetailPage';
import { AdminFundingPage } from './pages/admin/AdminFundingPage';
import {
  AdminAccountsPage,
  AdminSettingsPage,
  AdminTransactionsPage,
  AdminTransfersPage,
} from './pages/admin/AdminListPages';
import { MasterLoginPage } from './pages/master/MasterLoginPage';
import { MasterDashboardPage } from './pages/master/MasterDashboardPage';
import { MasterApplicationsPage } from './pages/master/MasterApplicationsPage';
import { MasterCreateApplicationPage } from './pages/master/MasterCreateApplicationPage';
import { MasterApplicationDetailPage } from './pages/master/MasterApplicationDetailPage';
import { MasterBrandingPage } from './pages/master/MasterBrandingPage';
import { useAuth } from './auth/AuthProvider';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';
import { TenantProvider } from './tenant/TenantProvider';
import { CustomerTenantGate } from './tenant/CustomerTenantGate';

function HomeRedirect() {
  const { loading, appUser } = useAuth();
  if (loading) return null;
  if (!appUser) return <Navigate to="/login" replace />;
  return <Navigate to={appUser.role === 'admin' ? '/admin' : '/app'} replace />;
}

function RootLayout() {
  return (
    <TenantProvider>
      <AuthProvider>
        <ToastProvider>
          <a className="app-skip" href="#main">
            Skip to content
          </a>
          <div id="main">
            <Outlet />
          </div>
        </ToastProvider>
      </AuthProvider>
    </TenantProvider>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        element: <CustomerTenantGate />,
        children: [
          { path: '/', element: <HomeRedirect /> },
          {
            element: <PublicOnlyRoute />,
            children: [
              {
                element: <AuthLayout />,
                children: [
                  { path: '/login', element: <LoginPage /> },
                  { path: '/forgot-password', element: <ForgotPasswordPage /> },
                ],
              },
            ],
          },
          {
            element: <ProtectedRoute role="user" />,
            children: [
              {
                path: '/app',
                element: <UserLayout />,
                children: [
                  { index: true, element: <UserDashboardPage /> },
                  { path: 'transfer', element: <TransferPage /> },
                  { path: 'transactions', element: <TransactionsPage /> },
                  { path: 'account', element: <AccountPage /> },
                  { path: 'profile', element: <ProfilePage /> },
                ],
              },
            ],
          },
          {
            element: <ProtectedRoute role="admin" />,
            children: [
              {
                path: '/admin',
                element: <AdminLayout />,
                children: [
                  { index: true, element: <AdminDashboardPage /> },
                  { path: 'users', element: <AdminUsersPage /> },
                  { path: 'users/new', element: <AdminCreateUserPage /> },
                  { path: 'users/:userId', element: <AdminUserDetailPage /> },
                  { path: 'accounts', element: <AdminAccountsPage /> },
                  { path: 'funding', element: <AdminFundingPage /> },
                  { path: 'transactions', element: <AdminTransactionsPage /> },
                  { path: 'transfers', element: <AdminTransfersPage /> },
                  { path: 'settings', element: <AdminSettingsPage /> },
                ],
              },
            ],
          },
        ],
      },
      {
        element: <MasterPublicOnlyRoute />,
        children: [{ path: '/master/login', element: <MasterLoginPage /> }],
      },
      {
        element: <MasterProtectedRoute />,
        children: [
          {
            path: '/master',
            element: <MasterLayout />,
            children: [
              { index: true, element: <MasterDashboardPage /> },
              { path: 'applications', element: <MasterApplicationsPage /> },
              { path: 'applications/new', element: <MasterCreateApplicationPage /> },
              { path: 'applications/:tenantId', element: <MasterApplicationDetailPage /> },
              {
                path: 'applications/:tenantId/branding',
                element: <MasterBrandingPage />,
              },
            ],
          },
        ],
      },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
