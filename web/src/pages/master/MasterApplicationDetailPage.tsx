import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { StatusBadge } from '../../components/ui/StatusBadges';
import { useToast } from '../../components/ui/Toast';
import { useAsyncData } from '../../hooks/useAsyncData';
import { formatDate, truncateMiddle } from '../../utils/format';
import type { TenantDeploymentStatus, TenantDnsStatus } from '../../types/tenant';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
}

function deploymentLabel(status: TenantDeploymentStatus): string {
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
}

function dnsLabel(status: TenantDnsStatus): string {
  switch (status) {
    case 'not_configured':
      return 'Not configured';
    case 'pending':
      return 'Waiting for DNS';
    case 'verified':
      return 'Verified';
    case 'failed':
      return 'Failed';
    default:
      return status;
  }
}

export function MasterApplicationDetailPage() {
  const { tenantId = '' } = useParams();
  const { pushToast } = useToast();
  const detail = useAsyncData(() => api.masterGetTenant(tenantId), [tenantId]);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ownerDraft, setOwnerDraft] = useState<string | null>(null);
  const [subdomainDraft, setSubdomainDraft] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  const tenant = detail.data?.tenant;
  const branding = detail.data?.branding;
  const deployment = detail.data?.deployment;

  async function runAction(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      pushToast(success, 'success');
      await detail.reload();
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err));
    } finally {
      setBusy(false);
      setConfirmDeactivate(false);
    }
  }

  async function saveConfig() {
    if (!tenant) return;
    const owner = ownerDraft ?? tenant.ownerUserId ?? '';
    if (owner && !UUID_RE.test(owner)) {
      setActionError('Owner user ID must be a valid UUID or empty.');
      return;
    }
    await runAction(
      () =>
        api.masterUpdateTenant(tenant.id, {
          name: (nameDraft ?? tenant.name).trim(),
          subdomain: (subdomainDraft ?? tenant.subdomain).trim().toLowerCase(),
          ownerUserId: owner.trim() ? owner.trim() : null,
        }),
      'Configuration saved',
    );
    setOwnerDraft(null);
    setSubdomainDraft(null);
    setNameDraft(null);
  }

  async function verifyDns() {
    if (!tenant) return;
    setBusy(true);
    setActionError(null);
    setVerifyMessage(null);
    try {
      const result = await api.masterVerifyTenantDns(tenant.id);
      setVerifyMessage(result.message);
      const ok = result.dnsStatus === 'verified' || result.status === 'verified';
      pushToast(ok ? 'DNS verified' : result.message || 'DNS not verified', ok ? 'success' : 'info');
      if (!ok && result.message) setActionError(result.message);
      await detail.reload();
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function provision(retry = false) {
    if (!tenant) return;
    setBusy(true);
    setActionError(null);
    setVerifyMessage(null);
    try {
      const result = await api.masterProvisionTenant(tenant.id);
      setVerifyMessage(result.message);
      const failed = Boolean(result.code && result.dnsStatus === 'failed');
      const ready = result.deploymentStatus === 'ready';
      pushToast(
        result.message || (retry ? 'Provisioning retried' : 'Provisioning started'),
        ready ? 'success' : failed ? 'error' : 'info',
      );
      if (failed || result.code) setActionError(result.message);
      await detail.reload();
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err));
      await detail.reload();
    } finally {
      setBusy(false);
    }
  }

  async function verifySsl() {
    if (!tenant) return;
    setBusy(true);
    setActionError(null);
    setVerifyMessage(null);
    try {
      const result = await api.masterVerifyTenantSsl(tenant.id);
      setVerifyMessage(result.message);
      const ok = result.sslStatus === 'verified';
      pushToast(ok ? 'SSL verified' : result.message || 'SSL not ready', ok ? 'success' : 'info');
      if (!ok && result.message) setActionError(result.message);
      await detail.reload();
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshStatus() {
    if (!tenant) return;
    setBusy(true);
    setActionError(null);
    setVerifyMessage(null);
    try {
      const dns = await api.masterVerifyTenantDns(tenant.id);
      setVerifyMessage(dns.message);
      if (dns.dnsStatus === 'verified' || dns.status === 'verified') {
        const ssl = await api.masterVerifyTenantSsl(tenant.id);
        setVerifyMessage(ssl.message);
        if (ssl.sslStatus !== 'verified') setActionError(ssl.message);
        else setActionError(null);
      } else {
        setActionError(dns.message);
      }
      pushToast('Deployment status refreshed', 'info');
      await detail.reload();
    } catch (err) {
      setActionError(getFriendlyErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (detail.loading && !detail.data) {
    return (
      <div className="page stack">
        <Skeleton height={32} width="40%" />
        <Skeleton height={180} />
      </div>
    );
  }

  if (detail.error || !tenant || !branding || !deployment) {
    return (
      <div className="page">
        <ErrorState
          description={detail.error ?? 'Application not found'}
          onRetry={() => void detail.reload()}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>{branding.applicationName || tenant.name}</h1>
          <p className="page-subtitle">
            <span className="mono-break">{tenant.slug}</span>
          </p>
        </div>
        <div className="row">
          <StatusBadge status={tenant.status} />
          <span className="badge">{deploymentLabel(deployment.deploymentStatus)}</span>
          <Link className="btn btn-secondary" to={`/master/applications/${tenant.id}/branding`}>
            Edit branding
          </Link>
        </div>
      </div>

      {actionError ? (
        <Alert tone="error" title="Action failed">
          {actionError}
        </Alert>
      ) : null}

      <div className="grid-2">
        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.05rem' }}>Application</h2>
          <dl className="detail-list">
            <div>
              <dt>Name</dt>
              <dd>{tenant.name}</dd>
            </div>
            <div>
              <dt>Slug</dt>
              <dd className="mono-break">{tenant.slug}</dd>
            </div>
            <div>
              <dt>Tenant ID</dt>
              <dd className="row">
                <span className="mono-break">{truncateMiddle(tenant.id, 10, 8)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    await copyText(tenant.id);
                    pushToast('Tenant ID copied', 'success');
                  }}
                >
                  Copy
                </Button>
              </dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusBadge status={tenant.status} />
              </dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{formatDate(tenant.createdAt)}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{formatDate(tenant.updatedAt)}</dd>
            </div>
          </dl>
        </div>

        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.05rem' }}>Owner</h2>
          <Alert tone="info">
            {deployment.ownerAssigned
              ? 'Owner assigned (Auth user UUID). Invitation email is not sent in this phase.'
              : 'Owner not assigned. Optional Auth user UUID only — no automatic account creation.'}
          </Alert>
          <Field label="Owner user ID" htmlFor="owner-id">
            <Input
              id="owner-id"
              value={ownerDraft ?? tenant.ownerUserId ?? ''}
              placeholder="Leave blank for no owner"
              onChange={(e) => setOwnerDraft(e.target.value)}
            />
          </Field>
        </div>
      </div>

      <div className="card card-pad stack">
        <h2 style={{ fontSize: '1.05rem' }}>Deployment</h2>
        <Alert tone="warning" title="Shared Netlify frontend">
          Provisioning associates this hostname with the shared Netlify site and configures
          Netlify DNS. Status values reflect verification — never assumed success.
          Provider: <strong>{deployment.provider}</strong>
        </Alert>
        <dl className="detail-list">
          <div>
            <dt>Application name</dt>
            <dd>{branding.applicationName || tenant.name}</dd>
          </div>
          <div>
            <dt>Tenant slug</dt>
            <dd className="mono-break">{tenant.slug}</dd>
          </div>
          <div>
            <dt>Subdomain</dt>
            <dd className="mono-break">{tenant.subdomain}</dd>
          </div>
          <div>
            <dt>Full hostname</dt>
            <dd className="mono-break">{deployment.hostname}</dd>
          </div>
          <div>
            <dt>Login URL</dt>
            <dd className="mono-break">{deployment.loginUrl}</dd>
          </div>
          <div>
            <dt>Tenant status</dt>
            <dd>
              <StatusBadge status={tenant.status} />
            </dd>
          </div>
          <div>
            <dt>Provisioning status</dt>
            <dd>
              <span className="badge">{deploymentLabel(deployment.deploymentStatus)}</span>
            </dd>
          </div>
          <div>
            <dt>DNS status</dt>
            <dd>{dnsLabel(deployment.dnsStatus)}</dd>
          </div>
          <div>
            <dt>SSL status</dt>
            <dd>{deployment.sslStatus.replace(/_/g, ' ')}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{deployment.ownerAssigned ? 'Owner assigned' : 'Owner not assigned'}</dd>
          </div>
          <div>
            <dt>Last provisioning attempt</dt>
            <dd>
              {deployment.lastProvisionedAt ? formatDate(deployment.lastProvisionedAt) : '—'}
            </dd>
          </div>
          <div>
            <dt>Last DNS check</dt>
            <dd>{deployment.dnsCheckedAt ? formatDate(deployment.dnsCheckedAt) : '—'}</dd>
          </div>
          <div>
            <dt>Last SSL check</dt>
            <dd>{deployment.sslCheckedAt ? formatDate(deployment.sslCheckedAt) : '—'}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDate(tenant.createdAt)}</dd>
          </div>
          <div>
            <dt>Last updated</dt>
            <dd>{formatDate(tenant.updatedAt)}</dd>
          </div>
        </dl>

        {deployment.lastProvisionError ? (
          <Alert tone="error" title="Last provisioning error">
            {deployment.lastProvisionError}
          </Alert>
        ) : null}

        <h3 style={{ fontSize: '0.95rem', marginTop: '0.5rem' }}>Required DNS record</h3>
        <div className="handoff-grid">
          <HandoffRow label="Type" value={deployment.dnsRecord.type} />
          <HandoffRow
            label="Name"
            value={deployment.dnsRecord.name}
            onCopy={() => copyText(deployment.dnsRecord.name)}
          />
          <HandoffRow
            label="Target"
            value={deployment.dnsRecord.target}
            onCopy={() => copyText(deployment.dnsRecord.target)}
          />
          <HandoffRow
            label="Current DNS status"
            value={
              !deployment.dnsCheckedAt && deployment.dnsStatus === 'not_configured'
                ? 'Not checked yet'
                : dnsLabel(deployment.dnsStatus)
            }
          />
          <HandoffRow
            label="Verification status"
            value={
              deployment.dnsStatus === 'verified'
                ? 'Verified'
                : !deployment.dnsCheckedAt
                  ? 'Click Verify DNS to check'
                  : deployment.dnsStatus === 'failed'
                    ? 'Not verified'
                    : 'Not verified yet'
            }
          />
        </div>

        {!deployment.dnsCheckedAt ? (
          <Alert tone="info" title="DNS has not been checked yet">
            Public DNS may already be in place. Click <strong>Verify DNS</strong>, then{' '}
            <strong>Verify SSL</strong>. If buttons fail, redeploy the <code>master-deploy</code>{' '}
            Edge Function and confirm Edge secrets <code>TENANT_BASE_DOMAIN</code> and{' '}
            <code>DEPLOYMENT_DNS_TARGET</code>.
          </Alert>
        ) : null}

        {verifyMessage ? (
          <Alert tone={deployment.dnsStatus === 'verified' ? 'success' : 'warning'}>
            {verifyMessage}
          </Alert>
        ) : null}

        <div className="row" style={{ flexWrap: 'wrap' }}>
          <Button type="button" disabled={busy} onClick={() => void provision(false)}>
            {busy ? 'Working…' : 'Provision'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void provision(true)}
          >
            Retry Provisioning
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void verifyDns()}>
            Verify DNS
          </Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void verifySsl()}>
            Verify SSL
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void refreshStatus()}
          >
            Refresh Status
          </Button>
        </div>
      </div>

      <div className="grid-2">
        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.05rem' }}>Domain configuration</h2>
          <Field label="Application name" htmlFor="cfg-name">
            <Input
              id="cfg-name"
              value={nameDraft ?? tenant.name}
              onChange={(e) => setNameDraft(e.target.value)}
            />
          </Field>
          <Field
            label="Subdomain"
            htmlFor="cfg-subdomain"
            hint="Changing subdomain resets DNS verification."
          >
            <Input
              id="cfg-subdomain"
              value={subdomainDraft ?? tenant.subdomain}
              onChange={(e) => setSubdomainDraft(e.target.value.toLowerCase())}
            />
          </Field>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Expected hostname: <code>{deployment.hostname}</code>
          </p>
          <Button type="button" onClick={() => void saveConfig()} disabled={busy}>
            Save configuration
          </Button>
        </div>

        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.05rem' }}>Branding summary</h2>
          <div
            className="brand-swatch-row"
            style={{
              ['--preview-primary' as string]: branding.primaryColor,
              ['--preview-secondary' as string]: branding.secondaryColor,
              ['--preview-accent' as string]: branding.accentColor,
            }}
          >
            <span className="brand-swatch" style={{ background: branding.primaryColor }} title="Primary" />
            <span
              className="brand-swatch"
              style={{ background: branding.secondaryColor }}
              title="Secondary"
            />
            <span className="brand-swatch" style={{ background: branding.accentColor }} title="Accent" />
          </div>
          <dl className="detail-list">
            <div>
              <dt>Application name</dt>
              <dd>{branding.applicationName}</dd>
            </div>
            <div>
              <dt>Login headline</dt>
              <dd>{branding.loginHeadline ?? '—'}</dd>
            </div>
            <div>
              <dt>Support email</dt>
              <dd>{branding.supportEmail ?? '—'}</dd>
            </div>
          </dl>
          <Link className="btn btn-secondary" to={`/master/applications/${tenant.id}/branding`}>
            Open branding editor
          </Link>
        </div>
      </div>

      <div className="card card-pad stack">
        <h2 style={{ fontSize: '1.05rem' }}>Handoff information</h2>
        <p className="muted">
          Share non-secret configuration with the application owner. Secrets are never shown here.
        </p>
        <div className="handoff-grid">
          <HandoffRow
            label="Application"
            value={branding.applicationName || tenant.name}
            onCopy={() => copyText(branding.applicationName || tenant.name)}
          />
          <HandoffRow
            label="Login URL"
            value={deployment.loginUrl}
            onCopy={() => copyText(deployment.loginUrl)}
          />
          <HandoffRow
            label="Hostname"
            value={deployment.hostname}
            onCopy={() => copyText(deployment.hostname)}
          />
          <HandoffRow
            label="Subdomain"
            value={tenant.subdomain}
            onCopy={() => copyText(tenant.subdomain)}
          />
          <HandoffRow
            label="DNS target"
            value={deployment.dnsTarget}
            onCopy={() => copyText(deployment.dnsTarget)}
          />
          <HandoffRow label="Tenant status" value={tenant.status} />
          <HandoffRow
            label="Deployment status"
            value={deploymentLabel(deployment.deploymentStatus)}
          />
          <HandoffRow
            label="Owner"
            value={
              deployment.ownerAssigned
                ? (tenant.ownerUserId ?? 'Assigned')
                : 'Owner not assigned'
            }
            onCopy={
              tenant.ownerUserId ? () => copyText(tenant.ownerUserId!) : undefined
            }
          />
          <HandoffRow
            label="Support contact"
            value={branding.supportEmail ?? 'Not configured'}
            onCopy={
              branding.supportEmail ? () => copyText(branding.supportEmail!) : undefined
            }
          />
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-header">
          <h2 style={{ fontSize: '1.05rem' }}>Actions</h2>
        </div>
        <Alert tone="info">
          Activation is independent of DNS. Configure branding first, then activate when ready.
          {deployment.deploymentStatus !== 'ready'
            ? ' Deployment is not Ready yet — DNS/SSL verification has not fully succeeded.'
            : ''}
        </Alert>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          {tenant.status === 'inactive' ? (
            <Button
              disabled={busy}
              onClick={() =>
                void runAction(() => api.masterActivateTenant(tenant.id), 'Application activated')
              }
            >
              Activate
            </Button>
          ) : (
            <Button variant="danger" disabled={busy} onClick={() => setConfirmDeactivate(true)}>
              Deactivate
            </Button>
          )}
          <Link className="btn btn-secondary" to="/master/applications">
            Back to list
          </Link>
        </div>
      </div>

      <Modal
        open={confirmDeactivate}
        title="Deactivate application?"
        onClose={() => setConfirmDeactivate(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmDeactivate(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void runAction(
                  () => api.masterDeactivateTenant(tenant.id),
                  'Application deactivated',
                )
              }
            >
              Deactivate
            </Button>
          </>
        }
      >
        <p>
          Are you sure you want to deactivate this application? Inactive tenants are not exposed on
          the public configuration path.
        </p>
      </Modal>
    </div>
  );
}

function HandoffRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy?: () => Promise<void> | void;
}) {
  const { pushToast } = useToast();
  return (
    <div className="handoff-row">
      <div>
        <div className="muted" style={{ fontSize: '0.75rem' }}>
          {label}
        </div>
        <div className="mono-break">{value}</div>
      </div>
      {onCopy ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await onCopy();
            pushToast(`${label} copied`, 'success');
          }}
        >
          Copy
        </Button>
      ) : null}
    </div>
  );
}
