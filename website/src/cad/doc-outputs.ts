/**
 * Výstupy dokumentu a revize modelu (vlna 22, bod 20 – výkresová část, etapa D2): „změna modelu musí zneplatnit navazující
 * výsledky“. Revize modelu je JEDNA – `modelRev` / `geometrySig` z engine/result-key.ts (A1): krátké `r·a1b2c3` k zobrazení,
 * shodu určuje 64bitový otisk téhož řetězce (`hashPair`, stejné FNV jako `resultKey` – žádné druhé hashování).
 *
 * Trvalé záznamy v dokumentu (uloží se se souborem .mncad i se sdílením):
 *  * **vydání listu** `DrawingDoc.issued` – zapíše jen `výkres vydat [B]` / tlačítko „Vydat list“ (písmeno revize + revize
 *    modelu + datum). Export list NEvydává (kritik 2c.11 – vydání je rozhodnutí člověka). Po změně modelu je vydaný list
 *    „zastaralý“: ⚠ `drawing.stale` ve `výkres stav`, `stav`, na konci běhu, při exportu se stejným písmenem revize
 *    (přísný režim ✗), v řádku D (`stale=drawing`), v JSON a v GUI (odznak na záložce listu + pruh „Vydat novou revizi“);
 *  * **záznamy exportů** `CadDoc.outputs` – formát, soubor, revize modelu, čas (a pole `job` pro stav úlohy z balíku A3):
 *    `exporty` je vypíše, po změně modelu jako zastaralé (soubor na disku je ze starší revize);
 *  * **seznam zastaralých výstupů** (`výstupy`, panel „Zastaralé výstupy“) = vydané listy + exporty + uložené analýzy, které
 *    pro nynější revizi neplatí (A1 `staleResults`) + kopie dílů v sestavě starší než díl (D1 `staleCopies`) a `přepočítat
 *    vše` (engine/outputs-ops.ts), který přepočítá, co jde, a vypíše, co musí udělat člověk (nová revize, nový export).
 *
 * Čisté funkce bez jádra a Reactu – stejné v prohlížeči i v CLI.
 */
import { hashPair } from "./assembly";
import { geometrySig, modelRev } from "./engine/result-key";
import { cadLocale, tr } from "./i18n";
import type { RevisionItem } from "./drawing";
import type { CadDoc, DrawingDoc, ExportRecord, IssuedSheet, SupplyInfo } from "./types";

/* ───────────────────────── revize modelu ───────────────────────── */

/**
 * revize modelu dokumentu: `rev` = `r·a1b2c3` (zobrazení), `sig` = 64bitový otisk `geometrySig` (shoda); `data` = otisk údajů,
 * které nese razítko a kusovník listu (název, číslo, materiál, druh položky – i u kopií dílů v sestavě). Revize modelu je
 * geometrie (A1); vydaný list a výkres / CSV kusovníku ale zastarají i po změně jen čísla nebo materiálu (vlna 22, bod 20 – kolo 3).
 */
export type ModelId = { rev: string; sig: string; data: string };

type DataTree = (string | null | DataTree | SupplyInfo)[];
/** údaje dokumentu, které ukazuje razítko / kusovník (bez geometrie, bez náhodných id) */
function docData(d: CadDoc, depth = 0): DataTree {
  const out: DataTree = [d.name ?? "", d.material ?? "", d.materialName ?? "", d.props?.number ?? "", d.supply ?? null];
  if (d.kind === "assembly" && depth < 12)
    out.push((d.components ?? []).map((c): DataTree => [c.name, c.number ?? "", c.material ?? "", c.group ?? "", c.supply ?? null, c.source.kind === "file" ? c.source.fileName : docData(c.source.doc, depth + 1)]));
  return out;
}
/** otisk údajů razítka / kusovníku (`ModelId.data`) */
export function docDataSig(doc: CadDoc): string {
  const [a, b] = hashPair(JSON.stringify(docData(doc)));
  return a.toString(36) + b.toString(36);
}

