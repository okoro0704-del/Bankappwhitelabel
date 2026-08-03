import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  signIn: (usernameOrEmail: string, password: string) => Promise<SessionUser>;
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
  const appUserRef = useRef<SessionUser | null>(null);
  const sessionUserIdRef = useRef<string | null>(null);
  const hydrateGen = useRef(0);

  useEffect(() => {
    appUserRef.current = appUser;
  }, [appUser]);

  useEffect(() => {
    sessionUserIdRef.current = session?.user?.id ?? null;
  }, [session]);

  const hydrate = useCallback(async (next: Session | null) => {
    const gen = ++hydrateGen.current;
    setSession(next);

    if (!next) {
      setAppUser(null);
      return;
    }

    // Same signed-in user already loaded — keep existing appUser (avoids login bounce).
    if (appUserRef.current?.userId === next.user.id) {
      setError(null);
      return;
    }

    try {
      const user = await loadAppUser();
      if (gen !== hydrateGen.current) return;
      setAppUser(user);
      setError(null);
    } catch (err) {
      if (gen !== hydrateGen.current) return;
      setAppUser(null);
      if (err instanceof ApiError && err.code === 'ACCOUNT_INACTIVE') {
        setError(getFriendlyErrorMessage(err));
        await getSupabase().auth.signOut();
        setSession(null);
        return;
      }
      // Do not sign out on profile load failures — that bounces users off /admin right after login.
      setError(getFriendlyErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    void (async () => {
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

    const { data: subscription } = getSupabase().auth.onAuthStateChange((event, nextSession) => {
      // Defer to avoid supabase-js auth deadlocks with async callbacks.
      window.setTimeout(() => {
        void (async () => {
          if (!mounted) return;

          if (event === 'SIGNED_OUT') {
            setSession(null);
            setAppUser(null);
            setError(null);
            setLoading(false);
            return;
          }

          const sameUser =
            Boolean(nextSession?.user?.id) &&
            (appUserRef.current?.userId === nextSession?.user?.id ||
              sessionUserIdRef.current === nextSession?.user?.id);

          // Keep the shell mounted after login; flipping loading clears ProtectedRoute briefly.
          if (!sameUser) setLoading(true);
          await hydrate(nextSession);
          if (mounted) setLoading(false);
        })();
      }, 0);
    });

    return () => {
      mounted = false;
      subscription.subscription.unsubscribe();
    };
  }, [hydrate]);

  const signIn = useCallback(
    async (usernameOrEmail: string, password: string) => {
      setError(null);
      const identifier = usernameOrEmail.trim();
      let email = identifier;
      const passwordCandidates = Array.from(
        new Set([password, password.trim(), password.trim().toLowerCase()].filter(Boolean)),
      );

      if (!identifier.includes('@')) {
        const { data: resolved, error: resolveError } = await getSupabase().rpc('resolve_login_email', {
          p_identifier: identifier,
        });
        if (resolveError) {
          throw new ApiError('INTERNAL_ERROR', resolveError.message, 500);
        }
        if (!resolved || typeof resolved !== 'string') {
          const message = 'Invalid username or password.';
          setError(message);
          throw new ApiError('INVALID_CREDENTIALS', message, 401);
        }
        email = resolved;
      }

      let sessionData: Awaited<
        ReturnType<ReturnType<typeof getSupabase>['auth']['signInWithPassword']>
      >['data'] | null = null;
      let authError: { message?: string } | null = null;

      for (const candidate of passwordCandidates) {
        const result = await getSupabase().auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: candidate,
        });
        if (!result.error && result.data.session) {
          sessionData = result.data;
          authError = null;
          break;
        }
        authError = result.error;
      }

      if (authError || !sessionData?.session) {
        const message = (authError?.message ?? '').toLowerCase().includes('invalid')
          ? 'Invalid username or password.'
          : (authError?.message ?? 'Unable to sign in.');
        setError(message);
        throw new ApiError('INVALID_CREDENTIALS', message, 401);
      }

      setSession(sessionData.session);
      setLoading(false);

      try {
        const user = await loadAppUser();
        setAppUser(user);
        setError(null);
        return user;
      } catch (err) {
        setAppUser(null);
        if (err instanceof ApiError && err.code === 'UNAUTHENTICATED') {
          await getSupabase().auth.signOut();
          setSession(null);
          const message =
            'Sign-in succeeded but no bank profile is linked. In Web Finance, use “Enable admin login” on the application.';
          setError(message);
          throw new ApiError('INVALID_CREDENTIALS', message, 401);
        }
        setError(getFriendlyErrorMessage(err));
        throw err;
      }
    },
    [],
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
