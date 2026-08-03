import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, Route, Routes, RouterProvider } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import { ProfilePage } from '../pages/user/ProfilePage';
import { TransactionsPage } from '../pages/user/TransactionsPage';
import { UserDashboardPage } from '../pages/user/DashboardPage';
import { AdminDashboardPage } from '../pages/admin/AdminDashboardPage';
import { AdminUsersPage } from '../pages/admin/AdminUsersPage';
import { AdminUserDetailPage } from '../pages/admin/AdminUserDetailPage';
import { AdminCreateUserPage } from '../pages/admin/AdminCreateUserPage';
import {
  AdminAccountsPage,
  AdminSettingsPage,
  AdminTransactionsPage,
  AdminTransfersPage,
} from '../pages/admin/AdminListPages';
import { ProtectedRoute } from '../components/ProtectedRoute';
import { statusTone, transactionTypeLabel } from '../utils/format';

const authState = vi.hoisted(() => ({
  loading: false,
  session: { access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 },
  appUser: {
    userId: 'u1',
    role: 'user' as 'user' | 'admin',
    accountStatus: 'active' as const,
    email: 'user@example.com',
    username: 'casey',
    firstName: 'Casey',
    lastName: 'User',
  },
  error: null as string | null,
  signIn: vi.fn(),
  signOut: vi.fn(async () => undefined),
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
    getProfile: vi.fn(),
    getTransactions: vi.fn(),
    getTransfers: vi.fn(),
    getTransaction: vi.fn(),
    getTransfer: vi.fn(),
    adminListUsers: vi.fn(),
    adminGetUser: vi.fn(),
    adminCreateUser: vi.fn(),
    adminUpdateStatus: vi.fn(),
    adminListTransactions: vi.fn(),
    adminListTransfers: vi.fn(),
    adminGetTransfer: vi.fn(),
    adminFundWallet: vi.fn(),
  },
}));

import { api } from '../api/endpoints';

function wrap(ui: ReactNode) {
  return render(
    <ToastProvider>
      <MemoryRouter>{ui}</MemoryRouter>
    </ToastProvider>,
  );
}

