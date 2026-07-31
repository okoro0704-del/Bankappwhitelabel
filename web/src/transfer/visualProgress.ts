/**
 * Visual-only progress mapping. Never sent to the backend.
 * Backend status/stage remains authoritative for UI state.
 */
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
    switch (stage) {
      case 1:
        return 25;
      case 2:
        return 50;
      case 3:
        return 75;
      case 4:
        return 90;
      default:
        return 25;
    }
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
