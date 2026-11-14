/**
 * Změna adresáta v dialogu odeslání → tykání / vykání, oslovení a text návrhu — čistá logika
 * (testy v draft-retarget.test.ts). Majitel 14. 11.: „když e-mail (adresáta) změním, nezmění se mi
 * vykání / tykání a nepřepíše se oslovení — musím ručně přepínat a aktualizovat celý koncept".
 *
 * Pravidla:
 *  - nový hlavní adresát (Komu) → jeho uložené tykání / vykání (jinak výchozí vykání) a oslovení s jeho jménem;
 *  - text je pořád neupravený návrh aplikace (liší se nanejvýš oslovením) → připraví se celý znovu pro nového
 *    adresáta (tvary „ti posíláme / Vám zasíláme");
 *  - text uživatel upravil → jeho text zůstane, vymění se jen řádek s oslovením a pod textem se ukáže
 *    „Oslovení upraveno pro <jméno> (vykání)." s tlačítkem „Přegenerovat text";
 *  - ruční přepnutí Tykáme / Vykáme dál platí (uloží se k adrese) a má přednost — návrh se přizpůsobí jemu.
 */

import { normEmail } from "./roles";
import { applySalutation, bodyWithoutGreeting, type AddressForm } from "./tone";

/** Stav návrhu v e-mailu dialogu (doplňuje Komu / Kopie / Předmět / Text). */
export interface DraftTracking {
  /** Adresát, pro kterého aplikace text připravila. undefined = dialog změnu adresáta nesleduje. */
  draftTo?: string | null;
  /** Text tak, jak ho naposledy připravila aplikace (i s vyměněným podpisem). */
  draftBody?: string | null;
  /** Výměna podpisu („Odeslat z") — použije se i na znovu připravený text. */
  sig?: { from: string; to: string } | null;
  /** Poznámka pod textem po změně adresáta (text uživatele zůstal, vyměnilo se jen oslovení). */
  toneNote?: string | null;
}

/** Je text pořád návrh aplikace (nanejvýš s jiným oslovením)? */
export function isUntouchedDraft(body: string, draftBody: string | null | undefined): boolean {
  if (draftBody === null || draftBody === undefined) return false;
  return bodyWithoutGreeting(body) === bodyWithoutGreeting(draftBody);
}

export function addressWord(address: AddressForm): string {
  return address === "ty" ? "tykání" : "vykání";
}

/** „Oslovení upraveno pro Natálie Vojčíková (vykání)." */
export function recipientNote(who: string, address: AddressForm): string {
  return `Oslovení upraveno pro ${who} (${addressWord(address)}).`;
}

export type RecipientSwitch =
  /** Stejný adresát jako návrh (první načtení tónu) — nic se nemění. */
  | { kind: "same" }
  /** Neupravený návrh: hned nové oslovení, pak celý text znovu (redraft) pro nového adresáta. */
  | { kind: "regenerate"; body: string }
  /** Upravený text: jen nové oslovení + poznámka (s „Přegenerovat text", když jde text připravit znovu). */
  | { kind: "greeting"; body: string; note: string };

/** Co udělat s textem, když se načetlo tykání / vykání adresáta `email` (po změně Komu). */
export function planRecipientSwitch(input: {
  body: string;
  draftBody: string | null | undefined;
  draftTo: string | null | undefined;
  email: string;
  name: string | null | undefined;
  salutation: string;
  address: AddressForm;
  /** Dialog umí text připravit znovu pro jiného adresáta. */
  canRegenerate: boolean;
}): RecipientSwitch {
  const email = normEmail(input.email);
  if (!email || email === normEmail(input.draftTo)) return { kind: "same" };
  const body = applySalutation(input.body, input.salutation);
  if (input.canRegenerate && isUntouchedDraft(input.body, input.draftBody)) return { kind: "regenerate", body };
  return { kind: "greeting", body, note: recipientNote((input.name ?? "").trim() || email, input.address) };
}

/**
 * Znovu připravený text ze serveru → nový text, nebo null (mezitím se změnil adresát, nebo uživatel
 * začal psát — jeho text nepřepíšeme, leda na výslovné „Přegenerovat text" = force).
 */
export function acceptRedraft(input: {
  body: string;
  draftBody: string | null | undefined;
  /** Aktuální hlavní adresát v Komu. */
  mainTo: string | null | undefined;
  /** Pro koho se text připravoval. */
  email: string;
  fresh: string;
  sig?: { from: string; to: string } | null;
  force?: boolean;
}): string | null {
  const email = normEmail(input.email);
  if (!email || normEmail(input.mainTo) !== email) return null;
  if (!input.force && !isUntouchedDraft(input.body, input.draftBody)) return null;
  return input.sig ? swapSignature(input.fresh, input.sig.from, input.sig.to) : input.fresh;
}

/** Vymění podpis v textu (je-li tam starý); jinak text nechá. */
export function swapSignature(body: string, prev: string, next: string): string {
  const p = prev.trim();
  if (!p || !body.includes(p)) return body;
  return body.replace(p, next.trim());
}

/** Výměna podpisu v e-mailu dialogu — i v uloženém návrhu (aby zůstal „neupravený") a pro příští redraft. */
export function swapDraftSignature<T extends { body: string } & DraftTracking>(m: T, prev: string, next: string): T {
  const from = m.sig?.from ?? prev;
  return {
    ...m,
    body: swapSignature(m.body, prev, next),
    draftBody: m.draftBody === null || m.draftBody === undefined ? m.draftBody : swapSignature(m.draftBody, prev, next),
    sig: from.trim() === next.trim() ? null : { from, to: next },
  };
}
