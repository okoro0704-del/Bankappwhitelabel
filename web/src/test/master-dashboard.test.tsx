import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '../components/ui/Toast';
import {
  MasterProtectedRoute,
  MasterPublicOnlyRoute,
} from '../components/MasterProtectedRoute';
import { MasterDashboardPage } from '../pages/master/MasterDashboardPage';
import { MasterApplicationsPage } from '../pages/master/MasterApplicationsPage';
import { MasterCreateApplicationPage } from '../pages/master/MasterCreateApplicationPage';
import { MasterApplicationDetailPage } from '../pages/master/MasterApplicationDetailPage';
import { MasterBrandingPage } from '../pages/master/MasterBrandingPage';
import { BrandingPreview } from '../pages/master/BrandingPreview';
import type { MasterTenantDetail, MasterTenantSummary, TenantBranding } from '../types/tenant';
import { DEFAULT_NEW_TENANT_BRANDING } from '../types/tenant';

const authState = vi.hoisted(() => ({
  loading: false,
  session: { access_token: 't' } as { access_token: string } | null,
  appUser: {
    userId: 'master-1',
    role: 'admin' as 'user' | 'admin',
    accountStatus: 'active' as const,
    email: 'master@example.com',
    username: 'master',
    firstName: 'Pat',
    lastName: 'Platform',
    isMasterAdmin: true as boolean | undefined,
  } as null | {
    userId: string;
    role: 'user' | 'admin';
    accountStatus: 'active' | 'suspended';
    email: string;
    username: string;
    firstName: string;
    lastName: string;
    isMasterAdmin?: boolean;
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
    masterListTenants: vi.fn(),
    masterGetTenant: vi.fn(),
    masterCreateTenant: vi.fn(),
    masterUpdateTenant: vi.fn(),
    masterActivateTenant: vi.fn(),
    masterDeactivateTenant: vi.fn(),
    masterVerifyTenantDns: vi.fn(),
    masterVerifyTenantSsl: vi.fn(),
    masterProvisionTenant: vi.fn(),
    masterGetTenantDeployment: vi.fn(),
  },
}));

import { api } from '../api/endpoints';

const branding: TenantBranding = {
  ...DEFAULT_NEW_TENANT_BRANDING,
  applicationName: 'Northline Partner',
  primaryColor: '#0B3D2E',
  secondaryColor: '#1F6F56',
  accentColor: '#C4A35A',
  loginHeadline: 'Welcome to Partner',
  loginSubtitle: 'Sign in to continue.',
  supportEmail: 'owner@example.com',
};

const sampleDeployment = {
  hostname: 'partner.app.example.com',
  loginUrl: 'https://partner.app.example.com/login',
  adminDashboardUrl: 'https://partner.app.example.com/admin',
  baseDomain: 'app.example.com',
  dnsTarget: 'edgeserver.example.com',
  dnsStatus: 'pending' as const,
  sslStatus: 'not_configured' as const,
  deploymentStatus: 'waiting_for_dns' as const,
  dnsRecord: {
    type: 'CNAME' as const,
    name: 'partner',
    target: 'edgeserver.example.com',
  },
  dnsCheckedAt: null,
  dnsVerifiedAt: null,
  lastProvisionedAt: null,
  sslCheckedAt: null,
  lastProvisionError: null,
  ownerAssigned: true,
  provider: 'manual' as const,
};

const sampleTenant: MasterTenantSummary = {
  id: 't-1',
  name: 'Partner App',
  slug: 'partner',
  status: 'active',
  subdomain: 'partner',
  hostname: 'partner.app.example.com',
  ownerUserId: '11111111-1111-4111-8111-111111111111',
  ownerAssigned: true,
  applicationName: 'Northline Partner',
  dnsStatus: 'pending',
  sslStatus: 'not_configured',
  deploymentStatus: 'waiting_for_dns',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
};

const sampleDetail: MasterTenantDetail = {
  tenant: {
    id: sampleTenant.id,
    name: sampleTenant.name,
    slug: sampleTenant.slug,
    status: sampleTenant.status,
    ownerUserId: sampleTenant.ownerUserId,
    subdomain: sampleTenant.subdomain,
    handoffTempPassword: 'TempPass123!',
    handoffAdminUsername: 'partner.admin',
    createdAt: sampleTenant.createdAt,
    updatedAt: sampleTenant.updatedAt,
  },
  branding,
  deployment: sampleDeployment,
};

function wrap(ui: ReactNode, path = '/') {
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
    </ToastProvider>,
  );
}

