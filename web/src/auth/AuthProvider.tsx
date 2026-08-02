import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';

import { api } from '../api/endpoints';
import { ApiError, getFriendlyErrorMessage } from '../api/errors';
import { getSupabase } from './supabase';
import type { SessionUser } from '../types/api';

interface AuthState {
  loading: boolean;
  session: Session | null;
  appUser: SessionUser | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  refreshAppUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

async function loadAppUser(): Promise<SessionUser> {
  return api.getSession();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [appUser, setAppUser] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(async (next: Session | null) => {
    setSession(next);
    setError(null);

    if (!next) {
      setAppUser(null);
      return;
    }

    try {
      const user = await loadAppUser();
      setAppUser(user);
    } catch (err) {
      setAppUser(null);
      if (err instanceof ApiError && err.code === 'ACCOUNT_INACTIVE') {
        setError(getFriendlyErrorMessage(err));
        await getSupabase().auth.signOut();
        setSession(null);
        return;
      }
      if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
        setError(getFriendlyErrorMessage(err));
        await getSupabase().auth.signOut();
        setSession(null);
        return;
      }
      setError(getFriendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const { data } = await getSupabase().auth.getSession();
        if (!mounted) return;
        await hydrate(data.session);
      } catch (err) {
        if (mounted) {
          setError(getFriendlyErrorMessage(err));
          setAppUser(null);
          setSession(null);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    const { data: subscription } = getSupabase().auth.onAuthStateChange(
      async (_event, nextSession) => {
        setLoading(true);
        await hydrate(nextSession);
        setLoading(false);
      },
    );

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [hydrate]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const { data, error: authError } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        const message = authError.message.toLowerCase().includes('invalid')
          ? 'Invalid email or password.'
          : authError.message;
        setError(message);
        throw new ApiError('UNAUTHENTICATED', message, 401);
      }

      await hydrate(data.session);
    },
    [hydrate],
  );

  const signOut = useCallback(async () => {
    setError(null);
    await getSupabase().auth.signOut();
    setSession(null);
    setAppUser(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    const { error: resetError } = await getSupabase().auth.resetPasswordForEmail(email.trim());
    if (resetError) {
      throw new ApiError('VALIDATION_ERROR', resetError.message, 400);
    }
  }, []);

  const refreshAppUser = useCallback(async () => {
    if (!session) return;
    const user = await loadAppUser();
    setAppUser(user);
  }, [session]);

  const value = useMemo(
    () => ({
      loading,
      session,
      appUser,
      error,
      signIn,
      signOut,
      resetPassword,
      refreshAppUser,
    }),
    [loading, session, appUser, error, signIn, signOut, resetPassword, refreshAppUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}
