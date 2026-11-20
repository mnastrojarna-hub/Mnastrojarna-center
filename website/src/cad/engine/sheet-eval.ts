/**
 * Vyhodnocení listů výkresu do protokolu (CAD-HEADLESS-NAVRH.md kap. 5.2 č. 32–33, 5.3; balík B4).
 *
 * Varování listu (rovina řezu neprotíná těleso, pohledy se v měřítku nevejdou na list, ztracený pohled, detail bez
 * geometrie, vynechané Chytré kóty…) dřív viděl jen `výkres stav` nebo okno výkresu. Teď:
 * * **přísný režim** list spočítá po bloku po sobě jdoucích příkazů `výkres …` (při přepnutí listu a na konci skriptu);
 * * **normální režim** spočítá každý list, který běh měnil, jednou na konci běhu (stejné kódy, jen bez zastavení);
 * varování se přiřadí řádku posledního příkazu bloku (seznam řádků bloku v `data.lines`). Mezistavy uvnitř bloku
 * (`výkres A1` před `výkres měřítko 1:5`, popisek, který další `výkres upravit … posun=` odsune) tak nevedou k falešnému
 * nálezu ani zastavení: překryv poznámky z příkazu se ověří znovu na konci bloku (`recheckIssue`).
 *
 * Kódy nezávisí na jazyce: hlášení jádra výkresu nesou kód a druh (cad/drawing-issues.ts, vlna 15), překryv a přesah
 * rámečku jsou strojové druhy nálezu (`DrawingIssue.kind`); text bez hlášení se porovná s přeloženým klíčem
 * (`sheetWarningCode`), ne regulárním výrazem přes překlad.
 *
 * `drawingMemo` pamatuje poslední výsledky jádra pro tentýž dokument, popis a volby listu: vyhodnocení bloku a pozdější
 * export PDF (CLI `--formats`) téhož listu se nepočítají dvakrát (projekce sestavy trvá desítky sekund).
 */
import type { DrawingCompute, DrawingExtras } from "../drawing-agent";
import { DIMS_INCOMPLETE_KEY, SECTION_MISS_BADGE, isTextOfKey, issuesOf, type DrawingIssue } from "../drawing-issues";
import { tr } from "../i18n";
import type { CadDoc, DrawingAnnotation } from "../types";
import { codeText, type Code, type CodeLevel } from "./codes";
import type { KernelApi } from "./kernel";

type MemoEntry = { key: string; res: Awaited<ReturnType<DrawingCompute>> };
const MEMO_MAX = 4;
let memo: MemoEntry[] = [];

/** výsledek jádra pro list s pamětí posledních výsledků (stejný vstup = stejný list) */
export function drawingMemo(kernel: Pick<KernelApi, "drawing">): DrawingCompute {
  return async (doc, meta, opts) => {
    // klíč jako mezipaměť tělesa výkresu v jádře (kernel-ops „drawing“) + popis a volby listu: poznámky a kóty listu
    // (annotations) výsledek jádra nemění – vyhodnocení bloku po `kótovat …` tak použije list spočítaný tím příkazem
    const key = JSON.stringify([doc.features, doc.variables, doc.configs, doc.activeConfig, doc.bodies, doc.kind, doc.components, doc.mates, doc.material, meta, opts]);
    const hit = memo.find((m) => m.key === key);
    if (hit) return hit.res;
    const res = await kernel.drawing(doc, meta, opts);
    memo = [{ key, res }, ...memo.filter((m) => m.key !== key)].slice(0, MEMO_MAX);
    return res;
  };
}
/** zapomene výsledky (testy, uvolnění paměti) */
export const clearDrawingMemo = (): void => void (memo = []);

/** kód varování listu podle textu jádra (drawing.ts) – porovnáním s přeloženým klíčem, stejně v cs/en/de */
export function sheetWarningCode(text: string): Code {
  if (isTextOfKey(text, SECTION_MISS_BADGE)) return "drawing.section-miss";
  if (isTextOfKey(text, DIMS_INCOMPLETE_KEY)) return "drawing.dims-incomplete"; // kontrola kót (bod 18)
  return "drawing.warning";
}

/** kód nálezu příkazu výkresu (kód hlášení z cad/drawing-issues.ts; překryv i přesah rámečku = drawing.overlap) */
export const issueCode = (i: Pick<DrawingIssue, "kind" | "code" | "text">): Code => (i.kind === "overlap" || i.kind === "frame" ? "drawing.overlap" : i.kind === "section-miss" ? "drawing.section-miss" : i.code === "drawing.warning" ? sheetWarningCode(i.text) : i.code);

/** argumenty textu kódu: řez mimo těleso = jen název listu, ostatní název listu a text */
export const issueArgs = (code: Code, sheet: string, text: string): (string | number)[] => (code === "drawing.section-miss" ? [sheet] : [sheet, text]);

/** nález listu do protokolu: kód, úroveň (řez mimo těleso = ✗), text a strojová data hlášení (rozsah odsazení řezu …) */
export type SheetIssue = { code: Code; sheet: string; text: string; level?: CodeLevel; data?: Record<string, unknown> };

/** název listu do protokolu (název, jinak „list N“) */
export const sheetLabel = (doc: CadDoc, idx: number) => doc.drawings?.[idx]?.name || tr("list {0}", idx + 1);

