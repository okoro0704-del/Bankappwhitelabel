import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

import { ValidationError } from '../utils/errors';
import {
  ACCOUNT_TYPES,
  type AccountType,
  type ClientEnvConfig,
  type ServerEnvConfig,
} from '../types';

dotenv.config();

const requireEnv = (name: string): string => {
  const value = process.env[name];

  if (!value || value.trim().length === 0) {
    throw new ValidationError(`Missing required environment variable: ${name}`);
  }

  return value;
};

const optionalEnv = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
};

export const getClientEnvConfig = (): ClientEnvConfig => {
  return {
    supabaseUrl: requireEnv('SUPABASE_URL'),
    supabaseAnonKey: requireEnv('SUPABASE_ANON_KEY'),
  };
};

export const getServerEnvConfig = (): ServerEnvConfig => {
  const accountType = optionalEnv('INITIAL_ADMIN_ACCOUNT_TYPE');

  return {
    ...getClientEnvConfig(),
    supabaseServiceRoleKey: optionalEnv('SUPABASE_SERVICE_ROLE_KEY'),
    initialAdminEmail: optionalEnv('INITIAL_ADMIN_EMAIL'),
    initialAdminPassword: optionalEnv('INITIAL_ADMIN_PASSWORD'),
    initialAdminFirstName: optionalEnv('INITIAL_ADMIN_FIRST_NAME'),
    initialAdminLastName: optionalEnv('INITIAL_ADMIN_LAST_NAME'),
    initialAdminPhone: optionalEnv('INITIAL_ADMIN_PHONE'),
    initialAdminUsername: optionalEnv('INITIAL_ADMIN_USERNAME'),
    initialAdminAccountType:
      accountType && ACCOUNT_TYPES.includes(accountType as AccountType)
        ? (accountType as AccountType)
        : undefined,
    initialAdminAccountNumber: optionalEnv('INITIAL_ADMIN_ACCOUNT_NUMBER'),
  };
};

export const createSupabaseClient = (accessToken?: string): SupabaseClient => {
  const config = getClientEnvConfig();

  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: accessToken
      ? {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      : undefined,
  });
};

export const createSupabaseAdminClient = (): SupabaseClient => {
  const config = getServerEnvConfig();

  if (!config.supabaseServiceRoleKey) {
    throw new ValidationError(
      'Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY',
    );
  }

  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};
