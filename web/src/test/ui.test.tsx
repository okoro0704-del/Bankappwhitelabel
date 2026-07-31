import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute, PublicOnlyRoute } from '../components/ProtectedRoute';
import { AccountPage } from '../pages/user/AccountPage';
import { UserDashboardPage } from '../pages/user/DashboardPage';
import { TransactionsPage } from '../pages/user/TransactionsPage';
import { AdminFundingPage } from '../pages/admin/AdminFundingPage';
import { ToastProvider } from '../components/ui/Toast';

const authState = vi.hoisted(() => ({
  loading: false,
  session: { access_token: 't' } as { access_token: string } | null,
  appUser: {
    userId: 'u1',
    role: 'user' as 'user' | 'admin',
    accountStatus: 'active' as const,
    email: 'user@example.com',
    username: 'casey',
    firstName: 'Casey',
    lastName: 'User',
  } as null | {
    userId: string;
    role: 'user' | 'admin';
    accountStatus: 'active' | 'suspended';
    email: string;
    username: string;
    firstName: string;
    lastName: string;
  },
  error: null as string | null,
  signIn: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  refreshAppUser: vi.fn(),
}));

vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => authState,
}));

vi.mock('../api/endpoints', () => ({
  api: {
    getWallet: vi.fn(),
    getAccount: vi.fn(),
    getTransactions: vi.fn(),
    getTransfers: vi.fn(),
    getTransaction: vi.fn(),
    getProfile: vi.fn(),
    adminListUsers: vi.fn(),
    adminFundWallet: vi.fn(),
    getTenantConfig: vi.fn(),
  },
}));

import { api } from '../api/endpoints';
import { LoginPage } from '../pages/auth/LoginPage';
import { TenantProvider } from '../tenant/TenantProvider';
import { DEFAULT_NORTHLINE_CONFIGURATION } from '../types/tenant';

function renderWithProviders(ui: ReactNode, path = '/') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </ToastProvider>,
  );
}

describe('protected routes', () => {
  beforeEach(() => {
    authState.loading = false;
    authState.session = { access_token: 't' };
    authState.appUser = {
      userId: 'u1',
      role: 'user',
      accountStatus: 'active',
      email: 'user@example.com',
      username: 'casey',
      firstName: 'Casey',
      lastName: 'User',
    };
  });

  it('redirects unauthenticated users to login', async () => {
    authState.session = null;
    authState.appUser = null;

    renderWithProviders(
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/app" element={<div>Private</div>} />
        </Route>
        <Route path="/login" element={<div>Login screen</div>} />
      </Routes>,
      '/app',
    );

    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });

  it('keeps users out of admin routes', async () => {
    renderWithProviders(
      <Routes>
        <Route element={<ProtectedRoute role="admin" />}>
          <Route path="/admin" element={<div>Admin private</div>} />
        </Route>
        <Route path="/app" element={<div>User home</div>} />
      </Routes>,
      '/admin',
    );

    expect(await screen.findByText('User home')).toBeInTheDocument();
  });

  it('keeps admins in admin area', async () => {
    authState.appUser = {
      ...authState.appUser!,
      role: 'admin',
    };

    renderWithProviders(
      <Routes>
        <Route element={<ProtectedRoute role="admin" />}>
          <Route path="/admin" element={<div>Admin private</div>} />
        </Route>
      </Routes>,
      '/admin',
    );

    expect(await screen.findByText('Admin private')).toBeInTheDocument();
  });

  it('redirects authenticated users away from login', async () => {
    renderWithProviders(
      <Routes>
        <Route element={<PublicOnlyRoute />}>
          <Route path="/login" element={<div>Login screen</div>} />
        </Route>
        <Route path="/app" element={<div>User home</div>} />
      </Routes>,
      '/login',
    );

    expect(await screen.findByText('User home')).toBeInTheDocument();
  });
});