/** záznam (vydání listu, export výkresu / kusovníku) odpovídá revizi `id`: táž geometrie a – má-li záznam otisk údajů – tytéž údaje */
export const sameModel = (rec: { sig: string; data?: string }, id: ModelId): boolean => rec.sig === id.sig && (rec.data === undefined || rec.data === id.data);
/** změnily se jen údaje (číslo, materiál…), geometrie je táž */
const dataOnly = (rec: { sig: string; data?: string }, id: ModelId): boolean => rec.sig === id.sig && rec.data !== undefined && rec.data !== id.data;
/** „model je teď …“: jiná geometrie = nová revize; táž geometrie s jinými údaji = revize + „se změněnými údaji …“ */
export const nowRev = (rec: { sig: string; data?: string }, id: ModelId): string => (dataOnly(rec, id) ? tr("{0} se změněnými údaji dílu (název, číslo, materiál, druh položky)", id.rev) : id.rev);
/** export nese údaje razítka / kusovníku (výkres, CSV kusovníku) – jen ten po změně čísla / materiálu zastará */
const carriesData = (e: { what: string; format: string }): boolean => e.what === "drawing" || e.format.toLowerCase() === "csv";

const idMemo = new WeakMap<CadDoc, ModelId>();
/** revize modelu dokumentu (v mezipaměti podle objektu dokumentu – GUI ji čte při každém překreslení) */
export function modelId(doc: CadDoc): ModelId {
  let id = idMemo.get(doc);
  if (!id) {
    const g = geometrySig(doc);
    const [a, b] = hashPair(g);
    // rev = A1 modelRev (bez náhodných id – stejný model = stejná revize v prohlížeči i v CLI), sig = otisk s id (shoda záznamu)
    idMemo.set(doc, (id = { rev: modelRev(doc), sig: a.toString(36) + b.toString(36), data: docDataSig(doc) }));
  }
  return id;
}

/** datum záznamu v jazyce rozhraní (ISO čas → „20. 11. 2026“) */
export const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(cadLocale());
};
/** čas záznamu (GUI) – „14:05“ */
export const fmtTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(cadLocale(), { hour: "2-digit", minute: "2-digit" });
};

/* ───────────────────────── vydání listu ───────────────────────── */

/** stav listu vůči modelu: nevydaný / vydaný z této revize modelu / vydaný ze starší revize (zastaralý) */
export type SheetState = "none" | "current" | "stale";

export function sheetState(doc: CadDoc, s: Pick<DrawingDoc, "issued"> | undefined, id: ModelId = modelId(doc)): SheetState {
  if (!s?.issued) return "none";
  return sameModel(s.issued, id) ? "current" : "stale";
}

/** další písmeno revize: A → B, Z → AA, 1 → 2, 01 → 02, A9 → A10 (prázdné → A) */
export function nextRev(rev: string | undefined): string {
  const r = (rev ?? "").trim().toUpperCase();
  if (!r) return "A";
  const num = /^(.*?)(\d+)$/.exec(r);
  if (num) return `${num[1]}${String(Number(num[2]) + 1).padStart(num[2].length, "0")}`;
  const last = r[r.length - 1];
  if (last >= "A" && last < "Z") return r.slice(0, -1) + String.fromCharCode(last.charCodeAt(0) + 1);
  if (last === "Z") return r.slice(0, -1) + "AA";
  return `${r}1`;
}

type MetaLike = { revision?: string; revisions?: RevisionItem[]; author?: string };

/** písmeno revize, které `výkres vydat` bez písmena použije (viz `issueSheet`) */
export function defaultIssueRev(doc: CadDoc, s: DrawingDoc, id: ModelId = modelId(doc)): string {
  const m = s.meta as MetaLike;
  const revs = m.revisions ?? [];
  const st = sheetState(doc, s, id);
  // vydaný list: stejný model = totéž písmeno (opakované vydání nic nemění); změněný model = nové písmeno
  if (st === "current") return s.issued!.rev;
  if (st === "stale") {
    let r = nextRev(s.issued!.rev);
    // revize zapsaná v tabulce PO vydání (rozpracovaná revize) se použije, jen když je novější než vydaná
    const cur = (m.revision ?? "").toUpperCase();
    if (cur && cur !== s.issued!.rev && revs.some((x) => x.rev.toUpperCase() === cur)) r = cur;
    return r;
  }
  const cur = (m.revision ?? "").trim().toUpperCase();
  if (cur && revs.some((x) => x.rev.toUpperCase() === cur)) return cur;
  return (revs[revs.length - 1]?.rev ?? "A").toUpperCase();
}

