/**
 * Provedení textových příkazů výkresu (cad/agent-drawing.ts) nad dokumentem a textový stav výkresu pro agenty:
 * list, měřítko, pohledy, každá kóta s pohledem, duplicity, chybějící rozměry (Kontrola kót), co se nevešlo.
 * Sloučení Chytrých kót: vygenerované poznámky (`auto`) se nahradí, vlastní zůstanou; úpravy vygenerovaných kót
 * (tolerance, přípona, text) se podle klíče přenesou.
 * Příkazy pracují s aktivním listem (`výkres list N`, záložka listu ve výkresu) – viz `activeSheet`.
 */
import { applyTemplate, defaultTemplateRec, deleteTemplate, findTemplate, sameName, saveTemplate, settingsPersist, templateFromMeta, templatesLine, templateText, withDocTemplate, type TitleTemplateRec } from "./title-templates";
import { overlapIssueText, sheetOverlaps } from "./drawing-overlaps";
import { positionLines } from "./drawing-pos-agent";
import type { DrawingCmd, SheetRef, TitleField } from "./agent-drawing";
import { VIEW_CS } from "./agent-drawing";
import { defaultDrawingOptions, holeRowText, isRadialDim, modelViewKey, scaleLabel, STANDARD_SCALES, viewExtent, withAnnotations, type BalloonItem, type BomItem, type DetailView, type DimAnn, type DrawingMeta, type DrawingOptions, type DrawingResult, type ModelView, type PlacedView, type RevisionItem } from "./drawing";
import { linMeaning, type SmartDims, type SmartReport } from "./drawing-dims";
import { overdeterminedChain, sameSize, toleranceCheck, type ChainMember, type RefTolDim, type TolDim } from "./drawing-functional";
import { hasDrawnSprings, threadsOfDoc } from "./drawing-doc";
import { gearTableStatus } from "./drawing-geartable";
import { gearTablesOf } from "./gears/data";
import { attachLabel, dimAttachIssue, settleDim, userDimAttach } from "./drawing-dim-attach";
import { annLabel, annList, agentToSheet, agentToView, dimValue, findDims, findView, makeManualDim, makeMark, outsideFrame, overlappingTexts, patchAnn, resolveAnns, resolveOne, shortId, viewRangeLines, viewToAgent } from "./drawing-marks";
import { dimCheck } from "./dim-check";
import { dimCheckDetail, dimCheckLine } from "./dim-complete";
import { dimCheckIssues, sheetDimCheck, suggestionsFor, withGroupCount } from "./drawing-dimcheck";
import { fitDeviations, fitSuffix, parseFit } from "./drawing-fits";
import { applyViewsCmd, viewsStatusLines } from "./drawing-views-agent";
import { cadLocale, getLang, tr } from "./i18n";
import { applyGeneralTol, applyTitleFields, titleRevisionCheck, titleStatusLines, titleValueProblem, type TitleCmdField } from "./agent-title";
import { inheritTitle } from "./title-block";
import { loadSettings } from "./settings";
import { MATERIALS } from "../lib/mesh-metrics";
import { withDesignation } from "./material-designation";
import { uid, type CadDoc, type DrawingAnnotation, type DrawingDoc, type Vec3 } from "./types";
import { drawingKey, drawingLabel, drawingSets, drawingsLine, inDrawing, nextDrawingName, resolveDrawing, setSheets, sheetCount, sheetPos } from "./drawing-sets";
import type { DrawingExportResult } from "./drawing-export";
import { issueLine, issuesOf, warningIssue, type DrawingIssue } from "./drawing-issues";
import { SECTION_AXIS, sectionAt, sectionCoord, sectionStatusText, sectionText } from "./drawing-section";
import { pmiMarksOf, zoneLegendLines } from "./pmi-marks";
import { auditDoc, auditItems, classifyNote, TITLE_DATA_CMD, findingLevel, freeTextLines, freeTextList, isFreeAnn, LEADER_MAX_CHARS, limitHint, lineCount, linesOf, mainSheet, newAgentFindings, NOTE_MAX_LEADERS, NOTE_MAX_LINES, notesBudgetLine, noteStyle, orderedSheets, stampOrigin, TEXT_MAX_H, titleDataLabel, TITLE_VALUE_MAX, titleHint, type AuditFinding, type AuditInput, type GenLine, type NoteClass } from "./drawing-notes-rules";
import { formNotesOfDoc } from "./drawing-doc";
import { draftNotesAudit } from "./draft/agent-notes";
import type { DraftModel } from "./draft/model";
import { CodedError } from "./engine/codes";
import { issueSheet, modelId, nextRev as nextRevOf, sheetIssueLine, sheetState, staleSheetText, withdrawIssue } from "./doc-outputs";

export { annLabel, dimValue, findDims } from "./drawing-marks";

export type SmartResult = DrawingResult & { smart?: SmartDims };
export type DrawingCompute = (doc: CadDoc, meta: DrawingMeta, opts: Partial<DrawingOptions>) => Promise<SmartResult>;
/** Údaje, které zná jen aplikace: hmotnost (výsledek stavby), kusovník a pozice komponent sestavy – jako výkresové prostředí. */
export type DrawingExtras = { massKg?: number; bom?: BomItem[]; balloons?: BalloonItem[] };
/**
 * Prostředí příkazů výkresu v aplikaci: doplňky razítka a otevřené záložky (pro „výkres model "záložka"“);
 * `referenceDims` = tolerované kóty předlohy (výtah z DWG/DXF/PDF – balík předlohy) pro `výkres kontrola tolerancí`.
 */
/**
 * `input` = soubor vstupů hostitele podle názvu (CLI `--files`, HTTP `body.files`, připojené soubory konzole) – logo razítka
 * a šablony hlavičky názvem souboru i bez prohlížeče (vlna 22, bod 22j)
 */
export type DrawingEnv = { extras?: (doc: CadDoc) => DrawingExtras; tabs?: () => { title: string; doc: CadDoc }[]; referenceDims?: (doc: CadDoc) => RefTolDim[]; input?: (name: string) => Promise<{ name: string; bytes: Uint8Array } | null> };

/** číslo do protokolu: na setiny, desetinná čárka podle jazyka (EN 6.8, CS / DE 6,8) */
const fmtN = (n: number) => String(Math.round(n * 100) / 100).replace(".", getLang() === "en" ? "." : ",");
/** rozměr na tisíciny (hodnoty kót – B7) */
const fmtN3 = (n: number) => String(Math.round(n * 1000) / 1000).replace(".", ",");
/** číslo na 3 desetinná místa s oddělovačem jazyka (protokol) */
const fmtN3L = (n: number) => String(Math.round(n * 1000) / 1000 || 0).replace(".", getLang() === "en" ? "." : ",");
/** desetinná místa tolerance v zápisu jazyka (cs/de „0,005“, en „0.005“) – lícování (H7, g6) zůstávají */
export const localDecimals = (t: string) => {
  const sep = (1.5).toLocaleString(cadLocale()).includes(",") ? "," : ".";
  return t.replace(/(\d)[.,](\d)/g, `$1${sep}$2`);
};
/** název pohledu; pohled dalšího modelu na listu (`m:<id>`) názvem modelu z voleb listu */
const VIEW_NAME = (k: string, o?: Partial<DrawingOptions>) =>
  k.startsWith("m:") ? (o?.models?.find((m) => modelViewKey(m.id) === k)?.name ?? k) : k.startsWith("aux:") ? tr("pohled {0}", k.slice(4)) : k.startsWith("cut:") ? tr("řez {0}–{0}", k.slice(4)) : tr(k === "section" ? "řez" : k === "sheet" ? "list" : VIEW_CS[k as keyof typeof VIEW_CS] ?? k);

/**
 * Tabulka děr textem (15. vlna, B9): jen díry – konkávní válcové plochy; vnější válce soustruženého dílu se nevypisují. Řádek
 * = jedna díra („A1 M8 Ø6,8 ⌴Ø20 [0; 60]“), pohled tabulky (díry s osou ve směru pohledu) a díry s jinou osou, které v ní nejsou.
 */
function holeTableLine(res: DrawingResult, o?: Partial<DrawingOptions>): string {
  const info = res.holeTableInfo;
  const other = info?.other.length ? info.other.map((h) => tr("Ø{0} osa {1}", fmtN(h.d), h.axis)).join(", ") : "";
  const view = info ? VIEW_NAME(info.view, o) : "";
  if (res.holes?.length) {
    const rows = res.holes.map((h) => `${h.tag} ${h.thread ? `${h.thread} Ø${fmtN(h.d)}${(h.steps ?? []).map((x) => ` ⌴Ø${fmtN(x)}`).join("")}` : holeRowText(h, fmtN)} [${fmtN(h.x)}; ${fmtN(h.y)}]`).join(" · ");
    return tr("Tabulka děr (pohled {0}, {1}): {2}", view, res.holes.length, rows) + (other ? tr(" · díry s jinou osou nejsou v tabulce ({0}): {1}", info!.other.length, other) : "");
  }
  if (other) return tr("Tabulka děr: v pohledu {0} žádná díra s osou ve směru pohledu; díry s jinou osou ({1}): {2} – přidejte pohled ve směru jejich osy", view, info!.other.length, other);
  return tr("Tabulka děr: žádné díry (vnější válce – hřídel, osazení – se nevypisují)");
}

// ---------------------------------------------------------------- aktivní list (textové příkazy ↔ výkresové prostředí)

let activeId: string | null = null;
const activeSubs = new Set<(id: string | null) => void>();
/**
 * Aktivní list výkresu (id listu): nastaví ho `výkres list N` / nový list a přepnutí záložky listu ve výkresu. Příkazy výkresu
 * pracují s ním a výkres se otevře na něm. Neznámé id (jiný dokument) = první list.
 */
export const activeSheet = {
  get: () => activeId,
  set(id: string | null, notify = true) {
    if (id === activeId) return;
    activeId = id;
    if (notify) for (const f of activeSubs) f(id);
  },
  subscribe(f: (id: string | null) => void) {
    activeSubs.add(f);
    return () => void activeSubs.delete(f);
  },
};
/** index aktivního listu v dokumentu (neznámý → 0) */
export function activeSheetIndex(doc: CadDoc): number {
  const i = doc.drawings?.findIndex((s) => s.id === activeId) ?? -1;
  return i >= 0 ? i : 0;
}
/** popis listu „2 „Detail““ (číslo listu v jeho výkresu) */
const sheetName = (doc: CadDoc, i: number) => `${sheetPos(doc, i).pos + 1} „${doc.drawings?.[i]?.name ?? tr("List {0}", i + 1)}“`;
/**
 * Přehled listů aktivního výkresu: „Listy (2): 1 „List 1“ A3 · 2 „Detail“ auto (aktivní)“; u více výkresů s názvem výkresu
 * a přehledem výkresů (cad/drawing-sets.ts).
 */
export function sheetsLine(doc: CadDoc, active = activeSheetIndex(doc)): string {
  const list = doc.drawings ?? [];
  if (!list.length) return tr("Listy: zatím žádný (první vznikne příkazem výkresu)");
  const set = setSheets(doc, active);
  const line = tr("Listy ({0}): {1}", set.length, set.map((i) => `${sheetName(doc, i)} ${String((list[i].options as Partial<DrawingOptions>).sheet ?? "auto")}${i === active ? tr(" (aktivní)") : ""}`).join(" · "));
  const sets = drawingSets(doc);
  return sets.length > 1 ? `${drawingsLine(doc, active)}\n${tr("Výkres „{0}“ – {1}", sets.find((x) => x.sheets.includes(active))?.name ?? "", line)}` : line;
}
/** List aktivního výkresu podle čísla (od 1) nebo názvu → index v doc.drawings – chyba se seznamem listů. */
export function resolveSheet(doc: CadDoc, ref: SheetRef): number {
  const list = doc.drawings ?? [];
  const set = list.length ? setSheets(doc, activeSheetIndex(doc)) : [];
  const i = typeof ref === "number" ? (set[ref - 1] ?? -1) : (set.find((k) => list[k].name.toLowerCase() === ref.trim().toLowerCase()) ?? -1);
  if (i >= 0 && i < list.length) return i;
  throw new Error(tr("list {0} neexistuje – {1}; nový list: výkres list nový \"název\"", typeof ref === "number" ? ref : `„${ref}“`, sheetsLine(doc)));
}

/** Volby nového výkresu: Chytré kóty (uložené výkresy si ponechají svůj režim kót; makeDrawing má dál výchozí „auto“). */
export const NEW_DRAWING_OPTIONS: DrawingOptions = { ...defaultDrawingOptions, dimensions: "smart" };

/** Nový list s výchozími volbami (Chytré kóty). */
export function newSheet(doc: CadDoc, n = 1): DrawingDoc {
  return {
    id: uid(),
    name: tr("List {0}", n),
    options: { ...NEW_DRAWING_OPTIONS, views: { ...defaultDrawingOptions.views }, details: [] } as unknown as Record<string, unknown>,
    meta: withDefaultTitle({ name: doc.name, number: doc.props?.number ?? "", author: doc.props?.author ?? "", revision: doc.props?.revision ?? "", tolerance: "", ...defaultTemplate() }),
    annotations: [],
  };
}

/** výchozí pojmenovaná šablona hlavičky z Nastavení (logo, firma, druh razítka …) na údaje nového listu (vlna 22, bod 22j) */
function withDefaultTitle(meta: Record<string, unknown>): Record<string, unknown> {
  const rec = defaultTemplateRec();
  if (rec) applyTemplate(meta, rec);
  return meta;
}

/** šablony hlavičky z Nastavení, které listy dokumentu používají (`titleTpl`), se zkopírují do dokumentu (jdou s ním dál) */
export function syncDocTemplates(doc: CadDoc): void {
  for (const s of doc.drawings ?? []) {
    const n = (s.meta as Partial<DrawingMeta>).titleTpl;
    if (!n || doc.titleTemplates?.some((t) => sameName(t.name, n))) continue;
    const hit = findTemplate(doc, n);
    if (hit) doc.titleTemplates = withDocTemplate(doc, hit.rec).titleTemplates;
  }
}

/** šablona razítka nových listů z Nastavení (výchozí ISO 7200 se do listu nezapisuje) */
function defaultTemplate(): { template?: string } {
  const t = loadSettings().titleTemplate;
  return t && t !== "iso7200" ? { template: t } : {};
}

/**
 * Další výkres dílu (tlačítko Nový výkres, `výkres nový`): sada listů s názvem „Výkres N“ (nebo `name`) a s listem 1 –
 * vrací dokument, id nového listu (otevře se na něm) a název. Díl bez výkresu dostane první výkres.
 */
export function addDrawing(doc: CadDoc, name?: string): { doc: CadDoc; sheetId: string; name: string } {
  const has = !!doc.drawings?.length;
  const n = name?.trim() || (has ? nextDrawingName(doc) : tr("Výkres 1"));
  if (drawingSets(doc).some((x) => x.name.toLowerCase() === n.toLowerCase())) throw new Error(tr("výkres „{0}“ už existuje – {1}", n, drawingsLine(doc)));
  const s = inDrawing(newSheet(doc, 1), !has && n === tr("Výkres 1") ? "" : n);
  return { doc: { ...doc, drawings: [...(doc.drawings ?? []), s] }, sheetId: s.id, name: n };
}

/** Volby listu (doplněné o výchozí). */
export function sheetOptions(s: DrawingDoc): DrawingOptions {
  const o = s.options as Partial<DrawingOptions>;
  return { ...defaultDrawingOptions, ...o, views: { ...defaultDrawingOptions.views, ...(o.views ?? {}) } };
}

/** Označení materiálu do razítka jako ve výkresovém prostředí (vlastní označení, jinak třída materiálu; sestava dle kusovníku). */
export const materialLabel = (doc: CadDoc) => (doc.kind === "assembly" ? tr("dle kusovníku") : doc.materialName?.trim() || (MATERIALS.find((m) => m.id === doc.material) ?? MATERIALS[0]).label);

/**
 * Údaje razítka pro výpočet výkresu z dokumentu (jako výkresové prostředí): materiál, závity, číslo listu, dnešní datum,
 * kusovník (podle volby listu) a pozice komponent z `extras`.
 */
