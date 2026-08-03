import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ApiError } from '../api/errors';
import { AuthLayout } from '../layouts/AuthLayout';
import { LoginPage } from '../pages/auth/LoginPage';
import { BrandMark } from '../tenant/BrandMark';
import {
  applyTenantCssVariables,
  clearTenantCssVariables,
  sanitizeBranding,
  sanitizeHexColor,
  sanitizePublicUrl,
} from '../tenant/branding';
import { CustomerTenantGate } from '../tenant/CustomerTenantGate';
import { TenantProvider, useTenant } from '../tenant/TenantProvider';
import type { TenantConfiguration } from '../types/tenant';
import { DEFAULT_NORTHLINE_CONFIGURATION } from '../types/tenant';

const authState = vi.hoisted(() => ({
  loading: false,
  session: null as { access_token: string } | null,
  appUser: null as null | { role: 'user' | 'admin' },
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
    getTenantConfig: vi.fn(),
  },
}));

import { api } from '../api/endpoints';

function tenantConfig(overrides: Partial<TenantConfiguration> = {}): TenantConfiguration {
  return {
    ...DEFAULT_NORTHLINE_CONFIGURATION,
    ...overrides,
    branding: {
      ...DEFAULT_NORTHLINE_CONFIGURATION.branding,
      ...overrides.branding,
    },
  };
}