function asMaster() {
  authState.loading = false;
  authState.session = { access_token: 't' };
  authState.appUser = {
    userId: 'master-1',
    role: 'admin',
    accountStatus: 'active',
    email: 'master@example.com',
    username: 'master',
    firstName: 'Pat',
    lastName: 'Platform',
    isMasterAdmin: true,
  };
}

describe('Master Admin authentication', () => {
  beforeEach(() => {
    asMaster();
    vi.mocked(api.masterListTenants).mockReset();
    vi.mocked(api.masterGetTenant).mockReset();
    vi.mocked(api.masterCreateTenant).mockReset();
    vi.mocked(api.masterUpdateTenant).mockReset();
    vi.mocked(api.masterActivateTenant).mockReset();
    vi.mocked(api.masterDeactivateTenant).mockReset();
    vi.mocked(api.masterVerifyTenantDns).mockReset();
  });

  it('redirects unauthenticated Master routes to Master login', async () => {
    authState.session = null;
    authState.appUser = null;

    wrap(
      <Routes>
        <Route element={<MasterProtectedRoute />}>
          <Route path="/master" element={<div>Master home</div>} />
        </Route>
        <Route path="/master/login" element={<div>Master login screen</div>} />
      </Routes>,
      '/master',
    );

    expect(await screen.findByText('Master login screen')).toBeInTheDocument();
  });

  it('blocks authenticated non-Master users from the Master Dashboard', async () => {
    authState.appUser = {
      userId: 'u1',
      role: 'admin',
      accountStatus: 'active',
      email: 'admin@example.com',
      username: 'admin',
      firstName: 'Ada',
      lastName: 'Admin',
      isMasterAdmin: false,
    };

    wrap(
      <Routes>
        <Route element={<MasterProtectedRoute />}>
          <Route path="/master" element={<div>Master home</div>} />
        </Route>
      </Routes>,
      '/master',
    );

    expect(await screen.findByText('Web Finance access required')).toBeInTheDocument();
    expect(screen.queryByText('Master home')).not.toBeInTheDocument();
  });

  it('allows Master Admins into the Master Dashboard', async () => {
    wrap(
      <Routes>
        <Route element={<MasterProtectedRoute />}>
          <Route path="/master" element={<div>Master home</div>} />
        </Route>
      </Routes>,
      '/master',
    );

    expect(await screen.findByText('Master home')).toBeInTheDocument();
  });

  it('redirects signed-in Master Admins away from Master login', async () => {
    wrap(
      <Routes>
        <Route element={<MasterPublicOnlyRoute />}>
          <Route path="/master/login" element={<div>Master login screen</div>} />
        </Route>
        <Route path="/master" element={<div>Master home</div>} />
      </Routes>,
      '/master/login',
    );

    expect(await screen.findByText('Master home')).toBeInTheDocument();
  });
});

