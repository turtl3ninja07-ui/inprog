import iso from 'iso-3166-1';

export type CountryCount = {
  code: string;
  count: number;
};

const STORAGE_KEY = 'leaderboard_counts';
const EVT = 'leaderboard:update';

function emitUpdate() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVT));
  }
}

export function onLeaderboardUpdated(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => cb();
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}

export function getCounts(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function setCounts(next: Record<string, number>) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    emitUpdate();
  } catch {
    // no-op
  }
}

export function topN(n: number): CountryCount[] {
  const counts = getCounts();
  return Object.entries(counts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, Math.max(0, n));
}

export function normalizeCountryCode(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const code = String(input).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

export function incrementCountry(code: string, delta = 1) {
  const cc = normalizeCountryCode(code);
  if (!cc) return;
  const counts = getCounts();
  counts[cc] = (counts[cc] || 0) + (Number.isFinite(delta) ? delta : 1);
  setCounts(counts);
}

export function clearCounts() {
  setCounts({});
}

export function codeToFlagEmoji(code: string): string {
  const c = normalizeCountryCode(code);
  if (!c) return '🏳️';
  const A = 0x41;
  const RI = 0x1f1e6;
  const first = RI + (c.charCodeAt(0) - A);
  const second = RI + (c.charCodeAt(1) - A);
  return String.fromCodePoint(first, second);
}

// Typed interface for iso-3166-1 module to avoid explicit any.
type IsoModule = {
  whereNumeric: (n: string) => { alpha2?: string } | null | undefined;
};
const isoMod = iso as unknown as IsoModule;

// Map ISO 3166-1 numeric code to alpha-2 (e.g., 840 -> US)
export function alpha2FromNumeric(numeric: string | number | undefined | null): string | null {
  if (numeric == null) return null;
  const nstr = String(numeric).padStart(3, '0');
  const entry = isoMod.whereNumeric(nstr);
  return entry?.alpha2 ? String(entry.alpha2).toUpperCase() : null;
}