function renderBrandedLogin() {
  return render(
    <TenantProvider>
      <MemoryRouter initialEntries={['/login']}>
        <Routes>
          <Route element={<CustomerTenantGate />}>
            <Route element={<AuthLayout />}>
              <Route path="/login" element={<LoginPage />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </TenantProvider>,
  );
}

function ReloadControl() {
  const { reload } = useTenant();
  return (
    <button type="button" onClick={() => void reload()}>
      Reload tenant
    </button>
  );
}

describe('branding sanitization', () => {
  it('accepts only #RRGGBB colors', () => {
    expect(sanitizeHexColor('#1F6F68', '#000000')).toBe('#1F6F68');
    expect(sanitizeHexColor('red', '#0B3D2E')).toBe('#0B3D2E');
    expect(sanitizeHexColor('javascript:alert(1)', '#0B3D2E')).toBe('#0B3D2E');
  });

  it('accepts http(s) and same-origin relative public URLs', () => {
    expect(sanitizePublicUrl('https://cdn.example.com/logo.png')).toBe(
      'https://cdn.example.com/logo.png',
    );
    expect(sanitizePublicUrl('/cit-bank-logo.png')).toBe('/cit-bank-logo.png');
    expect(sanitizePublicUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizePublicUrl('data:text/html,hi')).toBeNull();
    expect(sanitizePublicUrl('//evil.example/x.png')).toBeNull();
  });

  it('sanitizes branding payloads safely', () => {
    const safe = sanitizeBranding({
      applicationName: 'Acme',
      logoUrl: 'javascript:evil',
      faviconUrl: 'https://cdn.example.com/favicon.ico',
      primaryColor: 'not-a-color',
      secondaryColor: '#112233',
      accentColor: '#AABBCC',
      loginHeadline: 'Hello',
      loginSubtitle: null,
      supportEmail: null,
      supportPhone: null,
    });
    expect(safe.logoUrl).toBeNull();
    expect(safe.faviconUrl).toBe('https://cdn.example.com/favicon.ico');
    expect(safe.primaryColor).toBe('#0B3D2E');
    expect(safe.secondaryColor).toBe('#112233');
  });

  it('applies CSS variables without injecting unsafe values', () => {
    const root = document.createElement('div');
    applyTenantCssVariables(
      sanitizeBranding({
        ...DEFAULT_NORTHLINE_CONFIGURATION.branding,
        primaryColor: '#ABCDEF',
        secondaryColor: '#123456',
        accentColor: '#FEDCBA',
      }),
      root,
    );
    expect(root.style.getPropertyValue('--tenant-primary')).toBe('#ABCDEF');
    expect(root.style.getPropertyValue('--tenant-secondary')).toBe('#123456');
    expect(root.style.getPropertyValue('--nl-accent')).toBe('#123456');
    clearTenantCssVariables(root);
    expect(root.style.getPropertyValue('--tenant-primary')).toBe('');
  });

  it('BrandMark falls back to initial when logo is missing', () => {
    render(<BrandMark applicationName="Summit" logoUrl={null} />);
    expect(screen.getByText('S')).toBeInTheDocument();
  });
});

describe('runtime tenant branding', () => {
  beforeEach(() => {
    vi.mocked(api.getTenantConfig).mockReset();
    authState.session = null;
    authState.appUser = null;
    document.title = 'Application';
  });

  it('renders Tenant A branding from config', async () => {
    vi.mocked(api.getTenantConfig).mockResolvedValue(
      tenantConfig({
        tenantId: 'tenant-a',
        name: 'Acme',
        slug: 'acme',
        subdomain: 'acme',
        branding: {
          ...DEFAULT_NORTHLINE_CONFIGURATION.branding,
          applicationName: 'Acme Banking',
          loginHeadline: 'Welcome to Acme',
          loginSubtitle: 'Sign in to Acme.',
          primaryColor: '#111111',
          secondaryColor: '#222222',
          accentColor: '#333333',
        },
      }),
    );

    renderBrandedLogin();

    expect(await screen.findByText('Acme Banking')).toBeInTheDocument();
    expect(screen.getByText('Welcome to Acme')).toBeInTheDocument();
    expect(screen.queryByText('Summit Finance')).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Acme Banking'));
  });

  it('renders Tenant B branding and never Tenant A copy', async () => {
    vi.mocked(api.getTenantConfig).mockResolvedValue(
      tenantConfig({
        tenantId: 'tenant-b',
        name: 'Summit',
        slug: 'summit',
        subdomain: 'summit',
        branding: {
          ...DEFAULT_NORTHLINE_CONFIGURATION.branding,
          applicationName: 'Summit Finance',
          loginHeadline: 'Summit sign-in',
          loginSubtitle: 'Continue to Summit.',
        },
      }),
    );

    renderBrandedLogin();

    expect(await screen.findByText('Summit Finance')).toBeInTheDocument();
    expect(screen.getByText('Summit sign-in')).toBeInTheDocument();
    expect(screen.queryByText('Acme Banking')).not.toBeInTheDocument();
    expect(screen.queryByText('Northline')).not.toBeInTheDocument();
  });

  it('shows unavailable state when tenant config is not found (inactive/unknown)', async () => {
    vi.mocked(api.getTenantConfig).mockRejectedValue(
      new ApiError('NOT_FOUND', 'Tenant not found', 404),
    );

    renderBrandedLogin();

    expect(await screen.findByText('Application unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /sign in/i })).not.toBeInTheDocument();
  });

  it('shows unavailable when API returns inactive status', async () => {
    vi.mocked(api.getTenantConfig).mockResolvedValue(
      tenantConfig({
        status: 'inactive',
        branding: {
          ...DEFAULT_NORTHLINE_CONFIGURATION.branding,
          applicationName: 'Should Not Appear',
        },
      }),
    );

    renderBrandedLogin();

    expect(await screen.findByText('Application unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Should Not Appear')).not.toBeInTheDocument();
  });

  it('shows error state with retry when configuration fails', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getTenantConfig)
      .mockRejectedValueOnce(new ApiError('NETWORK_ERROR', 'Unable to reach the server', 0))
      .mockResolvedValueOnce(
        tenantConfig({
          branding: {
            ...DEFAULT_NORTHLINE_CONFIGURATION.branding,
            applicationName: 'Recovered App',
            loginHeadline: 'Back online',
          },
        }),
      );

    renderBrandedLogin();

    expect(
      await screen.findByText(/Could not load application configuration/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(await screen.findByText('Recovered App')).toBeInTheDocument();
  });

  it('applies updated branding after configuration reload', async () => {
    const user = userEvent.setup();
    vi.mocked(api.getTenantConfig)
      .mockResolvedValueOnce(
        tenantConfig({
          branding: {
            ...DEFAULT_NORTHLINE_CONFIGURATION.branding,
            applicationName: 'Before Save',
            loginHeadline: 'Old headline',
          },
        }),
      )
      .mockResolvedValueOnce(
        tenantConfig({
          branding: {
            ...DEFAULT_NORTHLINE_CONFIGURATION.branding,
            applicationName: 'After Save',
            loginHeadline: 'New headline',
          },
        }),
      );

    render(
      <TenantProvider>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route element={<CustomerTenantGate />}>
              <Route element={<AuthLayout />}>
                <Route
                  path="/login"
                  element={
                    <>
                      <LoginPage />
                      <ReloadControl />
                    </>
                  }
                />
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </TenantProvider>,
    );

    expect(await screen.findByText('Before Save')).toBeInTheDocument();
    expect(document.title).toBe('Before Save');

    await user.click(screen.getByRole('button', { name: /reload tenant/i }));

    expect(await screen.findByText('After Save')).toBeInTheDocument();
    expect(screen.getByText('New headline')).toBeInTheDocument();
    expect(screen.queryByText('Before Save')).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('After Save'));
  });
});

describe('tenant security surface', () => {
  it('does not expose secrets in public tenant configuration fixtures', () => {
    const serialized = JSON.stringify(DEFAULT_NORTHLINE_CONFIGURATION);
    expect(serialized).not.toMatch(/service_role|jwt.?secret|database.?password|SUPABASE_SERVICE/i);
  });
});
