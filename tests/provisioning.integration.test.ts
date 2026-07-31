import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Integration tests against a live Supabase project.
 * Enable with RUN_SUPABASE_INTEGRATION=1 and valid server env vars.
 */
const enabled = process.env.RUN_SUPABASE_INTEGRATION === '1';

const describeIntegration = enabled ? test : test.skip;

describeIntegration('Supabase integration: auth + provisioning', async (t) => {
  const { authService } = await import('../src/services/auth/auth-service');
  const { userProvisioningService } = await import(
    '../src/services/users/user-provisioning-service'
  );
  const { profileRepository } = await import(
    '../src/repositories/profiles/profile-repository'
  );
  const { accountRepository } = await import(
    '../src/repositories/accounts/account-repository'
  );
  const { createSupabaseClient } = await import('../src/config/supabase');
  const { AuthorizationError, ConflictError, AuthenticationError } = await import(
    '../src/utils/errors'
  );

  const suffix = Date.now().toString(36);
  let adminActor: {
    userId: string;
    role: 'admin';
    accountStatus: 'active' | 'suspended';
  } = {
    userId: 'pending',
    role: 'admin',
    accountStatus: 'active',
  };

  let createdAuthUserIds: string[] = [];

  t.after(async () => {
    for (const userId of createdAuthUserIds) {
      try {
        await authService.deleteAuthUser(userId);
      } catch {
        // best-effort cleanup
      }
    }
  });

  await t.test('admin can create user with generated account number and type', async () => {
    const adminEmail = process.env.INTEGRATION_ADMIN_EMAIL;
    const adminPassword = process.env.INTEGRATION_ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
      throw new Error(
        'INTEGRATION_ADMIN_EMAIL and INTEGRATION_ADMIN_PASSWORD are required for integration tests',
      );
    }

    const session = await authService.signIn(adminEmail, adminPassword);
    const profile = await profileRepository.findByUserId(session.user.id);
    assert.ok(profile);
    assert.equal(profile.role, 'admin');
    adminActor = {
      userId: profile.userId,
      role: 'admin',
      accountStatus: profile.status,
    };

    const provisioned = await userProvisioningService.provisionUser(adminActor, {
      firstName: 'Test',
      lastName: 'User',
      email: `user_${suffix}@example.com`,
      username: `user_${suffix}`,
      phone: '+15551234567',
      accountType: 'one_time_transfer',
      password: 'TestPass123!',
    });

    createdAuthUserIds.push(provisioned.profile.userId);

    assert.match(provisioned.account.accountNumber, /^\d{10}$/);
    assert.equal(provisioned.account.accountType, 'one_time_transfer');
    assert.equal(provisioned.profile.role, 'user');
  });

  await t.test('duplicate email and username are rejected', async () => {
    const email = `dup_${suffix}@example.com`;
    const username = `dup_${suffix}`;

    const first = await userProvisioningService.provisionUser(adminActor, {
      firstName: 'Dup',
      lastName: 'One',
      email,
      username,
      accountType: 'escrow',
      password: 'TestPass123!',
    });
    createdAuthUserIds.push(first.profile.userId);

    await assert.rejects(
      () =>
        userProvisioningService.provisionUser(adminActor, {
          firstName: 'Dup',
          lastName: 'Two',
          email,
          username: `other_${suffix}`,
          accountType: 'escrow',
          password: 'TestPass123!',
        }),
      ConflictError,
    );

    await assert.rejects(
      () =>
        userProvisioningService.provisionUser(adminActor, {
          firstName: 'Dup',
          lastName: 'Three',
          email: `other_${suffix}@example.com`,
          username,
          accountType: 'escrow',
          password: 'TestPass123!',
        }),
      ConflictError,
    );
  });

  await t.test('valid auth succeeds and invalid credentials fail', async () => {
    const email = `auth_${suffix}@example.com`;
    const password = 'AuthPass123!';

    const provisioned = await userProvisioningService.provisionUser(adminActor, {
      firstName: 'Auth',
      lastName: 'Flow',
      email,
      username: `auth_${suffix}`,
      accountType: 'four_stage_verification',
      password,
    });
    createdAuthUserIds.push(provisioned.profile.userId);

    const session = await authService.signIn(email, password);
    assert.ok(session.session?.access_token);

    const user = await authService.getUserFromAccessToken(session.session.access_token);
    assert.equal(user.id, provisioned.profile.userId);

    await assert.rejects(
      () => authService.signIn(email, 'wrong-password'),
      AuthenticationError,
    );
  });

  await t.test('user cannot create another user', async () => {
    const email = `limited_${suffix}@example.com`;
    const provisioned = await userProvisioningService.provisionUser(adminActor, {
      firstName: 'Limited',
      lastName: 'User',
      email,
      username: `limited_${suffix}`,
      accountType: 'escrow',
      password: 'TestPass123!',
    });
    createdAuthUserIds.push(provisioned.profile.userId);

    await assert.rejects(
      () =>
        userProvisioningService.provisionUser(
          {
            userId: provisioned.profile.userId,
            role: 'user',
            accountStatus: 'active',
          },
          {
            firstName: 'Nope',
            lastName: 'Admin',
            email: `nope_${suffix}@example.com`,
            username: `nope_${suffix}`,
            accountType: 'escrow',
          },
        ),
      AuthorizationError,
    );
  });

  await t.test('RLS blocks reading another profile and mutating protected fields', async () => {
    const password = 'RlsPass123!';
    const first = await userProvisioningService.provisionUser(adminActor, {
      firstName: 'Rls',
      lastName: 'One',
      email: `rls1_${suffix}@example.com`,
      username: `rls1_${suffix}`,
      accountType: 'escrow',
      password,
    });
    const second = await userProvisioningService.provisionUser(adminActor, {
      firstName: 'Rls',
      lastName: 'Two',
      email: `rls2_${suffix}@example.com`,
      username: `rls2_${suffix}`,
      accountType: 'escrow',
      password,
    });
    createdAuthUserIds.push(first.profile.userId, second.profile.userId);

    const session = await authService.signIn(`rls1_${suffix}@example.com`, password);
    const client = createSupabaseClient(session.session!.access_token);

    const { data: otherProfile } = await client
      .from('profiles')
      .select('id')
      .eq('id', second.profile.id)
      .maybeSingle();
    assert.equal(otherProfile, null);

    const { error: roleError } = await client
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', first.profile.id);
    assert.ok(roleError);

    const { error: typeError } = await client
      .from('accounts')
      .update({ account_type: 'four_stage_verification' })
      .eq('id', first.account.id);
    assert.ok(typeError);

    const { error: numberError } = await client
      .from('accounts')
      .update({ account_number: '9999999999' })
      .eq('id', first.account.id);
    assert.ok(numberError);

    const { error: statusError } = await client
      .from('accounts')
      .update({ account_status: 'suspended' })
      .eq('id', first.account.id);
    assert.ok(statusError);

    const unchanged = await accountRepository.findById(first.account.id);
    assert.equal(unchanged?.accountType, 'escrow');
    assert.equal(unchanged?.accountNumber, first.account.accountNumber);
    assert.equal(unchanged?.accountStatus, 'active');

    const unchangedProfile = await profileRepository.findById(first.profile.id);
    assert.equal(unchangedProfile?.role, 'user');
  });
});

test('auth migration SQL defines profiles, accounts, and privilege protection', () => {
  const migrationPath = path.join(
    process.cwd(),
    'supabase',
    'migrations',
    '20260730170000_auth_profiles_accounts.sql',
  );
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /create table public\.profiles/i);
  assert.match(sql, /create table public\.accounts/i);
  assert.match(sql, /protect_profile_privileges/i);
  assert.match(sql, /protect_account_privileges/i);
  assert.match(sql, /generate_account_number/i);
  assert.match(sql, /enable row level security/i);
  assert.match(sql, /is_admin/i);
});
