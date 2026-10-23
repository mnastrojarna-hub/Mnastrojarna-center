import type { JobStage } from "@/lib/supabase/database.types";
import type { CaptureDocKind, DocIssuer } from "@/lib/jobs/capture-types";
import type {
  BatchApplyState, BatchDocDraft, BatchDocType, BatchFile, BatchPage, BatchResult, BatchReviewModel, BatchSide,
  BatchSort, BatchTypeMeta, BatchWarning, BatchWarningAction, BatchWarningCode, CadFormat, DocFlag, DrawingExtract,
} from "@/lib/jobs/capture-batch-types";
import { CAPTURE_CHIPS, chipFor, isBlankReviewItem } from "@/lib/jobs/capture-review";
import { docKindToStage } from "@/lib/jobs/apply-extraction";
import { docNumbersEqual } from "@/lib/jobs/matching";
import { guessFileKind } from "@/lib/jobs/file-kinds";
import { isForward, stageMeta, stageRank } from "@/lib/jobs/stages";
import { plural } from "@/lib/jobs/deadlines";

/**
 * Dávkové focení — čistá logika sdílená serverem i klientem: druhy dokladů v dávce (meta, barvy,
 * prohození vystavitele), rozpoznání CAD formátu, normalizace roztřídění od AI, výchozí roztřídění
 * bez AI, kontrola roztřídění, stav zakázky z dokladů, texty historie a výsledku.
 */

// ── Druhy dokladů ───────────────────────────────────────────
export const BATCH_TYPE_ENUM = [
  "poptavka_zakaznik", "objednavka_zakaznik",
  "nabidka_my", "potvrzeni_my", "dodaci_list_my", "faktura_my", "objednavka_my", "poptavka_my",
  "nabidka_dodavatel", "potvrzeni_dodavatel", "dodaci_list_dodavatel", "faktura_dodavatel",
  "vykres", "foto", "ostatni",
] as const; // model_3d jen deterministicky
export const DOC_FLAG_ENUM = ["signed", "accepted", "proforma", "credit_note", "partial", "paid", "complaint"] as const;

const SWAPS: Partial<Record<BatchDocType, [BatchDocType, string]>> = {
  poptavka_zakaznik: ["poptavka_my", "Je to naše poptávka dodavateli"],
  objednavka_zakaznik: ["objednavka_my", "Je to naše objednávka dodavateli"],
  nabidka_my: ["nabidka_dodavatel", "Je to nabídka dodavatele"],
  potvrzeni_my: ["potvrzeni_dodavatel", "Je to potvrzení od dodavatele"],
  dodaci_list_my: ["dodaci_list_dodavatel", "Je to dodací list dodavatele"],
  faktura_my: ["faktura_dodavatel", "Je to faktura dodavatele"],
  objednavka_my: ["objednavka_zakaznik", "Je to objednávka zákazníka"],
  poptavka_my: ["poptavka_zakaznik", "Je to poptávka zákazníka"],
  nabidka_dodavatel: ["nabidka_my", "Je to naše nabídka"],
  potvrzeni_dodavatel: ["potvrzeni_my", "Je to naše potvrzení"],
  dodaci_list_dodavatel: ["dodaci_list_my", "Je to náš dodací list"],
  faktura_dodavatel: ["faktura_my", "Je to naše faktura"],
};

const SUPPLIER_SIDE: BatchDocType[] = [
  "objednavka_my", "poptavka_my", "nabidka_dodavatel", "potvrzeni_dodavatel", "dodaci_list_dodavatel", "faktura_dodavatel",
];

function chipMeta(key: BatchDocType): BatchTypeMeta | null {
  const chip = CAPTURE_CHIPS.find((c) => c.key === key);
  if (!chip) return null;
  const swap = SWAPS[key] ?? null;
  const form = key === "vykres" ? "drawing" : key === "ostatni" ? "file" : "business";
  const side: BatchSide = form !== "business" ? "none" : SUPPLIER_SIDE.includes(key) ? "supplier" : "customer";
  return {
    key, label: chip.label, docKind: chip.docKind, issuer: chip.issuer, side, group: chip.group,
    fileKind: chip.fileKind, form, swap: swap?.[0] ?? null, swapLabel: swap?.[1] ?? null,
  };
}

export const BATCH_TYPE_ORDER: BatchDocType[] = [
  "poptavka_zakaznik", "objednavka_zakaznik",
  "nabidka_my", "potvrzeni_my", "dodaci_list_my", "faktura_my", "objednavka_my", "poptavka_my",
  "nabidka_dodavatel", "potvrzeni_dodavatel", "dodaci_list_dodavatel", "faktura_dodavatel",
  "vykres", "model_3d", "foto", "ostatni",
];

export const BATCH_TYPES: Record<BatchDocType, BatchTypeMeta> = Object.fromEntries(
  BATCH_TYPE_ORDER.map((key): [BatchDocType, BatchTypeMeta] => {
    if (key === "model_3d") {
      return [key, {
        key, label: "3D model", docKind: null, issuer: null, side: "none", group: "ostatni",
        fileKind: "model_3d", form: "model", swap: null, swapLabel: null,
      }];
    }
    if (key === "foto") {
      return [key, {
        key, label: "Fotka", docKind: null, issuer: null, side: "none", group: "ostatni",
        fileKind: "foto", form: "file", swap: null, swapLabel: null,
      }];
    }
    return [key, chipMeta(key)!];
  }),
) as Record<BatchDocType, BatchTypeMeta>;

export function isBatchDocType(v: unknown): v is BatchDocType {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(BATCH_TYPES, v);
}

export function isDocFlag(v: unknown): v is DocFlag {
  return typeof v === "string" && (DOC_FLAG_ENUM as readonly string[]).includes(v);
}

/** Druh v dávce podle druhu dokladu a vystavitele (stejně jako chip jednoho dokladu). */
export function batchTypeFor(docKind: CaptureDocKind, issuer: DocIssuer): BatchDocType {
  return chipFor(docKind, issuer).chip.key;
}

export function sideOf(type: BatchDocType): BatchSide {
  return BATCH_TYPES[type]?.side ?? "none";
}

export function isBusinessType(type: BatchDocType): boolean {
  return BATCH_TYPES[type]?.form === "business";
}

