// === ILocalStore — the client-only persistence seam (no backend) ===
//
// The account is backed by a named local JSON document now; the SAME document shape is what a meta
// server persists later (see src/account/README.md). This is the ONE local read/write interface —
// swap the backend (localStorage / native prefs / file) without touching the account logic.
export interface ILocalStore {
  read<T>(doc: string): T | null;
  write<T>(doc: string, value: T): void;
}

/** localStorage-backed store (browser/Capacitor WebView). Non-authoritative, safe to lose. */
export function createLocalStore(): ILocalStore {
  return {
    read<T>(doc: string): T | null {
      try {
        const raw = localStorage.getItem(doc);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        return null;
      }
    },
    write<T>(doc: string, value: T): void {
      try {
        localStorage.setItem(doc, JSON.stringify(value));
      } catch {
        /* quota / private-mode — non-authoritative, ignore */
      }
    },
  };
}
