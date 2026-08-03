/**
 * Customer-facing verification code titles (never "Stage X of 4").
 * Shared by transfer UI and admin deliverables.
 */
export const VERIFICATION_CODE_TITLES = {
  1: 'Account Activation Code',
  2: 'International Transfer Fee Code',
  3: 'Anti Fraud Code',
  4: 'Wire Transfer Tax Code',
} as const;

export type VerificationCodeStage = 1 | 2 | 3 | 4;

export function verificationCodeTitle(stage: number): string {
  const n = Math.min(4, Math.max(1, Math.round(stage))) as VerificationCodeStage;
  return VERIFICATION_CODE_TITLES[n];
}

export function verificationCodeSubtitle(stage: number): string {
  const title = verificationCodeTitle(stage);
  return `Enter your ${title} to continue processing your transfer.`;
}

/**
 * Visual-only progress mapping. Never sent to the backend.
 * Backend status/stage remains authoritative for UI state.
 *
 * Four-stage transfers pause at these gates for a code request:
 *   35% → Account Activation Code
 *   68% → International Transfer Fee Code
 *   85% → Anti Fraud Code
 *   95% → Wire Transfer Tax Code
 *  100% → completed
 */

export const VERIFICATION_PROGRESS_GATES = {
  1: 35,
  2: 68,
  3: 85,
  4: 95,
} as const;

export function progressGateForStage(stage?: number | null): number {
  const n = stage ?? 1;
  if (n <= 1) return VERIFICATION_PROGRESS_GATES[1];
  if (n === 2) return VERIFICATION_PROGRESS_GATES[2];
  if (n === 3) return VERIFICATION_PROGRESS_GATES[3];
  return VERIFICATION_PROGRESS_GATES[4];
}

/** Progress floor before animating toward the gate for this stage. */
export function progressFloorForStage(stage?: number | null): number {
  const n = stage ?? 1;
  if (n <= 1) return 8;
  if (n === 2) return VERIFICATION_PROGRESS_GATES[1];
  if (n === 3) return VERIFICATION_PROGRESS_GATES[2];
  return VERIFICATION_PROGRESS_GATES[3];
}

export function visualProgressPercent(input: {
  status: string;
  stage?: number | null;
}): number {
  const status = input.status.toLowerCase();

  if (status === 'completed') return 100;
  if (status === 'restricted' || status === 'failed' || status === 'cancelled') {
    return 0;
  }

  if (status === 'verification_required' || status.startsWith('verification_stage_')) {
    const stage = input.stage ?? stageFromStatus(status) ?? 1;
    return progressGateForStage(stage);
  }

  if (status === 'processing' || status === 'initiated') return 12;
  return 8;
}

export function stageFromStatus(status: string): number | null {
  const match = status.match(/verification_stage_(\d)/i);
  if (!match) return null;
  return Number(match[1]);
}

export function isVerificationStatus(status: string): boolean {
  return (
    status === 'verification_required' ||
    status.startsWith('verification_stage_')
  );
}

export function isTerminalTransferStatus(status: string): boolean {
  return ['completed', 'failed', 'restricted', 'cancelled'].includes(status);
}