/** Popisek do věty („objednávka zákazníka", „naše faktura"). */
export function typePhrase(type: BatchDocType): string {
  const chip = CAPTURE_CHIPS.find((c) => c.key === type);
  if (chip) return chip.accusative;
  return type === "model_3d" ? "3D model" : "fotku";
}

// ── Ceny v textech ──────────────────────────────────────────
const MONEY_RE = /\d[\d\s.,]*\s*(?:Kč|CZK|EUR|€|USD|\$|,-)/gi;

/** Bez práva na marže nesmí z textu prosáknout částky. */
export function redactPrices(text: string): string {
  return text.replace(MONEY_RE, "…");
}

// ── Soubory: CAD formát, čísla z názvu ──────────────────────
const EXT_FORMAT: Record<string, CadFormat> = {
  step: "STEP", stp: "STEP", iges: "IGES", igs: "IGES", stl: "STL", "3mf": "3MF",
  x_t: "Parasolid", x_b: "Parasolid", sldprt: "SolidWorks", sldasm: "SolidWorks",
  catpart: "CATIA", catproduct: "CATIA", prt: "NX/Creo", asm: "NX/Creo", ipt: "Inventor", iam: "Inventor",
  par: "Solid Edge", psm: "Solid Edge", jt: "JT", sat: "ACIS", "3dm": "Rhino", f3d: "Fusion",
  dxf: "DXF", dwg: "DWG",
};

/** 2D formáty (výkres), ostatní CAD = 3D model. */
export function isDrawingFormat(f: CadFormat | null): boolean {
  return f === "DXF" || f === "DWG";
}

export function fileExtension(name: string): string {
  return /\.([A-Za-z0-9_]{1,12})$/.exec(name ?? "")?.[1]?.toLowerCase() ?? "";
}

function headText(head: Uint8Array | string | null | undefined, max = 4096): string {
  if (!head) return "";
  if (typeof head === "string") return head.slice(0, max);
  let s = "";
  const n = Math.min(head.length, max);
  for (let i = 0; i < n; i++) s += String.fromCharCode(head[i]);
  return s;
}

export function isZipHead(head: Uint8Array | null | undefined): boolean {
  return Boolean(head && head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04);
}

/** CAD formát podle obsahu (prvních bajtů), jinak podle přípony. size = celá velikost (binární STL). */
export function cadFormatOf(name: string, head?: Uint8Array | string | null, size?: number): CadFormat | null {
  const text = headText(head);
  const ext = fileExtension(name);
  if (text) {
    if (text.includes("ISO-10303-21")) return "STEP";
    if (/^\s*AC10\d\d/.test(text)) return "DWG";
    if (/^\s*0\s*\r?\n\s*SECTION/.test(text)) return "DXF";
    const firstLine = text.split(/\r?\n/)[0] ?? "";
    if (firstLine.length >= 73 && firstLine.charAt(72) === "S" && /^\s*\S/.test(firstLine)) return "IGES";
    if (head && typeof head !== "string" && head.length >= 84 && typeof size === "number") {
      const count = (head[80] | (head[81] << 8) | (head[82] << 16) | (head[83] << 24)) >>> 0;
      if (count > 0 && 84 + 50 * count === size) return "STL";
    }
    if (/^solid\s/.test(text) && /facet\s+normal/.test(text)) return "STL";
    if (ext === "3mf" && head && typeof head !== "string" && isZipHead(head)) return "3MF";
  }
  return EXT_FORMAT[ext] ?? null;
}

const GENERIC_PART = /^(part|body|component|komponenta|dil|díl|soucast|součást|assembly|sestava|model|unknown|untitled|bez[-_ ]?nazvu|noname|image|img|photo|foto|scan|sken|dsc|pxl|document|dokument|drawing|vykres|výkres)[\s_-]*\d{0,4}$/i;

function cleanNumberCandidate(s: string): string {
  const t = s.replace(/_/g, "-").replace(/\s+/g, " ").replace(/^[\s.\-]+|[\s.\-]+$/g, "");
  if (t.length < 3 || t.length > 40 || (t.match(/\d/g) ?? []).length < 2 || GENERIC_PART.test(t)) return "";
  if (/^(img|dsc|pxl|scan|photo|image)[-\s]?\d+/i.test(t)) return "";
  return t;
}

/** Odstraní testovací značky „__<typ>…" a příponu. */
function baseName(name: string): string {
  return (name ?? "").replace(/\.[A-Za-z0-9_]{1,12}$/, "").replace(/__.*$/, "");
}

const REV_RE = /[\s_.-]+(?:rev(?:ize|ision)?|index|idx|änderung|aend)[\s_.-]*([A-Za-z0-9]{1,3})$/i;

/** Revize z názvu souboru („4711-02_rev_B.step" → „B"). */
export function revisionFromFilename(name: string): string {
  return REV_RE.exec(baseName(name))?.[1]?.toUpperCase() ?? "";
}

/** Číslo výkresu / dílu z názvu souboru („4711-02_rev_B.step" → „4711-02"); "" = název nic neříká. */
export function drawingNumberFromFilename(name: string): string {
  let b = baseName(name).replace(REV_RE, "");
  b = b.replace(/^(?:v[yý]kres|drawing|zeichnung|model|3d|dil|díl|part)[\s_-]+/i, "");
  b = b.replace(/[\s_-]+(?:v[yý]kres|drawing|zeichnung|model|3d)$/i, "");
  b = b.replace(/[\s_-]*(?:str|page|list|sheet)[\s_-]*\d{1,3}$/i, "");
  return cleanNumberCandidate(b);
}

/** Číslo dílu z hlavičky STEP (PRODUCT('4711-02',…) → FILE_NAME('…')). */
export function stepPartNumber(head: Uint8Array | string | null | undefined): string {
  const text = headText(head, 65536);
  if (!text) return "";
  for (const m of text.matchAll(/PRODUCT\s*\(\s*'([^']{1,120})'/gi)) {
    const n = cleanNumberCandidate(m[1]);
    if (n) return n;
  }
  const fn = /FILE_NAME\s*\(\s*'([^']{1,250})'/i.exec(text);
  if (fn) {
    const last = fn[1].split(/[\\/]/).pop() ?? "";
    return drawingNumberFromFilename(last);
  }
  return "";
}

