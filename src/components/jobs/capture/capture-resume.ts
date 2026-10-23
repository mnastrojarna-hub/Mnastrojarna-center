/**
 * Rozpracované focení dávky: záznam v sessionStorage (obnova po zavření / přenačtení)
 * a krok „Zpět" v historii prohlížeče (Android tlačítko Zpět v Roztřídění / Kontrole).
 * Vše v try/catch — v soukromém okně nebo bez úložiště dialog funguje dál, jen bez obnovy.
 */

export const RESUME_KEY = "capture-resume";
export const RESUME_MAX_AGE_MS = 24 * 3600 * 1000;

export type ResumeStep = "sort" | "review" | "done-partial";

export interface CaptureResumeRecord {
  captureId: string;
  step: ResumeStep;
  pages: number;
  savedAt: string;
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is CaptureResumeRecord {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.captureId === "string" && /^[0-9a-f-]{36}$/i.test(r.captureId)
    && (r.step === "sort" || r.step === "review" || r.step === "done-partial")
    && typeof r.pages === "number" && typeof r.savedAt === "string";
}

/** Platný záznam (ne starší než 24 h), jinak null. */
export function parseResume(raw: string | null, now: number = Date.now()): CaptureResumeRecord | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isRecord(v)) return null;
    const at = Date.parse(v.savedAt);
    if (!Number.isFinite(at) || now - at > RESUME_MAX_AGE_MS || at - now > 60_000) return null;
    return v;
  } catch {
    return null;
  }
}

export function readResume(): CaptureResumeRecord | null {
  const s = storage();
  if (!s) return null;
  try {
    const rec = parseResume(s.getItem(RESUME_KEY));
    if (!rec) s.removeItem(RESUME_KEY);
    return rec;
  } catch {
    return null;
  }
}

export function writeResume(rec: Omit<CaptureResumeRecord, "savedAt">): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(RESUME_KEY, JSON.stringify({ ...rec, savedAt: new Date().toISOString() } satisfies CaptureResumeRecord));
  } catch {
    // plné / zakázané úložiště — obnova jen nebude
  }
}

export function clearResume(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(RESUME_KEY);
  } catch {
    // ignorovat
  }
}

// ── Historie (Android „Zpět") ───────────────────────────────
const HISTORY_FLAG = "captureDialog";

/** Vrchol historie patří dialogu (náš záznam). */
export function isCaptureHistoryTop(): boolean {
  try {
    const st: unknown = window.history.state;
    return Boolean(st && typeof st === "object" && (st as Record<string, unknown>)[HISTORY_FLAG]);
  } catch {
    return false;
  }
}

/**
 * Přidat záznam historie, aby „Zpět" zůstal v dialogu. Zachová interní stav
 * Next routeru (jinak by Next při popstate stránku přenačetl).
 */
export function pushCaptureHistory(): void {
  try {
    if (isCaptureHistoryTop()) return;
    const st: unknown = window.history.state;
    const base = st && typeof st === "object" ? (st as Record<string, unknown>) : {};
    window.history.pushState({ ...base, [HISTORY_FLAG]: true }, "");
  } catch {
    // bez historie — Zpět zavře stránku jako dřív
  }
}

/** Zavření tlačítkem: uklidit náš záznam historie (když je na vrcholu). */
export function popCaptureHistory(): void {
  try {
    if (isCaptureHistoryTop()) window.history.back();
  } catch {
    // ignorovat
  }
}
