import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/endpoints';
import { getFriendlyErrorMessage } from '../../api/errors';
import { Alert, ErrorState, Skeleton } from '../../components/ui/Feedback';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Field';
import { useToast } from '../../components/ui/Toast';
import { useAsyncData } from '../../hooks/useAsyncData';
import type { TenantBranding } from '../../types/tenant';
import { BrandingPreview } from './BrandingPreview';

function isHex(value: string) {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

export function MasterBrandingPage() {
  const { tenantId = '' } = useParams();
  const { pushToast } = useToast();
  const detail = useAsyncData(() => api.masterGetTenant(tenantId), [tenantId]);
  const [draft, setDraft] = useState<TenantBranding | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (detail.data?.branding) {
      setDraft({ ...detail.data.branding });
      setDirty(false);
    }
  }, [detail.data]);

  function update<K extends keyof TenantBranding>(key: K, value: TenantBranding[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
  }

  function validate(branding: TenantBranding): boolean {
    const next: Record<string, string> = {};
    if (branding.applicationName.trim().length < 2) {
      next.applicationName = 'Application name must be at least 2 characters.';
    }
    if (!isHex(branding.primaryColor)) next.primaryColor = 'Use #RRGGBB.';
    if (!isHex(branding.secondaryColor)) next.secondaryColor = 'Use #RRGGBB.';
    if (!isHex(branding.accentColor)) next.accentColor = 'Use #RRGGBB.';
    if (
      branding.supportEmail &&
      branding.supportEmail.trim() &&
      !branding.supportEmail.includes('@')
    ) {
      next.supportEmail = 'Enter a valid email or leave blank.';
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (!draft || !detail.data) return;
    if (!validate(draft)) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await api.masterUpdateTenant(detail.data.tenant.id, {
        branding: {
          applicationName: draft.applicationName.trim(),
          logoUrl: draft.logoUrl?.trim() || null,
          faviconUrl: draft.faviconUrl?.trim() || null,
          primaryColor: draft.primaryColor,
          secondaryColor: draft.secondaryColor,
          accentColor: draft.accentColor,
          loginHeadline: draft.loginHeadline?.trim() || null,
          loginSubtitle: draft.loginSubtitle?.trim() || null,
          supportEmail: draft.supportEmail?.trim() || null,
          supportPhone: draft.supportPhone?.trim() || null,
        },
      });
      setDraft({ ...updated.branding });
      setDirty(false);
      pushToast('Branding saved', 'success');
      await detail.reload();
    } catch (err) {
      setError(getFriendlyErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function resetDraft() {
    if (detail.data?.branding) {
      setDraft({ ...detail.data.branding });
      setDirty(false);
      setFieldErrors({});
      setError(null);
    }
  }

  if (detail.loading && !draft) {
    return (
      <div className="page stack">
        <Skeleton height={32} width="40%" />
        <Skeleton height={280} />
      </div>
    );
  }

  if (detail.error || !detail.data || !draft) {
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
          <h1>Branding</h1>
          <p className="page-subtitle">
            {detail.data.tenant.name} — preview updates live; changes save only when you click Save.
          </p>
        </div>
        <Link className="btn btn-secondary" to={`/master/applications/${tenantId}`}>
          Back to details
        </Link>
      </div>

      {error ? (
        <Alert tone="error" title="Could not save branding">
          {error}
        </Alert>
      ) : null}

      {dirty ? (
        <Alert tone="warning" title="Unsaved changes">
          Preview reflects your edits. They are not persisted until you save.
        </Alert>
      ) : null}

      <div className="branding-layout">
        <form className="card card-pad stack" onSubmit={onSave}>
          <h2 style={{ fontSize: '1.05rem' }}>Identity</h2>
          <Field
            label="Application name"
            htmlFor="brand-app-name"
            error={fieldErrors.applicationName}
          >
            <Input
              id="brand-app-name"
              value={draft.applicationName}
              onChange={(e) => update('applicationName', e.target.value)}
            />
          </Field>
          <Field label="Logo URL" htmlFor="brand-logo" hint="HTTPS URL if hosted externally.">
            <Input
              id="brand-logo"
              value={draft.logoUrl ?? ''}
              onChange={(e) => update('logoUrl', e.target.value || null)}
            />
          </Field>
          <Field label="Favicon URL" htmlFor="brand-favicon">
            <Input
              id="brand-favicon"
              value={draft.faviconUrl ?? ''}
              onChange={(e) => update('faviconUrl', e.target.value || null)}
            />
          </Field>

          <h2 style={{ fontSize: '1.05rem' }}>Colors</h2>
          <div className="grid-3">
            <ColorField
              id="brand-primary"
              label="Primary"
              value={draft.primaryColor}
              error={fieldErrors.primaryColor}
              onChange={(v) => update('primaryColor', v)}
            />
            <ColorField
              id="brand-secondary"
              label="Secondary"
              value={draft.secondaryColor}
              error={fieldErrors.secondaryColor}
              onChange={(v) => update('secondaryColor', v)}
            />
            <ColorField
              id="brand-accent"
              label="Accent"
              value={draft.accentColor}
              error={fieldErrors.accentColor}
              onChange={(v) => update('accentColor', v)}
            />
          </div>

          <h2 style={{ fontSize: '1.05rem' }}>Login</h2>
          <Field label="Login headline" htmlFor="brand-headline">
            <Input
              id="brand-headline"
              value={draft.loginHeadline ?? ''}
              onChange={(e) => update('loginHeadline', e.target.value || null)}
            />
          </Field>
          <Field label="Login subtitle" htmlFor="brand-subtitle">
            <Textarea
              id="brand-subtitle"
              rows={2}
              value={draft.loginSubtitle ?? ''}
              onChange={(e) => update('loginSubtitle', e.target.value || null)}
            />
          </Field>
          <Field label="Support email" htmlFor="brand-email" error={fieldErrors.supportEmail}>
            <Input
              id="brand-email"
              type="email"
              value={draft.supportEmail ?? ''}
              onChange={(e) => update('supportEmail', e.target.value || null)}
            />
          </Field>
          <Field label="Support phone" htmlFor="brand-phone">
            <Input
              id="brand-phone"
              value={draft.supportPhone ?? ''}
              onChange={(e) => update('supportPhone', e.target.value || null)}
            />
          </Field>

          <div className="row">
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? 'Saving…' : 'Save branding'}
            </Button>
            <Button type="button" variant="secondary" disabled={!dirty || saving} onClick={resetDraft}>
              Discard
            </Button>
          </div>
        </form>

        <BrandingPreview branding={draft} />
      </div>
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  error,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} htmlFor={id} error={error}>
      <div className="row">
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
        <input
          type="color"
          aria-label={`${label} picker`}
          value={isHex(value) ? value : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
      </div>
    </Field>
  );
}