// ── Roztřídění: klíče, kontrola ─────────────────────────────
/** Klíč stránek dokladu (vytěžení platí jen pro tytéž stránky ve stejném pořadí). */
export function pagesKey(ids: string[]): string {
  return ids.join(",");
}

/** Je roztřídění v pořádku vůči stránkám relace? null = ano, jinak česká hláška. */
export function validateBatchSort(sort: BatchSort, pages: BatchPage[]): string | null {
  if (!sort || !Array.isArray(sort.docs) || !Array.isArray(sort.excludedPageIds)) return "Chybí roztřídění dokladů.";
  const byId = new Map(pages.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const docIds = new Set<string>();
  for (const d of sort.docs) {
    if (!d || typeof d.id !== "string" || !d.id) return "Doklad bez identifikátoru.";
    if (docIds.has(d.id)) return "Dva doklady mají stejný identifikátor.";
    docIds.add(d.id);
    if (!isBatchDocType(d.type)) return "Neznámý druh dokladu.";
    if (!Array.isArray(d.pageIds) || !d.pageIds.length) return "Doklad nemá žádnou stránku.";
    let filePages = 0;
    for (const id of d.pageIds) {
      const p = byId.get(id);
      if (!p) return "Stránka nepatří k této dávce.";
      if (seen.has(id)) return "Stránka je ve dvou dokladech.";
      seen.add(id);
      if (p.source === "file") filePages++;
    }
    if (filePages && d.pageIds.length > 1) return "Soubor bez náhledu (CAD, Excel…) musí být samostatný doklad.";
    if (BATCH_TYPES[d.type].form === "model" && filePages !== 1) return "3D model musí být samostatný soubor.";
  }
  for (const id of sort.excludedPageIds) {
    if (!byId.has(id)) return "Stránka nepatří k této dávce.";
    if (seen.has(id)) return "Vyřazená stránka je zároveň v dokladu.";
    seen.add(id);
  }
  if (seen.size !== pages.length) return "Některá stránka není zařazená do žádného dokladu.";
  return null;
}

// ── Revize výkresu ──────────────────────────────────────────
/** Pořadí revize (A < B < … < Z < AA; čísla číselně); null = nejde porovnat. */
export function revisionRank(rev: string): [number, number] | null {
  const r = rev.trim().toUpperCase().replace(/^REV\.?\s*/, "");
  if (/^\d{1,6}$/.test(r)) return [0, Number(r)];
  if (/^[A-Z]{1,3}$/.test(r)) return [1, [...r].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)];
  return null;
}

/** Je revize `next` novější než `prev`? (obě neprázdné a porovnatelné) */
export function isNewerRevision(next: string, prev: string): boolean {
  const a = revisionRank(next);
  const b = revisionRank(prev);
  return Boolean(a && b && a[0] === b[0] && a[1] > b[1]);
}

// ── Stav zakázky z dokladů ──────────────────────────────────
/** Nejvyšší posun stavu z dokladů skupiny (jen dopředu; proforma, dobropis, dílčí dodávka neposouvají). */
export function batchStage(
  // paidComplete = BusinessDocState.paidComplete; partialConfirmed = advancePurchaseOrder u DL dodavatele s `partial`
  docs: { type: BatchDocType; flags: DocFlag[]; paidComplete?: boolean; partialConfirmed?: boolean }[],
  target: { mode: "existing" | "new"; stage: JobStage | null },
): JobStage | "keep" {
  let best: JobStage | null = null;
  for (const d of docs) {
    const meta = BATCH_TYPES[d.type];
    if (!meta || meta.form !== "business" || !meta.docKind || !meta.issuer) continue;
    const flags = d.flags ?? [];
    if (meta.docKind === "faktura" && (flags.includes("proforma") || flags.includes("credit_note"))) continue;
    if (d.type === "dodaci_list_dodavatel" && flags.includes("partial") && !d.partialConfirmed) continue;
    let st = docKindToStage(meta.docKind, meta.issuer);
    if (d.type === "faktura_my" && d.paidComplete) st = "dokonceno";
    if (!st) continue;
    if (!best || stageRank(st) > stageRank(best)) best = st;
  }
  if (target.mode === "new") return best ?? "poptavka";
  if (!best || !target.stage) return "keep";
  return isForward(target.stage, best) ? best : "keep";
}

