const ACTIVE_TRANSFER_KEY = 'northline.activeTransferId';

/** Persist only a non-sensitive transfer id so refresh can resume from the API. */
export function rememberActiveTransferId(transferId: string): void {
  try {
    sessionStorage.setItem(ACTIVE_TRANSFER_KEY, transferId);
  } catch {
    // Ignore storage failures (private mode, etc.)
  }
}

export function readActiveTransferId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_TRANSFER_KEY);
  } catch {
    return null;
  }
}

export function clearActiveTransferId(): void {
  try {
    sessionStorage.removeItem(ACTIVE_TRANSFER_KEY);
  } catch {
    // ignore
  }
}
