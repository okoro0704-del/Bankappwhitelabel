import type { User } from '@supabase/supabase-js';
import crypto from 'node:crypto';

import {
  createSupabaseAdminClient,
  createSupabaseClient,
  getServerEnvConfig,
} from '../../config/supabase';
import type { AccountType } from '../../types';
import { AuthenticationError, ValidationError } from '../../utils/errors';
import { validateEmail } from '../../utils/validation';

export class AuthService {
  async signIn(email: string, password: string) {
    const client = createSupabaseClient();
    const normalizedEmail = validateEmail(email);

    const { data, error } = await client.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error || !data.session || !data.user) {
      throw new AuthenticationError('Invalid credentials');
    }

    return data;
  }

  async signOut(accessToken: string): Promise<void> {
    const client = createSupabaseClient(accessToken);
    const { error } = await client.auth.signOut();

    if (error) {
      throw new AuthenticationError('Unable to sign out current session');
    }
  }

  async getUserFromAccessToken(accessToken: string): Promise<User> {
    if (!accessToken || accessToken.trim().length === 0) {
      throw new AuthenticationError('Authenticated user could not be resolved');
    }

    const client = createSupabaseClient();
    const { data, error } = await client.auth.getUser(accessToken);

    if (error || !data.user) {
      throw new AuthenticationError('Authenticated user could not be resolved');
    }

    return data.user;
  }

  async requestPasswordReset(email: string): Promise<void> {
    const client = createSupabaseClient();
    const normalizedEmail = validateEmail(email);
    const { error } = await client.auth.resetPasswordForEmail(normalizedEmail);

    if (error) {
      throw new ValidationError('Password reset could not be initiated');
    }
  }

  async createAuthUser(email: string, password?: string) {
    const adminClient = createSupabaseAdminClient();
    const normalizedEmail = validateEmail(email);
    const resolvedPassword =
      password && password.length >= 8 ? password : crypto.randomBytes(24).toString('base64url');

    const { data, error } = await adminClient.auth.admin.createUser({
      email: normalizedEmail,
      password: resolvedPassword,
      email_confirm: true,
    });

    if (error || !data.user) {
      throw new ValidationError('Supabase auth user could not be created', {
        email: normalizedEmail,
        reason: error?.message,
      });
    }

    return {
      user: data.user,
      temporaryPassword: password ? undefined : resolvedPassword,
    };
  }

  async deleteAuthUser(userId: string): Promise<void> {
    const adminClient = createSupabaseAdminClient();
    const { error } = await adminClient.auth.admin.deleteUser(userId);

    if (error) {
      throw new ValidationError('Supabase auth user cleanup failed', {
        userId,
        reason: error.message,
      });
    }
  }

  getInitialAdminConfig() {
    const config = getServerEnvConfig();

    return {
      email: config.initialAdminEmail,
      password: config.initialAdminPassword,
      firstName: config.initialAdminFirstName,
      lastName: config.initialAdminLastName,
      phone: config.initialAdminPhone,
      username: config.initialAdminUsername,
      accountType: (config.initialAdminAccountType ?? 'escrow') as AccountType,
      accountNumber: config.initialAdminAccountNumber,
    };
  }
}

export const authService = new AuthService();