// ── Texty ───────────────────────────────────────────────────
function lowerFirst(s: string): string {
  return s ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

function docPhrase(d: { type: BatchDocType; documentNumber?: string }): string {
  const num = (d.documentNumber ?? "").trim();
  const label = d.type === "vykres" || d.type === "model_3d" || d.type === "foto" ? BATCH_TYPES[d.type].label : typePhrase(d.type);
  return `${lowerFirst(label)}${num ? ` ${num}` : ""}`;
}

/** Souhrnná událost skupiny („Vyfocena dávka 4 dokladů: objednávka zákazníka PO-4471, výkres 4711-02…"). */
export function batchEventMessage(args: {
  docs: { type: BatchDocType; documentNumber?: string }[];
  aiUsed: boolean;
  auto?: boolean;
}): string {
  const n = args.docs.length;
  const list = args.docs.slice(0, 8).map(docPhrase);
  if (n > 8) list.push(`a ${n - 8} ${plural(n - 8, "další", "další", "dalších")}`);
  const head = args.aiUsed
    ? `AI roztřídila vyfocenou dávku ${n} ${plural(n, "dokladu", "dokladů", "dokladů")}`
    : `Vyfocena dávka ${n} ${plural(n, "dokladu", "dokladů", "dokladů")} (vyplněno ručně)`;
  return `${head}${list.length ? `: ${list.join(", ")}` : ""}${args.auto ? " — uloženo automaticky" : ""}`;
}

function savedWord(n: number): string {
  return `${plural(n, "Uložen", "Uloženy", "Uloženo")} ${n} ${plural(n, "doklad", "doklady", "dokladů")}`;
}

/**
 * Kolik skutečných zakázek skupiny dají: různé cíle (existující zakázka), „new" / nevybraný cíl = každá
 * skupina zvlášť. Dvě skupiny do stejné zakázky = 1 zakázka.
 */
export function distinctJobCount(groups: { job: { targetKey: string } }[]): number {
  const seen = new Set<string>();
  let n = 0;
  for (const g of groups) {
    const k = g.job.targetKey;
    if (!k || k === "new") n++;
    else if (!seen.has(k)) {
      seen.add(k);
      n++;
    }
  }
  return n;
}

/** Nadpis obrazovky Hotovo („Uloženo 6 dokladů k zakázce Z-2026-031 · stav Vyfakturováno"). */
export function batchResultHeadline(r: Pick<BatchResult, "groups" | "docs">): string {
  const saved = r.docs.filter((d) => d.ok && d.skipped !== "excluded").length;
  // skupiny uložené do stejné zakázky = jedna zakázka (počítají se různá jobId)
  const groups: BatchResult["groups"] = [];
  for (const g of r.groups) {
    if (!g.ok || !g.jobNumber) continue;
    const same = groups.findIndex((x) => (x.jobId && x.jobId === g.jobId) || (!x.jobId && !g.jobId && x.jobNumber === g.jobNumber));
    if (same < 0) groups.push(g);
    else groups[same] = { ...groups[same], created: groups[same].created || g.created, stageTo: groups[same].stageTo ?? g.stageTo };
  }
  if (!saved && !groups.length) return "Nic se neuložilo";
  if (groups.length <= 1) {
    const g = groups[0];
    const parts: string[] = [];
    if (!g) parts.push(savedWord(saved));
    else if (g.created) parts.push(`Založena zakázka ${g.jobNumber}`, lowerFirst(savedWord(saved)));
    else parts.push(`${savedWord(saved)} k zakázce ${g.jobNumber}`);
    const stage = g?.stageTo ?? null;
    if (stage) parts.push(`stav ${stageMeta(stage).label}`);
    return parts.join(" · ");
  }
  const created = groups.filter((g) => g.created).length;
  const head = `${savedWord(saved)} ke ${groups.length} ${plural(groups.length, "zakázce", "zakázkám", "zakázkám")}`;
  return created ? `${head} · ${created === 1 ? "1 nová zakázka" : `${created} ${plural(created, "nová zakázka", "nové zakázky", "nových zakázek")}`}` : head;
}

/** Souhrn nad „Uložit vše" („2 zakázky · 6 dokladů · + nový zákazník Kovo Plus · + 3 položky · …"). */
export function batchSummaryLine(review: BatchReviewModel, state: BatchApplyState): string {
  const active = state.sort.docs.filter((d) => !d.excluded);
  const excluded = state.sort.docs.filter((d) => d.excluded).length;
  const groups = state.groups.filter((g) => g.docIds.some((id) => active.some((d) => d.id === id)));
  const parts: string[] = [];
  const jobs = distinctJobCount(groups);
  parts.push(`${jobs} ${plural(jobs, "zakázka", "zakázky", "zakázek")}`);
  parts.push(`${active.length} ${plural(active.length, "doklad", "doklady", "dokladů")}`);
  // mazání a změny stavu hned na začátku (na mobilu se konec řádku ořízne)
  if (excluded) parts.push(`vyřazeno ${excluded} (smaže se)`);
  for (const g of groups) {
    if (g.job.stage === "keep") continue;
    const rg = review.groups.find((x) => x.key === g.key);
    const target = rg?.model.targets.find((t) => t.key === g.job.targetKey);
    const name = target?.number ?? (g.job.targetKey === "new" ? "nové zakázky" : "zakázky");
    parts.push(`stav ${name} → ${stageMeta(g.job.stage).label}`);
  }
  for (const g of groups) {
    if (g.job.customer.mode === "new" && g.job.customer.party.name.trim()) parts.push(`+ nový zákazník ${g.job.customer.party.name.trim()}`);
  }
  let items = groups.reduce((s, g) => s + g.job.items.filter((i) => !isBlankReviewItem(i)).length, 0);
  let quotes = 0;
  let pending = 0;
  let archive = 0;
  for (const d of active) {
    const st = state.docs[d.id];
    if (!st) continue;
    if (st.kind === "drawing") {
      if (st.state.link.mode === "add" && st.state.onDuplicate !== "skip") items++;
      if (st.state.archive && st.state.drawingNumber.trim() && st.state.onDuplicate !== "skip") archive++;
    }
    if (st.kind === "model" && st.state.link.mode === "add" && st.state.onDuplicate !== "skip") items++;
    if (st.kind === "business" && st.state.type === "nabidka_dodavatel" && !st.state.fileOnly && st.state.onDuplicate !== "skip") {
      if (review.margins) quotes++;
      else pending++;
    }
  }
  if (items) parts.push(`+ ${items} ${plural(items, "položka", "položky", "položek")}`);
  if (quotes) parts.push(`${quotes} ${plural(quotes, "nabídka dodavatele", "nabídky dodavatelů", "nabídek dodavatelů")} → Nákup`);
  if (pending) parts.push(`${pending} ${plural(pending, "nabídka dodavatele čeká", "nabídky dodavatelů čekají", "nabídek dodavatelů čeká")} na zapsání do Nákupu`);
  if (archive) parts.push(`${archive} ${plural(archive, "výkres", "výkresy", "výkresů")} do archivu`);
  return parts.join(" · ");
}

// ── Upozornění ──────────────────────────────────────────────
export function makeWarning(
  code: BatchWarningCode,
  severity: BatchWarning["severity"],
  docIds: string[],
  message: string,
  actions: BatchWarningAction[] = [],
  groupKey: string | null = null,
): BatchWarning {
  return { id: `${code}:${docIds.join(",")}`, code, severity, docIds, groupKey, message, actions };
}

/** Jedinečná id upozornění (stejný kód a doklady → přípona #n). */
export function uniqueWarnings(list: BatchWarning[]): BatchWarning[] {
  const seen = new Map<string, number>();
  return list.map((w) => {
    const n = seen.get(w.id) ?? 0;
    seen.set(w.id, n + 1);
    return n ? { ...w, id: `${w.id}#${n + 1}` } : w;
  });
}

// ── Doklady ze souborů bez náhledu ──────────────────────────
export function blankDraft(id: string, type: BatchDocType, pageIds: string[]): BatchDocDraft {
  return {
    id, type, pageIds, aiType: null, confidence: null, reason: "", title: "", documentNumber: "", partyName: "",
    drawingNumbers: [], format: null, flags: [], issuerCheck: "unknown", excluded: false,
  };
}

/** Doklad ze souboru bez náhledu (CAD → model / výkres, jinak „Jiné"). */
export function fileDocDraft(
  id: string,
  file: BatchFile,
  page: BatchPage,
  link?: { drawingNumber: string; revision: string } | null,
  headNumber?: string,
): BatchDocDraft {
  const format = file.format ?? cadFormatOf(file.filename);
  const type: BatchDocType = format ? (isDrawingFormat(format) ? "vykres" : "model_3d") : "ostatni";
  const number = link?.drawingNumber || headNumber || (format ? drawingNumberFromFilename(file.filename) : "");
  const d = blankDraft(id, type, [page.id]);
  d.format = format;
  d.documentNumber = type === "ostatni" ? "" : number;
  d.drawingNumbers = number ? [number] : [];
  d.title = type === "model_3d"
    ? `3D model${number ? ` ${number}` : ""}${format ? ` (${format})` : ""}`
    : type === "vykres" ? `Výkres${number ? ` ${number}` : ""}${format ? ` (${format})` : ""}` : file.filename;
  return d;
}

/** Výchozí druh obrázku / PDF podle názvu souboru (bez AI). */
function nameKindType(filename: string): BatchDocType | null {
  const k = guessFileKind(filename);
  switch (k) {
    case "poptavka": return "poptavka_zakaznik";
    case "objednavka": return "objednavka_zakaznik";
    case "nabidka": return "nabidka_my";
    case "potvrzeni": return "potvrzeni_my";
    case "dodaci_list": return "dodaci_list_my";
    case "faktura": return "faktura_my";
    case "vykres": return "vykres";
    default: return null;
  }
}

/**
 * Roztřídění bez AI: manual = fotky a PDF jako 1 doklad (ledaže názvy souborů říkají různé druhy),
 * ai_failed = 1 soubor = 1 doklad. Soubory bez náhledu vždy samostatně.
 */
export function defaultSortWithoutAi(
  files: BatchFile[],
  pages: BatchPage[],
  mode: "manual" | "ai_failed",
  opts: { expectedType?: BatchDocType | null } = {},
): BatchSort {
  const docs: BatchDocDraft[] = [];
  let n = 0;
  const nextId = () => `d${++n}`;
  const visualFiles = files.filter((f) => pages.some((p) => p.fileId === f.id && p.source !== "file"));
  const pagesOf = (f: BatchFile) => pages.filter((p) => p.fileId === f.id).map((p) => p.id);

  if (mode === "ai_failed") {
    for (const f of visualFiles) {
      const type = nameKindType(f.filename) ?? opts.expectedType ?? "ostatni";
      const d = blankDraft(nextId(), type, pagesOf(f));
      d.title = f.filename;
      docs.push(d);
    }
  } else {
    const kinds = visualFiles.map((f) => nameKindType(f.filename));
    const distinct = [...new Set(kinds.filter((k): k is BatchDocType => k !== null))];
    if (distinct.length >= 2) {
      const byType = new Map<BatchDocType, BatchDocDraft>();
      visualFiles.forEach((f, i) => {
        const type = kinds[i] ?? distinct[0];
        let d = byType.get(type);
        if (!d) {
          d = blankDraft(nextId(), type, []);
          d.title = f.filename;
          byType.set(type, d);
          docs.push(d);
        }
        d.pageIds.push(...pagesOf(f));
      });
    } else if (visualFiles.length) {
      const type = opts.expectedType ?? distinct[0] ?? "ostatni";
      const d = blankDraft(nextId(), type, visualFiles.flatMap(pagesOf));
      d.title = visualFiles[0].filename;
      docs.push(d);
    }
  }
  for (const p of pages) {
    if (p.source !== "file") continue;
    const f = files.find((x) => x.id === p.fileId);
    if (f) docs.push(fileDocDraft(nextId(), f, p));
  }
  return { docs, excludedPageIds: [] };
}

// ── Kontrola vystavitele (IČO) ──────────────────────────────
function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D+/g, "");
}