export type IssueResult = {
  /** nový stav listu (meta s revizí a tabulkou revizí, `issued`) */
  sheet: DrawingDoc;
  rev: string;
  id: ModelId;
  /** do tabulky revizí přibyl řádek */
  added: boolean;
  /** dosavadní vydání listu */
  prev?: IssuedSheet;
  /** totéž písmeno revize, ale jiný model – výkres se změnil a nese staré písmeno (⚠ drawing.stale) */
  sameRevChanged: boolean;
  /** list už byl vydán z téže revize modelu se stejným písmenem – beze změny */
  unchanged: boolean;
};

/**
 * Vydá list: písmeno revize (`rev`, jinak `defaultIssueRev`) – chybí-li v tabulce revizí, přidá se řádek (datum, popis
 * `note` nebo „první vydání“ / „změna modelu r·… → r·…“, kreslil z razítka); revize v razítku = vydané písmeno; `issued` =
 * písmeno + revize modelu + čas. Čistá funkce nad listem.
 */
export function issueSheet(doc: CadDoc, s: DrawingDoc, o: { rev?: string; note?: string; date?: string; at?: string } = {}): IssueResult {
  const id = modelId(doc);
  const rev = (o.rev?.trim() || defaultIssueRev(doc, s, id)).toUpperCase();
  const m = { ...(s.meta as MetaLike & Record<string, unknown>) };
  const revs: RevisionItem[] = [...(m.revisions ?? [])];
  const prev = s.issued;
  const i = revs.findIndex((r) => r.rev.toUpperCase() === rev);
  const note = o.note?.trim() || (prev && dataOnly(prev, id) ? tr("změna údajů dílu (název, číslo, materiál, druh položky)") : prev && !sameModel(prev, id) ? tr("změna modelu {0} → {1}", prev.modelRev, id.rev) : tr("první vydání"));
  const date = o.date?.trim() || new Date(o.at ?? Date.now()).toLocaleDateString(cadLocale());
  let added = false;
  if (i < 0) {
    revs.push({ rev, date, note, author: m.author ?? "" });
    added = true;
  } else if (o.note?.trim()) revs[i] = { ...revs[i], note: o.note.trim() };
  m.revisions = revs;
  m.revision = rev;
  const unchanged = !!prev && prev.rev === rev && sameModel(prev, id);
  const issued: IssuedSheet = unchanged ? prev! : { rev, modelRev: id.rev, sig: id.sig, data: id.data, at: o.at ?? new Date().toISOString(), ...(o.note?.trim() ? { note: o.note.trim() } : {}) };
  return { sheet: { ...s, meta: m as Record<string, unknown>, issued }, rev, id, added, ...(prev ? { prev } : {}), sameRevChanged: !!prev && prev.rev === rev && !sameModel(prev, id), unchanged };
}

/** zruší vydání listu (list zůstane, tabulka revizí také) */
export function withdrawIssue(s: DrawingDoc): DrawingDoc {
  const { issued: _gone, ...rest } = s;
  void _gone;
  return rest;
}

/** řádek „Vydání: …“ do `výkres stav` (a stejný text v GUI) */
export function sheetIssueLine(doc: CadDoc, s: DrawingDoc, id: ModelId = modelId(doc)): string {
  const st = sheetState(doc, s, id);
  if (st === "none") return tr("Vydání: nevydáno · list z modelu {0} (vydat: výkres vydat {1})", id.rev, defaultIssueRev(doc, s, id));
  const is = s.issued!;
  if (st === "current") return tr("Vydání: rev. {0} z modelu {1} ({2}) – odpovídá modelu", is.rev, is.modelRev, fmtDate(is.at));
  return tr("⚠ Vydání: rev. {0} z modelu {1} ({2}) – model je teď {3}: list je ZASTARALÝ – vydejte novou revizi: výkres vydat {4}", is.rev, is.modelRev, fmtDate(is.at), nowRev(is, id), nextRev(is.rev));
}

