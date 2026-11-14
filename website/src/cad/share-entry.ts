/**
 * S čím stránka CADu přišla: sdílený odkaz k otevření, nebo žádost o zadání kódu. Čistá logika nad adresou a
 * sessionStorage, aby v cad-app.tsx zůstalo jen pár řádků.
 *
 *  – `#<KÓD>` / `#q=…` / `#s=…` / `#r=…`: skript stránky (share-code.ts) část za # hned odložil do sessionStorage a z adresy
 *    odstranil; odložený odkaz se otevře (a po F5 znovu – dokud ho stránka po NEÚSPĚCHU nezahodí: překlep v kódu ani
 *    vypršelý odkaz se tak na kartu „nepřilepí“);
 *  – `?kod=1` (příjemce otevřel `…/s` bez kódu – přesměrování z next.config.mjs / .htaccess): zeptat se na kód;
 *  – část za #, která vypadá jako kód s chybou (0 / O / I / l, jiná délka, VELKÁ PÍSMENA): zeptat se na kód a říct, co je
 *    špatně – místo mlčky otevřeného prázdného CADu.
 */
import { parseShareHash, shareCodeProblem, type ParsedShare } from "./share";
import { SHARE_ASK_PARAM, SHARE_STASH_KEY } from "./share-code";

/** open = sdílený odkaz k otevření (`hash` = část za # ve tvaru pro odložení), ask = zeptat se na kód */
export type ShareEntry = { kind: "open"; parsed: ParsedShare; hash: string } | { kind: "ask"; value: string; error?: string } | null;

/** odloží sdílený odkaz (část za #) pro tuto kartu – F5 ho otevře znovu */
export function stashShare(hash: string) {
  try {
    sessionStorage.setItem(SHARE_STASH_KEY, hash);
  } catch {
    /* soukromý režim bez úložiště */
  }
}
/** zahodí odložený odkaz (nepodařilo se ho otevřít, záložka se sdíleným dokumentem zavřena) */
export function clearShareStash() {
  try {
    sessionStorage.removeItem(SHARE_STASH_KEY);
  } catch {
    /* ignore */
  }
}
const stashed = () => {
  try {
    return sessionStorage.getItem(SHARE_STASH_KEY) || "";
  } catch {
    return "";
  }
};
/** odkaz ve tvaru pro odložení: u kódu jen `#KÓD` (bez přilepené interpunkce), jinak část za # tak, jak přišla */
export const stashForm = (parsed: ParsedShare, hash: string) => (parsed.kind === "code" ? `#${parsed.code}` : hash);

/** text pro pole kódu z nepovedené části za #: bez #, dekódovaný, bez přilepené interpunkce */
function fieldText(hash: string): string {
  let t = hash.replace(/^#/, "");
  try {
    t = decodeURIComponent(t);
  } catch {
    /* ponechat */
  }
  return t.replace(/[^0-9A-Za-z]+$/, "").slice(0, 40);
}

/**
 * Přečte adresu (a při načtení stránky i odložený odkaz) a uklidí ji: část za # i parametr `kod` z adresy zmizí
 * (dokument pod NDA nemá zůstat v historii prohlížeče). `initial` = načtení stránky; jinak změna části za # u otevřené
 * stránky (odkaz vložený do adresního řádku).
 */
export function readShareEntry(initial: boolean): ShareEntry {
  const hash = location.hash;
  const params = new URLSearchParams(location.search);
  const ask = initial && params.get(SHARE_ASK_PARAM) === "1";
  if (ask) params.delete(SHARE_ASK_PARAM);
  const clean = () => {
    const q = params.toString();
    history.replaceState(null, "", location.pathname + (q ? `?${q}` : ""));
  };
  const parsed = hash.length > 1 ? parseShareHash(hash) : null;
  if (parsed) {
    const form = stashForm(parsed, hash);
    stashShare(form);
    clean();
    return { kind: "open", parsed, hash: form };
  }
  const problem = hash.length > 1 ? shareCodeProblem(hash, true) : null;
  if (problem) {
    clearShareStash();
    clean();
    return { kind: "ask", value: fieldText(hash), error: problem };
  }
  if (ask) {
    // příjemce přišel zadat kód: dřívější sdílený dokument této karty se znovu neotevírá
    clearShareStash();
    clean();
    return { kind: "ask", value: "" };
  }
  if (!initial) return null;
  const kept = stashed();
  const old = parseShareHash(kept);
  return old ? { kind: "open", parsed: old, hash: kept } : null;
}