export interface IssuerContext {
  ourIco: string;
  customerIcos: string[];
  supplierIcos: string[];
}

/**
 * Deterministická kontrola vystavitele podle IČO: vystavitel = my → naše doklady; adresát = my →
 * vystavil zákazník / dodavatel (podle adresářů, jinak dle druhu). suggested = druh, který IČO sedí.
 */
export function checkIssuer(
  type: BatchDocType,
  issuerIco: string,
  recipientIco: string,
  ctx: IssuerContext,
): { check: "ok" | "mismatch" | "unknown"; suggested: BatchDocType | null } {
  const meta = BATCH_TYPES[type];
  if (!meta || meta.form !== "business" || !meta.docKind || !meta.issuer) return { check: "unknown", suggested: null };
  const ours = digits(ctx.ourIco);
  const iss = digits(issuerIco);
  const rec = digits(recipientIco);
  const isCustomer = Boolean(iss) && iss !== ours && ctx.customerIcos.some((x) => digits(x) === iss);
  const isSupplier = Boolean(iss) && iss !== ours && ctx.supplierIcos.some((x) => digits(x) === iss);
  let expected: DocIssuer | "jiny" | null = null;
  if (ours && iss === ours) expected = "my";
  else if (isSupplier && !isCustomer) expected = "dodavatel";
  else if (isCustomer && !isSupplier) expected = "zakaznik";
  else if ((ours && rec === ours) || isCustomer || isSupplier) expected = "jiny";
  if (!expected) return { check: "unknown", suggested: null };
  const actual = meta.issuer;
  const ok = expected === "jiny" ? actual !== "my" : actual === expected;
  if (ok) return { check: "ok", suggested: null };
  const want: DocIssuer = expected !== "jiny"
    ? expected
    : meta.docKind === "poptavka" || meta.docKind === "objednavka" ? "zakaznik" : "dodavatel";
  const exact = CAPTURE_CHIPS.find((c) => c.docKind === meta.docKind && c.issuer === want);
  return { check: "mismatch", suggested: exact && exact.key !== type ? exact.key : null };
}

