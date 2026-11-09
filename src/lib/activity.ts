import { activeNavHref, allNavItems } from "@/lib/nav";
import { relativeTime } from "@/lib/utils";

/**
 * Poslední aktivita uživatele (9. 11.) — majitel chce vidět, kdy kdo naposledy něco v systému udělal (kliknul),
 * ne kdy se přihlásil. Prohlížeč posílá „tep" jen po skutečné akci (kliknutí / klávesa), nejvýš 1× za minutu;
 * DB navíc zapíše jen když je uložený čas starší než 30 s (migrace 20261109140000_posledni_aktivita.sql).
 */

/** Nejvýš jeden tep za tuto dobu (na kartu prohlížeče). */
export const ACTIVITY_THROTTLE_MS = 60_000;
/** Bez aktivity déle než tolik dní = ve správě uživatelů tlumeně (na první pohled, kdo systém nepoužívá). */
export const ACTIVITY_STALE_DAYS = 7;
/** Do této doby od poslední akce = „právě teď v systému" (zelená tečka). */
export const ACTIVITY_RECENT_MS = 10 * 60_000;
/** Maximální délka uložené cesty (DB check profiles_last_active_path_len). */
export const ACTIVITY_PATH_MAX = 200;

/** Cesta stránky pro tep: jen „/…" (ne „//host"), bez dotazu a kotvy, max 200 znaků. Jinak null. */
export function sanitizeActivityPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.trim().split(/[?#]/, 1)[0] ?? "";
  if (!path.startsWith("/") || path.startsWith("//") || /[\p{Cc}\\]/u.test(path)) return null;
  return path.slice(0, ACTIVITY_PATH_MAX);
}

/**
 * Omezovač tepů (čistá logika, testovatelná): první akce pošle hned, další během intervalu jen označí
 * „čeká" — ta se odešle při odchodu z karty (flush), aby se neztratila poslední akce před přepnutím jinam.
 * Návrat na kartu (visible) interval vynuluje: první akce po návratu jde hned.
 */
export interface ActivityThrottle {
  /** Uživatel něco udělal. true = poslat tep teď. */
  interaction(now: number): boolean;
  /** Karta se skrývá / stránka odchází. true = je co dohnat (akce v intervalu, která ještě neodešla). */
  flush(now: number): boolean;
  /** Karta je znovu vidět — bez tepu (jen otevřená karta není aktivita), další akce ale půjde hned. */
  visible(): void;
}

export function createActivityThrottle(intervalMs = ACTIVITY_THROTTLE_MS): ActivityThrottle {
  let lastSent = Number.NEGATIVE_INFINITY;
  let pending = false;
  return {
    interaction(now) {
      if (now - lastSent >= intervalMs) {
        lastSent = now;
        pending = false;
        return true;
      }
      pending = true;
      return false;
    },
    flush(now) {
      if (!pending) return false;
      pending = false;
      lastSent = now;
      return true;
    },
    visible() {
      lastSent = Number.NEGATIVE_INFINITY;
    },
  };
}

/** Lidský název stránky z menu (Kniha zakázek, Pošta …); bez položky menu cesta sama. */
export function activityPageLabel(path: string | null | undefined): string | null {
  if (!path) return null;
  const href = activeNavHref(path, allNavItems.map((i) => i.href));
  return href ? allNavItems.find((i) => i.href === href)?.title ?? path : path;
}

const EXACT = new Intl.DateTimeFormat("cs-CZ", {
  timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export type ActivityTone = "recent" | "normal" | "stale" | "never";

export interface LastActiveView {
  /** „před 5 min", „teď", „9. 10. 2026" … nebo „Zatím žádná aktivita". */
  label: string;
  tone: ActivityTone;
  /** Přesné datum a čas (Praha) pro title; null = žádná aktivita. */
  exact: string | null;
  /** Stránka poslední akce (název z menu, jinak cesta). */
  page: string | null;
}

/** Zobrazení poslední aktivity ve správě uživatelů. */
export function describeLastActive(at: string | null | undefined, path?: string | null, now: number = Date.now()): LastActiveView {
  const t = at ? new Date(at).getTime() : Number.NaN;
  if (!at || Number.isNaN(t)) return { label: "Zatím žádná aktivita", tone: "never", exact: null, page: null };
  const age = now - t;
  const tone: ActivityTone = age <= ACTIVITY_RECENT_MS ? "recent" : age > ACTIVITY_STALE_DAYS * 86_400_000 ? "stale" : "normal";
  return { label: relativeTime(at), tone, exact: EXACT.format(new Date(t)), page: activityPageLabel(path) };
}

/** Řazení „podle aktivity": naposledy aktivní první, bez aktivity na konci (stabilně podle původního pořadí). */
export function compareLastActive(a: string | null | undefined, b: string | null | undefined): number {
  const ta = a ? new Date(a).getTime() : Number.NaN;
  const tb = b ? new Date(b).getTime() : Number.NaN;
  const na = Number.isNaN(ta);
  const nb = Number.isNaN(tb);
  if (na && nb) return 0;
  if (na) return 1;
  if (nb) return -1;
  return tb - ta;
}
