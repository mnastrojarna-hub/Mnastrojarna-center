/**
 * Technická chyba běhu anonymizace → česká hláška pro uživatele + jestli má smysl to zkusit znovu
 * (čistá funkce — server i klient). Surová (anglická) zpráva patří jen do logu serveru — nikdy do
 * anon_reason, odznaku ani tooltipu.
 *
 * POCTIVOST (majitel 30. 10.: „píše to PDF je poškozené nebo zaheslované… to je blbost"):
 *  - „poškozené" JEN když soubor nerozebere pdf.js (InvalidPDFException) — to samé ukáže i prohlížeč PDF,
 *  - „zaheslované" JEN když PDF chce heslo k OTEVŘENÍ (PasswordException); heslo vlastníka (zákaz úprav
 *    a kopírování z CAD / ERP) otevření nebrání a anonymizuje se normálně,
 *  - cokoli jiného (chyba prostředí, paměť, čas, úložiště, AI) = přechodná chyba → opakuje se samo,
 *    nikdy „Požádej o nový soubor".
 */

/** Jen heslo k OTEVŘENÍ (uživatelské). PDF s heslem vlastníka (zákaz úprav/kopírování, CAD/ERP) se otevře samo. */
export const PDF_PASSWORD_TEXT = "PDF je zaheslované — bez hesla k otevření ho nejde přečíst. Požádej o soubor bez hesla.";
/** Jen když pdf.js soubor nerozebere (ani s opravou xref) — to samé ukáže i prohlížeč PDF. */
export const PDF_INVALID_TEXT = "Soubor není čitelné PDF (poškozený nebo jiný formát) — nejde otevřít. Požádej o nový soubor.";
/** Přechodná / interní chyba — soubor se zpracuje znovu sám. */
export const INTERNAL_RETRY_TEXT = "Anonymizace se nepovedla kvůli technické chybě při zpracování — zkusí se znovu automaticky.";
/** Po vyčerpání automatických pokusů. */
export const INTERNAL_FINAL_TEXT = "Anonymizace se opakovaně nepovedla kvůli technické chybě při zpracování (ne kvůli souboru) — klikni Anonymizovat znovu.";
/**
 * Dřívější (nepravdivá) hláška pro JAKOUKOLI chybu u PDF — v produkci ji dostala i běžná PDF, protože
 * vykreslení padalo na chybějících globálech pdf.js. Migrace 20261030180000 takové soubory vrátí do fronty.
 */
export const LEGACY_PDF_FAILURE_TEXT = "PDF je poškozené nebo zaheslované — nejde otevřít. Požádej o nový soubor.";
/** Dřívější obecná hláška technické chyby (také se vrací do fronty). */
export const LEGACY_TECH_FAILURE_TEXT = "Anonymizace se nepovedla (technická chyba) — zkus Anonymizovat znovu.";

export type FailureKind = "password" | "corrupt" | "storage" | "ai_busy" | "timeout" | "internal" | "core";

export interface FailureInfo {
  kind: FailureKind;
  /** Česká věta pro uživatele. */
  text: string;
  /** Má smysl opakovat (chyba prostředí / běhu, ne vada souboru). */
  transient: boolean;
}

const JS_ERROR = /TypeError|ReferenceError|RangeError|SyntaxError|Cannot read|undefined|is not a function|is not defined|\bnull\b/i;

