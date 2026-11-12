/**
 * Rozhodnutí o stavu anonymizace (spec §5.3) — čistá funkce.
 * Zásada od 31. 10. (majitel): plná automatika bez kontroly člověkem — výsledek je done (nejlepší
 * automatický výsledek; pochybnosti jako tichá poznámka v souhrnu a historii), skipped (není výkres),
 * unsupported (formát nejde), failed (technická chyba po opakováních). Stav `review` už nevzniká.
 */

import { FAST_ATTEMPTS } from "./failure-text";
import type { AnonMethod, AnonPagesAcc, AnonStatus, AnonUsage, AnonWarning } from "./types";

export interface DecideInput {
  mode: "full" | "approval";
  method: AnonMethod | null;
  /** Detekce použila AI a odpověděl požadovaný model. */
  aiUsed: boolean;
  modelFallback: boolean;
  confidence: number;
  /** Všechny zásahy pravidel jsou pokryté vypálenými oblastmi. */
  ruleHitsCovered: boolean;
  /** Výstupní kontroly (únik textu, inkoust ponechaného textu, zbytky) prošly. */
  outputChecksPassed: boolean;
  /** Fotka: ověření přepisem bez nálezu (null = neověřovalo se — vektor / sken s vysokou jistotou). */
  verifyClean: boolean | null;
  /** Fotka: keep hodnoty (číslo výkresu…) jsou v přepisu. */
  verifyKeepPresent: boolean | null;
  /** Fotka: odhad px/mm (null = nevíme / netýká se). */
  pxPerMm: number | null;
  isPhoto: boolean;
  hasMaster: boolean;
  /** Varování z detekce / oblastí (§2.4) a pravidel. */
  warnings: AnonWarning[];
  customerStandard: boolean;
  termInKeep: boolean;
  titleBlockFound: boolean;
  /** Výstup se nevytvořil (selhání) — důvod. */
  failure?: string | null;
  /** Žádná stránka není výkres. */
  notDrawing?: boolean;
  unsupported?: string | null;
  /** Denní limit automatiky vyčerpán (jen automatika). */
  budgetExceeded?: boolean;
}

export interface Decision {
  status: AnonStatus;
  reason: string | null;
  warnings: AnonWarning[];
}

/** Varování výstupní kontroly: v kopii zůstal název firmy (začátek hlášky — za ním strana). */
export const COMPANY_LEAK_WARNING = "V anonymizované kopii zůstal název firmy";
/**
 * Varování „zůstal název firmy" pro stranu (12. 11.): s názvy, které kontrola kopie viděla — v historii pokusů je
 * hned vidět, co zůstalo (firma z razítka, nebo planý poplach typu výrobce materiálu, který patří do „Ponechat").
 * Text vždy začíná COMPANY_LEAK_WARNING (na tom stojí decideAnonStatus).
 */
export function companyLeakWarning(page: number, names?: readonly string[] | null, why?: string | null): string {
  const shown = [...new Set((names ?? []).map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean))].slice(0, 3).map((n) => n.slice(0, 60));
  return `${COMPANY_LEAK_WARNING}${shown.length ? ` „${shown.join("“, „")}“` : ""} (strana ${page}${why ? `; ${why}` : ""}).`;
}
/** Důvod selhání, když v kopii zůstal název firmy — kopie se nikdy nepoužije. */
export const COMPANY_LEAK_TEXT = "V anonymizované kopii zůstal název firmy — kopie se nepoužije. Klikni Anonymizovat znovu (nebo pošli výkres jako PDF přímo z CAD).";
/** Totéž při automatickém opakování (nová detekce AI). */
export const COMPANY_LEAK_RETRY_TEXT = "V anonymizované kopii zůstal název firmy — kopie se nepoužije, zkusí se znovu automaticky.";

/**
 * Zůstal v kopii název firmy a má smysl automatický pokus znovu? Jen s AI (nová detekce a kontrola
 * obrazem — pravidla bez AI by dopadla stejně), ne po ručním uložení editoru a jen v rámci rychlých pokusů
 * (claim zvyšuje anon_attempts; FAST_ATTEMPTS = 3 pokusy hned za sebou v témže běhu, třetí únik = selhalo
 * s důvodem). Majitel 5. 11.: „někdy to musí dělat na třikrát" — opakování po úniku dřív skončilo po dvou
 * pokusech hláškou „Klikni Anonymizovat znovu" a třetí pokus dělal majitel ručně; teď ho udělá systém sám
 * (jména nalezená kontrolou kopie se navíc přenášejí do dalšího pokusu jako termíny, viz service.ts).
 */