describe('login state', () => {
  it('shows sign-in form', async () => {
    authState.session = null;
    authState.appUser = null;
    vi.mocked(api.getTenantConfig).mockResolvedValue(DEFAULT_NORTHLINE_CONFIGURATION);
    renderWithProviders(
      <TenantProvider>
        <LoginPage />
      </TenantProvider>,
    );
    expect(await screen.findByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
  });
});

describe('dashboard states', () => {
  beforeEach(() => {
    vi.mocked(api.getWallet).mockReset();
    vi.mocked(api.getAccount).mockReset();
    vi.mocked(api.getTransactions).mockReset();
    vi.mocked(api.getTransfers).mockReset();
  });

  it('renders loading then balance from API', async () => {
    vi.mocked(api.getWallet).mockResolvedValue({
      id: 'w1',
      accountId: 'a1',
      balance: 250,
      currency: 'USD',
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(api.getAccount).mockResolvedValue({
      id: 'a1',
      accountNumber: '1234567890',
      accountType: 'escrow',
      accountStatus: 'active',
      balance: 250,
      currency: 'USD',
      oneTimeTransferUsed: false,
    });
    vi.mocked(api.getTransactions).mockResolvedValue({
      items: [],
      limit: 5,
      offset: 0,
      total: 0,
    });
    vi.mocked(api.getTransfers).mockResolvedValue({
      items: [],
      limit: 5,
      offset: 0,
      total: 0,
    });

    renderWithProviders(<UserDashboardPage />);

    expect(await screen.findByText(/available balance/i)).toBeInTheDocument();
    expect(screen.getByText(/250\.00/)).toBeInTheDocument();
    expect(screen.getByText(/escrow/i)).toBeInTheDocument();
    expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
  });

  it('renders dashboard error with retry', async () => {
    vi.mocked(api.getWallet).mockRejectedValue(new Error('boom'));
    vi.mocked(api.getAccount).mockRejectedValue(new Error('boom'));
    vi.mocked(api.getTransactions).mockRejectedValue(new Error('boom'));
    vi.mocked(api.getTransfers).mockRejectedValue(new Error('boom'));

    renderWithProviders(<UserDashboardPage />);
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});

describe('account rendering', () => {
  it('shows account fields from API', async () => {
    vi.mocked(api.getAccount).mockResolvedValue({
      id: 'a1',
      accountNumber: '1234567890',
      accountType: 'one_time_transfer',
      accountStatus: 'active',
      balance: 10,
      currency: 'USD',
      oneTimeTransferUsed: false,
    });
    vi.mocked(api.getWallet).mockResolvedValue({
      id: 'w1',
      accountId: 'a1',
      balance: 10,
      currency: 'USD',
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(api.getProfile).mockResolvedValue({
      id: 'p1',
      userId: 'u1',
      firstName: 'Casey',
      lastName: 'User',
      email: 'user@example.com',
      phone: null,
      username: 'casey',
      status: 'active',
      role: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    renderWithProviders(<AccountPage />);
    expect(await screen.findByText(/one-time transfer/i)).toBeInTheDocument();
    expect(screen.getByText(/1234 567 890/)).toBeInTheDocument();
  });
});

describe('transaction rendering', () => {
  it('renders transaction rows', async () => {
    vi.mocked(api.getWallet).mockResolvedValue({
      id: 'w1',
      accountId: 'a1',
      balance: 40,
      currency: 'USD',
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(api.getTransactions).mockResolvedValue({
      items: [
        {
          id: 't1',
          accountId: 'a1',
          walletId: 'w1',
          type: 'credit',
          status: 'completed',
          amount: 40,
          balanceBefore: 0,
          balanceAfter: 40,
          reference: 'REF-1',
          description: 'Funding',
          createdAt: new Date().toISOString(),
        },
      ],
      limit: 20,
      offset: 0,
      total: 1,
    });

    renderWithProviders(<TransactionsPage />);
    expect(await screen.findAllByText('REF-1')).not.toHaveLength(0);
    expect(screen.getAllByText(/funding/i).length).toBeGreaterThan(0);
  });
});

describe('admin wallet funding flow', () => {
  it('funds via API and shows confirmation balance', async () => {
    const user = userEvent.setup();
    vi.mocked(api.adminListUsers).mockResolvedValue({
      items: [
        {
          profile: {
            id: 'p1',
            userId: 'u1',
            firstName: 'Casey',
            lastName: 'User',
            email: 'casey@example.com',
            phone: null,
            username: 'casey',
            status: 'active',
            role: 'user',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          account: {
            id: 'a1',
            accountNumber: '1234567890',
            accountType: 'escrow',
            accountStatus: 'active',
            balance: 100,
            currency: 'USD',
            oneTimeTransferUsed: false,
          },
        },
      ],
      limit: 100,
      offset: 0,
      total: 1,
    });
    vi.mocked(api.adminFundWallet).mockResolvedValue({
      wallet: {
        id: 'w1',
        accountId: 'a1',
        balance: 150,
        currency: 'USD',
        updatedAt: new Date().toISOString(),
      },
      transaction: {
        id: 'tx1',
        accountId: 'a1',
        walletId: 'w1',
        type: 'credit',
        status: 'completed',
        amount: 50,
        balanceBefore: 100,
        balanceAfter: 150,
        reference: 'FUND-1',
        description: 'Test fund',
        createdAt: new Date().toISOString(),
      },
      idempotentReplay: false,
    });

    renderWithProviders(<AdminFundingPage />);

    const select = await screen.findByLabelText(/select user/i);
    await user.selectOptions(select, 'u1');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await user.type(screen.getByLabelText(/^amount$/i), '50');
    await user.click(screen.getByRole('button', { name: /review/i }));
    await user.click(screen.getByRole('button', { name: /confirm funding/i }));
    await user.click(screen.getByRole('button', { name: /^fund wallet$/i }));

    await waitFor(() => {
      expect(api.adminFundWallet).toHaveBeenCalled();
    });
    expect(await screen.findByText(/funding confirmed/i)).toBeInTheDocument();
    expect(screen.getByText(/150\.00/)).toBeInTheDocument();
    expect(screen.getByText('FUND-1')).toBeInTheDocument();
  });
});