export function classifyFailure(message: string): FailureInfo {
  const m = String(message ?? "");
  // vada souboru — jen podle značek pdf.js / našich vět (ne podle „encrypt": šifrování s heslem vlastníka otevření nebrání)
  if (/PasswordException|No password given|Incorrect Password/i.test(m) || m === PDF_PASSWORD_TEXT) return { kind: "password", text: PDF_PASSWORD_TEXT, transient: false };
  if (/InvalidPDFException|Invalid PDF structure|PDF file is empty/i.test(m) || m === PDF_INVALID_TEXT) return { kind: "corrupt", text: PDF_INVALID_TEXT, transient: false };
  if (/nemá uloženou cestu/i.test(m)) return { kind: "storage", text: "Soubor nemá uloženou cestu v úložišti — nahraj ho znovu.", transient: false };
  // originál v úložišti opravdu není (smazaný) — opakování nepomůže
  if (/stáhnout: (Object not found|not found)/i.test(m)) return { kind: "storage", text: "Originál souboru v úložišti chybí — nahraj ho znovu.", transient: false };
  if (/stáhnout|úložiště|Uložení|Object not found|Storage(Unknown|Api)?Error|Bucket not found/i.test(m)) {
    return { kind: "storage", text: "Soubor se nepodařilo načíst z úložiště nebo uložit výsledek — zkusí se znovu automaticky.", transient: true };
  }
  if (/\b429\b|\b529\b|overloaded|rate.?limit/i.test(m)) return { kind: "ai_busy", text: "AI je teď přetížená — zkusí se znovu automaticky za chvíli.", transient: true };
  if (/timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|fetch failed|socket hang up|network|trvalo příliš dlouho|aborted|\b50[234]\b/i.test(m)) {
    return { kind: "timeout", text: "Zpracování se přerušilo (vypršel čas nebo výpadek spojení) — zkusí se znovu automaticky.", transient: true };
  }
  // chyba nasazení (chybí fonty pdf.js) — po opravě nasazení projde, proto se opakuje
  if (/Chybí fonty pdf\.js v nasazení/.test(m)) return { kind: "internal", text: `${m.replace(/\.?\s*$/, ".")} Zkusí se znovu automaticky.`, transient: true };
  // dřívější nepravdivé hlášky (zobrazení starých řádků, než je migrace vrátí do fronty)
  if (m === LEGACY_PDF_FAILURE_TEXT || m === LEGACY_TECH_FAILURE_TEXT) return { kind: "internal", text: INTERNAL_RETRY_TEXT, transient: true };
  if (m === INTERNAL_RETRY_TEXT || m === INTERNAL_FINAL_TEXT) return { kind: "internal", text: m, transient: true };
  // české hlášky jádra („Písmo se nevykreslilo…", „Soubor je větší než 50 MB") projdou beze změny
  if (/[ěščřžýáíéůúňťď]/i.test(m) && !JS_ERROR.test(m)) return { kind: "core", text: m, transient: false };
  return { kind: "internal", text: INTERNAL_RETRY_TEXT, transient: true };
}

export function userFacingFailure(message: string): string {
  return classifyFailure(message).text;
}

/** Pokusy hned za sebou (claim zvedá anon_attempts). */
export const FAST_ATTEMPTS = 3;
/** Celkem automatických pokusů u přechodné chyby (další se odkládají). */
export const MAX_ATTEMPTS = 6;
/** Odklad 4., 5. a 6. pokusu (min) — výpadek úložiště / AI / nasazení mezitím pomine. */
export const RETRY_DELAYS_MIN = [5, 15, 45] as const;

export interface RetryPlan {
  status: "pending" | "failed";
  /** pending: odklad dalšího pokusu (0 = hned). */
  delayMs: number;
  text: string;
}

/**
 * Co po chybě běhu: vada souboru / odmítnutý klíč / limit útraty → hned failed (opakování nepomůže);
 * přechodná chyba → 3 pokusy hned, pak 3 odložené (5 / 15 / 45 min), teprve potom failed.
 */
export function retryPlan(attempts: number, info: FailureInfo, opts: { permanent?: boolean } = {}): RetryPlan {
  const n = Math.max(1, attempts || 1);
  if (!info.transient || opts.permanent) return { status: "failed", delayMs: 0, text: info.text };
  if (n < FAST_ATTEMPTS) return { status: "pending", delayMs: 0, text: info.text };
  if (n < MAX_ATTEMPTS) return { status: "pending", delayMs: RETRY_DELAYS_MIN[Math.min(n - FAST_ATTEMPTS, RETRY_DELAYS_MIN.length - 1)] * 60_000, text: info.text };
  return { status: "failed", delayMs: 0, text: info.kind === "internal" ? INTERNAL_FINAL_TEXT : info.text.replace(/\s*—\s*zkusí se znovu automaticky.*$/i, " — klikni Anonymizovat znovu.") };
}