/** hlášení výkresu (cad/drawing-issues.ts) jako nález listu `sheet` */
export function sheetIssue(i: DrawingIssue, sheet: string): SheetIssue {
  const code = issueCode(i);
  return { code, sheet, text: i.text, ...(code === "drawing.section-miss" || i.level === "error" ? { level: "error" as const } : {}), ...(i.data ? { data: i.data } : {}) };
}

/**
 * Text záznamu nálezu listu: text kódu (název listu, u varování i text jádra); u řezu mimo těleso navíc přesný důvod
 * s rozsahem odsazení z hlášení jádra (vlna 15, B5), když se liší od stručného odznaku.
 */
export function sheetIssueText(x: Pick<SheetIssue, "code" | "sheet" | "text">): string {
  const base = codeText(x.code, ...issueArgs(x.code, x.sheet, x.text));
  return x.code === "drawing.section-miss" && x.text && !isTextOfKey(x.text, SECTION_MISS_BADGE) ? `${base} – ${x.text}` : base;
}

/** týž nález listu (kód, dokument a text bez upřesnění důvodu) – protokol ho neopakuje */
export const sameSheetFinding = (a: { code?: string; doc?: string; text: string }, b: { code?: string; doc?: string; text: string }): boolean =>
  a.code === b.code && a.doc === b.doc && (a.text === b.text || a.text.startsWith(`${b.text} – `) || b.text.startsWith(`${a.text} – `));

/**
 * Spočítá list `idx` dokumentu (s kusovníkem a pozicemi sestavy – `extras`) a vrátí jeho hlášení jako záznamy s kódem:
 * strukturovaná hlášení jádra (cad/drawing-issues.ts: řez mimo těleso, pohledy se nevejdou, ztracený pohled, tabulka děr
 * přes pohled, ostatní varování) a vynechané Chytré kóty (jeden záznam za list). Bez listů / 2D výkres → prázdný seznam.
 */
export async function evaluateSheet(doc: CadDoc, idx: number, compute: DrawingCompute, extras: () => Promise<DrawingExtras>): Promise<SheetIssue[]> {
  if (doc.kind === "draft" || !doc.drawings?.length) return [];
  const s = doc.drawings[idx];
  if (!s) return [];
  const { sheetMeta, sheetOptions } = await import("../drawing-agent");
  const o = sheetOptions(s);
  const res = await compute(doc, sheetMeta(doc, s, idx, await extras()), o);
  const name = sheetLabel(doc, idx);
  const out: SheetIssue[] = issuesOf(res).map((i) => sheetIssue(i, name));
  const skipped = o.dimensions === "smart" ? (res.smart?.report.skipped ?? []) : [];
  if (skipped.length) out.push({ code: "drawing.warning", sheet: name, text: tr("vynecháno: {0}", skipped.join("; ")) });
  // kontrola kót pro výrobní úplnost (vlna 22, bod 18): ⚠ drawing.dims-incomplete, ℹ drawing.tol-nonfunctional
  out.push(...(await dimSheetIssues(doc, s, res, o)).map((i) => sheetIssue(i, name)));
  return out;
}

/** hlášení kontroly kót listu (poznámky listu se sloučenými Chytrými kótami jako ve `výkres stav`) */
async function dimSheetIssues(doc: CadDoc, s: NonNullable<CadDoc["drawings"]>[number], res: Awaited<ReturnType<DrawingCompute>>, o: ReturnType<typeof import("../drawing-agent").sheetOptions>): Promise<DrawingIssue[]> {
  const [{ mergeSmart }, { sheetDimCheck, dimCheckIssues }, { withAnnotations }] = await Promise.all([import("../drawing-agent"), import("../drawing-dimcheck"), import("../drawing")]);
  let anns = s.annotations;
  if (o.dimensions === "smart" && res.smart) anns = mergeSmart(anns, o, res.smart)?.annotations ?? anns;
  return dimCheckIssues(sheetDimCheck(doc, withAnnotations(res, anns), anns, o), { sheetId: s.id });
}

/**
 * Překryv / přesah rámečku poznámky z příkazu výkresu na konci bloku znovu: poznámka (táž, neupravená) na listu `sheetId`
 * pořád přesahuje nebo se překrývá → true. Poznámka upravená dalším příkazem (nový objekt) nebo smazaná → false (nález
 * upraveného stavu ohlásil ten příkaz sám).
 */
export async function recheckIssue(doc: CadDoc, issue: DrawingIssue, compute: DrawingCompute, extras: () => Promise<DrawingExtras>): Promise<{ present: boolean; sheet: string }> {
  const idx = doc.drawings?.findIndex((s) => s.id === issue.sheetId) ?? -1;
  const s = idx >= 0 ? doc.drawings![idx] : undefined;
  const ann = issue.ann;
  if (!s || !ann || !s.annotations.includes(ann)) return { present: false, sheet: "" };
  const [{ sheetMeta, sheetOptions }, { outsideFrame, overlappingTexts }] = await Promise.all([import("../drawing-agent"), import("../drawing-marks")]);
  const res = await compute(doc, sheetMeta(doc, s, idx, await extras()), sheetOptions(s));
  const others: DrawingAnnotation[] = s.annotations.filter((a) => a !== ann);
  const present = issue.kind === "frame" ? outsideFrame(res, ann) : overlappingTexts(res, others, ann).length > 0;
  return { present, sheet: sheetLabel(doc, idx) };
}
