import crypto from 'node:crypto';

const CODE_PEPPER = process.env.VERIFICATION_CODE_PEPPER ?? 'fictional-bank-dev-pepper';

export const generateSixDigitCode = (): string => {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
};

export const hashVerificationCode = (
  code: string,
  transferId: string,
  stage: number,
): string => {
  return crypto
    .createHash('sha256')
    .update(`${CODE_PEPPER}:${transferId}:${stage}:${code}`)
    .digest('hex');
};

export const verificationCodesMatch = (
  code: string,
  transferId: string,
  stage: number,
  expectedHash: string,
): boolean => {
  const actual = hashVerificationCode(code, transferId, stage);
  const actualBuf = Buffer.from(actual, 'utf8');
  const expectedBuf = Buffer.from(expectedHash, 'utf8');
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
};

export const defaultVerificationExpiry = (minutes = 15): Date => {
  return new Date(Date.now() + minutes * 60_000);
};
