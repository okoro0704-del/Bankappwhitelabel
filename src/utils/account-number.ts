import crypto from 'node:crypto';

export const ACCOUNT_NUMBER_LENGTH = 10;

export const generateAccountNumber = (): string => {
  const max = 10 ** ACCOUNT_NUMBER_LENGTH;
  const min = 10 ** (ACCOUNT_NUMBER_LENGTH - 1);
  const value = crypto.randomInt(min, max);

  return String(value);
};