/** text ⚠ drawing.stale pro list (protokol, `stav`, konec běhu) */
export function staleSheetText(sheetName: string, is: IssuedSheet, id: ModelId): string {
  return tr("list „{0}“ vydán jako rev. {1} z modelu {2} ({3}), model je teď {4} – vydejte novou revizi: výkres vydat {5}", sheetName, is.rev, is.modelRev, fmtDate(is.at), nowRev(is, id), nextRev(is.rev));
}

/** text ⚠ drawing.stale při exportu vydaného zastaralého listu (soubor nese staré písmeno revize s jiným obsahem) */
export function staleExportText(sheetName: string, is: IssuedSheet, id: ModelId): string {
  return tr("list „{0}“ se exportuje s revizí {1}, ale rev. {1} byla vydána z modelu {2} a model je teď {3} – soubor má jiný obsah pod stejným písmenem; nejdřív vydejte novou revizi: výkres vydat {4}", sheetName, is.rev, is.modelRev, nowRev(is, id), nextRev(is.rev));
}

/** zastaralé vydané listy dokumentu: index v `doc.drawings`, list, vydání */
export function staleSheets(doc: CadDoc, id: ModelId = modelId(doc)): { idx: number; sheet: DrawingDoc; issued: IssuedSheet }[] {
  if (doc.kind === "draft") return [];
  return (doc.drawings ?? []).flatMap((s, idx) => (s.issued && !sameModel(s.issued, id) ? [{ idx, sheet: s, issued: s.issued }] : []));
}

/* ───────────────────────── záznamy exportů ───────────────────────── */

/** nejvýš tolik záznamů exportů v dokumentu (nejstarší odpadnou) */
export const OUTPUTS_MAX = 40;

export type ExportInput = Pick<ExportRecord, "what" | "format" | "file"> &
  Partial<Pick<ExportRecord, "sheets" | "rev" | "revStale" | "job" | "at">> & {
    /**
     * dokument, ZE KTERÉHO soubor vznikl (vlna 22, body 12 a 22h): export z menu běží jako úloha a záznam se zapisuje až po
     * jejím konci do dokumentu, který mezitím mohl uživatel změnit – revize a otisk záznamu musí patřit exportovanému modelu,
     * jinak by soubor ze starší revize hlásil „odpovídá modelu“. Bez `from` = `doc` (text: export běží nad dokumentem běhu).
     */
    from?: CadDoc;
  };

/**
 * Záznam exportu do dokumentu: revize modelu a čas. Stejný formát + soubor = novější záznam nahradí starší (soubor na disku
 * se přepsal). Vrací nový dokument (vstup se nemění) a záznam.
 */
export function recordExport(doc: CadDoc, e: ExportInput): { doc: CadDoc; rec: ExportRecord } {
  const id = modelId(doc);
  const src = e.from ? modelId(e.from) : id;
  const at = e.at ?? new Date().toISOString();
  const rec: ExportRecord = {
    id: hashPair(`${e.format}|${e.file}|${at}`)[0].toString(36),
    what: e.what,
    format: e.format.toLowerCase(),
    file: e.file,
    modelRev: src.rev,
    sig: src.sig,
    ...(carriesData(e) ? { data: src.data } : {}),
    at,
    ...(e.sheets?.length ? { sheets: e.sheets } : {}),
    ...(e.rev ? { rev: e.rev } : {}),
    ...(e.revStale ? { revStale: true } : {}),
    ...(e.job ? { job: e.job } : {}),
  };
  const rest = (doc.outputs ?? []).filter((x) => !(x.format === rec.format && x.file === rec.file));
  const outputs = [...rest, rec].slice(-OUTPUTS_MAX);
  const next: CadDoc = { ...doc, outputs };
  idMemo.set(next, id); // záznam geometrii nemění – revize nového objektu dokumentu je táž
  return { doc: next, rec };
}

/**
 * stav záznamu exportu: z nynější revize modelu / ze starší revize; soubor, který nese písmeno revize vydané z jiného modelu
 * (export zastaralého vydaného listu – `revStale`), je zastaralý i při shodě modelu (papír rev. A ≠ soubor rev. A)
 */
export const exportState = (doc: CadDoc, rec: ExportRecord, id: ModelId = modelId(doc)): "current" | "stale" => (sameModel(rec, id) && !rec.revStale ? "current" : "stale");