// ── Normalizace roztřídění od AI ────────────────────────────
export interface RawClassifiedDoc {
  pages: number[];
  type: string;
  title: string;
  documentNumber: string;
  partyName: string;
  issuerName: string;
  issuerIco: string;
  recipientIco: string;
  drawingNumbers: string[];
  flags: string[];
  confidence: number;
  reason: string;
  continuesPrevious: boolean;
}
export interface RawClassification {
  documents: RawClassifiedDoc[];
  fileLinks: { file: number; drawingNumber: string; revision: string }[];
  ignoredPages: number[];
  duplicatePages: { page: number; sameAs: number }[];
  pageLabels: { page: number; label: string }[];
  notes: string[];
}

export interface NormalizeContext extends IssuerContext {
  /** Stránky poslané AI v pořadí S1…Sn (pageId). */
  sentPageIds: string[];
  /** Stránky nad limit (neroztříděné). */
  truncatedPageIds?: string[];
  margins: boolean;
  /** Číslo dílu z hlavičky STEP podle fileId. */
  headNumbers?: Record<string, string>;
}

function str(v: unknown, max = 300): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function intList(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === "number" && Number.isInteger(x)) : [];
}

const DOC_NUMBER_RE = /^[A-Za-z0-9/._-]{1,40}$/;

/** Číslo dokladu z AI (jen bezpečné znaky). */
export function safeDocNumber(v: unknown): string {
  const s = str(v, 60).replace(/\s+/g, "");
  return DOC_NUMBER_RE.test(s) ? s : "";
}

export function coerceClassification(raw: unknown): RawClassification {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]) : []);
  const obj = (x: unknown) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});
  return {
    documents: arr("documents").map((x) => {
      const d = obj(x);
      return {
        pages: intList(d.pages),
        type: str(d.type, 40),
        title: str(d.title, 200),
        documentNumber: str(d.documentNumber, 80),
        partyName: str(d.partyName, 200),
        issuerName: str(d.issuerName, 200),
        issuerIco: str(d.issuerIco, 30),
        recipientIco: str(d.recipientIco, 30),
        drawingNumbers: (Array.isArray(d.drawingNumbers) ? d.drawingNumbers : []).map((s) => str(s, 80)).filter(Boolean),
        flags: (Array.isArray(d.flags) ? d.flags : []).map((s) => str(s, 30)),
        confidence: typeof d.confidence === "number" && Number.isFinite(d.confidence) ? d.confidence : 0,
        reason: str(d.reason, 300),
        continuesPrevious: d.continuesPrevious === true,
      };
    }),
    fileLinks: arr("fileLinks").map((x) => {
      const d = obj(x);
      return { file: typeof d.file === "number" ? d.file : 0, drawingNumber: str(d.drawingNumber, 80), revision: str(d.revision, 20) };
    }),
    ignoredPages: intList(o.ignoredPages),
    duplicatePages: arr("duplicatePages").map((x) => {
      const d = obj(x);
      return { page: typeof d.page === "number" ? d.page : 0, sameAs: typeof d.sameAs === "number" ? d.sameAs : 0 };
    }),
    pageLabels: arr("pageLabels").map((x) => {
      const d = obj(x);
      return { page: typeof d.page === "number" ? d.page : 0, label: str(d.label, 200) };
    }),
    notes: arr("notes").map((s) => str(s, 300)).filter(Boolean),
  };
}

function clamp01(n: number): number {
  return Math.round(Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0)) * 1000) / 1000;
}

/**
 * Roztřídění od AI → BatchSort + upozornění. Strany mimo rozsah se zahodí, strana ve dvou dokladech
 * patří prvnímu, přefocené strany se vyřadí (lze vrátit), nezařazené → „Nezařazené strany",
 * prázdné → vyřazený doklad. Vystavitel se ověří přes IČO, bez práva na marže bez cen v textech.
 */