export function sheetMeta(doc: CadDoc, s: DrawingDoc, idx = 0, extras?: DrawingExtras): DrawingMeta {
  const m = s.meta as Partial<DrawingMeta>;
  const o = s.options as Partial<DrawingOptions>;
  return {
    ...m,
    name: m.name || doc.name,
    material: materialLabel(doc),
    date: m.date || new Date().toLocaleDateString(cadLocale()),
    threads: threadsOfDoc(doc),
    // číslo listu v jeho výkresu (razítko „List 1/2“); list mimo dokument (ještě neuložený první list) = idx
    ...(doc.drawings?.[idx] ? { sheetIndex: sheetPos(doc, idx).pos + 1, sheetCount: sheetPos(doc, idx).count } : { sheetIndex: idx + 1, sheetCount: Math.max(1, doc.drawings?.length ?? 1) }),
    ...(extras?.massKg !== undefined ? { massKg: extras.massKg } : {}),
    ...(extras?.bom?.length && o.bomTable !== false ? { bom: extras.bom } : {}),
    ...(extras?.balloons?.length ? { components: extras.balloons } : {}),
    // revize modelu do patičky razítka a metadat PDF / DXF (vlna 22, bod 20 – cad/doc-outputs.ts); 2D výkres ji nemá
    ...(doc.kind !== "draft" ? { modelRev: modelId(doc).rev } : {}),
    // popisy ploch a oblastní úpravy z modelu (vlna 23, R2 / R3) – součást údajů listu (paměť výpočtu listu je rozliší)
    ...(pmiMarksOf(doc).length ? { pmi: pmiMarksOf(doc) } : {}),
  };
}

/**
 * Přípona kóty rozdělená na část, kterou tvoří Chytré kóty samy (stoupání závitu „×1,5“ na začátku; „)“ pomocné kóty
 * a „ (=90)“ stejných roztečí na konci), a úpravu uživatele mezi nimi (tolerance „h6“, „±0,05“, „-6g“).
 */
export function splitSuffix(a: { prefix?: string; suffix?: string }): { head: string; user: string; tail: string } {
  const s = a.suffix ?? "";
  const head = a.prefix === "M" ? (/^×\d+(?:[.,]\d+)?/.exec(s)?.[0] ?? "") : "";
  const tail = a.prefix === "(" ? (s.endsWith(")") ? ")" : "") : a.prefix && /^\d+× $/.test(a.prefix) ? (/ \(=[^()]*\)$/.exec(s)?.[0] ?? "") : "";
  return { head, user: s.slice(head.length, s.length - tail.length), tail };
}

/**
 * Sloučí vygenerované Chytré kóty do poznámek listu. `force` = přegenerovat (i smazané vygenerované); jinak jen když se
 * změnil model nebo rozvržení (`smartGen`). Vrátí null, když není co měnit.
 */
/**
 * `userLost` = vygenerované kóty s úpravou uživatele (tolerance, uložení, přípona, revize), jejichž klíč nová generace nezná
 * a které se nezachovaly – úprava zmizí (zkouška 959: díly vložené do sestavy mají nová id prvků); volající ji ohlásí ⚠.
 */
export function mergeSmart(ann: DrawingAnnotation[], opts: Partial<DrawingOptions>, smart: SmartDims, force = false): { annotations: DrawingAnnotation[]; gen: string; userLost?: number } | null {
  if (!force && opts.smartGen === smart.gen) return null;
  const off = new Set(force ? [] : (opts.smartOff ?? []));
  const old = new Map(ann.filter((a) => a.auto).map((a) => [a.auto!, a]));
  const user = ann.filter((a) => !a.auto);
  const gen = smart.annotations
    .filter((a) => !off.has(a.auto!))
    .map((a) => {
      const o = old.get(a.auto!);
      if (!o || o.type !== a.type) return a;
      const keep = { ...a, id: o.id } as DrawingAnnotation;
      if (keep.type === "dim" && o.type === "dim") {
        // přenese se jen úprava uživatele (tolerance) – ne přípona, kterou stará kóta měla vygenerovanou (stoupání, závorka)
        const user = splitSuffix(o).user;
        if (user) {
          const n = splitSuffix(keep);
          keep.suffix = `${n.head}${user}${n.tail}`;
        }
        if (o.text !== undefined && o.text !== keep.text) keep.text = o.text;
      }
      if (keep.type === "callout" && o.type === "callout" && o.tol) keep.tol = o.tol;
      // ruční poloha (odsazení / posun) vygenerované kóty a popisu přežije přegenerování po změně modelu (vlna 22, bod 17)
      if (o.placed === "user") keepPlacement(keep, o);
      // revize (trojúhelník) a zobrazení úchylek uložení zůstávají u přegenerované kóty
      if (o.rev) keep.rev = o.rev;
      if (o.tolShow) keep.tolShow = o.tolShow;
      return keep;
    });
  // vygenerovaná kóta s úpravou uživatele (tolerance, revize), která se tentokrát nevešla, zůstane (souřadnice pohledu jdou s ním)
  const dropped = new Set(smart.report.dropped ?? []);
  const have = new Set(gen.map((a) => a.auto));
  const kept = ann.filter((a) => a.auto && dropped.has(a.auto) && !have.has(a.auto) && !off.has(a.auto) && userEdited(a));
  const userLost = force ? 0 : ann.filter((a) => a.auto && !have.has(a.auto) && !off.has(a.auto) && !kept.includes(a) && userEdited(a)).length;
  return { annotations: [...user, ...gen, ...kept], gen: smart.gen, ...(userLost ? { userLost } : {}) };
}

/** varování listu: ruční úpravy vygenerovaných kót se nepodařilo přiřadit (do protokolu ⚠ drawing.warning) */
export const lostEditsText = (n: number) => tr("{0} ručních úprav kót se nepodařilo přiřadit – kóty se přegenerovaly bez nich (tolerance, uložení, přípony)", n);

/**
 * Ruční poloha staré vygenerované kóty / popisu přenesená na novou (vlna 22, bod 17): délková kóta odsazení (znaménko strany
 * podle nové kóty), průměr / poloměr / úhel směr a odsazení, souřadnicová posun textu, popis koleno. Měřené body jsou nové.
 */
function keepPlacement(keep: DrawingAnnotation, o: DrawingAnnotation) {
  keep.placed = "user";
  if (keep.type === "dim" && o.type === "dim") {
    const k = keep as Record<string, unknown>;
    const q = o as Record<string, unknown>;
    if (typeof q.offset === "number" && typeof k.offset === "number") k.offset = "ang" in q || (k.offset as number) === 0 ? q.offset : Math.sign(k.offset as number) * Math.abs(q.offset as number);
    if (typeof q.ang === "number" && "ang" in k) k.ang = q.ang;
    if (typeof q.jog === "number") k.jog = q.jog;
  } else if (keep.type === "callout" && o.type === "callout") keep.at = o.at;
}

/** vygenerovaná poznámka s úpravou uživatele (tolerance / přípona, vlastní text, revize, zobrazení úchylek, ruční poloha) */
function userEdited(a: DrawingAnnotation): boolean {
  if (a.rev || a.tolShow || a.placed) return true;
  if (a.type === "dim") return !!splitSuffix(a).user.trim() || a.text !== undefined;
  return a.type === "callout" && !!a.tol?.trim();
}

// ---------------------------------------------------------------- funkční rozměry a kontrola tolerancí (B8, 5.3)

type DimA = Extract<DrawingAnnotation, { type: "dim" }>;
/** vygenerovaná kóta uzavřeného řetězu rotačního dílu (článek `len:c:` nebo celková délka `len:all`) */
const isChainDim = (a: DrawingAnnotation): a is DimA => a.type === "dim" && !!a.auto && (a.auto.startsWith("len:c:") || a.auto === "len:all");
/** rozměry řetězu v pohledu `view` (hodnota, nese-li toleranci) – přeurčený řetěz (B8) */
function chainMembers(views: PlacedView[], anns: DrawingAnnotation[], view: string): ChainMember[] {
  return anns.filter((a): a is DimA => isChainDim(a) && a.view === view).map((a) => ({ value: dimValue(views, a), tol: !!splitSuffix(a).user.trim() }));
}

