import type { AccountType } from '../types/api';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export function formatMoney(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

export function formatDateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
}

export function formatAccountNumber(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length !== 10) return value;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
}

export function truncateMiddle(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Backend/admin labels for account processing modes. */
export function accountTypeLabel(type: AccountType | string): string {
  switch (type) {
    case 'escrow':
      return 'Escrow';
    case 'one_time_transfer':
      return 'One-time transfer';
    case 'four_stage_verification':
      return 'Four-stage verification';
    default:
      return type;
  }
}

/**
 * Customer-facing account type. Backend modes stay hidden from account holders.
 */
export function customerAccountTypeLabel(_type?: AccountType | string): string {
  return 'Current account';
}

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function transactionTypeLabel(type: string): string {
  switch (type) {
    case 'funding':
      return 'Funding';
    case 'debit':
      return 'Debit';
    case 'credit':
      return 'Credit';
    default:
      return statusLabel(type);
  }
}

export function statusTone(status: string): BadgeTone {
  const value = status.toLowerCase();
  if (value === 'completed' || value === 'active') return 'success';
  if (value === 'failed' || value === 'cancelled') return 'danger';
  if (value === 'restricted' || value === 'suspended') return 'warning';
  if (value.includes('verification') || value === 'pending' || value === 'processing' || value === 'initiated') {
    return 'info';
  }
  return 'neutral';
}

export function transactionTypeTone(type: string): BadgeTone {
  switch (type) {
    case 'funding':
      return 'accent';
    case 'credit':
      return 'success';
    case 'debit':
      return 'info';
    default:
      return 'neutral';
  }
}

export function amountSignClass(type: string): string {
  if (type === 'debit') return 'amount-debit';
  if (type === 'funding' || type === 'credit') return 'amount-credit';
  return '';
}

export function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

export function createIdempotencyKey(prefix = 'ui'): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function matchesDateFilter(iso: string, filter: string): boolean {
  if (filter === 'all') return true;
  const created = new Date(iso).getTime();
  if (Number.isNaN(created)) return false;
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (filter === '7d') return created >= now - 7 * day;
  if (filter === '30d') return created >= now - 30 * day;
  if (filter === '90d') return created >= now - 90 * day;
  return true;
}