/** zastaralé záznamy exportů */
export const staleExports = (doc: CadDoc, id: ModelId = modelId(doc)): ExportRecord[] => (doc.outputs ?? []).filter((r) => exportState(doc, r, id) === "stale");

/** důvod zastaralého záznamu exportu (text seznamu zastaralých výstupů) */
const exportWhy = (r: ExportRecord, id: ModelId): string =>
  !sameModel(r, id) ? tr("exportováno z modelu {0} ({1}), model je teď {2}", r.modelRev, fmtDate(r.at), nowRev(r, id)) : tr("soubor nese rev. {0}, která byla vydána z jiné revize modelu – vydejte novou revizi a exportujte znovu", r.rev ?? "?");

const FMT_LABEL: Record<string, string> = { step: "STEP", stl: "STL", brep: "BREP", obj: "OBJ", glb: "GLB", "3mf": "3MF", wrl: "VRML", pdf: "PDF", dxf: "DXF", dwg: "DWG", svg: "SVG", csv: "CSV", png: "PNG" };
export const formatName = (f: string): string => FMT_LABEL[f.toLowerCase()] ?? f.toUpperCase();

/** listy záznamu výkresu názvy (podle id v dokumentu; smazaný list = „?“) */
const sheetNames = (doc: CadDoc, ids?: string[]) => (ids ?? []).map((sid) => doc.drawings?.find((s) => s.id === sid)?.name ?? "?");

/** příkaz, který export zopakuje (text) */
export function reexportCmd(doc: CadDoc, rec: ExportRecord): string {
  if (rec.what === "model") return `export ${rec.format}`;
  if (rec.what === "sketch") return "skica export dxf";
  const idx = rec.sheets?.length === 1 ? (doc.drawings?.findIndex((s) => s.id === rec.sheets![0]) ?? -1) : -1;
  return `výkres export ${rec.format}${rec.sheets && rec.sheets.length > 1 ? " vše" : idx >= 0 && (doc.drawings?.length ?? 0) > 1 ? ` list ${idx + 1}` : ""}`;
}

