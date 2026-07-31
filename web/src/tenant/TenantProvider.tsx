import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/errors';
import type { TenantBranding, TenantConfiguration } from '../types/tenant';
import {
  applyDocumentTitle,
  applyFavicon,
  applyTenantCssVariables,
  clearTenantCssVariables,
  sanitizeBranding,
} from './branding';

export type TenantLoadState =
  | { status: 'loading' }
  | { status: 'ready'; config: TenantConfiguration; branding: TenantBranding }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string };

interface TenantContextValue {
  state: TenantLoadState;
  config: TenantConfiguration | null;
  branding: TenantBranding | null;
  loading: boolean;
  reload: () => Promise<void>;
}

const TenantContext = createContext<TenantContextValue | null>(null);

function isUnavailableError(error: unknown): boolean {
  return error instanceof ApiError && (error.code === 'NOT_FOUND' || error.status === 404);
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TenantLoadState>({ status: 'loading' });

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const config = await api.getTenantConfig();
      if (config.status !== 'active') {
        clearTenantCssVariables();
        setState({
          status: 'unavailable',
          message: 'This application is currently unavailable.',
        });
        applyDocumentTitle('Application unavailable');
        return;
      }

      const branding = sanitizeBranding(config.branding);
      applyTenantCssVariables(branding);
      applyDocumentTitle(branding.applicationName);
      applyFavicon(branding.faviconUrl);
      setState({ status: 'ready', config: { ...config, branding }, branding });
    } catch (error) {
      clearTenantCssVariables();
      applyFavicon(null);
      if (isUnavailableError(error)) {
        applyDocumentTitle('Application unavailable');
        setState({
          status: 'unavailable',
          message:
            'This application is not available. It may be inactive or the hostname is not configured.',
        });
        return;
      }
      applyDocumentTitle('Configuration error');
      setState({
        status: 'error',
        message: getFriendlyErrorMessage(error),
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const value = useMemo<TenantContextValue>(
    () => ({
      state,
      config: state.status === 'ready' ? state.config : null,
      branding: state.status === 'ready' ? state.branding : null,
      loading: state.status === 'loading',
      reload: load,
    }),
    [state, load],
  );

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    throw new Error('useTenant must be used within TenantProvider');
  }
  return ctx;
}

/** Optional hook for surfaces that may render outside TenantProvider (tests). */
export function useOptionalTenant(): TenantContextValue | null {
  return useContext(TenantContext);
}
