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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function copyText(value: string) {
  await navigator.clipboard.writeText(value);
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

  const tenant = detail.data?.tenant;
  const branding = detail.data?.branding;

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

  if (detail.loading && !detail.data) {
    return (
      <div className="page stack">
        <Skeleton height={32} width="40%" />
        <Skeleton height={180} />
      </div>
    );
  }

  if (detail.error || !tenant || !branding) {
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
            Owner is an optional Auth user UUID. Invitation email flows are not available yet.
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

      <div className="grid-2">
        <div className="card card-pad stack">
          <h2 style={{ fontSize: '1.05rem' }}>Domain configuration</h2>
          <Alert tone="warning" title="DNS not automated">
            Saving a subdomain updates the tenant record only. No DNS provider, Netlify, or Vercel
            integration runs in this phase.
          </Alert>
          <Field label="Application name" htmlFor="cfg-name">
            <Input
              id="cfg-name"
              value={nameDraft ?? tenant.name}
              onChange={(e) => setNameDraft(e.target.value)}
            />
          </Field>
          <Field label="Subdomain" htmlFor="cfg-subdomain">
            <Input
              id="cfg-subdomain"
              value={subdomainDraft ?? tenant.subdomain}
              onChange={(e) => setSubdomainDraft(e.target.value.toLowerCase())}
            />
          </Field>
          <p className="muted" style={{ fontSize: '0.85rem' }}>
            Planned hostname shape: <code>{tenant.subdomain}.example.com</code>
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
            <span className="brand-swatch" style={{ background: branding.secondaryColor }} title="Secondary" />
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
            label="Subdomain"
            value={tenant.subdomain}
            onCopy={() => copyText(tenant.subdomain)}
          />
          <HandoffRow label="Status" value={tenant.status} />
          <HandoffRow
            label="Owner"
            value={tenant.ownerUserId ?? 'Not assigned'}
            onCopy={tenant.ownerUserId ? () => copyText(tenant.ownerUserId!) : undefined}
          />
          <HandoffRow
            label="Tenant ID"
            value={tenant.id}
            onCopy={() => copyText(tenant.id)}
          />
        </div>
      </div>

      <div className="card card-pad">
        <div className="card-header">
          <h2 style={{ fontSize: '1.05rem' }}>Actions</h2>
        </div>
        <div className="row">
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