export function companyLeakRetry(i: { status: AnonStatus; reason: string | null; aiUsed: boolean; manualSave: boolean; attempts: number | null | undefined }): boolean {
  return i.status === "failed" && i.reason === COMPANY_LEAK_TEXT && i.aiUsed && !i.manualSave && (i.attempts ?? 1) < FAST_ATTEMPTS;
}

export const DONE_MIN_CONFIDENCE = 0.85;
export const NO_TITLE_MIN_CONFIDENCE = 0.9;
export const MIN_PX_PER_MM = 6;

/**
 * Varování, která dřív posílala výkres „Ke kontrole". Od 31. 10. (majitel: „Žádný nic ke kontrole
 * nepůjde. Prostě to automaticky bude fungovat.") se výkres NIKDY neposílá ke kontrole — varování
 * zůstávají jen v souhrnu a historii (tichá poznámka), stav je done.
 */
export const NOTE_CODES = new Set<AnonWarning["code"]>([
  "no_ai", "model_fallback", "coords_out_of_image", "low_resolution", "no_master", "low_px_per_mm", "customer_standard",
  "term_in_keep", "area_cap", "keep_overlap", "verify_leak", "verify_keep_missing", "verify_new_graphic", "no_title_block",
  "dxf_graphics", "dxf_layer_term", "step_suspicious", "residue", "ai_failed", "approval_mode", "low_confidence",
  "text_layer_untrusted", "ai_removed_text", "truncated", "no_terms", "cut_uncertain", "hidden_text", "plot_stamp", "nothing_found", "terms_learned",
]);

/** Fakta jedné dávky stránek PDF (pdf-pipeline → service). */
export interface PdfBatchFacts {
  warnings: AnonWarning[];
  residue: boolean;
  outputOk: boolean;
  customerStandard: boolean;
  termInKeep: boolean;
  /** Jistota AI dávky (min přes stránky s AI). */
  confidence: number;
  /** Každá zahrnutá stránka dávky měla AI. */
  aiUsed: boolean;
  /** Dávka měla aspoň jednu zahrnutou stránku. */
  hasIncluded: boolean;
  fallback: boolean;
  titleBlockFound: boolean;
  verifyClean: boolean | null;
  verifyKeepMissing: boolean;
  detected?: Partial<Record<string, string>>;
  usage?: AnonUsage | null;
}

function sumUsage(a: AnonUsage | null | undefined, b: AnonUsage | null | undefined): AnonUsage | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return {
    input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheWrite: a.cacheWrite + b.cacheWrite,
    usd: Math.round((a.usd + b.usd) * 10000) / 10000, calls: a.calls + b.calls,
  };
}

/**
 * Sloučí dávku stránek do průběžného stavu (navazování PDF > 10 stran): varování a zbytky se nesmí
 * ztratit, „AI u všech stránek" a „razítko na všech stránkách" platí jen když platí v každé dávce,
 * jistota = minimum. Čistá funkce.
 */
