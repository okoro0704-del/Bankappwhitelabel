import { Navigate, Outlet, createBrowserRouter } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute } from './components/ProtectedRoute';
import { AuthLayout } from './layouts/AuthLayout';
import { UserLayout } from './layouts/UserLayout';
import { AdminLayout } from './layouts/AdminLayout';
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
import { useAuth } from './auth/AuthProvider';
import { AuthProvider } from './auth/AuthProvider';
import { ToastProvider } from './components/ui/Toast';

function HomeRedirect() {
  const { loading, appUser } = useAuth();
  if (loading) return null;
  if (!appUser) return <Navigate to="/login" replace />;
  return <Navigate to={appUser.role === 'admin' ? '/admin' : '/app'} replace />;
}

function RootLayout() {
  return (
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
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
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
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
