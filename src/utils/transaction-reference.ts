import crypto from 'node:crypto';

export const generateTransactionReference = (prefix = 'FND'): string => {
  const normalizedPrefix = prefix.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'FND';
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(6).toString('hex').toUpperCase();
  return `${normalizedPrefix}-${stamp}-${random}`;
};

export const generateIdempotencyKey = (prefix = 'IDEM'): string => {
  const normalizedPrefix = prefix.replace(/[^A-Za-z0-9]/g, '').slice(0, 8) || 'IDEM';
  return `${normalizedPrefix}-${crypto.randomUUID()}`;
};