export function mergeBatch(prev: AnonPagesAcc | null | undefined, b: PdfBatchFacts, extra: { manualBy?: string | null } = {}): AnonPagesAcc {
  const p: AnonPagesAcc = prev ?? {
    warnings: [], residue: false, outputOk: true, customerStandard: false, termInKeep: false, minConfidence: 1, allAi: true,
    fallback: false, allTitleBlock: true, verifyClean: null, verifyKeepMissing: false, usage: null,
  };
  const seen = new Set(p.warnings.map((w) => `${w.code}:${w.page ?? ""}:${w.message}`));
  const warnings = [...p.warnings];
  for (const w of b.warnings) {
    const k = `${w.code}:${w.page ?? ""}:${w.message}`;
    if (!seen.has(k) && warnings.length < 200) { seen.add(k); warnings.push(w); }
  }
  return {
    warnings,
    residue: p.residue || b.residue,
    outputOk: p.outputOk && b.outputOk,
    customerStandard: p.customerStandard || b.customerStandard,
    termInKeep: p.termInKeep || b.termInKeep,
    minConfidence: b.hasIncluded && b.aiUsed ? Math.min(p.minConfidence, b.confidence) : p.minConfidence,
    allAi: p.allAi && (b.aiUsed || !b.hasIncluded),
    fallback: p.fallback || b.fallback,
    allTitleBlock: p.allTitleBlock && (b.titleBlockFound || !b.hasIncluded),
    verifyClean: p.verifyClean === false || b.verifyClean === false ? false : (p.verifyClean ?? b.verifyClean),
    verifyKeepMissing: p.verifyKeepMissing || b.verifyKeepMissing,
    detected: p.detected && Object.keys(p.detected).length ? p.detected : (b.detected as AnonPagesAcc["detected"]),
    manualBy: extra.manualBy !== undefined ? extra.manualBy : (p.manualBy ?? null),
    usage: sumUsage(p.usage, b.usage),
  };
}

/** Průběžný stav → vstup rozhodnutí (bez režimu). */
export function accToDecide(acc: AnonPagesAcc, base: { method: AnonMethod; failure?: string | null; notDrawing?: boolean }): Omit<DecideInput, "mode"> {
  return {
    method: base.method, aiUsed: acc.allAi, modelFallback: acc.fallback, confidence: acc.minConfidence,
    ruleHitsCovered: !acc.residue, outputChecksPassed: acc.outputOk, verifyClean: acc.verifyClean,
    verifyKeepPresent: acc.verifyKeepMissing ? false : null, pxPerMm: null, isPhoto: false, hasMaster: false,
    warnings: [...acc.warnings], customerStandard: acc.customerStandard, termInKeep: acc.termInKeep,
    titleBlockFound: acc.allTitleBlock || (acc.allAi && acc.minConfidence >= NO_TITLE_MIN_CONFIDENCE),
    failure: base.failure ?? null, notDrawing: base.notDrawing ?? false,
  };
}

export function decideAnonStatus(i: DecideInput): Decision {
  const warnings = [...i.warnings];
  if (i.unsupported) return { status: "unsupported", reason: i.unsupported, warnings };
  if (i.failure) return { status: "failed", reason: i.failure, warnings };
  if (i.budgetExceeded) return { status: "pending", reason: "Denní limit AI pro automatiku je vyčerpán — pokračuje zítra (nebo spusť ručně).", warnings };
  if (i.notDrawing) return { status: "skipped", reason: "Není výkres", warnings };
  // „s jistotou": výstup, který neprošel kontrolou (v kopii zůstal text, metadata, název firmy v DXF),
  // se nikdy nepoužije — místo kontroly člověkem selhání s důvodem
  if (!i.outputChecksPassed) {
    if (warnings.some((w) => w.code === "verify_leak" && w.message.startsWith(COMPANY_LEAK_WARNING))) return { status: "failed", reason: COMPANY_LEAK_TEXT, warnings };
    return { status: "failed", reason: "Kontrola anonymizované kopie neprošla (zůstal text nebo metadata) — kopie se nepoužije, zkus Anonymizovat znovu.", warnings };
  }

  // tiché poznámky (historie / souhrn) — žádná z nich nezastaví automatiku
  const add = (code: AnonWarning["code"], message: string) => {
    if (!warnings.some((w) => w.code === code)) warnings.push({ code, message });
  };
  if (!i.aiUsed && (i.isPhoto || i.method === "image" || i.method === "image_pdf")) add("no_ai", "Bez AI klíče se na skenech a fotkách název firmy nehledá (smazán jen text podle pravidel).");
  if (i.modelFallback) add("model_fallback", "Odpověděl záložní model.");
  if (i.aiUsed && i.confidence < DONE_MIN_CONFIDENCE) add("low_confidence", `Jistota AI ${Math.round(i.confidence * 100)} %.`);
  if (i.isPhoto && i.verifyClean === false) add("verify_leak", "Ověření přepisem našlo podezřelý zbytek.");
  if (i.isPhoto && i.pxPerMm !== null && i.pxPerMm < MIN_PX_PER_MM) add("low_px_per_mm", "Písmo na fotce je malé.");
  void i.mode;
  return { status: "done", reason: null, warnings };
}