export function normalizeClassification(
  rawInput: unknown,
  pages: BatchPage[],
  files: BatchFile[],
  ctx: NormalizeContext,
): { sort: BatchSort; pages: BatchPage[]; warnings: BatchWarning[] } {
  const raw = coerceClassification(rawInput);
  const sIds = ctx.sentPageIds;
  const pageOfS = (s: number): string | null => (s >= 1 && s <= sIds.length ? sIds[s - 1] : null);
  const outPages = pages.map((p) => ({ ...p }));
  const pageById = new Map(outPages.map((p) => [p.id, p]));
  const warnings: BatchWarning[] = [];
  const docs: BatchDocDraft[] = [];
  const used = new Set<string>();
  const excludedPageIds: string[] = [];
  let n = 0;
  const nextId = () => `d${++n}`;

  for (const l of raw.pageLabels) {
    const id = pageOfS(l.page);
    const p = id ? pageById.get(id) : null;
    if (p && l.label) p.aiLabel = redactPrices(l.label).slice(0, 80);
  }

  // přefocené strany (vyřazené, lze vrátit)
  for (const dp of raw.duplicatePages) {
    const id = pageOfS(dp.page);
    const same = pageOfS(dp.sameAs);
    if (!id || !same || id === same || used.has(id)) continue;
    const p = pageById.get(id)!;
    p.duplicateOf = same;
    used.add(id);
    excludedPageIds.push(id);
    warnings.push(makeWarning(
      "sort_uncertain", "info", [],
      `2× stejná stránka (${p.label}) — ponechána první, druhá vyřazena.`,
      [{ kind: "restore_page", label: "Vrátit", pageId: id }],
    ));
  }

  for (const rd of raw.documents) {
    const ids: string[] = [];
    for (const s of rd.pages) {
      const id = pageOfS(s);
      if (!id || used.has(id) || ids.includes(id)) continue;
      ids.push(id);
    }
    if (!ids.length) continue;
    ids.forEach((id) => used.add(id));
    let type: BatchDocType = isBatchDocType(rd.type) && rd.type !== "model_3d" ? rd.type : "ostatni";
    const flags = [...new Set(rd.flags.filter(isDocFlag))];
    const d = blankDraft(nextId(), type, ids);
    d.aiType = type;
    d.confidence = clamp01(rd.confidence);
    d.documentNumber = safeDocNumber(rd.documentNumber);
    d.partyName = redactPrices(rd.partyName).slice(0, 120);
    d.title = redactPrices(rd.title).slice(0, 120);
    d.reason = redactPrices(rd.reason).slice(0, 200);
    d.drawingNumbers = [...new Set(rd.drawingNumbers.map(safeDocNumber).filter(Boolean))].slice(0, 30);
    d.flags = flags;
    if (type === "vykres") {
      // firma z razítka výkresu = kdo kreslil, ne zákazník → ani strana, ani v názvu
      d.partyName = "";
      d.title = drawingTitle(d.title, [rd.partyName, rd.issuerName], d.drawingNumbers.length ? d.drawingNumbers : [d.documentNumber]);
    }
    if (type === "nabidka_my" && flags.includes("accepted")) {
      type = "objednavka_zakaznik";
      d.type = type;
      d.aiType = type;
      warnings.push(makeWarning("sort_uncertain", "info", [d.id], "Potvrzená naše nabídka — bráno jako objednávka."));
    }
    const issuer = checkIssuer(type, rd.issuerIco, rd.recipientIco, ctx);
    d.issuerCheck = issuer.check;
    if (issuer.check === "mismatch") {
      const actions: BatchWarningAction[] = issuer.suggested
        ? [{ kind: "set_type", label: `→ ${BATCH_TYPES[issuer.suggested].label}`, docId: d.id, type: issuer.suggested }]
        : [];
      warnings.push(makeWarning(
        "issuer_mismatch", "warn", [d.id],
        `Podle IČO vystavitele to nevypadá na „${BATCH_TYPES[type].label}" — zkontroluj, kdo doklad vystavil.`,
        actions,
      ));
    }
    if (flags.includes("complaint")) {
      warnings.push(makeWarning("complaint", "info", [d.id], "Vypadá to na reklamaci — zkontroluj doklad (stav zakázky se nemění)."));
    }
    if (!ctx.margins && sideOf(type) === "supplier") {
      d.title = [BATCH_TYPES[type].label, d.documentNumber].filter(Boolean).join(" ") + (d.partyName ? ` · ${d.partyName}` : "");
      d.reason = "";
    }
    docs.push(d);
  }

  // nedělitelné PDF drží pohromadě (všechny jeho strany do prvního dokladu)
  for (const f of files) {
    if (f.splittable || f.pageCount < 2) continue;
    const fp = outPages.filter((p) => p.fileId === f.id).map((p) => p.id);
    const holders = docs.filter((d) => d.pageIds.some((id) => fp.includes(id)));
    if (holders.length < 2) continue;
    const first = holders[0];
    for (const h of holders.slice(1)) {
      first.pageIds.push(...h.pageIds.filter((id) => !first.pageIds.includes(id)));
      h.pageIds = [];
    }
    warnings.push(makeWarning("sort_uncertain", "info", [first.id], `${f.filename} nejde rozdělit — strany zůstaly v jednom dokladu.`));
  }

  // duplicitní doklady (stejný druh a číslo)
  const kept = docs.filter((d) => d.pageIds.length);
  kept.forEach((d, i) => {
    if (!d.documentNumber) return;
    const prev = kept.slice(0, i).find((x) => x.type === d.type && docNumbersEqual(x.documentNumber, d.documentNumber));
    if (!prev) return;
    warnings.push(makeWarning(
      "duplicate_doc", "warn", [d.id, prev.id],
      `${BATCH_TYPES[d.type].label} ${d.documentNumber} je v dávce dvakrát.`,
      [{ kind: "exclude_doc", label: "Vyřadit duplicitu", docId: d.id }],
    ));
  });

  // prázdné / nečitelné strany → vyřazený doklad
  const ignored = raw.ignoredPages.map(pageOfS).filter((id): id is string => Boolean(id) && !used.has(id as string));
  if (ignored.length) {
    ignored.forEach((id) => used.add(id));
    const d = blankDraft(nextId(), "ostatni", ignored);
    d.title = "Prázdné strany";
    d.excluded = true;
    d.reason = "AI je vyhodnotila jako prázdné nebo nečitelné.";
    kept.push(d);
  }

  // nezařazené poslané strany
  const unassigned = sIds.filter((id) => !used.has(id));
  if (unassigned.length) {
    unassigned.forEach((id) => used.add(id));
    const d = blankDraft(nextId(), "ostatni", unassigned);
    d.title = "Nezařazené strany";
    kept.push(d);
    warnings.push(makeWarning("sort_uncertain", "warn", [d.id], `AI nezařadila ${unassigned.length} ${plural(unassigned.length, "stránku", "stránky", "stránek")} — zkontroluj je.`));
  }

  // strany nad limit
  const truncated = (ctx.truncatedPageIds ?? []).filter((id) => !used.has(id));
  if (truncated.length) {
    truncated.forEach((id) => used.add(id));
    const d = blankDraft(nextId(), "ostatni", truncated);
    d.title = "Nezařazené strany";
    kept.push(d);
    warnings.push(makeWarning(
      "pages_truncated", "warn", [d.id],
      `AI roztřídila prvních ${sIds.length} stran — zbylých ${truncated.length} je v dokladu „Nezařazené strany".`,
    ));
  }

  // zbylé stránky: soubory bez náhledu (CAD, kancelář) a nečitelné fotky / PDF — 1 soubor = 1 doklad
  const links = new Map<string, { drawingNumber: string; revision: string }>();
  for (const l of raw.fileLinks) {
    const f = files[l.file - 1];
    const num = safeDocNumber(l.drawingNumber);
    if (f && num) links.set(f.id, { drawingNumber: num, revision: safeDocNumber(l.revision) });
  }
  for (const f of files) {
    const fp = outPages.filter((p) => p.fileId === f.id && !used.has(p.id));
    if (!fp.length) continue;
    fp.forEach((p) => used.add(p.id));
    if (fp.length === 1 && fp[0].source === "file") {
      kept.push(fileDocDraft(nextId(), f, fp[0], links.get(f.id), ctx.headNumbers?.[f.id]));
      continue;
    }
    const type = nameKindType(f.filename) ?? "ostatni";
    const d = blankDraft(nextId(), type, fp.map((p) => p.id));
    d.title = f.filename;
    d.reason = f.aiSkipReason ?? "";
    kept.push(d);
  }

  return { sort: { docs: kept, excludedPageIds }, pages: outPages, warnings: uniqueWarnings(warnings) };
}

