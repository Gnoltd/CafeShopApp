const STORAGE_KEY = "phadincafe-active-table"

/** Remembers the qrToken of the table a guest most recently reached a real
 * (non-cleaning) session for, so Home can offer to resume it. Best-effort —
 * wrapped in try/catch since localStorage can throw in private browsing. */
export function saveActiveTable(qrToken: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, qrToken)
  } catch {
    // Ignore — resume banner just won't be offered next visit.
  }
}

export function getActiveTable(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function clearActiveTable(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore.
  }
}