/** doplněk řádku „✓ Chytré kóty …“: funkční rozměry a způsob kótování poloh děr podle pohledů */
function smartExtras(o: DrawingOptions, rep: SmartReport): string {
  const parts: string[] = [];
  if (o.dimFunctional?.length) parts.push(tr("funkční {0}", o.dimFunctional.map(fmtN3).join(", ")));
  const hm = Object.entries(rep.holeMode ?? {}).filter(([, m]) => m !== "edges");
  if (hm.length) parts.push(tr("polohy děr {0}", hm.map(([k, m]) => `${m === "ordinate" ? tr("souřadnicově") : tr("tabulkou děr")} (${VIEW_NAME(k, o)})`).join(", ")));
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

/**
 * `výkres kontrola tolerancí` (5.3): funkční rozměry listu (kótovat … funkční …) a tolerované kóty předlohy (`ref`)
 * musí být na listu kótou s tolerancí. Řádky protokolu (⚠ / ✓ a seznam) a hlášení `drawing.tolerance-missing`.
 */
export function tolCheckLines(views: PlacedView[], anns: DrawingAnnotation[], o: Partial<DrawingOptions>, refDims: RefTolDim[] | null = null): { lines: string[]; issues: DrawingIssue[] } {
  // null = předloha není připojena (výtah kót předlohy dodá balík předlohy) – kontrolují se jen funkční rozměry
  const ref = refDims ?? [];
  const dims: TolDim[] = anns.flatMap((a, i): TolDim[] => {
    if (a.type === "dim" && a.kind !== "angle") return [{ id: shortId(i), label: annLabel(views, a), value: dimValue(views, a), view: a.view, tolerance: splitSuffix(a).user.trim() || (a.text && /[±+\-]\d|[A-Za-z]{1,2}\d/.test(a.text) ? a.text : ""), reference: a.prefix === "(", dia: a.kind === "diameter" || a.kind === "radius" || /^[ØM]/.test(a.prefix ?? "") }];
    if (a.type === "callout") {
      const m = /[ØM](\d+(?:[.,]\d+)?)/.exec(a.lines[0] ?? "");
      return m ? [{ id: shortId(i), label: annLabel(views, a), value: Number(m[1].replace(",", ".")), view: a.view, tolerance: a.tol ?? "", reference: false, dia: true }] : [];
    }
    return [];
  });
  const rows = toleranceCheck(dims, o.dimFunctional ?? [], ref);
  if (!rows.length) return { lines: [tr("✓ kontrola tolerancí: list nemá funkční rozměry (kótovat … funkční …) ani tolerované kóty předlohy – není co kontrolovat")], issues: [] };
  const at = (d: TolDim) => `${d.id} ${d.label} (${VIEW_NAME(d.view, o)})`;
  const issues: DrawingIssue[] = [];
  const body = rows.map((r) => {
    const what = r.kind === "functional" ? tr("funkční") : tr("předloha {0}", r.expect ?? "");
    const real = r.dims.filter((d) => !d.reference);
    let text: string;
    if (r.status === "ok") return `  ✓ ${fmtN3(r.value)} ${what}: ${real.filter((d) => d.tolerance).map(at).join(", ")}`;
    if (r.status === "missing-dim") text = tr("{0} ({1}): na listu není kóta s touto hodnotou – doplňte ji (kótovat / výkres kóta …)", fmtN3(r.value), what);
    else if (r.status === "reference") text = tr("{0} ({1}): na listu jen pomocná kóta {2} – výkres tolerance {0} … ji převede na funkční", fmtN3(r.value), what, r.dims.map(at).join(", "));
    else text = tr("{0} ({1}): kóta bez tolerance {2} – výkres tolerance {3} …", fmtN3(r.value), what, real.map(at).join(", "), real[0].id);
    issues.push({ level: "warn", code: "drawing.tolerance-missing", kind: "tolerance-missing", text, data: { value: r.value, source: r.kind, status: r.status, ids: r.dims.map((d) => d.id), ...(r.expect ? { expected: r.expect } : {}) } });
    return `  ⚠ ${text}`;
  });
  const nf = rows.filter((r) => r.kind === "functional").length;
  const head = refDims === null
    ? issues.length ? tr("⚠ kontrola tolerancí: bez tolerance {0} z {1} funkčních rozměrů (předloha není připojena – kóty předlohy se nekontrolují)", issues.length, rows.length) : tr("✓ kontrola tolerancí: všech {0} funkčních rozměrů má toleranci (předloha není připojena – kóty předlohy se nekontrolují)", rows.length)
    : issues.length ? tr("⚠ kontrola tolerancí: bez tolerance {0} z {1} rozměrů (funkčních {2}, z předlohy {3})", issues.length, rows.length, nf, rows.filter((r) => r.kind === "reference").length) : tr("✓ kontrola tolerancí: všech {0} rozměrů má toleranci (funkčních {1}, z předlohy {2})", rows.length, nf, rows.filter((r) => r.kind === "reference").length);
  return { lines: [head, ...body], issues };
}

// ---------------------------------------------------------------- popisky a duplicity

/** Skupiny kót se stejným významem (stejná osa a interval, stejná kružnice, stejný popis) – duplicity. */
export function dimDuplicates(views: PlacedView[], anns: DrawingAnnotation[]): DrawingAnnotation[][] {
  const groups = new Map<string, DrawingAnnotation[]>();
  for (const a of anns) {
    let key: string | null = null;
    const v = views.find((x) => x.key === a.view);
    if (a.type === "dim") {
      if ((a.kind === "horizontal" || a.kind === "vertical") && v?.cam) key = linMeaning(v.cam, a.kind === "horizontal" ? "h" : "v", a.a, a.b, a.prefix ?? a.text ?? "");
      else if (isRadialDim(a)) key = `R:${a.view}:${a.kind}:${a.c.map((x) => x.toFixed(3)).join()}:${a.r.toFixed(3)}`;
      else if (a.kind === "aligned") key = `A:${a.view}:${[a.a, a.b].map((p) => p.map((x) => x.toFixed(3)).join()).sort().join("|")}`;
    } else if (a.type === "callout") key = `C:${a.lines.map((l) => l.replace(/^\d+× /, "")).join("|")}`;
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

// ---------------------------------------------------------------- provedení příkazů

/**
 * `file` = soubor z `výkres export …` (aplikace ho uloží / stáhne); `issues` = strukturovaná hlášení posledního výpočtu
 * listu (řez mimo těleso ✗, pohledy se nevejdou ⚠ … – cad/drawing-issues.ts) a vlastní nálezy příkazu (překryv poznámky,
 * vynechané kóty, řádky „! …“) pro protokol – engine podle druhu rozhodne, kdy je zapíše (cad/engine/ops/drawing-cmd.ts).
 */
export type DrawingCmdResult = { doc: CadDoc; log: string[]; changed: boolean; open: boolean; file?: DrawingExportResult; issues?: DrawingIssue[] };

const TITLE_KEY: Record<TitleField, string> = { name: "název", number: "číslo", author: "kreslil", revision: "revize", date: "datum", material: "materiál", tolerance: "nepředepsané", edges: "hrany", note: "poznámka" };
const today = () => new Date().toLocaleDateString(cadLocale());

/** Razítko a revize do protokolu / stavu. */
function titleLines(doc: CadDoc, s: DrawingDoc): string[] {
  const m = s.meta as Partial<DrawingMeta>;
  const v = (x?: string) => x?.trim() || "—";
  const revs = m.revisions ?? [];
  // revize jako na listu: prázdné pole = poslední z tabulky revizí; revize mimo tabulku = upozornění
  const rev = titleRevisionCheck(m);
  return [
    tr("Razítko: název {0} · číslo {1} · kreslil {2} · revize {3} · datum {4} · materiál {5}", v(m.name || doc.name), v(m.number), v(m.author), rev.shown, m.date?.trim() || today(), v(materialLabel(doc))),
    revs.length ? tr("Revize ({0}): {1}", revs.length, revs.map((r) => `${r.rev} ${r.date || "—"} „${r.note}“${r.author ? ` (${r.author})` : ""}`).join(" · ")) : tr("Revize: žádné"),
    ...(rev.warning ? [tr("⚠ {0}", rev.warning)] : []),
    // šablona, promítání, logo, další pole, nepředepsané tolerance a jak se pole vešla (cad/agent-title.ts) – s názvem
    // a materiálem z dokumentu jako na listu
    ...titleStatusLines(doc, { ...m, name: m.name || doc.name, material: materialLabel(doc) }, sheetOptions(s).projection),
  ];
}

// ---------------------------------------------------------------- poznámky agenta (vlna 23, R1–R6 – cad/drawing-notes-rules.ts)

/** generované řádky nad razítkem: legenda oblastních úprav z modelu (původ = původ úpravy) a poznámka k plechu (jeden řádek) */
export function generatedFreeText(doc: CadDoc): { legend: GenLine[]; form: string[] } {
  const form = doc.kind === "assembly" || doc.kind === "draft" ? [] : formNotesOfDoc(doc);
  return { legend: zoneLegendLines(doc), form: form.length ? [form.join(", ")] : [] };
}

/** název listu do hlášky (u více výkresů s názvem výkresu) */
const sheetTitle = (doc: CadDoc, idx: number) => {
  const s = doc.drawings?.[idx];
  const n = s?.name || tr("list {0}", idx + 1);
  return drawingSets(doc).length > 1 ? `${drawingLabel(drawingKey(s ?? {}))} / ${n}` : n;
};

/** nálezy pravidel textu celého dokumentu (všechny kanály – cad/drawing-notes-rules.ts `auditDoc`) */
export const auditOf = (doc: CadDoc): AuditFinding[] => auditDoc(doc as AuditInput, generatedFreeText(doc), (i) => sheetTitle(doc, i));

/**
 * R4: po změně listu příkazem agenta – volný text celého dokumentu (všechny výkresy a listy) nejvýš NOTE_MAX_LINES řádků;
 * jinak ✗ drawing.notes-limit s výpisem řádků (agent / ručně) a radou. `what` = co příkaz přidal (do hlášky).
 */
function checkNotesBudget(doc: CadDoc, idx: number, what: string) {
  const items = freeTextLines(doc, undefined, generatedFreeText(doc));
  const total = linesOf(items);
  if (total > NOTE_MAX_LINES) throw new CodedError("drawing.notes-limit", [sheetTitle(doc, idx), tr("{0} – dokument by měl {1} řádků volného textu, nejvýš {2} (všechny výkresy a listy dohromady): {3}; {4}", what, total, NOTE_MAX_LINES, freeTextList(items, 8, drawingSets(doc).length > 1 || (doc.drawings?.length ?? 0) > 1 ? (i) => sheetTitle(doc, i) : undefined), limitHint())]);
}

/** limit řádků volného textu dokumentu (vysvětlivka oblastní úpravy z modelu – engine/ops/functional.ts); i bez výkresu */
export function checkDocNotesBudget(doc: CadDoc, what: string): void {
  const items = doc.drawings?.length ? freeTextLines(doc, undefined, generatedFreeText(doc)) : [];
  const legend = doc.drawings?.length ? [] : generatedFreeText(doc).legend;
  const total = linesOf(items) + legend.reduce((n, l) => n + lineCount(l.text), 0);
  if (total > NOTE_MAX_LINES) throw new CodedError("drawing.notes-limit", [doc.drawings?.length ? sheetTitle(doc, activeSheetIndex(doc)) : tr("model"), tr("{0} – výkres by měl {1} řádků volného textu nad razítkem (vysvětlivky úprav se počítají), nejvýš {2}: {3}; {4}", what, total, NOTE_MAX_LINES, items.length ? freeTextList(items) : legend.map((l) => `„${l.text}“`).join(" · "), tr("úpravy se stejným předpisem slučte do jedné vysvětlivky (stejný text = jeden řádek „Z1, Z2 …“), úpravu celého dílu dejte do razítka (výkres razítko tepelné=… tvrdost=…)"))]);
}

/** R5: volný text agenta jen na hlavním listu (pohledy s kótami) – list jen s poznámkami / „výkres + list poznámek“ nevznikne */
function checkFirstSheet(doc: CadDoc, idx: number, what: string) {
  const main = mainSheet(doc);
  if (idx !== main) throw new CodedError("drawing.notes-sheet", [sheetTitle(doc, idx), tr("{0} – volný text patří jen na hlavní list „{1}“ (pohledy s kótami) nad razítko, nejvýš {2} řádků v celém dokumentu; na dalších listech a výkresech jen pohledy, řezy, detaily, kóty a odkazy na geometrii", what, sheetTitle(doc, main), NOTE_MAX_LINES)]);
}

/** R4: heslovitý řádek (každý řádek textu), jinak ✗ drawing.note-style s důvodem */
function checkStyle(doc: CadDoc, idx: number, text: string, max?: number, maxWords?: number) {
  for (const l of text.split(/\r?\n/)) {
    const why = noteStyle(l, max, maxWords);
    if (why) throw new CodedError("drawing.note-style", [sheetTitle(doc, idx), tr("„{0}“: {1} – pište strojařsky heslovitě (např. „Hrany srazit 0,5×45°“ patří do razítka, „Brousit“ k ploše odkazem), ne větou", l.trim(), why)]);
  }
}

/**
 * R1: volný text, který je údajem razítka, se zapíše do razítka (meta listu, materiál do dokumentu) – vrací řádek ℹ;
 * smíšený text (údaj razítka ve větě) = ✗ drawing.note-title-data s radou, jak ho rozdělit. `null` = text údajem není.
 */
function moveToTitle(doc: CadDoc, idx: number, m: Record<string, unknown>, cls: NoteClass, text: string, conflicts: string[] = []): string {
  if (cls.mixed || !cls.parts.length) {
    throw new CodedError("drawing.note-title-data", [
      sheetTitle(doc, idx),
      tr("„{0}“ obsahuje údaj razítka ({1}) – do poznámky nepatří; zapište ho do razítka: {2}{3}", text, cls.parts.map((p) => titleDataLabel(p.key)).join(", ") || "—", titleHint(cls.parts), cls.rest.length ? tr(" a zbytek zkraťte na samostatnou heslovitou poznámku („{0}“)", cls.rest.join(", ")) : "") +
        (cls.parts.some((p) => p.value.length > TITLE_VALUE_MAX) ? tr(" – hodnota buňky razítka heslovitě, nejvýš {0} znaků (např. hrany=\"ISO 13715 -0,3\")", TITLE_VALUE_MAX) : ""),
    ]);
  }
  // D3: hodnota se do razítka přesune jen v tvaru, který přijme i `výkres razítko …=` (tvrdost s jednotkou, drsnost s hodnotou)
  for (const p of cls.parts) {
    const bad = titleValueProblem(p.key, p.value);
    if (bad) throw new CodedError("drawing.note-title-data", [sheetTitle(doc, idx), tr("„{0}“: {1} – do razítka se nepřesune; zapište ho přímo: {2}", text, bad, titleHint([p]))]);
  }
  const done: string[] = [];
  for (const p of cls.parts) {
    if (p.key === "material") {
      const cur = doc.materialName?.trim() ?? "";
      if (cur && fold(cur).includes(fold(p.value))) {
        done.push(tr("materiál „{0}“ (už v razítku)", cur));
        continue;
      }
      // D3: materiál je údaj MODELU – poznámka s jiným materiálem, než má model, model nepřepíše (✗, model je zdroj)
      if (cur) throw new CodedError("drawing.note-title-data", [sheetTitle(doc, idx), tr("„{0}“: materiál „{1}“ se liší od materiálu modelu „{2}“ – materiál razítka je materiál modelu; jiný materiál zadejte modelu (materiál {1}), poznámkou ne", text, p.value, cur)]);
      doc.materialName = p.value;
      (doc as { materialBy?: "agent" }).materialBy = "agent";
      done.push(tr("materiál „{0}“", p.value));
      continue;
    }
    if (p.key === "tolerance") {
      const old = typeof m.tolerance === "string" ? m.tolerance.trim() : "";
      if (old && fold(old) !== fold(p.value) && !fold(old).includes(fold(p.value))) {
        conflicts.push(tr("nepředepsané: v razítku „{0}“, poznámka „{1}“ – ponecháno „{0}“", old, p.value));
        keepConflict(m, "tolerance", old, p.value);
        done.push(tr("nepředepsané „{0}“ (rozpor – ponecháno)", old));
        continue;
      }
      applyGeneralTol(m, p.value);
      done.push(tr("nepředepsané „{0}“", String(m.tolerance ?? p.value)));
      continue;
    }
    const old = typeof m[p.key] === "string" ? (m[p.key] as string).trim() : "";
    // D3: buňka už nese JINOU hodnotu (dřívější poznámka, příkaz razítka, ruční zápis) – první hodnota zůstane, obě se ukážou ⚠
    if (old && fold(old) !== fold(p.value)) {
      conflicts.push(tr("{0}: v razítku „{1}“, poznámka „{2}“ – ponecháno „{1}“ (jednu hodnotu zvolte příkazem výkres razítko {3}=\"…\")", titleDataLabel(p.key), old, p.value, TITLE_DATA_CMD[p.key]));
      keepConflict(m, p.key, old, p.value);
      done.push(tr("{0} „{1}“ (rozpor – ponecháno)", titleDataLabel(p.key), old));
      continue;
    }
    m[p.key] = p.value;
    done.push(`${titleDataLabel(p.key)} „${p.value}“`);
  }
  return tr("„{0}“ → {1} (údaje razítka se nepíšou jako poznámka)", text, done.join(", "));
}

/** rozpor v buňce razítka zůstane v údajích listu, dokud ho agent nevyřeší příkazem `výkres razítko <pole>=` (⚠ při každém vyhodnocení) */
type TitleConflict = { key: string; kept: string; other: string };
function keepConflict(m: Record<string, unknown>, key: string, kept: string, other: string): void {
  const list = ((m.titleConflicts as TitleConflict[] | undefined) ?? []).filter((c) => !(c.key === key && c.other === other));
  m.titleConflicts = [...list, { key, kept, other }];
}

/** malá písmena bez diakritiky (porovnání hodnot razítka) */
const fold = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
/** ⚠ drawing.title-conflict: přesun do buňky razítka, která už nese jinou hodnotu (D3 – první zůstane, obě v hlášce) */
const conflictIssues = (conflicts: readonly string[], sheetId: string): DrawingIssue[] => conflicts.map((c) => ({ level: "warn", code: "drawing.title-conflict", kind: "other", text: c, sheetId }));

/** zapnuté pohledy listu (bez zapnutého pohledu kreslí jádro přední – drawing.ts) */
const viewsOnSheet = (o: DrawingOptions): string[] => {
  const on = Object.entries(o.views).filter(([, v]) => v).map(([k]) => k);
  return on.length ? on : ["front"];
};
/** list nemá vlastní pohledy navíc: žádný řez, detail, další model, pomocný pohled ani řez lomenou čarou */
const plainViews = (o: DrawingOptions): boolean => !o.section && !o.details?.length && !o.models?.length && !(o as { aux?: unknown[] }).aux?.length && !(o as { cuts?: unknown[] }).cuts?.length && !(o as { brokenOut?: unknown[] }).brokenOut?.length;

/** nález pravidel jako hlášení listu (úroveň podle původu: agent ✗, člověk ℹ) */
const issueOfFinding = (f: AuditFinding, sheetId: string): DrawingIssue => ({ level: findingLevel(f), code: f.code, kind: "other", text: f.text, sheetId, ...(f.data ? { data: f.data } : {}) });

/**
 * R7 (vlna 23): nálezy pravidel textu pro list `idx` – položky listu (volný text, místní popisy, kóty, razítko, revize),
 * nálezy celého dokumentu (limit řádků a popisů, popisy / úpravy v modelu, materiál) na hlavním listu a na listu, který
 * volný text nese; list bez pohledu (R5) a list, který jen opakuje pohledy jiného listu. Agent = ✗, ruční text = ℹ rada.
 */
export function notesSheetIssues(doc: CadDoc, idx: number, res?: Pick<DrawingResult, "views">): DrawingIssue[] {
  const s = doc.drawings?.[idx];
  if (!s || doc.kind === "draft") return [];
  const out: DrawingIssue[] = [];
  const main = mainSheet(doc);
  const carries = freeTextLines(doc, [idx]).length > 0;
  const mine = auditOf(doc).filter((f) => f.sheet === idx || (f.sheet < 0 && (idx === main || carries)));
  for (const f of mine) out.push(issueOfFinding(f, s.id));
  // D1: text ze souboru otevřeného z disku, který tento běh nezměnil – ne ✗ a export neblokuje, ale ✓ to není
  for (const c of ((s.meta as { titleConflicts?: TitleConflict[] }).titleConflicts ?? [])) out.push({ level: "warn", code: "drawing.title-conflict", kind: "other", text: tr("{0}: v razítku „{1}“, poznámka „{2}“ – ponecháno „{1}“ (jednu hodnotu zvolte příkazem výkres razítko {3}=\"…\")", titleDataLabel(c.key as never), c.kept, c.other, TITLE_DATA_CMD[c.key as keyof typeof TITLE_DATA_CMD] ?? c.key), sheetId: s.id });
  const loaded = mine.filter((f) => f.by === "loaded");
  if (loaded.length) out.push({ level: "warn", code: "drawing.notes-loaded", kind: "other", text: loadedText(doc, loaded), sheetId: s.id, data: { count: loaded.length } });
  const set = setSheets(doc, idx);
  const pos = set.indexOf(idx);
  const o = sheetOptions(s);
  // R5: list dílu bez pohledu (ne list jen s kusovníkem sestavy) – „list jen s poznámkami“
  const noViews = res ? !res.views.length && !o.views.iso && !o.models?.length && !o.details?.length : false;
  if (noViews && !o.bomOnly) out.push({ level: "warn", code: "drawing.sheet-empty", kind: "other", text: tr("list nemá žádný pohled – list jen s poznámkami nebo prázdný list výkres nemá; přidejte pohledy (výkres pohledy přední,horní) nebo list smažte (výkres list smazat {0})", pos + 1), sheetId: s.id, data: { sheetPos: pos + 1 } });
  // R5: list, který jen opakuje pohledy jiného listu dokumentu (rozdělení „výkres + poznámky“ v jakémkoli pořadí i přes další
  // výkres): jeho pohledy jsou podmnožinou pohledů jiného listu ve stejném měřítku, nemá řez / detail / model navíc a kromě
  // vygenerovaných kót nese jen volný text
  if (!noViews && !o.bomOnly && plainViews(o) && (doc.drawings?.length ?? 0) > 1) {
    const mine = res ? [...res.views.map((v) => v.key), ...(o.views.iso ? ["iso"] : [])] : viewsOnSheet(o);
    const own = s.annotations.some((a) => !a.auto && a.type !== "text" && !(a.type === "note" && isFreeAnn(a)));
    const twin = orderedSheets(doc).find((j) => {
      if (j === idx) return false;
      const tw = sheetOptions(doc.drawings![j]);
      if (tw.bomOnly) return false; // list jen s kusovníkem pohledy nemá – kopií pohledů být nemůže
      const has = new Set(viewsOnSheet(tw));
      // stejné měřítko (list s pohledem ve větším měřítku je detailní list, ne kopie); ze dvou shodných listů je kopií ten další
      const same = mine.every((k) => has.has(k)) && String(tw.scale) === String(o.scale);
      const twinOwn = doc.drawings![j].annotations.some((a) => !a.auto && a.type !== "text" && !(a.type === "note" && isFreeAnn(a)));
      return same && (has.size > mine.length || twinOwn || orderedSheets(doc).indexOf(j) < orderedSheets(doc).indexOf(idx));
    });
    // D4: list agenta, který jen opakuje pohledy jiného listu a nese text = ✗ (rozdělení „výkres + poznámky“); prázdná kopie
    // (nový list s výchozími pohledy, který agent teprve nastaví) poznámkami není – ⚠ jako u člověka
    const agentSheet = s.annotations.some((a) => a.by === "agent" && (a.type === "text" || (a.type === "note" && isFreeAnn(a))));
    if (twin !== undefined && !own) out.push({ level: agentSheet ? "error" : "warn", code: "drawing.sheet-duplicate", kind: "other", text: tr("list „{0}“ opakuje pohledy listu „{1}“ a nepřidává nic než text – výkres se na „list s výkresem + list s poznámkami“ nedělí; smažte ho a údaje dejte do razítka / k ploše", sheetTitle(doc, idx), sheetTitle(doc, twin)), sheetId: s.id, data: { sheetPos: pos + 1 } });
  }
  return out;
}

/**
 * Dokument načtený textovou cestou (JSON řádek, setDocument, `otevřít`, CLI `--open`) – přerazítkovaný na agenta: porušení
 * pravidel textu po kódech (počet + první nález) pro řádek ✗ načtení. Načtený dokument zůstane otevřený (agent ho opraví
 * příkazy `výkres smazat …`), ale běh skončí chybou a export listu s porušením se odmítne.
 */
export function ingestFindings(doc: CadDoc): { code: AuditFinding["code"] | "drawing.notes-loaded"; args: [string, string] }[] {
  if (doc.kind === "draft") return draftIngest(doc);
  const audit = auditOf(doc);
  const all = audit.filter((f) => f.by === "agent" && findingLevel(f) === "error");
  const by = new Map<string, AuditFinding[]>();
  for (const f of all) by.set(f.code, [...(by.get(f.code) ?? []), f]);
  const out: { code: AuditFinding["code"] | "drawing.notes-loaded"; args: [string, string] }[] = [...by.entries()].map(([code, list]) => ({ code: code as AuditFinding["code"], args: [list[0].sheet >= 0 ? sheetTitle(doc, list[0].sheet) : tr("model"), tr("dokument agenta (JSON / setDocument v tomto běhu): {0}{1}", list[0].text, list.length > 1 ? tr(" (a dalších {0})", list.length - 1) : "")] }));
  // D1: soubor otevřený z disku – jeho text agent nevytvořil: ⚠ (žádná zelená), export povolen
  const loaded = audit.filter((f) => f.by === "loaded");
  if (loaded.length) out.push({ code: "drawing.notes-loaded", args: [loaded[0].sheet >= 0 ? sheetTitle(doc, loaded[0].sheet) : tr("model"), loadedText(doc, loaded)] });
  return out;
}

/** 2D výkres z JSON řádku (agent → ✗ po kódech) nebo ze souboru z disku (⚠ drawing.notes-loaded) – cad/draft/agent-notes.ts */
function draftIngest(doc: CadDoc): { code: AuditFinding["code"] | "drawing.notes-loaded"; args: [string, string] }[] {
  if (!doc.draft) return [];
  const all = draftNotesAudit(doc.draft as DraftModel);
  const out: { code: AuditFinding["code"] | "drawing.notes-loaded"; args: [string, string] }[] = [];
  const by = new Map<string, typeof all>();
  for (const f of all.filter((x) => x.by === "agent")) by.set(f.code, [...(by.get(f.code) ?? []), f]);
  for (const [code, list] of by) out.push({ code: code as AuditFinding["code"], args: [doc.name, tr("dokument agenta (JSON / setDocument v tomto běhu): {0}{1}", list[0].text, list.length > 1 ? tr(" (a dalších {0})", list.length - 1) : "")] });
  const loaded = all.filter((x) => x.by === "loaded");
  if (loaded.length) out.push({ code: "drawing.notes-loaded", args: [doc.name, tr("text 2D výkresu ze souboru otevřeného z disku porušuje pravidla pro agenty ({0} nálezů) – agent ho nezměnil, export je povolen. První: {1}", loaded.length, loaded[0].text)] });
  return out;
}

/** původ buňky / názvu listu */
const metaByOf = (s: DrawingDoc, k: string) => ((s.meta as { by?: Record<string, string> }).by ?? {})[k] ?? "user";

/** text ⚠ drawing.notes-loaded: kolik nálezů, které pravidlo, že agent text nezměnil a export je povolen */
export function loadedText(doc: CadDoc, loaded: readonly AuditFinding[]): string {
  const codes = [...new Set(loaded.map((f) => f.code))];
  const lim = loaded.find((f) => f.code === "drawing.notes-limit" && f.key === "doc");
  return tr("text ze souboru otevřeného z disku porušuje pravidla pro agenty ({0} nálezů: {1}{2}) – agent ho nezměnil, export je povolen; co agent změní, platí jako jeho text (✗). První: {3}", loaded.length, codes.join(", "), lim ? tr("; volný text {0}/{1} řádků", String(lim.data?.count ?? lim.item), NOTE_MAX_LINES) : "", loaded[0].text.split(" – ")[0]);
}

/**
 * Export výkresu textovou cestou (výkres export, window.mncad.exportDrawing, CLI --formats): list, na kterém agent porušil
 * pravidla textu, se neexportuje – výkres s 10 větami nad razítkem ani „list poznámek“ nevznikne ani jako soubor (R4, R5).
 */
export function exportGuard(doc: CadDoc, sheets: number[]): AuditFinding[] {
  const audit = auditOf(doc);
  const bad = audit.filter((f) => f.by === "agent" && findingLevel(f) === "error" && (f.sheet < 0 || sheets.includes(f.sheet)));
  // D1: nálezy textu načteného souboru export nezastaví – volající je ohlásí ⚠ drawing.notes-loaded
  if (!bad.length) return audit.filter((f) => f.by === "loaded" && (f.sheet < 0 || sheets.includes(f.sheet)));
  const f = bad[0];
  throw new CodedError(f.code, [f.sheet >= 0 ? sheetTitle(doc, f.sheet) : sheetTitle(doc, sheets[0] ?? 0), tr("export odmítnut – {0}{1}", f.text, bad.length > 1 ? tr(" (a dalších {0} nálezů – výkres stav)", bad.length - 1) : "")]);
}

/** příkazy, u kterých protokol ukáže hlášení výpočtu listu řádkem ✗ / ⚠ (ostatní je vrací jen v `issues`) */
const ISSUE_LINES = new Set<DrawingCmd["k"]>(["set", "dim", "views"]);
/** kola dílu pro stav výkresu (sestava = žádná) */
const gearsOf = (doc: CadDoc) => (doc.kind === "assembly" ? [] : gearTablesOf(doc));
const ISSUE_KINDS = new Set<DrawingIssue["kind"]>(["section-miss", "section-legacy", "sheet-fit", "view-lost", "hole-table-overlap", "gear-table-overlap"]);

/**
 * Provede příkaz výkresu nad dokumentem – nad aktivním listem (`výkres list N`; chybí-li list, založí se první).
 * `compute` = výpočet výkresu v jádře; `env` = doplňky aplikace (kusovník, pozice, hmotnost, otevřené záložky).
 * Výsledek nese `issues` posledního výpočtu listu; u voleb listu a kót je protokol ukáže i řádkem ✗ / ⚠ (B5, B6).
 */
export async function applyDrawingCmd(doc0: CadDoc, cmd: DrawingCmd, compute0: DrawingCompute, env: DrawingEnv = {}): Promise<DrawingCmdResult> {
  let last: SmartResult | null = null;
  const compute: DrawingCompute = async (d, m, o) => (last = await compute0(d, m, o));
  const r0 = await applyCmd(doc0, cmd, compute, env);
  // R6: co zapsal příkaz textové cesty, je od agenta (razítko původu na jediném místě zápisu); R1/R2/R4/R5: nový porušený
  // kanál textu (kóta, razítko, revize, odkaz, text …), který žádná cílená kontrola příkazu nezachytila, příkaz odmítne
  const r = r0.changed || r0.doc !== doc0 ? { ...r0, doc: stampDoc(doc0, r0.doc) } : r0;
  if (r.doc !== doc0 && r.doc.drawings?.length) guardAgentText(doc0, r.doc);
  const res = last as SmartResult | null;
  // stav výkresu sbírá hlášení všech vypsaných listů sám, export hlásí varování všech exportovaných listů sám
  if (!res || cmd.k === "status" || cmd.k === "export") return r;
  const own = r.issues ?? [];
  const sheetId = r.doc.drawings?.[activeSheetIndex(r.doc)]?.id;
  // hlášení výpočtu listu (`computed`) – vlastní nález příkazu se stejným textem se neopakuje
  const computed = issuesOf(res)
    .filter((i) => !own.some((o) => o.text === i.text))
    .map((i): DrawingIssue => ({ ...i, computed: true, ...(sheetId ? { sheetId } : {}) }));
  const issues = [...computed, ...own];
  const lines = ISSUE_LINES.has(cmd.k) || (cmd.k === "sheet" && "then" in cmd && !!cmd.then) ? issues.filter((i) => i.level === "error" || ISSUE_KINDS.has(i.kind)).map(issueLine) : [];
  return { ...r, log: [...r.log, ...lines.filter((l) => !r.log.includes(l))], ...(issues.length ? { issues } : {}) };
}

/** listy dokumentu po příkazu textové cesty s razítkem původu „agent“ u všeho, co příkaz zapsal nebo změnil */
function stampDoc(doc0: CadDoc, doc: CadDoc): CadDoc {
  if (!doc.drawings?.length) return doc;
  const prev = new Map((doc0.drawings ?? []).map((s) => [s.id, s]));
  let changed = false;
  const drawings = doc.drawings.map((s) => {
    const n = stampOrigin(prev.get(s.id), s, "agent");
    if (n !== s) changed = true;
    return n;
  });
  const mat = doc.materialName !== doc0.materialName && doc.materialName?.trim() ? { materialBy: "agent" as const } : {};
  return changed || Object.keys(mat).length ? { ...doc, drawings, ...mat } : doc;
}

/** nové porušení pravidel textu, které příkaz agenta způsobil → ✗ (dokument se nezmění) */
function guardAgentText(doc0: CadDoc, doc: CadDoc): void {
  const gen0 = generatedFreeText(doc0);
  const gen1 = generatedFreeText(doc);
  const fresh = newAgentFindings(auditDoc(doc0 as AuditInput, gen0), auditOf(doc), auditItems(doc0 as AuditInput, gen0), auditItems(doc as AuditInput, gen1));
  if (!fresh.length) return;
  const f = fresh[0];
  throw new CodedError(f.code, [f.sheet >= 0 ? sheetTitle(doc, f.sheet) : sheetTitle(doc, activeSheetIndex(doc)), fresh.length > 1 ? `${f.text} ${tr("(a dalších {0}: {1})", fresh.length - 1, fresh.slice(1, 3).map((x) => x.text.split(" – ")[0]).join(" · "))}` : f.text]);
}

async function applyCmd(doc0: CadDoc, cmd: DrawingCmd, compute: DrawingCompute, env: DrawingEnv): Promise<DrawingCmdResult> {
  if (doc0.kind === "assembly" && cmd.k === "dim" && cmd.mode === "smart") throw new Error(tr("Chytré kóty jsou pro díly – u sestavy použijte „kótovat celkově“ a pozice"));
  const doc: CadDoc = { ...doc0, drawings: doc0.drawings?.length ? [...doc0.drawings] : [newSheet(doc0)] };
  const created = !doc0.drawings?.length;
  if (created) syncDocTemplates(doc);
  let idx = activeSheetIndex(doc);
  const sheet = (): DrawingDoc => doc.drawings![idx];
  const put = (s: DrawingDoc) => (doc.drawings![idx] = s);
  const log: string[] = [];
  const issues: DrawingIssue[] = [];
  /** řádek „! …“ do protokolu konzole a týž nález strojově (`issues`; překryv / přesah rámečku = drawing.overlap) */
  const issue = (kind: DrawingIssue["kind"], text: string, ann?: DrawingAnnotation) => {
    log.push(text);
    issues.push({ level: "warn", code: kind === "overlap" || kind === "frame" ? "drawing.overlap" : "drawing.warning", kind, text: text.replace(/^! /, ""), sheetId: sheet().id, ...(ann ? { ann } : {}) });
  };
  if (created) log.push(tr("✓ nový list výkresu „{0}“ (Chytré kóty)", sheet().name));
  /**
   * poznámka u razítka z textové cesty (vlna 23): údaj razítka se přesune do razítka (R1), jinak heslovitý řádek jen na
   * listu 1 (R4, R5) s razítkem původu „agent“; dosavadní poznámka se nahradí a protokol to řekne (žádné tiché přepsání)
   */
  const agentNote = (m: Record<string, unknown>, value: string): string[] => {
    const v = value.trim();
    if (!v) {
      delete m.note;
      delete m.noteBy;
      return [tr("✓ poznámka u razítka zrušena")];
    }
    const cls = classifyNote(v);
    if (cls) {
      const conflicts: string[] = [];
      const text = moveToTitle(doc, idx, m, cls, v, conflicts);
      issues.push({ level: "note", code: "drawing.note-to-title", kind: "other", text, sheetId: sheet().id }, ...conflictIssues(conflicts, sheet().id));
      return [`ℹ ${text}`, ...conflicts.map((c) => `⚠ ${c}`)];
    }
    checkFirstSheet(doc, idx, tr("poznámka „{0}“", v));
    checkStyle(doc, idx, v);
    const old = typeof m.note === "string" ? m.note.trim() : "";
    m.note = v;
    m.noteBy = "agent";
    return [old && old !== v ? tr("✓ poznámka: {0} (nahrazuje „{1}“)", v, old) : tr("✓ poznámka: {0}", v)];
  };
  const extras = env.extras?.(doc);
  /** výpočet listu (s kusovníkem a pozicemi) a sloučení dosud nevložených Chytrých kót – kóty a značky se váží na list */
  const computeSheet = async () => {
    const o = sheetOptions(sheet());
    const res = await compute(doc, sheetMeta(doc, sheet(), idx, extras), o);
    if (res.smart && o.dimensions === "smart") {
      const m = mergeSmart(sheet().annotations, o, res.smart);
      if (m) put({ ...sheet(), options: { ...o, smartGen: m.gen } as unknown as Record<string, unknown>, annotations: m.annotations });
    }
    return res;
  };
  const done = (r: Omit<DrawingCmdResult, "doc" | "log">): DrawingCmdResult => {
    // u více listů se k výsledku připíše list, se kterým příkaz pracoval
    if (setSheets(doc, idx).length > 1 && cmd.k !== "sheet" && cmd.k !== "status") {
      const k = log.findIndex((l) => l.startsWith("✓"));
      if (k >= 0) log[k] += tr(" · list {0}", sheetName(doc, idx));
    }
    const all = [...(r.issues ?? []), ...issues];
    return { doc, log, ...r, ...(all.length ? { issues: all } : {}) };
  };
  switch (cmd.k) {
    case "set": {
      const o = { ...sheetOptions(sheet()), ...cmd.opts };
      put({ ...sheet(), options: o as unknown as Record<string, unknown> });
      log.push(tr("✓ výkres: {0}", cmd.summary.join(", ") || tr("beze změny voleb")));
      // výpočet listu: řez mimo těleso a „pohledy se nevejdou“ jdou do protokolu (✗ / ⚠) a do `issues`
      const res = await computeSheet();
      // Starší zápis (skripty před vlnou 15 psaly odsazení řezu jako souřadnici na ose: `řez XZ odsazení -57` = rovina Y = −57).
      // Číslo, které v dnešní konvenci (jako u skici) těleso mine, ale jako souřadnice ho protne, se vyloží postaru – řez
      // se uloží v dnešní konvenci a protokol to řekne řádkem ⚠ i s dnešním zápisem (žádná tichá změna vstupu).
      const sec = cmd.opts.section;
      const range = sec?.normal ? ((res.issues ?? []).find((i) => i.kind === "section-miss")?.data?.offsetRange as [number, number] | undefined) : undefined;
      if (sec && range) {
        const legacy = sectionAt(sec.plane, sec.offset, sec.kind);
        if (legacy.offset > range[0] + 1e-9 && legacy.offset < range[1] - 1e-9) {
          put({ ...sheet(), options: { ...sheetOptions(sheet()), section: legacy } as unknown as Record<string, unknown> });
          log[log.length - 1] = log[log.length - 1].replace(sectionText(sec), sectionText(legacy));
          await computeSheet();
          const ax = (["X", "Y", "Z"] as const)[SECTION_AXIS[sec.plane]];
          const text = tr("řez {0} odsazení {1}: rovina {2} = {3} těleso míjí – číslo vyloženo postaru jako souřadnice {2} = {1} (zápis před sjednocením znaménka se skicou); dnes pište: výkres řez {0} odsazení {4}", sec.plane, fmtN3L(sec.offset), ax, fmtN3L(sectionCoord(sec)), fmtN3L(legacy.offset));
          return done({ changed: true, open: true, issues: [{ level: "warn", code: "drawing.warning", kind: "section-legacy", text, data: { plane: sec.plane, typed: sec.offset, offset: legacy.offset, coord: sectionCoord(legacy) } }] });
        }
      }
      return done({ changed: true, open: true });
    }
    case "meta": {
      const m = { ...(sheet().meta as Record<string, unknown>) };
      if (cmd.field === "roughness") {
        // obecná drsnost = buňka razítka se značkou ISO 1302 (vlna 23, R1); starší dokumenty ji měly v poznámce – tam se odebere
        const base = String(m.note ?? "").replace(/\s*·?\s*Nepředepsaná drsnost [^·]*/u, "").trim();
        if (base !== String(m.note ?? "").trim()) m.note = base || undefined;
        m.roughness = /^\d/.test(cmd.value.trim()) ? `Ra ${cmd.value.trim()}` : cmd.value.trim();
        log.push(tr("✓ obecná drsnost {0} (razítko)", String(m.roughness)));
      } else if (cmd.field === "tolerance") {
        // ISO 2768 třída (mK, f H …), tabulka podle desetinných míst nebo text; „ne“ = zrušit (cad/title-block.ts)
        log.push(applyGeneralTol(m, cmd.value));
      } else if (cmd.field === "note") {
        log.push(...agentNote(m, cmd.value));
      } else {
        m[cmd.field] = cmd.value;
        log.push(tr("✓ hrany: {0}", cmd.value));
      }
      // rozpor v buňce (D3) vyřeší výslovná hodnota té buňky (`výkres drsnost`, `výkres nepředepsané`, `výkres hrany`)
      if (Array.isArray(m.titleConflicts)) {
        const left = (m.titleConflicts as TitleConflict[]).filter((c) => c.key !== cmd.field);
        if (left.length) m.titleConflicts = left;
        else delete m.titleConflicts;
      }
      put({ ...sheet(), meta: m });
      if (cmd.field === "note" && m.noteBy === "agent") checkNotesBudget(doc, idx, tr("poznámka „{0}“", cmd.value));
      return done({ changed: true, open: false });
    }
    case "dim": {
      // funkční rozměry a polohy děr se pamatují u listu (prázdné / auto = zrušit) – B8, B12
      let o: DrawingOptions = { ...sheetOptions(sheet()), dimensions: cmd.mode, ...(cmd.style ? { dimStyle: cmd.style } : {}), ...(cmd.functional ? { dimFunctional: cmd.functional.length ? cmd.functional : undefined } : {}), ...(cmd.holes ? { dimHoles: cmd.holes === "auto" ? undefined : cmd.holes } : {}) };
      if (cmd.mode !== "smart") {
        const keep = sheet().annotations.filter((a) => !a.auto);
        const removed = sheet().annotations.length - keep.length;
        put({ ...sheet(), options: { ...o, smartGen: undefined, smartOff: undefined } as unknown as Record<string, unknown>, annotations: keep });
        log.push(cmd.mode === "overall" ? tr("✓ kóty: jen celkové rozměry (odstraněno vygenerovaných: {0})", removed) : cmd.mode === "auto" ? tr("✓ kóty: Auto + Ø – základní kóty zapečené do pohledů (odstraněno vygenerovaných: {0})", removed) : tr("✓ kóty: žádné automatické (odstraněno vygenerovaných: {0})", removed));
        return done({ changed: true, open: true });
      }
      // polohy děr kótami (souřadnicově / od hran) = tabulka děr je na listu navíc (polohy dvakrát) → vypne se;
      // tabulkou = tabulka se zapne (pohled tabulky volí jádro – ten, kde jsou díry)
      let tableNote = "";
      if ((cmd.holes === "ordinate" || cmd.holes === "chain") && o.holeTable) {
        o = { ...o, holeTable: false };
        tableNote = tr(" · tabulka děr vypnuta – polohy děr jsou kótami (zpět: kótovat díry tabulka)");
      } else if (cmd.holes === "table") o = { ...o, holeTable: true };
      let res = await compute(doc, sheetMeta(doc, sheet(), idx, extras), o);
      if (!res.smart) throw new Error(tr("jádro nevrátilo Chytré kóty"));
      let m = mergeSmart(sheet().annotations, o, res.smart, true)!;
      // B8: pomocná kóta s tolerancí = řetěz přeurčený funkčními rozměry → pomocnou bude funkční rozměr bez tolerance
      const tolRef = m.annotations.find((a): a is DimA => isChainDim(a) && a.prefix === "(" && !!splitSuffix(a).user.trim());
      let overNote = "";
      if (tolRef && o.dimFunctional?.length) {
        const value = dimValue(res.views, tolRef);
        const od = overdeterminedChain(chainMembers(res.views, m.annotations, tolRef.view), value, o.dimFunctional);
        if (od && "drop" in od) {
          o = { ...o, dimFunctional: o.dimFunctional.filter((v) => !sameSize(v, od.drop)) };
          const r2 = await compute(doc, sheetMeta(doc, sheet(), idx, extras), o);
          if (r2.smart) {
            res = r2;
            m = mergeSmart(sheet().annotations, o, r2.smart, true)!;
            overNote = tr("! řetěz byl přeurčený (funkční byly všechny jeho rozměry) – pomocnou kótou je funkční rozměr bez tolerance {0}, tolerovaný {1} zůstává funkční", fmtN3(od.drop), fmtN3(value));
          }
        } else overNote = tr("! pomocná kóta {0} nese toleranci – řetěz je přeurčený (všechny jeho rozměry jsou funkční a tolerované); zrušte funkčnost jednoho rozměru (kótovat … funkční …)", annLabel(res.views, tolRef));
      }
      put({ ...sheet(), options: { ...o, smartGen: m.gen, smartOff: [] } as unknown as Record<string, unknown>, annotations: m.annotations });
      const rep = res.smart!.report;
      const per = Object.entries(rep.perView).map(([k, n]) => `${VIEW_NAME(k, o)} ${n}`).join(", ");
      log.push(tr("✓ Chytré kóty ({0}): {1} kót a popisů – {2} · očekávaných rozměrů {3}", o.dimStyle === "baseline" ? tr("od základny") : tr("řetězově"), res.smart!.annotations.filter((a) => a.type !== "centerline").length, per || "—", rep.expected) + smartExtras(o, rep) + tableNote);
      if (overNote) issue("other", overNote);
      for (const v of o.dimFunctional ?? []) if (!rep.functional?.some((x) => x === v)) issue("other", tr("! funkční rozměr {0}: na listu není délková kóta s touto hodnotou (hodnoty kót: výkres stav)", fmtN3(v)));
      for (const s of rep.skipped) issue("dims-skipped", tr("! vynecháno: {0}", s));
      return done({ changed: true, open: true });
    }
    case "dimcheck": {
      // kontrola kót pro výrobní úplnost po položkách (bod 18): ✓ / ◐ / ✗ / – (nezkontrolováno), čísla pro `výkres doplnit kóty 3 5`
      const res = await computeSheet();
      const anns = sheet().annotations;
      const dc = sheetDimCheck(doc, withAnnotations(res, anns), anns, sheetOptions(sheet()));
      if (!dc) {
        log.push(tr("kontrola kót: list sestavy – rozměry dílů se kontrolují na výkresech dílů"));
        return done({ changed: created, open: false });
      }
      log.push(...dimCheckDetail(dc));
      return done({ changed: created, open: false, issues: dimCheckIssues(dc, { sheetId: sheet().id, withTol: true }) });
    }
    case "dimfill": {
      // doplnit chybějící kóty podle kontroly (= GUI „Přidat kótu“): poloha od hrany dílu / základny, velikost mezi hranami prvku, Ø díry
      const res = await computeSheet();
      const o = sheetOptions(sheet());
      let anns = sheet().annotations;
      const dc = sheetDimCheck(doc, withAnnotations(res, anns), anns, o);
      if (!dc) throw new Error(tr("výkres doplnit kóty: jen u výkresu dílu"));
      const sug = suggestionsFor(dc, doc, res.views, cmd.what).filter((x) => !cmd.only || cmd.only.includes(dc.items.indexOf(x.item) + 1));
      const added: string[] = [];
      const failed: string[] = [];
      const per = new Map<string, number>();
      for (const { item, dim } of sug) {
        if (!dim) {
          failed.push(item.label);
          continue;
        }
        try {
          const n = per.get(`${dim.view}:${dim.kind}`) ?? 0;
          per.set(`${dim.view}:${dim.kind}`, n + 1);
          const ann = withGroupCount(item, makeManualDim(res, o, dim, dim.kind === "diameter" ? 8 : 10 + 7 * n).ann);
          anns = [...anns, ann];
          added.push(`${shortId(anns.length - 1)} ${annLabel(res.views, ann)} (${item.label})`);
        } catch (e) {
          failed.push(`${item.label} – ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (added.length) put({ ...sheet(), annotations: anns });
      log.push(added.length ? tr("✓ doplněno kót: {0} – {1}", added.length, added.join(" · ")) : tr("ℹ žádná kóta nedoplněna"));
      if (failed.length) issue("other", tr("! nejde doplnit automaticky: {0} – zadejte kótu sami (výkres kóta …)", failed.join("; ")));
      const after = sheetDimCheck(doc, withAnnotations(res, anns), anns, o);
      if (after) log.push(dimCheckLine(after));
      return done({ changed: added.length > 0, open: added.length > 0 });
    }
    case "tolcheck": {
      const res = await computeSheet();
      const r = tolCheckLines(res.views, sheet().annotations, sheetOptions(sheet()), env.referenceDims ? env.referenceDims(doc) : null);
      log.push(...r.lines);
      return { ...done({ changed: created, open: false }), ...(r.issues.length ? { issues: r.issues } : {}) };
    }
    case "tol": {
      // desetinná čárka podle jazyka listu (skript s tečkami „-0.005“ → „-0,005“ na českém výkrese)
      const tolS = localDecimals(cmd.tol);
      const res = await computeSheet();
      let views = res.views;
      let anns = sheet().annotations;
      let so = sheetOptions(sheet());
      // kóta podle ČÍSELNÉ hodnoty modelu (±1e-6; B7), druhu (Ø, M, R), nebo id (a12); `pohled …` zúží výběr
      let hits = findDims(views, anns, cmd.target);
      if (/^a\d+$/i.test(cmd.target)) hits = resolveAnns(views, anns, cmd.target, true).map((i) => anns[i]);
      if (cmd.view) hits = hits.filter((a) => a.view === cmd.view);
      const dimList = () => annList(views, anns, so, (a) => a.type === "dim" || a.type === "callout") || "—";
      if (!hits.length) throw new Error(tr("kóta „{0}“{1} na výkrese není – kóty: {2}", cmd.target, cmd.view ? tr(" (pohled {0})", VIEW_NAME(cmd.view, so)) : "", dimList()));
      // pomocná kóta v závorce se netoleruje (ISO 129-1): shoduje-li se zadání i s jinou kótou, platí ta jiná
      const isRef = (a: DrawingAnnotation) => a.type === "dim" && a.prefix === "(";
      // starší dokument: ruční náhradní kóta (dřív se pomocná kóta tolerovat nedala) se stejnou hodnotou jako vygenerovaná
      // pomocná kóta řetězu → převede se vygenerovaná a ruční duplicita se odstraní (B8)
      const refHits = hits.filter(isRef);
      const manual = refHits.length && isChainDim(refHits[0]) ? hits.filter((a) => !isRef(a)) : [];
      const dupes = manual.length && manual.every((a) => !a.auto && a.type === "dim" && a.view === refHits[0].view && a.kind === (refHits[0] as DimA).kind) ? manual : [];
      if (dupes.length) hits = refHits;
      else if (refHits.length && refHits.length < hits.length) hits = hits.filter((a) => !isRef(a));
      let converted = "";
      if (hits.every(isRef) && so.dimensions === "smart" && isChainDim(hits[0])) {
        // B8: tolerance na pomocné kótě = rozměr je funkční → řetěz se přepočte (pomocnou kótou bude jiný článek); byly-li by
        // pak funkční všechny rozměry řetězu (přeurčený), pomocným bude funkční rozměr bez tolerance
        const ref = hits[0] as DimA;
        const value = dimValue(views, ref);
        const members = chainMembers(views, anns, ref.view);
        const od = overdeterminedChain(members, value, so.dimFunctional ?? []);
        if (od && "stuck" in od) throw new Error(tr("rozměr {0} nelze tolerovat: řetěz {1} by byl přeurčený – všechny jeho rozměry jsou funkční a ostatní mají toleranci, jeden musí zůstat pomocný (ISO 129-1); zrušte funkčnost jednoho z nich (kótovat … funkční …)", fmtN3(value), members.map((x) => fmtN3(x.value)).join(" · ")));
        const drop = od && "drop" in od ? od.drop : null;
        const o2: DrawingOptions = { ...so, dimFunctional: [...(so.dimFunctional ?? []).filter((v) => !sameSize(v, value) && !(drop !== null && sameSize(v, drop))), Math.round(value * 1000) / 1000] };
        const r2 = await compute(doc, sheetMeta(doc, sheet(), idx, extras), o2);
        const m2 = r2.smart ? mergeSmart(anns, o2, r2.smart) : null;
        const same = m2?.annotations.find((a) => a.auto === ref.auto);
        if (m2 && same && !isRef(same)) {
          // ruční duplicity převedené kóty pryč
          const gone = new Set(dupes.map((a) => a.id));
          put({ ...sheet(), options: { ...o2, smartGen: m2.gen } as unknown as Record<string, unknown>, annotations: m2.annotations.filter((a) => !gone.has(a.id)) });
          const now = m2.annotations.find((a) => a.type === "dim" && a.prefix === "(" && a.view === ref.view);
          const nowL = now ? annLabel(r2.views, now) : tr("celková délka");
          converted = drop !== null ? tr(" – rozměr {0} je nyní funkční; řetěz by byl přeurčený, pomocnou kótou je proto funkční rozměr bez tolerance {1}", fmtN3(value), nowL) : tr(" – rozměr {0} je nyní funkční (pomocnou kótou řetězu je {1})", fmtN3(value), nowL);
          if (dupes.length) converted += tr(" · odstraněna ruční náhradní kóta {0}", dupes.map((a) => annLabel(views, a)).join(", "));
          hits = [same];
          views = r2.views;
          anns = sheet().annotations;
          so = sheetOptions(sheet());
        } else if (dupes.length) hits = dupes; // převod nevyšel: tolerance na ruční kótu jako dřív
      }
      if (hits.every(isRef)) {
        const ref = hits[0] as Extract<DrawingAnnotation, { type: "dim" }>;
        const chain = ref.auto?.startsWith("len:c:");
        const others = anns.filter((a) => a.type === "dim" && !isRef(a) && a.view === ref.view && a.kind === ref.kind && (!chain || !!a.auto?.startsWith("len:c:")));
        throw new Error(tr("kóta „{0}“ je pomocná (v závorce) – pomocná kóta se netoleruje (ISO 129-1); tolerujte jiný článek řetězu: {1}", annLabel(views, ref), others.map((a) => annLabel(views, a)).join(", ") || "—"));
      }
      if (hits.length > 1) throw new Error(tr("kóta „{0}“ není jednoznačná ({1}×: {2}) – upřesněte ji id (výkres tolerance a3 …) nebo pohledem (… pohled horní)", cmd.target, hits.length, hits.map((a) => `${shortId(anns.indexOf(a))} ${annLabel(views, a)} (${VIEW_NAME(a.view, so)})`).join(", ")));
      const h = hits[0];
      const fit = /^[A-Za-z]{1,2}\d/.test(tolS); // lícování (h6, H7, 6H) bez mezery, ±0,1 také bez mezery (ISO 129)
      // pole tolerance ISO 286 (H7, g6, H7/g6): úchylky podle jmenovitého rozměru kóty (výkres uložení je vyžaduje)
      const holeD = h.type === "callout" ? /Ø(\d+(?:[.,]\d+)?)/.exec(h.lines[0] ?? "") : null;
      const iso = parseFit(tolS) && ((h.type === "dim" && h.prefix !== "M") || holeD) ? tolS.replace(/\s+/g, "") : null;
      const nominal = !iso ? 0 : h.type === "dim" ? dimValue(views, h) : Number(holeD![1].replace(",", "."));
      if (cmd.fit) {
        if (!parseFit(tolS)) throw new Error(tr("„{0}“ není pole tolerance ISO 286 – např. H7, g6, js6, H7/g6", tolS));
        if (!iso) throw new Error(tr("uložení ISO 286 patří ke kótě rozměru nebo díry (Ø40, 25, Ø12 skrz) – u závitu použijte výkres tolerance M8 6H"));
        if (!(iso && (iso.includes("/") ? iso.split("/").every((z) => fitDeviations(nominal, z)) : fitDeviations(nominal, iso)))) throw new Error(tr("pole {0} není pro rozměr {1} mm v ISO 286 definováno (tabulky do 500 mm)", tolS, fmtN(nominal)));
      }
      const next = anns.map((a) => {
        if (a.id !== h.id) return a;
        if (a.type === "dim") {
          // závit: „M20×1,5“ + „-6g“; jinak tolerance za hodnotou. Vygenerovaná část přípony (stoupání, „ (=90)“) zůstane,
          // dřívější tolerance se nahradí
          const p = splitSuffix(a);
          const t = a.prefix === "M" ? `-${tolS}` : fit || /^[±+-]/.test(tolS) ? tolS : ` ${tolS}`;
          return { ...a, suffix: `${p.head}${t}${p.tail}`, ...(cmd.show ? { tolShow: cmd.show } : {}) };
        }
        return a.type === "callout" ? { ...a, tol: tolS, ...(cmd.show ? { tolShow: cmd.show } : {}) } : a;
      });
      put({ ...sheet(), annotations: next });
      const dev = iso ? fitSuffix(nominal, iso, cmd.show ?? h.tolShow ?? so.fitShow ?? "dev") : "";
      log.push(tr("✓ tolerance {0} → {1} ({2})", tolS, annLabel(views, next.find((a) => a.id === h.id)!) + (dev ? ` ${dev}` : ""), VIEW_NAME(h.view, so)) + converted);
      return done({ changed: true, open: false });
    }
    case "views": {
      if (cmd.cmd.op === "bomsheet") {
        // kusovník na samostatném listu (vlna 22, bod 17): tento list ho nekreslí, nový list téhož výkresu jen s kusovníkem
        if (doc.kind !== "assembly") throw new Error(tr("kusovník na samostatném listu – jen výkres sestavy"));
        const list = doc.drawings!;
        const set = setSheets(doc, idx);
        const has = set.find((k) => (list[k].options as Partial<DrawingOptions>).bomOnly);
        put({ ...sheet(), options: { ...sheet().options, bomPlace: "sheet", bomTable: true } });
        if (has === undefined) {
          const cur = sheet().meta as Partial<DrawingMeta>;
          const s = newSheet(doc, set.length + 1);
          list.push(inDrawing({ ...s, name: tr("Kusovník"), options: { ...s.options, bomOnly: true, dimensions: "none" }, meta: { ...inheritTitle(cur), name: cur.name ?? doc.name, number: cur.number ?? "", author: cur.author ?? "", revision: cur.revision ?? "", date: cur.date ?? "", tolerance: cur.tolerance ?? "" } }, drawingKey(sheet())));
        }
        const bi = has ?? list.length - 1;
        log.push(tr("✓ kusovník na samostatném listu {0} – list {1} ho nekreslí (zpět: výkres kusovník nad | sloupce)", sheetName(doc, bi), sheetName(doc, idx)));
        return done({ changed: true, open: true });
      }
      if (cmd.cmd.op === "tpl") {
        // pojmenované šablony hlavičky s logem (vlna 22, bod 22j – cad/title-templates.ts)
        const c = cmd.cmd;
        const cur = sheet().meta as Partial<DrawingMeta>;
        switch (c.act) {
          case "list":
            log.push(templatesLine(doc, cur.titleTpl));
            return { doc, log, changed: created, open: false };
          case "save": {
            let rec: TitleTemplateRec;
            if (Object.keys(c.fields).length) {
              const m: Record<string, unknown> = {};
              const applied = await applyTitleFields(m, c.fields, env.input);
              for (const w of applied.warnings) issue("other", tr("! {0}", w));
              rec = templateFromMeta(c.name, m as Partial<DrawingMeta>);
            } else {
              rec = templateFromMeta(c.name, cur);
              put({ ...sheet(), meta: { ...sheet().meta, titleTpl: rec.name } });
            }
            doc.titleTemplates = saveTemplate(doc, rec, c.setDefault).titleTemplates;
            // CLI / bez úložiště prohlížeče: Nastavení platí jen pro tento běh – neříkat „uložena do Nastavení“ (bod 22j, kolo 6)
            log.push(settingsPersist() ? tr("✓ šablona hlavičky {0} uložena do dokumentu i do Nastavení{1}", templateText(rec), c.setDefault ? tr(" · výchozí pro nové listy") : "") : tr("✓ šablona hlavičky {0} uložena do dokumentu; v Nastavení jen pro tento běh{1}", templateText(rec), c.setDefault ? tr(" · výchozí pro nové listy") : ""));
            return done({ changed: true, open: false });
          }
          case "use": {
            const hit = findTemplate(doc, c.name);
            if (!hit) throw new Error(tr("šablona hlavičky „{0}“ neexistuje – {1}", c.name, templatesLine(doc)));
            const m = { ...(sheet().meta as Record<string, unknown>) };
            applyTemplate(m, hit.rec);
            put({ ...sheet(), meta: m });
            if (hit.from === "settings") doc.titleTemplates = withDocTemplate(doc, hit.rec).titleTemplates;
            log.push(tr("✓ razítko podle šablony hlavičky {0}", templateText(hit.rec)));
            return done({ changed: true, open: false });
          }
          case "delete": {
            const r = deleteTemplate(doc, c.name);
            if (!r.found) throw new Error(tr("šablona hlavičky „{0}“ neexistuje – {1}", c.name, templatesLine(doc)));
            doc.titleTemplates = r.doc.titleTemplates;
            log.push(tr("✓ šablona hlavičky „{0}“ smazána z dokumentu i z Nastavení (razítka listů zůstávají)", c.name));
            return done({ changed: true, open: false });
          }
        }
      }
      const r = await applyViewsCmd({ doc, sheet, put, compute: computeSheet }, cmd.cmd);
      log.push(...r.log);
      return done({ changed: r.changed, open: r.open });
    }
    case "status": {
      const st = await drawingStatus(doc, compute, { sheet: cmd.sheet, extras });
      if (st.doc) Object.assign(doc, { drawings: st.doc.drawings });
      log.push(st.text);
      // hlášení listů ve výpisu („Varování výkresu: …“, ✗ řez mimo těleso) i strojově – engine je zapíše s kódem na řádek `výkres stav`
      return { doc, log, changed: !!st.doc || created, open: false, ...(st.issues?.length ? { issues: st.issues } : {}) };
    }
    case "sheet": {
      const list = doc.drawings!;
      switch (cmd.op) {
        case "list":
          log.push(sheetsLine(doc, idx));
          return { doc, log, changed: created, open: false };
        case "select": {
          idx = resolveSheet(doc, cmd.ref);
          activeSheet.set(sheet().id);
          log.push(tr("✓ list {0} – další příkazy výkresu pracují s ním", sheetName(doc, idx)));
          break;
        }
        case "new": {
          // nový list patří do výkresu aktivního listu
          const cur = sheet().meta as Partial<DrawingMeta>;
          const set = setSheets(doc, idx);
          const n = set.length + 1;
          const s = newSheet(doc, n);
          const name = cmd.name?.trim() || s.name;
          if (set.some((k) => list[k].name.toLowerCase() === name.toLowerCase())) throw new Error(tr("list „{0}“ už existuje – {1}", name, sheetsLine(doc, idx)));
          // údaje razítka (šablona, logo, firma, zákazník …) převezme nový list z aktivního
          list.push(inDrawing({ ...s, name, meta: { ...inheritTitle(cur), name: cur.name ?? doc.name, number: cur.number ?? "", author: cur.author ?? "", revision: cur.revision ?? "", date: cur.date ?? "", tolerance: cur.tolerance ?? "" } }, drawingKey(sheet())));
          idx = list.length - 1;
          activeSheet.set(sheet().id);
          syncDocTemplates(doc);
          log.push(tr("✓ nový list {0} (Chytré kóty) – další příkazy výkresu pracují s ním", sheetName(doc, idx)));
          break;
        }
        case "rename": {
          const i = cmd.ref === undefined ? idx : resolveSheet(doc, cmd.ref);
          const name = cmd.name.trim();
          if (!name) throw new Error(tr("název listu nesmí být prázdný"));
          const old = list[i].name;
          list[i] = { ...list[i], name };
          log.push(tr("✓ list {0}: „{1}“ → „{2}“", sheetPos(doc, i).pos + 1, old, name));
          return { doc, log, changed: true, open: false };
        }
        case "delete": {
          const i = resolveSheet(doc, cmd.ref);
          const set = setSheets(doc, i);
          if (set.length <= 1) throw new Error(tr("výkres má jen jeden list – ten smazat nelze"));
          const at = set.indexOf(i);
          const keep = list[idx === i ? set[at + 1] ?? set[at - 1] : idx];
          const [gone] = list.splice(i, 1);
          idx = Math.max(0, list.indexOf(keep));
          activeSheet.set(sheet().id);
          log.push(tr("✓ list {0} „{1}“ smazán – aktivní list {2}", at + 1, gone.name, sheetName(doc, idx)));
          return { doc, log, changed: true, open: false };
        }
      }
      if (cmd.then) {
        const r = await applyDrawingCmd(doc, cmd.then, compute, env);
        return { doc: r.doc, log: [...log, ...r.log], changed: true, open: true };
      }
      return { doc, log, changed: true, open: true };
    }
    case "drawings": {
      // více výkresů dílu (cad/drawing-sets.ts): listy nesou název výkresu, příkazy pracují s výkresem aktivního listu
      const list = doc.drawings!;
      const sets = () => drawingSets(doc);
      switch (cmd.op) {
        case "list":
          // u více výkresů začíná přehled listů přehledem výkresů – nevypisovat ho dvakrát
          log.push(...(sets().length > 1 ? [] : [drawingsLine(doc, idx)]), sheetsLine(doc, idx));
          return { doc, log, changed: created, open: false };
        case "new": {
          // díl bez výkresu: první výkres vznikl právě teď (created) – jen dostane název; jinak další výkres s listem 1
          const name = cmd.name?.trim() || (created ? tr("Výkres 1") : nextDrawingName(doc));
          if (created) list[0] = inDrawing(list[0], name === tr("Výkres 1") ? "" : name);
          else list.push(addDrawing(doc, name).doc.drawings!.at(-1)!);
          idx = created ? 0 : list.length - 1;
          activeSheet.set(sheet().id);
          log.push(tr("✓ nový výkres „{0}“ – list 1 „{1}“ (Chytré kóty); další příkazy výkresu pracují s ním · výkresů {2}", name, sheet().name, sets().length));
          return { doc, log, changed: true, open: true };
        }
        case "select": {
          const set = resolveDrawing(doc, cmd.ref);
          idx = set.sheets[0];
          activeSheet.set(sheet().id);
          log.push(tr("✓ výkres „{0}“ ({1}) – další příkazy výkresu pracují s ním", set.name, sheetCount(set.sheets.length)));
          return { doc, log, changed: created, open: true };
        }
        case "rename": {
          const set = cmd.ref === undefined ? sets().find((x) => x.sheets.includes(idx))! : resolveDrawing(doc, cmd.ref);
          const name = cmd.name.trim();
          if (!name) throw new Error(tr("název výkresu nesmí být prázdný"));
          if (sets().some((x) => x !== set && x.name.toLowerCase() === name.toLowerCase())) throw new Error(tr("výkres „{0}“ už existuje – {1}", name, drawingsLine(doc, idx)));
          for (const i of set.sheets) list[i] = inDrawing(list[i], name);
          log.push(tr("✓ výkres „{0}“ → „{1}“", set.name, name));
          return { doc, log, changed: true, open: false };
        }
        case "delete": {
          const set = resolveDrawing(doc, cmd.ref);
          if (sets().length <= 1) throw new Error(tr("dokument má jen jeden výkres – ten smazat nelze (smažte jeho listy nebo kóty)"));
          const keep = set.sheets.includes(idx) ? null : list[idx];
          doc.drawings = list.filter((_, i) => !set.sheets.includes(i));
          idx = keep ? doc.drawings.indexOf(keep) : 0;
          activeSheet.set(sheet().id);
          log.push(tr("✓ výkres „{0}“ smazán ({1}) – aktivní výkres „{2}“", set.name, sheetCount(set.sheets.length), sets().find((x) => x.sheets.includes(idx))?.name ?? ""));
          return { doc, log, changed: true, open: false };
        }
      }
      break;
    }
    case "export": {
      // soubor výkresu jako window.mncad.exportDrawing – aplikace ho uloží (stáhne); bez listu = list se nezakládá
      const { exportDrawing } = await import("./drawing-export");
      const r = await exportDrawing(doc0, cmd.format, { sheet: cmd.sheet, ...(cmd.dwgVersion ? { dwgVersion: cmd.dwgVersion as never } : {}) }, compute, extras);
      log.push(tr("✓ výkres export {0}: {1} ({2} kB{3})", cmd.format.toUpperCase(), r.name, Math.max(1, Math.round(r.bytes / 1024)), r.sheets && r.sheets > 1 ? tr(", listů {0}", r.sheets) : ""));
      for (const w of r.warnings ?? []) {
        log.push(tr("! {0}", w));
        issues.push({ ...warningIssue(w), sheetId: sheet().id }); // varování exportovaných listů (řez mimo těleso = ✗)
      }
      return { doc: doc0, log, changed: false, open: false, file: r, ...(issues.length ? { issues } : {}) };
    }
    case "title": {
      const f = { ...cmd.fields };
      // šablona= pojmenovaná šablona hlavičky (dokument / Nastavení – vlna 22, bod 22j) má přednost před druhem razítka
      const named = f.template !== undefined ? findTemplate(doc, f.template) : null;
      if (named) delete f.template;
      const keys = Object.keys(f) as TitleCmdField[];
      if (!keys.length && !named) {
        log.push(...titleLines(doc, sheet()));
        return { doc, log, changed: created, open: false };
      }
      const m = { ...(sheet().meta as Record<string, unknown>) };
      // poznámka u razítka z textové cesty = poznámka agenta (vlna 23: údaj razítka → do razítka, heslovitě, limit řádků)
      const noteVal = f.note;
      if (noteVal !== undefined) delete f.note;
      if (named) {
        applyTemplate(m, named.rec);
        if (named.from === "settings") doc.titleTemplates = withDocTemplate(doc, named.rec).titleTemplates;
      } else if (f.template !== undefined || f.logo !== undefined) delete m.titleTpl; // ruční změna druhu / loga = už ne podle šablony
      // pole, šablona, logo (připojený soubor / data URL / vstup hostitele) a nepředepsané tolerance – cad/agent-title.ts
      const tkeys = keys.filter((k) => k !== "note");
      const applied = tkeys.length ? await applyTitleFields(m, Object.fromEntries(tkeys.map((k) => [k, f[k]])), env.input) : { parts: [] as string[], warnings: [] as string[] };
      // rozpor v buňce (D3) vyřeší výslovná hodnota té buňky
      if (Array.isArray(m.titleConflicts)) {
        const left = (m.titleConflicts as TitleConflict[]).filter((c) => !(tkeys as string[]).includes(c.key));
        if (left.length) m.titleConflicts = left;
        else delete m.titleConflicts;
      }
      if (named) applied.parts.unshift(tr("šablona hlavičky {0}", templateText(named.rec)));
      const noteLines = noteVal !== undefined ? agentNote(m, noteVal) : [];
      put({ ...sheet(), meta: m });
      // číslo, autor a revize i do dokumentu (výchozí pro nové listy, sdílí se se souborem) – jako výkresové prostředí
      if (f.number !== undefined || f.author !== undefined || f.revision !== undefined) {
        doc.props = { ...(doc.props ?? {}), ...(f.number !== undefined ? { number: f.number } : {}), ...(f.author !== undefined ? { author: f.author } : {}), ...(f.revision !== undefined ? { revision: f.revision } : {}) };
      }
      if (f.material !== undefined) {
        // pole materiálu razítka = totéž pravidlo jako pole razítka v GUI a příkaz `materiál …` (material-designation.ts,
        // vlna 22 kolo 7, bod 22g): ČSN 11 523 → třída ocel; dřív jen text razítka a hustota zůstala podle dosavadní třídy bez ⚠
        const nd = withDesignation({ material: doc.material, ...(doc.materialName !== undefined ? { materialName: doc.materialName } : {}) }, f.material);
        doc.material = nd.material;
        if (nd.materialName) doc.materialName = nd.materialName;
        else delete doc.materialName;
      }
      // dosavadní pole se v protokolu jmenují jako dřív (TITLE_KEY), nová podle cad/agent-title.ts
      const off = named ? 1 : 0;
      if (applied.parts.length) log.push(tr("✓ razítko: {0}", applied.parts.map((p, i) => (i >= off && tkeys[i - off] in TITLE_KEY && !["tolerance", "logo", "template"].includes(tkeys[i - off]) ? `${tr(TITLE_KEY[tkeys[i - off] as TitleField])} „${f[tkeys[i - off]]}“` : p)).join(", ")));
      log.push(...noteLines);
      if (noteVal !== undefined && m.noteBy === "agent" && m.note) checkNotesBudget(doc, idx, tr("poznámka „{0}“", noteVal));
      for (const w of applied.warnings) issue("other", tr("! {0}", w));
      // revize mimo tabulku revizí se ohlásí hned (razítko a tabulka by si odporovaly)
      const rw = f.revision !== undefined ? titleRevisionCheck(m as Partial<DrawingMeta>).warning : undefined;
      if (rw) issue("other", tr("! {0}", rw));
      return done({ changed: true, open: false });
    }
    case "rev": {
      const m = { ...(sheet().meta as Partial<DrawingMeta>) };
      const revs: RevisionItem[] = [...(m.revisions ?? [])];
      if (cmd.op === "delete") {
        const i = revs.findIndex((r) => r.rev.toUpperCase() === cmd.rev);
        if (i < 0) throw new Error(tr("revize {0} v tabulce není – revize: {1}", cmd.rev, revs.map((r) => r.rev).join(", ") || "—"));
        revs.splice(i, 1);
        if (m.revision === cmd.rev) m.revision = revs[revs.length - 1]?.rev ?? "";
        log.push(tr("✓ revize {0} smazána", cmd.rev));
      } else {
        const i = revs.findIndex((r) => r.rev.toUpperCase() === cmd.rev);
        const prev = i >= 0 ? revs[i] : undefined;
        const row: RevisionItem = { rev: cmd.rev, date: cmd.date ?? prev?.date ?? today(), note: cmd.note || prev?.note || "", author: cmd.author ?? prev?.author ?? m.author ?? "" };
        if (i >= 0) revs[i] = row;
        else revs.push(row);
        m.revision = cmd.rev;
        log.push(tr("✓ revize {0} {1} „{2}“ – v razítku revize {0}", cmd.rev, row.date, row.note));
      }
      put({ ...sheet(), meta: { ...m, revisions: revs } as Record<string, unknown> });
      return done({ changed: true, open: false });
    }
    case "issue": {
      // vydání listu (vlna 22, bod 20): písmeno revize + revize modelu + datum; `vše` = všechny listy aktivního výkresu
      const which = cmd.all ? setSheets(doc, idx) : [idx];
      let changed = false;
      for (const i of which) {
        const s = doc.drawings![i];
        if (cmd.op === "withdraw") {
          if (!s.issued) {
            log.push(tr("→ list „{0}“ vydaný není – není co zrušit", s.name));
            continue;
          }
          doc.drawings![i] = withdrawIssue(s);
          changed = true;
          log.push(tr("✓ vydání listu „{0}“ (rev. {1} z modelu {2}) zrušeno – list je rozpracovaný", s.name, s.issued.rev, s.issued.modelRev));
          continue;
        }
        const r = issueSheet(doc, s, { ...(cmd.rev ? { rev: cmd.rev } : {}), ...(cmd.note ? { note: cmd.note } : {}), ...(cmd.date ? { date: cmd.date } : {}) });
        if (r.unchanged) {
          log.push(tr("→ list „{0}“ už je vydán jako rev. {1} z modelu {2} – beze změny", s.name, r.rev, r.id.rev));
          continue;
        }
        doc.drawings![i] = r.sheet;
        changed = true;
        const row = (r.sheet.meta as Partial<DrawingMeta>).revisions?.find((x) => x.rev.toUpperCase() === r.rev);
        log.push(tr("✓ list „{0}“ vydán jako rev. {1} z modelu {2} ({3}){4}", s.name, r.rev, r.id.rev, row?.date || today(), r.added ? tr(" · do tabulky revizí přidána revize {0} „{1}“", r.rev, row?.note ?? "") : ""));
        // totéž písmeno revize po změně modelu: papír rev. A a soubor rev. A by se lišily – ⚠ drawing.stale (přísný režim ✗)
        if (r.sameRevChanged && r.prev) issues.push({ level: "warn", code: "drawing.stale", kind: "stale", text: tr("list „{0}“: rev. {1} už byla vydána z modelu {2} a znovu se vydává ze změněného modelu {3} se stejným písmenem – změnu označte novou revizí (výkres vydat {4})", s.name, r.rev, r.prev.modelRev, r.id.rev, nextRevOf(r.rev)), sheetId: s.id });
      }
      return done({ changed, open: false });
    }
    case "mark": {
      // text na listu = volný text nad razítkem (R1 údaj razítka → razítko, R4 heslovitě a limit, R5 jen list 1)
      if (cmd.mark.type === "text") {
        const v = cmd.mark.text.trim();
        const cls = classifyNote(v);
        if (cls) {
          const m = { ...(sheet().meta as Record<string, unknown>) };
          const conflicts: string[] = [];
          const text = moveToTitle(doc, idx, m, cls, v, conflicts);
          log.push(`ℹ ${text}`, ...conflicts.map((c) => `⚠ ${c}`));
          put({ ...sheet(), meta: m });
          issues.push({ level: "note", code: "drawing.note-to-title", kind: "other", text, sheetId: sheet().id }, ...conflictIssues(conflicts, sheet().id));
          return done({ changed: true, open: false });
        }
        checkFirstSheet(doc, idx, tr("text „{0}“", v));
        checkStyle(doc, idx, v);
      }
      const res = await computeSheet();
      const o = sheetOptions(sheet());
      const anns = sheet().annotations;
      const made = makeMark(res, o, anns, cmd.mark, cmd.target, cmd.shift);
      const where = made.where;
      let ann: DrawingAnnotation = { ...made.ann, by: "agent" };
      if (cmd.mark.type === "note") {
        const v = cmd.mark.text.trim();
        // R2: místní popis = odkaz na geometrii (kóta / popis, bod, hrana, kružnice pohledu); volný bod ani místo na listu ne
        // odkaz na kótu není místní popis plochy – šipka míří na plochu nebo hranu (R2)
        if ("on" in cmd.target) throw new CodedError("drawing.note-free-leader", [sheetTitle(doc, idx), tr("„{0}“ → {1}: místní popis míří šipkou na plochu nebo hranu, ne na kótu – popis plochy zapište do modelu (poznámka F7 \"{0}\"; výkres ho převezme se šipkou), údaj ke kótě patří do kóty (výkres upravit <kóta> přípona=…)", v, where)]);
        if (!made.attached) throw new CodedError("drawing.note-free-leader", [sheetTitle(doc, idx), tr("„{0}“ → {1}: odkazová čára musí mířit na plochu nebo hranu – zapište popis do modelu k ploše (poznámka F7 \"{0}\"; výkres ho převezme se šipkou), nebo cílem zvolte hranu (pohled přední v x y na hraně)", v, where)]);
        const cls = classifyNote(v);
        const bad = cls?.parts.filter((p) => p.key !== "edges") ?? [];
        if (bad.length) throw new CodedError("drawing.note-title-data", [sheetTitle(doc, idx), tr("„{0}“: {1} u odkazu – údaje celého dílu patří do razítka ({2}), oblastní úprava plochy do modelu jako čerchovaná čára (úprava F7 tepelná \"58+2 HRC\" [od 0 do 25]), drsnost plochy značkou (výkres značka drsnost Ra 0,8 na …)", v, bad.map((p) => titleDataLabel(p.key)).join(", "), titleHint(bad))]);
        checkStyle(doc, idx, v, LEADER_MAX_CHARS);
      }
      if (cmd.mark.type === "text") ann = { ...ann, by: "agent" };
      put({ ...sheet(), annotations: [...anns, ann] });
      if (cmd.mark.type === "text" || (ann.type === "note" && isFreeAnn(ann))) checkNotesBudget(doc, idx, tr("text „{0}“", (ann as { text: string }).text));
      log.push(tr("✓ značka {0} · {1}", where, shortId(anns.length)));
      const over = overlappingTexts(res, anns, ann);
      if (over.length) issue("overlap", tr("! popisek se překrývá s „{0}“ – posuňte ho: výkres upravit {1} posun=\"dx dy\" (mm listu)", over.join("“, „"), shortId(anns.length)), ann);
      if (outsideFrame(res, ann)) issue("frame", tr("! značka přesahuje rámeček listu – posuňte ji: výkres upravit {0} posun=\"dx dy\"", shortId(anns.length)), ann);
      return done({ changed: true, open: true });
    }
    case "mdim": {
      const res = await computeSheet();
      const o = sheetOptions(sheet());
      const anns = sheet().annotations;
      const { ann, where } = makeManualDim(res, o, cmd.dim, cmd.offset, cmd.text);
      put({ ...sheet(), annotations: [...anns, ann] });
      log.push(tr("✓ kóta {0} ({1}) · {2}", annLabel(res.views, ann), where, shortId(anns.length)));
      const over = overlappingTexts(res, anns, ann);
      if (over.length) issue("overlap", tr("! text kóty se překrývá s „{0}“ – změňte odsazení: výkres upravit {1} odsazení=…", over.join("“, „"), shortId(anns.length)), ann);
      if (outsideFrame(res, ann)) issue("frame", tr("! kóta přesahuje rámeček listu – zmenšete odsazení: výkres upravit {0} odsazení=…", shortId(anns.length)), ann);
      return done({ changed: true, open: true });
    }
    case "edit": {
      const res = await computeSheet();
      const o = sheetOptions(sheet());
      const anns = sheet().annotations;
      const i = resolveOne(res.views, anns, cmd.target, o);
      const before = annLabel(res.views, anns[i]);
      // úprava ruční kóty = potvrzení: kóta přichycená ke změněné geometrii se uloží s nynější geometrií (bod 20)
      const cur = anns[i].type === "dim" && !anns[i].auto ? settleDim(res.views, anns[i] as DimAnn) : anns[i];
      let next = patchAnn(cur, cmd.patch, res.views.find((v) => v.key === anns[i].view)?.s ?? 1);
      // nový text poznámky / textu z textové cesty = text agenta: stejná pravidla jako při vložení (vlna 23, R1 / R4)
      if (cmd.patch.text !== undefined && (next.type === "text" || next.type === "note")) {
        const v = cmd.patch.text.trim();
        const cls = classifyNote(v);
        if (cls && (next.type === "text" || isFreeAnn(next) || cls.parts.some((p) => p.key !== "edges"))) throw new CodedError("drawing.note-title-data", [sheetTitle(doc, idx), tr("„{0}“ obsahuje údaj razítka ({1}) – zapište ho do razítka: {2} a poznámku smažte (výkres smazat {3})", v, cls.parts.map((p) => titleDataLabel(p.key)).join(", ") || "—", titleHint(cls.parts), shortId(i))]);
        if (next.type === "text" || isFreeAnn(next)) checkFirstSheet(doc, idx, tr("text „{0}“", v));
        checkStyle(doc, idx, v, next.type === "note" && !isFreeAnn(next) ? LEADER_MAX_CHARS : undefined);
        next = { ...next, by: "agent" };
      }
      put({ ...sheet(), annotations: anns.map((a, k) => (k === i ? next : a)) });
      if (cmd.patch.text !== undefined && isFreeAnn(next)) checkNotesBudget(doc, idx, tr("úprava {0}", shortId(i)));
      const off = cmd.patch.offset !== undefined ? tr(" (odsazení {0})", fmtN(cmd.patch.offset)) : cmd.patch.shift ? tr(" (posun {0} {1})", fmtN(cmd.patch.shift[0]), fmtN(cmd.patch.shift[1])) : "";
      log.push(tr("✓ upraveno {0}: {1} → {2}{3}", shortId(i), before, annLabel(res.views, next), off));
      const over = overlappingTexts(res, anns.filter((_, k) => k !== i), next);
      if (over.length) issue("overlap", tr("! text se překrývá s „{0}“", over.join("“, „")), next);
      if (outsideFrame(res, next)) issue("frame", tr("! přesahuje rámeček listu"), next);
      return done({ changed: true, open: false });
    }
    case "del": {
      const res = await computeSheet();
      const o = sheetOptions(sheet());
      const anns = sheet().annotations;
      let gone: number[];
      if (cmd.targets === "all") gone = anns.map((_, i) => i);
      else if (cmd.targets === "custom") gone = anns.flatMap((a, i) => (a.auto ? [] : [i]));
      else {
        const set = new Set<number>();
        for (const t of cmd.targets) {
          const hits = resolveAnns(res.views, anns, t);
          if (!hits.length) throw new Error(tr("„{0}“ na listu není – {1}", t, annList(res.views, anns, o)));
          hits.forEach((i) => set.add(i));
        }
        gone = [...set].sort((a, b) => a - b);
      }
      const drop = new Set(gone);
      // smazané vygenerované kóty se nevrátí při přegenerování (jako tlačítko × v seznamu kót)
      const off = [...(o.smartOff ?? []), ...gone.flatMap((i) => (anns[i].auto ? [anns[i].auto!] : []))];
      put({ ...sheet(), options: { ...o, smartOff: [...new Set(off)] } as unknown as Record<string, unknown>, annotations: anns.filter((_, i) => !drop.has(i)) });
      const what = gone.slice(0, 12).map((i) => `${shortId(i)} ${annLabel(res.views, anns[i])}`).join(", ") + (gone.length > 12 ? " …" : "");
      log.push(gone.length ? tr("✓ smazáno {0}: {1} – id dalších poznámek se posunula (výkres stav)", gone.length, what) : tr("✓ není co smazat"));
      return done({ changed: gone.length > 0, open: false });
    }
    case "detail": {
      const o = sheetOptions(sheet());
      const details: DetailView[] = [...(o.details ?? [])];
      const setDetails = (d: DetailView[]) => put({ ...sheet(), options: { ...o, details: d } as unknown as Record<string, unknown> });
      if (cmd.op === "delete") {
        if (!details.some((d) => d.label === cmd.label)) throw new Error(tr("detail {0} na listu není – detaily: {1}", cmd.label, details.map((d) => d.label).join(", ") || "—"));
        setDetails(details.filter((d) => d.label !== cmd.label));
        log.push(tr("✓ detail {0} smazán", cmd.label));
        return done({ changed: true, open: false });
      }
      const res = await computeSheet();
      const H = res.sheet.h;
      // „umístit x y odshora“ = střed od levého horního rohu listu (nezávisí na výšce listu), jinak od levého dolního
      const placeAt = (scale: number, r: number) => (cmd.place ? (((p) => [p[0] - r * scale, p[1] - r * scale])(cmd.placeTop ? cmd.place : agentToSheet(H, cmd.place)) as [number, number]) : undefined);
      let label: string;
      if (cmd.op === "edit") {
        const i = details.findIndex((d) => d.label === cmd.label);
        if (i < 0) throw new Error(tr("detail {0} na listu není – detaily: {1}", cmd.label, details.map((d) => d.label).join(", ") || "—"));
        const d = details[i];
        const scale = cmd.scale ?? d.scale;
        details[i] = { ...d, scale, at: cmd.place ? placeAt(scale, d.r) : cmd.scale !== undefined ? undefined : d.at };
        label = d.label;
      } else {
        if (cmd.view.startsWith("detail:")) throw new Error(tr("detail se vytváří z pohledu, ne z jiného detailu"));
        const v = findView(res, o, cmd.view);
        const c = agentToView(cmd.at);
        const m = Math.max(2, 0.1 * Math.max(v.w, v.h));
        if (c[0] < v.x0 - m || c[0] > v.x0 + v.w + m || c[1] < v.y0 - m || c[1] > v.y0 + v.h + m) throw new Error(tr("střed detailu {0} je mimo pohled {1} – rozsahy ukáže výkres stav", `[${fmtN(cmd.at[0])}; ${fmtN(cmd.at[1])}]`, VIEW_NAME(v.key, o)));
        const used = new Set(details.map((d) => d.label));
        label = "ABCDEFGHJKLMNPRSTUVWXYZ".split("").find((ch) => !used.has(ch)) ?? "A";
        const scale = cmd.scale ?? STANDARD_SCALES.find((x) => x <= res.scaleValue * 2) ?? res.scaleValue * 2;
        details.push({ id: uid(), label, view: v.key, cx: c[0], cy: c[1], r: cmd.r, scale, ...(cmd.place ? { at: placeAt(scale, cmd.r) } : {}) });
      }
      setDetails(details);
      // ověření: detail na listu (nebo varování, proč ne)
      const chk = await compute(doc, sheetMeta(doc, sheet(), idx, extras), sheetOptions(sheet()));
      const d = details.find((x) => x.label === label)!;
      const p = chk.details?.find((x) => x.label === label);
      const warn = chk.warnings.filter((w) => w.includes(` ${label}`));
      log.push(p ? tr("✓ detail {0} (pohled {1}, střed {2}, r {3}, {4}) – na listu x {5}…{6}, y {7}…{8}", label, VIEW_NAME(d.view, o), `[${fmtN(viewToAgent([d.cx, d.cy])[0])}; ${fmtN(viewToAgent([d.cx, d.cy])[1])}]`, fmtN(d.r), scaleLabel(d.scale), fmtN(p.x), fmtN(p.x + p.w), fmtN(H - (p.y + p.h)), fmtN(H - p.y)) : tr("⚠ detail {0} uložen, ale na listu není: {1}", label, warn.join("; ") || "—"));
      return done({ changed: true, open: true });
    }
    case "model": {
      const o = sheetOptions(sheet());
      const models: ModelView[] = [...(o.models ?? [])];
      const setModels = (m: ModelView[]) => put({ ...sheet(), options: { ...o, models: m } as unknown as Record<string, unknown> });
      const key = cmd.name.toLowerCase();
      if (cmd.op === "delete") {
        if (!models.some((m) => m.name.toLowerCase() === key)) throw new Error(tr("model „{0}“ na listu není – modely: {1}", cmd.name, models.map((m) => m.name).join(", ") || "—"));
        setModels(models.filter((m) => m.name.toLowerCase() !== key));
        log.push(tr("✓ model „{0}“ odebrán z listu", cmd.name));
        return done({ changed: true, open: false });
      }
      const i = models.findIndex((m) => m.name.toLowerCase() === key);
      if (i >= 0) {
        models[i] = { ...models[i], ...(cmd.view ? { view: cmd.view } : {}), ...(cmd.scale !== undefined ? { scale: cmd.scale } : {}) };
      } else {
        const comp = doc.kind === "assembly" ? doc.components?.find((c) => c.name.toLowerCase() === key) : undefined;
        const tab = comp ? undefined : env.tabs?.().find((t) => t.title.toLowerCase() === key && t.doc !== doc0);
        if (!comp && !tab) {
          const avail = [...(doc.components ?? []).map((c) => c.name), ...(env.tabs?.() ?? []).map((t) => t.title)];
          throw new Error(tr("„{0}“ není komponenta sestavy ani otevřená záložka – k dispozici: {1}", cmd.name, [...new Set(avail)].join(", ") || "—"));
        }
        let source: ModelView["source"];
        if (comp) source = { kind: "component", compId: comp.id };
        else {
          // do výkresu se ukládá jen geometrie dokumentu (jeho vlastní výkresy ne) – jako „Vložit model ze souboru“
          const { drawings: _d, ...rest } = JSON.parse(JSON.stringify(tab!.doc)) as CadDoc;
          void _d;
          source = { kind: "doc", doc: rest };
        }
        models.push({ id: uid(), name: comp?.name ?? tab!.title, source, view: cmd.view ?? "front", scale: cmd.scale ?? "auto" });
      }
      setModels(models);
      const m = models[i >= 0 ? i : models.length - 1];
      const chk = await compute(doc, sheetMeta(doc, sheet(), idx, extras), sheetOptions(sheet()));
      const placed = chk.models?.find((x) => x.id === m.id);
      log.push(placed ? tr("✓ model „{0}“ na listu: pohled {1}, měřítko {2}", m.name, VIEW_NAME(m.view), placed.scale) : tr("⚠ model „{0}“ uložen, ale na listu není: {1}", m.name, chk.warnings.filter((w) => w.includes(m.name)).join("; ") || "—"));
      return done({ changed: true, open: true });
    }
  }
}

/**
 * Textový stav výkresu – zpětná vazba pro agenta: aktivní list (nebo `sheet`: číslo / název / "all"), přehled listů,
 * souřadnice pohledů, kóty a značky s id, razítko a revize. Chytré kóty, které ještě nejsou na listu (změna modelu),
 * se do stavu započítají a vrátí se i upravený dokument (`doc`) k uložení. `issues` = strukturovaná hlášení listů
 * (řez mimo těleso, pohledy se nevejdou … – cad/drawing-issues.ts; `data.sheetName` = název listu).
 */
export async function drawingStatus(doc0: CadDoc, compute: DrawingCompute, opts: { sheet?: SheetRef | "all"; extras?: DrawingExtras } = {}): Promise<{ text: string; doc?: CadDoc; issues?: DrawingIssue[] }> {
  if (!doc0.features.length && !doc0.components?.length) return { text: tr("Výkres: model je prázdný – nejdřív vymodelujte díl") };
  const has = !!doc0.drawings?.length;
  const doc: CadDoc = has ? { ...doc0, drawings: [...doc0.drawings!] } : { ...doc0, drawings: [newSheet(doc0)] };
  // „vše“ = všechny listy aktivního výkresu (cad/drawing-sets.ts)
  const which = opts.sheet === "all" ? setSheets(doc, activeSheetIndex(doc)) : [opts.sheet === undefined ? activeSheetIndex(doc) : resolveSheet(doc, opts.sheet)];
  let changed = false;
  const blocks: string[] = [];
  const issues: DrawingIssue[] = [];
  for (const i of which) {
    const r = await sheetStatus(doc, i, has, compute, opts.extras, blocks.length === 0);
    changed = changed || r.changed;
    blocks.push(r.text);
    issues.push(...r.issues.map((x) => ({ ...x, sheetId: doc.drawings![i].id, data: { ...(x.data ?? {}), sheetName: doc.drawings![i].name } })));
  }
  return { text: blocks.join("\n\n"), ...(changed ? { doc } : {}), ...(issues.length ? { issues } : {}) };
}

/** Stav jednoho listu (mění `doc.drawings[idx]`, když se doplnily Chytré kóty). */
async function sheetStatus(doc: CadDoc, idx: number, has: boolean, compute: DrawingCompute, extras: DrawingExtras | undefined, first: boolean): Promise<{ text: string; changed: boolean; issues: DrawingIssue[] }> {
  const s = doc.drawings![idx];
  const o = sheetOptions(s);
  let res = await compute(doc, sheetMeta(doc, s, idx, extras), o);
  let anns = s.annotations;
  let changed = false;
  if (o.dimensions === "smart" && res.smart) {
    const m = mergeSmart(anns, o, res.smart);
    if (m) {
      anns = m.annotations;
      doc.drawings![idx] = { ...s, options: { ...o, smartGen: m.gen } as unknown as Record<string, unknown>, annotations: anns };
      changed = true;
      if (m.userLost) res = { ...res, warnings: [...res.warnings, lostEditsText(m.userLost)] };
    }
  }
  const views = res.views;
  const { pos, count: n } = sheetPos(doc, idx);
  const L: string[] = [];
  const mode = o.dimensions === "smart" ? tr("Chytré kóty ({0})", o.dimStyle === "baseline" ? tr("od základny") : tr("řetězově")) : o.dimensions === "auto" ? tr("Auto + Ø (zapečené)") : o.dimensions === "overall" ? tr("jen celkové (zapečené)") : tr("bez automatických kót");
  const where = has ? (n > 1 ? tr(" (list {0}/{1})", pos + 1, n) : "") : tr(" (zatím neuložený – výchozí volby)");
  L.push(tr("Výkres „{0}“{1}: list {2} {3} · měřítko {4} · pohledy: {5} · kóty: {6}", s.name, where, res.sheet.name, o.orientation === "portrait" ? tr("na výšku") : tr("na šířku"), res.scale, [...views.map((v) => VIEW_NAME(v.key, o)), ...(o.views.iso ? [VIEW_NAME("iso")] : [])].join(", ") || "—", mode));
  if (first) L.push(sheetsLine(doc, activeSheetIndex(doc)));
  const extra = [o.rotation ? tr("otočení {0}°", o.rotation) : "", o.section ? sectionStatusText(o.section, o.section.kind === "half" ? tr("poloviční") : tr("celý")) : "", o.bomTable === false ? tr("bez kusovníku") : "", o.balloons === false ? tr("bez balónků") : "", hasDrawnSprings(doc) ? (o.springs === "full" ? tr("pružiny plně (šroubovice)") : tr("pružiny zjednodušeně (ISO 2162-1)")) : ""].filter(Boolean);
  if (extra.length) L.push(tr("Volby: {0}", extra.join(" · ")));
  const dims = anns.filter((a) => a.type === "dim" || a.type === "callout");
  L.push(tr("Kóty a popisy ({0}, z toho vygenerovaných {1}):", dims.length, dims.filter((a) => a.auto).length));
  // ruční kóty po změně modelu (bod 20): hodnota, která je na listu (přichycená geometrie), a značka ⚠ u kóty bez geometrie
  const attach = new Map(userDimAttach(views, anns).map((x) => [x.ann, x]));
  const dimText = (a: DrawingAnnotation) => {
    const x = attach.get(a as DimAnn);
    if (!x) return annLabel(views, a) + (a.auto ? "" : " *");
    return `${attachLabel(x)} * ⚠`;
  };
  const byView = new Map<string, string[]>();
  for (const a of dims) byView.set(a.view, [...(byView.get(a.view) ?? []), dimText(a)]);
  for (const [k, list] of byView) L.push(`  ${VIEW_NAME(k, o)}: ${list.join(" · ")}`);
  if (dims.some((a) => !a.auto)) L.push(attach.size ? tr("  (* = vlastní kóta uživatele · ⚠ = po změně modelu neodpovídá geometrii – viz hlášení níže)") : tr("  (* = vlastní kóta uživatele)"));
  const others = anns.filter((a) => a.type !== "dim" && a.type !== "callout");
  if (others.length) L.push(tr("Poznámky a značky: {0}", others.map((a) => annLabel(views, a)).join(" · ")));
  if (anns.length) L.push(tr("Id (výkres upravit / smazat / značka na <id>): {0}", annList(views, anns, o)));
  const dup = dimDuplicates(views, dims);
  L.push(dup.length ? tr("Duplicity ({0}): {1}", dup.length, dup.map((g) => g.map((a) => `${annLabel(views, a)} (${VIEW_NAME(a.view, o)})`).join(" = ")).join("; ")) : tr("Duplicity: žádné"));
  const out = withAnnotations(res, anns);
  const bbox = docBbox(res);
  // kontrola kót pro výrobní úplnost (vlna 22, bod 18 – cad/dim-complete.ts): velikosti i polohy podle geometrie kót, pomocná
  // tělesa, funkční prvky; nikdy „všech N“ – sestava: jen celkové rozměry (rozměry dílů patří na výkresy dílů)
  const dc = sheetDimCheck(doc, out, anns, o);
  if (dc) L.push(dimCheckLine(dc));
  else if (o.bomOnly) L.push(tr("List jen s kusovníkem – pohledy ani kóty nemá"));
  else {
    const chk = dimCheck(doc, bbox, out.texts);
    L.push(tr("Kontrola kót: celkové rozměry {0}/{1} (sestava – rozměry dílů se kontrolují na výkresech dílů)", chk.filter((x) => x.present).length, chk.length));
  }
  if (res.smart?.report.skipped.length) L.push(tr("Vynecháno (nevešlo se nebo nejde okótovat automaticky): {0}", res.smart.report.skipped.join("; ")));
  // tabulka děr: zapnutá volbou listu, nebo ji zapnuly Chytré kóty (polohy děr tabulkou – B12)
  if (o.holeTable || res.holes?.length) L.push(holeTableLine(res, o));
  if (o.springTable) L.push(res.springTables ? tr("Tabulka pružiny: {0}× nad razítkem (EN ISO 2162-2)", res.springTables) : tr("Tabulka pružiny: v dílu není pružina z tabulky (pružina tlačná | tažná | zkrutná | talířová)"));
  // tabulka ozubení (drawing-geartable.ts): co je na listu, nebo proč tam není
  if (o.gearTable) L.push(...(gearsOf(doc).length ? gearTableStatus(gearsOf(doc)) : [tr("Tabulka ozubení: v dílu není žádné kolo – tabulka se nekreslí")]));
  // funkční rozměry, polohy děr a kontrola tolerancí (B8, B12, 5.3)
  const hm = Object.entries(res.smart?.report.holeMode ?? {});
  // režim generátoru + kolik poloh děr je na listu doopravdy (smazané kóty generátor nevrátí – bod 18)
  const hp = dc?.items.filter((q) => q.kind === "pos" && q.id.startsWith("holepos:")) ?? [];
  if (o.dimensions === "smart" && hm.length) L.push(tr("Polohy děr: {0}", hm.map(([k, m]) => `${m === "ordinate" ? tr("souřadnicové kóty od levého dolního rohu") : m === "table" ? tr("tabulka děr") : tr("kóty od hran")} (${VIEW_NAME(k, o)})`).join(" · ")) + (hp.length ? tr(" – na listu {0}/{1}", hp.filter((q) => q.status === "ok").length, hp.length) : ""));
  if (o.dimFunctional?.length) L.push(tr("Funkční rozměry: {0} · {1}", o.dimFunctional.map(fmtN3).join(", "), tolCheckLines(views, anns, o).lines[0].replace(/^[✓⚠] /, "")));
  const m = s.meta as Partial<DrawingMeta>;
  L.push(tr("U razítka: nepředepsané tolerance {0} · hrany {1} · poznámka {2}", m.tolerance?.trim() || "—", m.edges?.trim() || "—", m.note?.trim() || "—"));
  L.push(...titleLines(doc, doc.drawings![idx]));
  // volný text nad razítkem celého výkresu (vlna 23, R4) a popisy / oblastní úpravy z modelu (R2 / R3)
  L.push(notesBudgetLine(doc, setSheets(doc, idx), generatedFreeText(doc)));
  if (res.pmi?.length) L.push(tr("Z modelu: {0}", res.pmi.map((x) => `${x.kind === "treatment" ? `${x.ref ?? ""} ` : ""}F${x.face + 1} „${x.text}“ → ${x.state === "ok" ? `${VIEW_NAME(x.view ?? "", o)} (${x.how === "chain" ? tr("tlustá čerchovaná 04.2 + kóta rozsahu") : x.how === "dot" ? tr("odkaz s tečkou na ploše") : tr("odkaz se šipkou")})${x.range ? tr(" ⚠ rozsah {0}–{1} přesahuje plochu {2} mm", fmtN(x.range.from), fmtN(x.range.to), fmtN(x.range.len)) : ""}` : x.state === "lost" ? tr("⚠ plocha se změnila – nekreslí se") : tr("⚠ nevidět v žádném pohledu")}`).join(" · ")));
  // vydání listu a revize modelu, ze které list vznikl (vlna 22, bod 20 – cad/doc-outputs.ts)
  L.push(sheetIssueLine(doc, doc.drawings![idx]));
  if (o.models?.length) L.push(tr("Další modely: {0}", o.models.map((x) => `„${x.name}“ (${VIEW_NAME(x.view)}, ${x.scale === "auto" ? tr("auto") : scaleLabel(x.scale)})`).join(" · ")));
  L.push(...viewsStatusLines(res, o, anns, s.meta as Partial<DrawingMeta>));
  // pozice po pohledech, kusovník a překryvy celého listu (vlna 22, bod 17 – cad/drawing-overlaps.ts)
  const ov = sheetOverlaps(out);
  L.push(...positionLines(res, o, ov));
  L.push(...viewRangeLines(res, o));
  if (res.warnings.length) L.push(tr("Varování výkresu: {0}", res.warnings.join("; ")));
  const issues = issuesOf(res);
  // řez mimo těleso: přesný důvod a rozsah odsazení (odznak ve výkresovém prostředí je stručný)
  for (const i of issues) if (i.level === "error") L.push(issueLine(i));
  // neúplné kóty, funkční prvek bez tolerance, přetolerování (bod 18) → ⚠ / ℹ s kódem na řádku `výkres stav`
  issues.push(...dimCheckIssues(dc, { sheetId: s.id, withTol: true }));
  // vydaný list ze starší revize modelu → ⚠ drawing.stale na řádku `výkres stav` (bod 20)
  const sh = doc.drawings![idx];
  if (sheetState(doc, sh) === "stale") issues.push({ level: "warn", code: "drawing.stale", kind: "stale", text: staleSheetText(sh.name, sh.issued!, modelId(doc)) });
  // ruční kóty bez geometrie / přichycené ke změněné geometrii → ⚠ drawing.dim-detached (bod 20)
  const det = dimAttachIssue(views, anns, o, sh.id);
  if (det) issues.push(det);
  // pravidla poznámek (vlna 23, R1/R4/R5/R7) → ⚠ / ℹ na řádku `výkres stav`
  issues.push(...notesSheetIssues(doc, idx, res));
  // překryvy na listu → ⚠ drawing.overlap s počtem a radou na řádku `výkres stav` (bod 17)
  const ovText = overlapIssueText(ov);
  if (ovText) issues.push({ level: "warn", code: "drawing.overlap", kind: "sheet-overlap", text: ovText, sheetId: sh.id, data: { total: ov.total, byKind: ov.byKind, crossings: ov.crossings } });
  return { text: L.join("\n"), changed, issues };
}

/** obálka modelu z pohledů výkresu (přední + horní / boční) – pro Kontrolu kót bez další stavby */
function docBbox(res: DrawingResult): [Vec3, Vec3] | null {
  const f = res.views.find((v) => v.key === "front");
  const t = res.views.find((v) => v.key === "top");
  const l = res.views.find((v) => v.key === "left" || v.key === "right");
  if (!f) return null;
  // skutečný rozsah (přerušený pohled je na listu kratší)
  const size = (v: PlacedView) => {
    const e = viewExtent(v);
    return [e.x1 - e.x0, e.y1 - e.y0];
  };
  const W = t ? size(t)[1] : l ? size(l)[0] : 0;
  return [[0, 0, 0], [size(f)[0], W, size(f)[1]]];
}
