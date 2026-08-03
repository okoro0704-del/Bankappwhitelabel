const ACTIVE_TRANSFER_KEY = 'northline.activeTransferId.v2';
/** Legacy key from earlier builds — clear on read so old stale IDs cannot freeze Transfer. */
const LEGACY_ACTIVE_TRANSFER_KEY = 'northline.activeTransferId';

function purgeLegacyActiveTransferId(): void {
  try {
    sessionStorage.removeItem(LEGACY_ACTIVE_TRANSFER_KEY);
  } catch {
    // ignore
  }
}

/** Persist only a non-sensitive transfer id so refresh can resume from the API. */
export function rememberActiveTransferId(transferId: string): void {
  try {
    purgeLegacyActiveTransferId();
    sessionStorage.setItem(ACTIVE_TRANSFER_KEY, transferId);
  } catch {
    // Ignore storage failures (private mode, etc.)
  }
}

export function readActiveTransferId(): string | null {
  try {
    purgeLegacyActiveTransferId();
    return sessionStorage.getItem(ACTIVE_TRANSFER_KEY);
  } catch {
    return null;
  }
}

export function clearActiveTransferId(): void {
  try {
    purgeLegacyActiveTransferId();
    sessionStorage.removeItem(ACTIVE_TRANSFER_KEY);
  } catch {
    // ignore
  }
}
