/**
 * Osobní předvolby vzhledu (profiles.ui_prefs, migrace 20261102120000_ui_prefs.sql) — čistý modul pro server
 * i prohlížeč. Ukládají se hned bez potvrzení (majitel 2. 11.): localStorage = okamžitá mezipaměť (platí už
 * při prvním vykreslení po obnovení), DB = výchozí pro uživatele na jiném počítači / v jiném prohlížeči.
 *
 * Klíče:
 *   mail.listWidth        — šířka seznamu vláken v Poště (px) vedle detailu zprávy (null = výchozí ~30 %)
 *   mail.foldersCollapsed — sloupec složek jen s ikonami (null = automaticky podle šířky okna)
 *   mail.comfortable      — seznam vláken „Pohodlné" (vyšší řádky s náhledem a štítky); null = Kompaktní
 *                           (na počítači ≥ 10 vláken na obrazovce, majitel 3. 11.); mobil vždy beze změny
 *   app.sidebarCollapsed  — hlavní menu vlevo jen s ikonami (null = automaticky: v Poště pod 1440 px sbalené,
 *                           jinde rozbalené)
 */

export const UI_PREF_KEYS = ["mail.listWidth", "mail.foldersCollapsed", "mail.comfortable", "app.sidebarCollapsed"] as const;
export type UiPrefKey = (typeof UI_PREF_KEYS)[number];

export interface UiPrefs {
  "mail.listWidth"?: number;
  "mail.foldersCollapsed"?: boolean;
  "mail.comfortable"?: boolean;
  "app.sidebarCollapsed"?: boolean;
}

/** Seznam vláken: nejužší / nejširší povolená šířka (px). */
export const MAIL_LIST_MIN = 260;
export const MAIL_LIST_MAX = 1600;
/** Detail zprávy nejméně (px) — na úzké obrazovce (1024) ustoupí seznamu jeho minimu. */
export const MAIL_DETAIL_MIN = 480;
/** Výchozí podíl seznamu ze šířky seznam + detail. */
export const MAIL_LIST_DEFAULT_RATIO = 0.3;
/** Krok klávesnice (šipky), se Shiftem větší. */
export const MAIL_LIST_STEP = 16;
export const MAIL_LIST_STEP_BIG = 64;

export function isUiPrefKey(k: unknown): k is UiPrefKey {
  return typeof k === "string" && (UI_PREF_KEYS as readonly string[]).includes(k);
}

/**
 * Ověření hodnoty: vrací { ok, value } (value null = smazat → výchozí), nebo { ok: false } u nesmyslu.
 * Šířka se zaokrouhlí a ořízne do rozsahu.
 */
export function sanitizeUiPref(key: unknown, value: unknown): { ok: true; key: UiPrefKey; value: number | boolean | null } | { ok: false; error: string } {
  if (!isUiPrefKey(key)) return { ok: false, error: "Neznámá předvolba." };
  if (value === null || value === undefined) return { ok: true, key, value: null };
  if (key === "mail.listWidth") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return { ok: false, error: "Šířka musí být číslo." };
    return { ok: true, key, value: Math.round(Math.min(MAIL_LIST_MAX, Math.max(MAIL_LIST_MIN, n))) };
  }
  if (typeof value !== "boolean") return { ok: false, error: "Hodnota musí být ano / ne." };
  return { ok: true, key, value };
}

/** Předvolby z DB / localStorage → jen známé klíče se správným typem. */
export function normalizeUiPrefs(raw: unknown): UiPrefs {
  const out: UiPrefs = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const k of UI_PREF_KEYS) {
    if (r[k] === undefined || r[k] === null) continue;
    const s = sanitizeUiPref(k, r[k]);
    if (s.ok && s.value !== null) (out as Record<string, unknown>)[k] = s.value;
  }
  return out;
}

/**
 * Skutečná šířka seznamu v prostoru `available` (seznam + detail, bez oddělovače): uložená (nebo výchozí 30 %),
 * nejméně MAIL_LIST_MIN, detail nejméně MAIL_DETAIL_MIN — když se obojí nevejde, má přednost minimum seznamu.
 */
export function clampListWidth(stored: number | null | undefined, available: number): number {
  const avail = Math.max(0, Math.round(available));
  const want = typeof stored === "number" && Number.isFinite(stored) ? stored : Math.round(avail * MAIL_LIST_DEFAULT_RATIO);
  const max = Math.max(MAIL_LIST_MIN, avail - MAIL_DETAIL_MIN);
  return Math.round(Math.min(max, Math.max(MAIL_LIST_MIN, want)));
}

/** Klávesnice na oddělovači: šipky ±16 px (Shift ±64), Home/End = nejužší / nejširší; jiné klávesy null. */
export function listWidthForKey(key: string, shift: boolean, current: number, available: number): number | null {
  const step = shift ? MAIL_LIST_STEP_BIG : MAIL_LIST_STEP;
  const max = Math.max(MAIL_LIST_MIN, available - MAIL_DETAIL_MIN);
  switch (key) {
    case "ArrowLeft":
      return Math.max(MAIL_LIST_MIN, current - step);
    case "ArrowRight":
      return Math.min(max, current + step);
    case "Home":
      return MAIL_LIST_MIN;
    case "End":
      return max;
    default:
      return null;
  }
}

/** Klíč localStorage (zvlášť pro každého uživatele — sdílený počítač). */
export function uiPrefsStorageKey(userId: string): string {
  return `mn.uiPrefs.${userId}`;
}

/**
 * Mezipaměť v prohlížeči: { prefs, pending } — pending = klíče, jejichž zápis do DB ještě nepotvrdil server
 * (zavřená karta během odkladu zápisu). Při dalším načtení mají přednost před DB a pošlou se znovu.
 */
export interface UiPrefsCache {
  prefs: UiPrefs;
  pending: UiPrefKey[];
}

export function parseUiPrefsCache(raw: string | null | undefined): UiPrefsCache {
  if (!raw) return { prefs: {}, pending: [] };
  try {
    const j = JSON.parse(raw) as { prefs?: unknown; pending?: unknown };
    const pending = Array.isArray(j.pending) ? j.pending.filter(isUiPrefKey) : [];
    // smazaná předvolba (výchozí) čekající na zápis: v prefs chybí, v pending je
    return { prefs: normalizeUiPrefs(j.prefs), pending: [...new Set(pending)] };
  } catch {
    return { prefs: {}, pending: [] };
  }
}

/**
 * Výsledné předvolby: DB (server) + nepotvrzené místní změny (pending) navrch. Potvrzené místní hodnoty se
 * ignorují — platí DB (změna z jiného prohlížeče).
 */
export function mergeUiPrefs(server: UiPrefs, cache: UiPrefsCache): UiPrefs {
  const out: UiPrefs = { ...server };
  for (const k of cache.pending) {
    const v = cache.prefs[k];
    if (v === undefined) delete (out as Record<string, unknown>)[k];
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