/** doba úlohy `⏱ 0,4 s` (značka ⏱ – zlaté snímky korpusu čas normalizují, engine-parity.cjs) */
export const jobTime = (ms: number): string => `⏱ ${(ms / 1000).toLocaleString(cadLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;

/**
 * úloha exportu uložená se záznamem (vlna 22, bod 22h): stav, doba a výsledek kontroly zpětným načtením – trvale v dokumentu,
 * ne jen v seznamu Exporty relace; bez kontroly se nic „✓“ nepíše
 */
function jobText(rec: ExportRecord): string {
  const j = rec.job;
  if (!j?.state) return "";
  const st = RUN_STATE_TEXT[j.state]?.() ?? j.state;
  const time = j.ms !== undefined ? ` ${jobTime(j.ms)}` : "";
  const check = j.check ? ` · ${j.check.ok ? tr("kontrola ✓") : `${tr("kontrola")} ⚠ ${j.check.text}`}` : "";
  return ` · ${tr("úloha: {0}", st)}${time}${check}`;
}
const RUN_STATE_TEXT: Record<string, () => string> = { done: () => tr("dokončeno"), cancelled: () => tr("zrušeno"), error: () => tr("chyba") };

/** jeden řádek záznamu exportu (`exporty`, panel) */
export function exportLine(doc: CadDoc, rec: ExportRecord, id: ModelId = modelId(doc)): string {
  const sheets = sheetNames(doc, rec.sheets);
  const head = tr("{0} „{1}“", formatName(rec.format), rec.file) + (sheets.length ? ` · ${sheets.length > 1 ? tr("listy {0}", sheets.join(", ")) : tr("list {0}", sheets[0])}` : "") + (rec.rev ? ` · ${tr("rev. {0}", rec.rev)}` : "");
  const when = tr("z modelu {0} ({1})", rec.modelRev, fmtDate(rec.at));
  const job = jobText(rec);
  if (exportState(doc, rec, id) === "current") return `${head} · ${when}${job} – ${tr("odpovídá modelu")}`;
  return sameModel(rec, id) ? `⚠ ${head} · ${when}${job} – ${tr("NESE ZASTARALÉ PÍSMENO REVIZE: rev. {0} byla vydána z jiné revize modelu – vydejte novou revizi a exportujte znovu: {1}", rec.rev ?? "?", reexportCmd(doc, rec))}` : `⚠ ${head} · ${when}${job} – ${tr("ZASTARALÝ: model je teď {0}, exportujte znovu: {1}", nowRev(rec, id), reexportCmd(doc, rec))}`;
}

/** výpis `exporty` */
export function exportsText(doc: CadDoc, id: ModelId = modelId(doc)): string {
  const list = doc.outputs ?? [];
  if (!list.length) return tr("Exporty: žádné záznamy – zapisuje je export z tohoto dokumentu (export step, výkres export pdf…) · model {0}", id.rev);
  const stale = list.filter((r) => exportState(doc, r, id) === "stale").length;
  return [tr("Exporty ({0}, zastaralých {1}) · model je teď {2}:", list.length, stale, id.rev), ...[...list].reverse().map((r, i) => `  ${i + 1}. ${exportLine(doc, r, id)}`)].join("\n");
}

/* ───────────────────────── zastaralé výstupy ───────────────────────── */

/** položka seznamu „Zastaralé výstupy“ */
export type StaleItem = {
  kind: "sheet" | "export" | "analysis" | "copy";
  /** popis položky (název listu, soubor, druh analýzy, komponenta) */
  label: string;
  /** proč neplatí */
  why: string;
  /** co s tím (příkaz) */
  fix: string;
  /** `přepočítat vše` ji vyřeší samo (přepočet / obnova) – jinak musí jednat člověk (nová revize, nový export) */
  auto: boolean;
  /** id listu / záznamu exportu (GUI) */
  ref?: string;
};

/** druhy analýz A1 (`staleResults`) lidsky a příkaz, který je přepočítá */
export const ANALYSIS: Record<string, { label: () => string; fix: string; auto: boolean }> = {
  clash: { label: () => tr("kontrola kolizí"), fix: "kolize", auto: true },
  mates: { label: () => tr("stav vazeb"), fix: "sestava vazby", auto: true },
  motion: { label: () => tr("pohybová studie"), fix: "pohyb spustit", auto: true },
  measure: { label: () => tr("měření"), fix: "měřit …", auto: false },
  compare: { label: () => tr("porovnání s referencí"), fix: "porovnat …", auto: false },
  inspect: { label: () => tr("kontrola"), fix: "kontrola", auto: false },
  overlay: { label: () => tr("překryv s předlohou"), fix: "porovnat předloha …", auto: false },
};

/**
 * Seznam zastaralých výstupů dokumentu: vydané listy ze starší revize modelu, zastaralé záznamy exportů, uložené analýzy,
 * které pro nynější stav neplatí (`analyses` = A1 `staleResults`), a kopie dílů v sestavě starší než díl (`copies` = popisy
 * D1 `staleCopies`).
 */
export function staleOutputs(doc: CadDoc, o: { analyses?: readonly string[]; copies?: readonly { name: string; why: string; fix?: string }[] } = {}): StaleItem[] {
  const id = modelId(doc);
  const out: StaleItem[] = [];
  for (const c of o.copies ?? []) out.push({ kind: "copy", label: c.name, why: c.why, fix: c.fix ?? "sestava obnovit vše", auto: true });
  for (const a of o.analyses ?? []) {
    const d = ANALYSIS[a];
    out.push({ kind: "analysis", label: d ? d.label() : a, why: tr("výsledek je ze starší revize modelu"), fix: d?.fix ?? a, auto: d?.auto ?? false });
  }
  for (const x of staleSheets(doc, id)) out.push({ kind: "sheet", label: tr("list „{0}“ rev. {1}", x.sheet.name, x.issued.rev), why: tr("vydán z modelu {0}, model je teď {1}", x.issued.modelRev, nowRev(x.issued, id)), fix: `výkres vydat ${nextRev(x.issued.rev)}`, auto: false, ref: x.sheet.id });
  for (const r of staleExports(doc, id)) out.push({ kind: "export", label: tr("{0} „{1}“", formatName(r.format), r.file), why: exportWhy(r, id), fix: reexportCmd(doc, r), auto: false, ref: r.id });
  return out;
}

/** text seznamu zastaralých výstupů (`výstupy zastaralé`) */
export function staleOutputsText(doc: CadDoc, items: readonly StaleItem[]): string {
  const id = modelId(doc);
  if (!items.length) return tr("Zastaralé výstupy: žádné – vydané listy, exporty a uložené analýzy odpovídají modelu {0}", id.rev);
  return [tr("Zastaralé výstupy ({0}) · model je teď {1}:", items.length, id.rev), ...items.map((x, i) => `  ${i + 1}. ⚠ ${x.label} – ${x.why} → ${x.fix}${x.auto ? tr(" (přepočítat vše)") : ""}`)].join("\n");
}

/**
 * Řádky výstupů do stavu dokumentu (`stav`, závěrečný stav běhu, stav aplikace): jen když dokument má vydané listy nebo
 * záznamy exportů – jinak nic (dokument bez výstupů se ve stavu nemění).
 */
export function outputsStatusLines(doc: CadDoc): string[] {
  if (doc.kind === "draft") return [];
  const sheets = (doc.drawings ?? []).filter((s) => s.issued);
  const exps = doc.outputs ?? [];
  if (!sheets.length && !exps.length) return [];
  const id = modelId(doc);
  const L: string[] = [tr("Revize modelu: {0}", id.rev)];
  for (const s of sheets) {
    const st = sheetState(doc, s, id);
    L.push(st === "current" ? tr("Výkres: list „{0}“ vydán jako rev. {1} z modelu {2} ({3}) – odpovídá modelu", s.name, s.issued!.rev, s.issued!.modelRev, fmtDate(s.issued!.at)) : `⚠ ${tr("Výkres: {0}", staleSheetText(s.name, s.issued!, id))}`);
  }
  if (exps.length) {
    const stale = staleExports(doc, id);
    L.push(stale.length ? `⚠ ${tr("Exporty: {0} z {1} ze starší revize modelu – {2} (výpis: exporty)", stale.length, exps.length, stale.map((r) => `${formatName(r.format)} „${r.file}“ ${r.modelRev}`).join(", "))}` : tr("Exporty: {0} – všechny z nynější revize modelu (výpis: exporty)", exps.length));
  }
  return L;
}

/** strojová část stavu (`= … status …`): `drawing.stale=N export.stale=N` – jen když něco neplatí */
export function outputsKv(doc: CadDoc): string {
  if (doc.kind === "draft") return "";
  const id = modelId(doc);
  const s = staleSheets(doc, id).length;
  const e = staleExports(doc, id).length;
  return [s ? `drawing.stale=${s}` : "", e ? `export.stale=${e}` : ""].filter(Boolean).join(" ");
}

/** druhy zastaralých výstupů dokumentu pro `stale=` řádku D (`drawing`, `export`) */
export function staleOutputKinds(doc: CadDoc): string[] {
  if (doc.kind === "draft") return [];
  const id = modelId(doc);
  return [...(staleSheets(doc, id).length ? ["drawing"] : []), ...(staleExports(doc, id).length ? ["export"] : [])];
}

/* ───────────────────────── skript z dokumentu (doc-script.ts) ───────────────────────── */

const ISSUE_W: readonly [string, string, string] = ["výkres vydat", "drawing issue", "zeichnung freigeben"];

/**
 * Vydání listu do textového skriptu (doc-script.ts, po kótách listu): vydaný list z nynějšího modelu = `výkres vydat A`
 * (při přečtení se vydá z přečteného modelu); vydaný list ze starší revize modelu se NEzapíše – vydání by po přečtení
 * tvrdilo shodu s modelem, kterou původní dokument neměl (poznámka skriptu).
 */
export function emitIssue(o: { li: 0 | 1 | 2; line(s: string): void; note(s: string): void }, doc: CadDoc, s: DrawingDoc): void {
  if (!s.issued || doc.kind === "draft") return;
  if (sheetState(doc, s) === "current") o.line(`${ISSUE_W[o.li]} ${s.issued.rev}`);
  else o.note(tr("list „{0}“ byl vydán jako rev. {1} z modelu {2}, který už neodpovídá – vydání se do skriptu nezapisuje (vydejte znovu: výkres vydat {3})", s.name, s.issued.rev, s.issued.modelRev, nextRev(s.issued.rev)));
}