/**
 * Název výkresu bez firmy z razítka (projekce, která kreslila): firma se z názvu od AI vyjme,
 * prázdný název = „Výkres <čísla>".
 */
export function drawingTitle(title: string, firms: string[], numbers: string[]): string {
  let t = String(title ?? "");
  for (const f of firms.map((x) => String(x ?? "").trim()).filter((x) => x.length >= 3)) {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // jen celé slovo („KOVO" nesmaže „Kovový držák")
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "giu"), " ");
  }
  t = t.replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").replace(/^[\s·,;:–-]+|[\s·,;:–(-]+$/g, "").trim();
  const nums = numbers.filter(Boolean);
  if (!t || /^(výkres|drawing|zeichnung)$/i.test(t)) return `Výkres${nums.length ? ` ${nums.join(" / ")}` : ""}`;
  return t.slice(0, 120);
}

// ── Balík (ZIP, později e-mail s přílohami) ─────────────────
/** Balík souboru: explicitní (e-mail…), jinak ZIP, ze kterého pochází; null = samostatný soubor. */
export function fileBundleKey(f: Pick<BatchFile, "fromZip"> & { bundle?: string | null }): string | null {
  if (f.bundle) return f.bundle;
  return f.fromZip ? `zip:${f.fromZip}` : null;
}

/** Balík dokladu = společný balík všech souborů jeho stránek (smíšený doklad = null). */
export function bundleKeyOf(files: (Pick<BatchFile, "fromZip"> & { bundle?: string | null })[]): string | null {
  if (!files.length) return null;
  const keys = new Set(files.map(fileBundleKey));
  if (keys.size !== 1) return null;
  return [...keys][0] ?? null;
}

// ── Výkres ──────────────────────────────────────────────────
/** Čísla výkresu (bez mezer navíc, max. 80 znaků, bez duplicit; 1. = hlavní). */
export function cleanDrawingNumbers(list: unknown[]): string[] {
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string") continue;
    const n = v.replace(/\s+/g, " ").trim().slice(0, 80);
    if (!n || out.some((x) => docNumbersEqual(x, n))) continue;
    out.push(n);
    if (out.length >= 10) break;
  }
  return out;
}

/** Všechna čísla výkresu (i ze starších vytěžení bez drawingNumbers). */
export function drawingNumbersOf(dr: Pick<DrawingExtract, "drawingNumber" | "drawingNumbers"> | null | undefined): string[] {
  if (!dr) return [];
  return cleanDrawingNumbers([dr.drawingNumber, ...(dr.drawingNumbers ?? [])]);
}

const DRAWING_STR_KEYS = [
  "drawingNumber", "revision", "title", "material", "dimensions", "generalTolerance", "tightestTolerance",
  "surface", "heatTreatment", "surfaceTreatment", "customerName", "drawingDate", "sheet", "scale", "notes", "summary",
] as const;

export function emptyDrawing(): DrawingExtract {
  return {
    drawingNumber: "", revision: "", title: "", material: "", dimensions: "", weightKg: 0,
    generalTolerance: "", tightestTolerance: "", surface: "", heatTreatment: "", surfaceTreatment: "",
    quantity: 0, customerName: "", drawingDate: "", sheet: "", scale: "", notes: "", summary: "",
    confidence: 0, needsClarification: [], drawingNumbers: [], customerOrderNumber: "", ourQuoteNumber: "",
  };
}

function isoDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (m) return v;
  const cz = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(v);
  if (cz) return `${cz[3]}-${cz[2].padStart(2, "0")}-${cz[1].padStart(2, "0")}`;
  return "";
}

function nonNeg(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(",", ".").replace(/[^\d.]/g, "")) : 0;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : 0;
}

/** Výstup čtení výkresu → úplný, uklizený DrawingExtract. */
export function normalizeDrawing(raw: unknown): DrawingExtract {
  let input = raw;
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { input = {}; }
  }
  const o = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const out = emptyDrawing();
  for (const k of DRAWING_STR_KEYS) {
    const max = k === "notes" || k === "summary" ? 1000 : 200;
    out[k] = typeof o[k] === "string" ? (o[k] as string).replace(/\s+/g, " ").trim().slice(0, max) : "";
  }
  out.drawingNumbers = cleanDrawingNumbers([out.drawingNumber, ...(Array.isArray(o.drawingNumbers) ? o.drawingNumbers : [])]);
  out.drawingNumber = (out.drawingNumber || out.drawingNumbers[0] || "").slice(0, 80);
  out.customerOrderNumber = safeDocNumber(o.customerOrderNumber);
  out.ourQuoteNumber = safeDocNumber(o.ourQuoteNumber);
  out.revision = out.revision.replace(/^(?:rev(?:ize|ision)?|index|idx)\.?\s*/i, "").slice(0, 20);
  out.drawingDate = isoDate(out.drawingDate);
  out.weightKg = nonNeg(o.weightKg);
  out.quantity = nonNeg(o.quantity);
  out.confidence = clamp01(typeof o.confidence === "number" ? o.confidence : 0);
  out.needsClarification = (Array.isArray(o.needsClarification) ? o.needsClarification : [])
    .filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 20);
  return out;
}

// ── Deterministické UUID (SHA-1) ────────────────────────────
/** SHA-1 (hex) — synchronně, bez Node crypto (modul sdílí i prohlížeč). */
export function sha1Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const ml = bytes.length * 8;
  const withPad = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  withPad.set(bytes);
  withPad[bytes.length] = 0x80;
  const view = new DataView(withPad.buffer);
  view.setUint32(withPad.length - 4, ml >>> 0);
  view.setUint32(withPad.length - 8, Math.floor(ml / 2 ** 32));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = (x << 1) | (x >>> 31);
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = (b << 30) | (b >>> 2); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
}

/** UUID odvozené z relace, dokladu a části (opakované uložení = stejná cesta souboru). */
export function captureUuid(captureId: string, docId: string, part: string | number = 0): string {
  const h = sha1Hex(`capture:${captureId.toLowerCase()}:${docId}:${part}`);
  const v = `5${h.slice(13, 16)}`;
  const variant = ((parseInt(h.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, "0");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${v}-${variant}${h.slice(18, 20)}-${h.slice(20, 32)}`;
}