describe('Master applications', () => {
  beforeEach(() => {
    asMaster();
    vi.mocked(api.masterListTenants).mockReset();
    vi.mocked(api.masterGetTenant).mockReset();
    vi.mocked(api.masterCreateTenant).mockReset();
    vi.mocked(api.masterUpdateTenant).mockReset();
    vi.mocked(api.masterActivateTenant).mockReset();
    vi.mocked(api.masterDeactivateTenant).mockReset();
    vi.mocked(api.masterVerifyTenantDns).mockReset();
  });

  it('loads the tenant list', async () => {
    vi.mocked(api.masterListTenants).mockResolvedValue({
      items: [sampleTenant],
      limit: 100,
      offset: 0,
      total: 1,
    });

    wrap(<MasterApplicationsPage />);

    expect((await screen.findAllByText('Northline Partner')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('partner').length).toBeGreaterThan(0);
  });

  it('shows empty state when there are no applications', async () => {
    vi.mocked(api.masterListTenants).mockResolvedValue({
      items: [],
      limit: 100,
      offset: 0,
      total: 0,
    });

    wrap(<MasterApplicationsPage />);

    expect(await screen.findByText('No applications yet')).toBeInTheDocument();
    expect(screen.getByText(/Create your first application/i)).toBeInTheDocument();
  });

  it('filters applications by search and status', async () => {
    const user = userEvent.setup();
    vi.mocked(api.masterListTenants).mockResolvedValue({
      items: [
        sampleTenant,
        {
          ...sampleTenant,
          id: 't-2',
          name: 'Inactive Co',
          slug: 'inactive-co',
          subdomain: 'inactive-co',
          hostname: 'inactive-co.app.example.com',
          applicationName: 'Inactive Co',
          status: 'inactive',
          ownerAssigned: false,
          ownerUserId: null,
        },
      ],
      limit: 100,
      offset: 0,
      total: 2,
    });

    wrap(<MasterApplicationsPage />);
    expect((await screen.findAllByText('Northline Partner')).length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText('Search'), 'inactive');
    expect(screen.queryByText('Northline Partner')).not.toBeInTheDocument();
    expect(screen.getAllByText('Inactive Co').length).toBeGreaterThan(0);

    await user.clear(screen.getByLabelText('Search'));
    await user.selectOptions(screen.getByLabelText('Filter'), 'active');
    expect(screen.getAllByText('Northline Partner').length).toBeGreaterThan(0);
    expect(screen.queryByText('Inactive Co')).not.toBeInTheDocument();
  });

  it('validates the create application form', async () => {
    const user = userEvent.setup();
    wrap(
      <Routes>
        <Route path="/master/applications/new" element={<MasterCreateApplicationPage />} />
      </Routes>,
      '/master/applications/new',
    );

    await user.type(screen.getByLabelText('Application name'), 'A');
    await user.click(screen.getByRole('button', { name: /create application/i }));
    expect(await screen.findByText(/Name must be at least 2 characters/i)).toBeInTheDocument();
    expect(api.masterCreateTenant).not.toHaveBeenCalled();
  });

  it('creates an application through the Master API', async () => {
    const user = userEvent.setup();
    vi.mocked(api.masterCreateTenant).mockResolvedValue(sampleDetail);

    wrap(
      <Routes>
        <Route path="/master/applications/new" element={<MasterCreateApplicationPage />} />
        <Route path="/master/applications/:tenantId" element={<div>Created detail</div>} />
      </Routes>,
      '/master/applications/new',
    );

    await user.type(screen.getByLabelText('Application name'), 'Partner App');
    await user.click(screen.getByRole('button', { name: /create application/i }));

    await waitFor(() => {
      expect(api.masterCreateTenant).toHaveBeenCalled();
    });
    expect(await screen.findByText('Created detail')).toBeInTheDocument();
  });

  it('loads application details', async () => {
    vi.mocked(api.masterGetTenant).mockResolvedValue(sampleDetail);

    wrap(
      <Routes>
        <Route path="/master/applications/:tenantId" element={<MasterApplicationDetailPage />} />
      </Routes>,
      '/master/applications/t-1',
    );

    expect(await screen.findByText('Handoff information')).toBeInTheDocument();
    expect(screen.getByText('Customer login URL')).toBeInTheDocument();
    expect(screen.getByText('Admin Dashboard URL')).toBeInTheDocument();
    expect(screen.getAllByText('https://partner.app.example.com/admin').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Admin username').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('partner.admin')).toBeInTheDocument();
    expect(screen.getAllByText('Temporary password').length).toBeGreaterThan(0);
    expect(screen.getByDisplayValue('TempPass123!')).toBeInTheDocument();
    expect(screen.getAllByText('partner').length).toBeGreaterThan(0);
    expect(screen.getAllByText(sampleTenant.id).length).toBeGreaterThan(0);
  });

  it('activates an inactive application', async () => {
    const user = userEvent.setup();
    const inactive = {
      ...sampleDetail,
      tenant: { ...sampleDetail.tenant, status: 'inactive' as const },
    };
    vi.mocked(api.masterGetTenant)
      .mockResolvedValueOnce(inactive)
      .mockResolvedValue({ ...sampleDetail });
    vi.mocked(api.masterActivateTenant).mockResolvedValue(sampleDetail);

    wrap(
      <Routes>
        <Route path="/master/applications/:tenantId" element={<MasterApplicationDetailPage />} />
      </Routes>,
      '/master/applications/t-1',
    );

    expect(await screen.findByRole('button', { name: 'Activate' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() => expect(api.masterActivateTenant).toHaveBeenCalledWith('t-1'));
  });

  it('requires confirmation before deactivating', async () => {
    const user = userEvent.setup();
    vi.mocked(api.masterGetTenant).mockResolvedValue(sampleDetail);
    vi.mocked(api.masterDeactivateTenant).mockResolvedValue({
      ...sampleDetail,
      tenant: { ...sampleDetail.tenant, status: 'inactive' },
    });

    wrap(
      <Routes>
        <Route path="/master/applications/:tenantId" element={<MasterApplicationDetailPage />} />
      </Routes>,
      '/master/applications/t-1',
    );

    expect(await screen.findByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(api.masterDeactivateTenant).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/Are you sure you want to deactivate this application/i),
    ).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(api.masterDeactivateTenant).toHaveBeenCalledWith('t-1'));
  });

  it('derives dashboard totals from the tenant list only', async () => {
    vi.mocked(api.masterListTenants).mockResolvedValue({
      items: [
        sampleTenant,
        { ...sampleTenant, id: 't-2', status: 'inactive', applicationName: 'Other' },
      ],
      limit: 100,
      offset: 0,
      total: 2,
    });

    wrap(<MasterDashboardPage />);
    expect(await screen.findByText('Total applications')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });
});

describe('Master branding', () => {
  beforeEach(() => {
    asMaster();
    vi.mocked(api.masterGetTenant).mockReset();
    vi.mocked(api.masterUpdateTenant).mockReset();
  });

  it('loads branding form and updates live preview without saving', async () => {
    const user = userEvent.setup();
    vi.mocked(api.masterGetTenant).mockResolvedValue(sampleDetail);

    wrap(
      <Routes>
        <Route
          path="/master/applications/:tenantId/branding"
          element={<MasterBrandingPage />}
        />
      </Routes>,
      '/master/applications/t-1/branding',
    );

    expect(await screen.findByLabelText('Application name')).toHaveValue('Northline Partner');
    expect(screen.getByLabelText('Branding preview')).toHaveTextContent('Welcome to Partner');

    await user.clear(screen.getByLabelText('Login headline'));
    await user.type(screen.getByLabelText('Login headline'), 'Hello Contoso');
    expect(screen.getByLabelText('Branding preview')).toHaveTextContent('Hello Contoso');
    expect(api.masterUpdateTenant).not.toHaveBeenCalled();
  });

  it('saves branding explicitly', async () => {
    const user = userEvent.setup();
    vi.mocked(api.masterGetTenant).mockResolvedValue(sampleDetail);
    vi.mocked(api.masterUpdateTenant).mockResolvedValue({
      ...sampleDetail,
      branding: { ...branding, applicationName: 'Updated Partner' },
    });

    wrap(
      <Routes>
        <Route
          path="/master/applications/:tenantId/branding"
          element={<MasterBrandingPage />}
        />
      </Routes>,
      '/master/applications/t-1/branding',
    );

    await screen.findByLabelText('Application name');
    await user.clear(screen.getByLabelText('Application name'));
    await user.type(screen.getByLabelText('Application name'), 'Updated Partner');
    await user.click(screen.getByRole('button', { name: /save branding/i }));

    await waitFor(() => {
      expect(api.masterUpdateTenant).toHaveBeenCalledWith(
        't-1',
        expect.objectContaining({
          branding: expect.objectContaining({ applicationName: 'Updated Partner' }),
        }),
      );
    });
  });

  it('shows save failure without claiming success', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('../api/errors');
    vi.mocked(api.masterGetTenant).mockResolvedValue(sampleDetail);
    vi.mocked(api.masterUpdateTenant).mockRejectedValue(
      new ApiError('FORBIDDEN', 'Nope', 403),
    );

    wrap(
      <Routes>
        <Route
          path="/master/applications/:tenantId/branding"
          element={<MasterBrandingPage />}
        />
      </Routes>,
      '/master/applications/t-1/branding',
    );

    await screen.findByLabelText('Application name');
    await user.type(screen.getByLabelText('Application name'), ' X');
    await user.click(screen.getByRole('button', { name: /save branding/i }));
    expect(await screen.findByText(/Could not save branding/i)).toBeInTheDocument();
    expect(screen.getByText(/Nope/i)).toBeInTheDocument();
  });

  it('preview component reflects branding props', () => {
    render(
      <BrandingPreview
        branding={{
          ...branding,
          applicationName: 'Preview Co',
          loginHeadline: 'Preview headline',
        }}
      />,
    );
    expect(screen.getByText('Preview Co')).toBeInTheDocument();
    expect(screen.getByText('Preview headline')).toBeInTheDocument();
  });
});

describe('Master deployment handoff', () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    asMaster();
    vi.mocked(api.masterGetTenant).mockReset();
    vi.mocked(api.masterListTenants).mockReset();
    vi.mocked(api.masterVerifyTenantDns).mockReset();
    vi.mocked(api.masterVerifyTenantSsl).mockReset();
    vi.mocked(api.masterProvisionTenant).mockReset();
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  it('shows deployment status, DNS instructions, and owner assignment', async () => {
    vi.mocked(api.masterGetTenant).mockResolvedValue(sampleDetail);

    wrap(
      <Routes>
        <Route path="/master/applications/:tenantId" element={<MasterApplicationDetailPage />} />
      </Routes>,
      '/master/applications/t-1',
    );

    expect(await screen.findByText('Deployment')).toBeInTheDocument();
    expect(screen.getAllByText('Waiting for DNS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('partner.app.example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('edgeserver.example.com').length).toBeGreaterThan(0);
    expect(screen.getByText('CNAME')).toBeInTheDocument();
    expect(screen.getAllByText('https://partner.app.example.com/login').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Provision' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Provisioning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify SSL' })).toBeInTheDocument();
    expect(screen.queryByText(/^Ready$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/NETLIFY_AUTH_TOKEN|service_role/i)).not.toBeInTheDocument();
  });

  it('calls provision endpoint from Master deployment actions', async () => {
    const user = userEvent.setup();
    vi.mocked(api.masterGetTenant).mockResolvedValue(sampleDetail);
    vi.mocked(api.masterProvisionTenant).mockResolvedValue({
      status: 'waiting_for_dns',
      hostname: 'partner.app.example.com',
      expectedTarget: 'edgeserver.example.com',
      deploymentStatus: 'waiting_for_dns',
      dnsStatus: 'pending',
      sslStatus: 'pending',
      message: 'Hostname associated and DNS record configured. SSL is pending.',
      checkedAt: '2026-07-31T12:00:00.000Z',
      code: 'DNS_NOT_READY',
      tenant: sampleDetail,
    });

    wrap(
      <Routes>
        <Route path="/master/applications/:tenantId" element={<MasterApplicationDetailPage />} />
      </Routes>,
      '/master/applications/t-1',
    );

    expect(await screen.findByRole('button', { name: 'Provision' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Provision' }));
    expect(api.masterProvisionTenant).toHaveBeenCalledWith('t-1');
  });

  it('shows owner not assigned when no owner UUID', async () => {
    vi.mocked(api.masterGetTenant).mockResolvedValue({
      ...sampleDetail,
      tenant: { ...sampleDetail.tenant, ownerUserId: null },
      deployment: { ...sampleDeployment, ownerAssigned: false },
    });

    wrap(
      <Routes>
        <Route path="/master/applications/:tenantId" element={<MasterApplicationDetailPage />} />
      </Routes>,
      '/master/applications/t-1',
    );

    expect(await screen.findAllByText(/^Owner not assigned$/i)).toHaveLength(2);
  });

  it('copies hostname and login URL from handoff', async () => {
    vi.mocked(api.masterGetTenant).mockResolvedValue(sampleDetail);

    wrap(
      <Routes>
        <Route path="/master/applications/:tenantId" element={<MasterApplicationDetailPage />} />
      </Routes>,
      '/master/applications/t-1',
    );

    const handoffHeading = await screen.findByText('Handoff information');
    const handoff = handoffHeading.closest('.card') as HTMLElement;
    const hostnameRow = within(handoff)
      .getByText('Hostname')
      .closest('.handoff-row') as HTMLElement;
    const loginRow = within(handoff)
      .getByText('Customer login URL')
      .closest('.handoff-row') as HTMLElement;

    fireEvent.click(within(hostnameRow).getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('partner.app.example.com');
    });

    fireEvent.click(within(loginRow).getByRole('button', { name: 'Copy' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://partner.app.example.com/login');
    });
  });

  it('filters DNS pending applications without inventing ready rows', async () => {
    const user = userEvent.setup();
    vi.mocked(api.masterListTenants).mockResolvedValue({
      items: [
        sampleTenant,
        {
          ...sampleTenant,
          id: 't-ready',
          name: 'Ready Co',
          slug: 'ready-co',
          applicationName: 'Ready Co',
          hostname: 'ready-co.app.example.com',
          dnsStatus: 'verified',
          sslStatus: 'verified',
          deploymentStatus: 'ready',
        },
      ],
      limit: 100,
      offset: 0,
      total: 2,
    });

    wrap(<MasterApplicationsPage />);
    expect((await screen.findAllByText('Northline Partner')).length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText('Filter'), 'dns_pending');
    expect(screen.getAllByText('Northline Partner').length).toBeGreaterThan(0);
    expect(screen.queryByText('Ready Co')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter'), 'ready');
    expect(screen.getAllByText('Ready Co').length).toBeGreaterThan(0);
    expect(screen.queryByText('Northline Partner')).not.toBeInTheDocument();
  });
});

describe('Master security surface', () => {
  it('does not render sensitive backend secrets in branding/config fixtures', () => {
    const serialized = JSON.stringify({ sampleDetail, branding });
    expect(serialized).not.toMatch(/service_role|jwt.?secret|database.?password|SUPABASE_SERVICE/i);
  });
});
