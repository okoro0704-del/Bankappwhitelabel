import { getServerEnvConfig } from '../config/supabase';
import { userProvisioningService } from '../services/users/user-provisioning-service';
import { isAppError } from '../utils/errors';
import logger from '../utils/logger';
import {
  validateAccountNumber,
  validateAccountType,
  validateEmail,
  validateName,
  validatePhone,
  validateUsername,
} from '../utils/validation';

/**
 * Controlled initial-admin bootstrap.
 *
 * Usage:
 *   npm run setup:initial-admin
 *
 * Requires INITIAL_ADMIN_* environment variables. Never exposes a public
 * "make me admin" API. Fails if an admin already exists.
 */
const run = async (): Promise<void> => {
  const config = getServerEnvConfig();

  if (!config.supabaseServiceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for initial admin setup');
  }

  if (!config.initialAdminEmail || !config.initialAdminPassword) {
    throw new Error(
      'INITIAL_ADMIN_EMAIL and INITIAL_ADMIN_PASSWORD are required for initial admin setup',
    );
  }

  const firstName = validateName(
    'firstName',
    config.initialAdminFirstName ?? 'Admin',
  );
  const lastName = validateName('lastName', config.initialAdminLastName ?? 'User');
  const email = validateEmail(config.initialAdminEmail);
  const username = validateUsername(config.initialAdminUsername ?? 'admin');
  const phone = validatePhone(config.initialAdminPhone);
  const accountType = validateAccountType(config.initialAdminAccountType ?? 'escrow');
  const accountNumber = validateAccountNumber(config.initialAdminAccountNumber);

  const result = await userProvisioningService.provisionInitialAdmin({
    firstName,
    lastName,
    email,
    password: config.initialAdminPassword,
    phone,
    username,
    accountType,
    accountNumber,
  });

  logger.info(
    {
      profileId: result.profile.id,
      userId: result.profile.userId,
      email: result.profile.email,
      username: result.profile.username,
      accountNumber: result.account.accountNumber,
      accountType: result.account.accountType,
      role: result.profile.role,
    },
    'Initial administrator provisioned successfully',
  );
};

run().catch((error: unknown) => {
  if (isAppError(error)) {
    logger.error(
      {
        code: error.code,
        statusCode: error.statusCode,
        details: error.details,
      },
      error.message,
    );
  } else {
    logger.error({ error }, 'Initial admin setup failed');
  }

  process.exit(1);
});