const sampleUser = {
  profile: {
    id: 'p1',
    userId: 'u1',
    firstName: 'Casey',
    lastName: 'User',
    email: 'casey@example.com',
    phone: null,
    username: 'casey',
    status: 'active' as const,
    role: 'user' as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  account: {
    id: 'a1',
    accountNumber: '1234567890',
    accountType: 'escrow' as const,
    accountStatus: 'active' as const,
    balance: 120,
    currency: 'USD',
    oneTimeTransferUsed: false,
  },
};

describe('format helpers phase 3', () => {
  it('maps transaction types and status tones', () => {
    expect(transactionTypeLabel('funding')).toBe('Funding');
    expect(statusTone('completed')).toBe('success');
    expect(statusTone('failed')).toBe('danger');
    expect(statusTone('verification_stage_2')).toBe('info');
  });
});

describe('user phase 3 screens', () => {
  beforeEach(() => {
    authState.appUser.role = 'user';
    vi.mocked(api.getWallet).mockResolvedValue({
      id: 'w1',
      accountId: 'a1',
      balance: 100,
      currency: 'USD',
      updatedAt: new Date().toISOString(),
    });
    vi.mocked(api.getAccount).mockResolvedValue(sampleUser.account);
    vi.mocked(api.getProfile).mockResolvedValue(sampleUser.profile);
    vi.mocked(api.getTransactions).mockResolvedValue({ items: [], limit: 5, offset: 0, total: 0 });
    vi.mocked(api.getTransfers).mockResolvedValue({ items: [], limit: 5, offset: 0, total: 0 });
  });

  it('shows dashboard refresh and transfer navigation', async () => {
    wrap(<UserDashboardPage />);
    expect(await screen.findByRole('button', { name: /refresh/i })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /transfer/i }).length).toBeGreaterThan(0);
  });

  it('opens transaction details from transactions page', async () => {
    const user = userEvent.setup();
    const tx = {
      id: 't1',
      accountId: 'a1',
      walletId: 'w1',
      type: 'funding',
      status: 'completed',
      amount: 50,
      balanceBefore: 50,
      balanceAfter: 100,
      reference: 'FUND-99',
      description: 'Admin credit',
      createdAt: new Date().toISOString(),
    };
    vi.mocked(api.getTransactions).mockResolvedValue({
      items: [tx],
      limit: 20,
      offset: 0,
      total: 1,
    });
    vi.mocked(api.getTransaction).mockResolvedValue(tx);

    wrap(<TransactionsPage />);
    expect(await screen.findAllByText('FUND-99')).not.toHaveLength(0);
    await user.click(screen.getAllByRole('button', { name: /details/i })[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/balance after/i)).toBeInTheDocument();
  });

  it('renders read-only profile with sign out', async () => {
    wrap(<ProfilePage />);
    expect(await screen.findByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});

describe('admin phase 3 screens', () => {
  beforeEach(() => {
    authState.appUser.role = 'admin';
    vi.mocked(api.adminListUsers).mockResolvedValue({
      items: [sampleUser],
      limit: 5,
      offset: 0,
      total: 1,
    });
    vi.mocked(api.adminListTransactions).mockResolvedValue({
      items: [
        {
          id: 't1',
          accountId: 'a1',
          walletId: 'w1',
          type: 'funding',
          status: 'completed',
          amount: 50,
          balanceBefore: 70,
          balanceAfter: 120,
          reference: 'ADM-FUND',
          description: null,
          createdAt: new Date().toISOString(),
        },
      ],
      limit: 5,
      offset: 0,
      total: 1,
    });
    vi.mocked(api.adminListTransfers).mockResolvedValue({
      items: [
        {
          id: 'tr1',
          reference: 'XFER-ADM',
          status: 'completed',
          amount: 10,
          recipient: { name: 'Alex', account: '9988776655', bank: 'Harbor' },
          description: null,
          currentStage: 0,
          stagesCompleted: 0,
          reasonCode: null,
          failureReason: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      ],
      limit: 5,
      offset: 0,
      total: 1,
    });
  });

  it('renders admin dashboard totals and recent activity', async () => {
    wrap(<AdminDashboardPage />);
    expect(await screen.findByText(/total users/i)).toBeInTheDocument();
    expect(screen.getByText('ADM-FUND')).toBeInTheDocument();
    expect(screen.getByText(/XFER-ADM/)).toBeInTheDocument();
    expect(screen.queryByText(/no aggregate endpoint yet/i)).not.toBeInTheDocument();
  });

  it('lists users and navigates to details', async () => {
    wrap(<AdminUsersPage />);
    expect((await screen.findAllByText(/casey@example.com/i)).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: /details/i })[0]).toHaveAttribute(
      'href',
      '/admin/users/u1',
    );
  });

  it('loads user details and account activity', async () => {
    vi.mocked(api.adminGetUser).mockResolvedValue(sampleUser);
    const router = createMemoryRouter(
      [{ path: '/admin/users/:userId', element: <AdminUserDetailPage /> }],
      { initialEntries: ['/admin/users/u1'] },
    );
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    );
    expect(await screen.findByText(/account & wallet/i)).toBeInTheDocument();
    expect(screen.getByText(/account holder deliverables/i)).toBeInTheDocument();
    expect(screen.getByText(/recent account activity/i)).toBeInTheDocument();
    expect(screen.getByText('ADM-FUND')).toBeInTheDocument();
  });

  it('creates a user through the admin form', async () => {
    const user = userEvent.setup();
    vi.mocked(api.adminCreateUser).mockResolvedValue({
      ...sampleUser,
      profile: { ...sampleUser.profile, userId: 'u-new' },
    });
    const router = createMemoryRouter(
      [
        { path: '/admin/users/new', element: <AdminCreateUserPage /> },
        { path: '/admin/users/:userId', element: <div>Created user page</div> },
      ],
      { initialEntries: ['/admin/users/new'] },
    );
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>,
    );

    await user.type(screen.getByLabelText(/first name/i), 'New');
    await user.type(screen.getByLabelText(/last name/i), 'Person');
    await user.type(screen.getByLabelText(/^email$/i), 'new@example.com');
    await user.type(screen.getByLabelText(/^username$/i), 'newperson');
    await user.click(screen.getByRole('button', { name: /create user/i }));

    await waitFor(() => {
      expect(api.adminCreateUser).toHaveBeenCalled();
    });
    expect(await screen.findByText(/account holder deliverables/i)).toBeInTheDocument();
    expect(screen.getByText('Temporary password')).toBeInTheDocument();
    expect(api.adminCreateUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'newperson',
        password: 'newperson',
      }),
    );
  });

  it('lists accounts, transactions, transfers, and settings', async () => {
    const { unmount: unmountAccounts } = wrap(<AdminAccountsPage />);
    expect((await screen.findAllByText(/1234 567 890/)).length).toBeGreaterThan(0);
    unmountAccounts();

    const { unmount: unmountTx } = wrap(<AdminTransactionsPage />);
    expect(await screen.findByText('ADM-FUND')).toBeInTheDocument();
    unmountTx();

    const { unmount: unmountTr } = wrap(<AdminTransfersPage />);
    expect(await screen.findByText('XFER-ADM')).toBeInTheDocument();
    unmountTr();

    wrap(<AdminSettingsPage />);
    expect(await screen.findByText(/signed-in administrator/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('opens admin transfer details from list', async () => {
    const user = userEvent.setup();
    vi.mocked(api.adminGetTransfer).mockResolvedValue({
      id: 'tr1',
      reference: 'XFER-ADM',
      status: 'completed',
      amount: 10,
      recipient: { name: 'Alex', account: '9988776655', bank: 'Harbor' },
      description: null,
      currentStage: 0,
      stagesCompleted: 0,
      reasonCode: null,
      failureReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
    wrap(<AdminTransfersPage />);
    await user.click((await screen.findAllByRole('button', { name: /details/i }))[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/harbor/i)).toBeInTheDocument();
  });

  it('keeps non-admins out of admin screens', async () => {
    authState.appUser.role = 'user';
    render(
      <ToastProvider>
        <MemoryRouter initialEntries={['/admin']}>
          <Routes>
            <Route element={<ProtectedRoute role="admin" />}>
              <Route path="/admin" element={<div>Admin only</div>} />
            </Route>
            <Route path="/app" element={<div>User home</div>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>,
    );
    expect(await screen.findByText('User home')).toBeInTheDocument();
  });
});
