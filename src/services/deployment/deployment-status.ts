import type { TenantDnsStatus, TenantSslStatus, TenantDeploymentStatus } from '../../types';
import { ValidationError } from '../../utils/errors';

/**
 * Derive provisioning status from verified DNS/SSL fields only.
 * Never invent a "ready" state without verified DNS + SSL.
 * Clients cannot set this value — only Master DNS verification may update DNS/SSL inputs.
 */
export const deriveDeploymentStatus = (
  dnsStatus: TenantDnsStatus,
  sslStatus: TenantSslStatus,
): TenantDeploymentStatus => {
  if (dnsStatus === 'not_configured') {
    return 'not_configured';
  }
  if (dnsStatus === 'pending' || dnsStatus === 'failed') {
    return 'waiting_for_dns';
  }
  // dns verified
  if (sslStatus === 'verified') {
    return 'ready';
  }
  if (sslStatus === 'pending') {
    return 'ssl_pending';
  }
  // ssl not_configured or failed after DNS success
  return 'dns_configured';
};

/**
 * Reject claimed deployment statuses that do not match DNS/SSL evidence.
 * Prevents inventing draft → ready without verification.
 */
export const assertDeploymentStatusConsistent = (
  dnsStatus: TenantDnsStatus,
  sslStatus: TenantSslStatus,
  claimed: TenantDeploymentStatus,
): void => {
  const expected = deriveDeploymentStatus(dnsStatus, sslStatus);
  if (claimed !== expected) {
    throw new ValidationError('Deployment status does not match DNS/SSL verification state');
  }
};

/** True only when both DNS and SSL are verified — used for readiness checks. */
export const isDeploymentReady = (
  dnsStatus: TenantDnsStatus,
  sslStatus: TenantSslStatus,
): boolean => deriveDeploymentStatus(dnsStatus, sslStatus) === 'ready';

export const dnsStatusLabel = (status: TenantDnsStatus): string => {
  switch (status) {
    case 'not_configured':
      return 'Not configured';
    case 'pending':
      return 'Waiting for DNS';
    case 'verified':
      return 'DNS configured';
    case 'failed':
      return 'DNS failed';
    default:
      return status;
  }
};

export const deploymentStatusLabel = (status: TenantDeploymentStatus): string => {
  switch (status) {
    case 'not_configured':
      return 'Not configured';
    case 'waiting_for_dns':
      return 'Waiting for DNS';
    case 'dns_configured':
      return 'DNS configured';
    case 'ssl_pending':
      return 'SSL pending';
    case 'ready':
      return 'Ready';
    default:
      return status;
  }
};
