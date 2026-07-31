import {
  ACCOUNT_STATUSES,
  ACCOUNT_TYPES,
  TRANSACTION_STATUSES,
  TRANSACTION_TYPES,
  type AccountStatus,
  type AccountType,
  type TransactionStatus,
  type TransactionType,
} from '../types';
import { ConflictError, ValidationError } from './errors';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;
const PHONE_REGEX = /^\+?[1-9]\d{7,14}$/;
const ACCOUNT_NUMBER_REGEX = /^\d{10}$/;
const NAME_REGEX = /^[a-zA-Z][a-zA-Z\s'-]{0,49}$/;
const REFERENCE_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,63}$/;
const IDEMPOTENCY_KEY_REGEX = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

const normalizeString = (value: string): string => value.trim();

export const requireNonEmptyString = (field: string, value: string): string => {
  const normalized = normalizeString(value);

  if (!normalized) {
    throw new ValidationError(`${field} is required`);
  }

  return normalized;
};

export const validateName = (field: string, value: string): string => {
  const normalized = requireNonEmptyString(field, value);

  if (!NAME_REGEX.test(normalized)) {
    throw new ValidationError(`${field} must contain only letters and simple separators`);
  }

  return normalized;
};

export const validateEmail = (value: string): string => {
  const normalized = requireNonEmptyString('email', value).toLowerCase();

  if (!EMAIL_REGEX.test(normalized)) {
    throw new ValidationError('email format is invalid');
  }

  return normalized;
};

export const validateUsername = (value: string): string => {
  const normalized = requireNonEmptyString('username', value).toLowerCase();

  if (!USERNAME_REGEX.test(normalized)) {
    throw new ValidationError(
      'username must be 3-30 characters and contain only letters, numbers, or underscores',
    );
  }

  return normalized;
};

export const validatePhone = (value?: string | null): string | null => {
  if (value == null || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim();

  if (!PHONE_REGEX.test(normalized)) {
    throw new ValidationError('phone format is invalid');
  }

  return normalized;
};

export const validateAccountType = (value: string): AccountType => {
  if (!ACCOUNT_TYPES.includes(value as AccountType)) {
    throw new ValidationError('account type is invalid');
  }

  return value as AccountType;
};

export const validateAccountStatus = (value: string): AccountStatus => {
  if (!ACCOUNT_STATUSES.includes(value as AccountStatus)) {
    throw new ValidationError('account status is invalid');
  }

  return value as AccountStatus;
};

export const validateAccountNumber = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim();

  if (!ACCOUNT_NUMBER_REGEX.test(normalized)) {
    throw new ValidationError('account number must be a 10 digit string');
  }

  return normalized;
};

export const validateInitialBalance = (value?: number): number | undefined => {
  if (value == null) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError('initial balance must be a non-negative number');
  }

  return value;
};

export const validateFundingAmount = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError('funding amount must be a number greater than zero');
  }

  const normalized = Math.round(value * 100) / 100;
  if (Math.abs(normalized - value) > Number.EPSILON) {
    throw new ValidationError('funding amount must have at most 2 decimal places');
  }

  return normalized;
};

export const validateTransferAmount = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new ValidationError('transfer amount must be a number greater than zero', {
      reasonCode: 'INVALID_AMOUNT',
    });
  }

  const normalized = Math.round(value * 100) / 100;
  if (Math.abs(normalized - value) > Number.EPSILON) {
    throw new ValidationError('transfer amount must have at most 2 decimal places', {
      reasonCode: 'INVALID_AMOUNT',
    });
  }

  return normalized;
};

export const validateRecipientName = (value: string): string => {
  const normalized = requireNonEmptyString('recipientName', value);
  if (normalized.length < 2 || normalized.length > 100) {
    throw new ValidationError('recipient name must be between 2 and 100 characters');
  }
  return normalized;
};

export const validateRecipientAccount = (value: string): string => {
  const normalized = requireNonEmptyString('recipientAccount', value);
  if (!/^\d{8,20}$/.test(normalized)) {
    throw new ValidationError('recipient account must be 8-20 digits');
  }
  return normalized;
};

export const validateRecipientBank = (value: string): string => {
  const normalized = requireNonEmptyString('recipientBank', value);
  if (normalized.length < 2 || normalized.length > 100) {
    throw new ValidationError('recipient bank must be between 2 and 100 characters');
  }
  return normalized;
};

export const validateRequiredIdempotencyKey = (value: string): string => {
  const key = validateIdempotencyKey(value);
  if (!key) {
    throw new ValidationError('idempotency key is required');
  }
  return key;
};

export const validateVerificationCodeInput = (value: string): string => {
  const normalized = requireNonEmptyString('verificationCode', value);
  if (!/^\d{6}$/.test(normalized)) {
    throw new ValidationError('verification code must be a 6 digit string');
  }
  return normalized;
};

export const validateTransactionReference = (value: string): string => {
  const normalized = requireNonEmptyString('reference', value);

  if (!REFERENCE_REGEX.test(normalized)) {
    throw new ValidationError(
      'reference must be 8-64 characters and use letters, numbers, or . _ : -',
    );
  }

  return normalized;
};

export const validateIdempotencyKey = (value?: string): string | undefined => {
  if (value == null || value.trim().length === 0) {
    return undefined;
  }

  const normalized = value.trim();

  if (!IDEMPOTENCY_KEY_REGEX.test(normalized)) {
    throw new ValidationError(
      'idempotency key must be 8-128 characters and use letters, numbers, or . _ : -',
    );
  }

  return normalized;
};

export const validateTransactionType = (value: string): TransactionType => {
  if (!TRANSACTION_TYPES.includes(value as TransactionType)) {
    throw new ValidationError('transaction type is invalid');
  }

  return value as TransactionType;
};

export const validateTransactionStatus = (value: string): TransactionStatus => {
  if (!TRANSACTION_STATUSES.includes(value as TransactionStatus)) {
    throw new ValidationError('transaction status is invalid');
  }

  return value as TransactionStatus;
};

export const throwIfDuplicate = (field: string, value: string): never => {
  throw new ConflictError(`${field} already exists`, { field, value });
};
