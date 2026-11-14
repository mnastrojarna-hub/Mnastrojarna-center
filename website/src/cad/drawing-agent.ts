/**
 * Provedení textových příkazů výkresu (cad/agent-drawing.ts) nad dokumentem a textový stav výkresu pro agenty:
 * list, měřítko, pohledy, každá kóta s pohledem, duplicity, chybějící rozměry (Kontrola kót), co se nevešlo.
 * Sloučení Chytrých kót: vygenerované poznámky (`auto`) se nahradí, vlastní zůstanou; úpravy vygenerovaných kót
 * (tolerance, přípona, text) se podle klíče přenesou.
 * Příkazy pracují s aktivním listem (`výkres list N`, záložka listu ve výkresu) – viz `activeSheet`.
 */
import type { DrawingCmd, SheetRef, TitleField } from "./agent-drawing";
import { VIEW_CS } from "./agent-drawing";
import { defaultDrawingOptions, isRadialDim, modelViewKey, scaleLabel, STANDARD_SCALES, viewExtent, withAnnotations, type BalloonItem, type BomItem, type DetailView, type DrawingMeta, type DrawingOptions, type DrawingResult, type ModelView, type PlacedView, type RevisionItem } from "./drawing";
import { linMeaning, type SmartDims } from "./drawing-dims";
import { threadsOfDoc } from "./drawing-doc";
import { annLabel, annList, agentToSheet, agentToView, dimValue, findDims, findView, makeManualDim, makeMark, outsideFrame, overlappingTexts, patchAnn, resolveAnns, resolveOne, shortId, viewRangeLines, viewToAgent } from "./drawing-marks";
import { dimCheck } from "./dim-check";
import { fitDeviations, fitSuffix, parseFit } from "./drawing-fits";
import { applyViewsCmd, viewsStatusLines } from "./drawing-views-agent";
import { cadLocale, tr } from "./i18n";
import { MATERIALS } from "../lib/mesh-metrics";
import { uid, type CadDoc, type DrawingAnnotation, type DrawingDoc, type Vec3 } from "./types";
import { drawingKey, drawingSets, drawingsLine, inDrawing, nextDrawingName, resolveDrawing, setSheets, sheetCount, sheetPos } from "./drawing-sets";
import type { DrawingExportResult } from "./drawing-export";

export { annLabel, dimValue, findDims } from "./drawing-marks";

export type SmartResult = DrawingResult & { smart?: SmartDims };
export type DrawingCompute = (doc: CadDoc, meta: DrawingMeta, opts: Partial<DrawingOptions>) => Promise<SmartResult>;
/** Údaje, které zná jen aplikace: hmotnost (výsledek stavby), kusovník a pozice komponent sestavy – jako výkresové prostředí. */
export type DrawingExtras = { massKg?: number; bom?: BomItem[]; balloons?: BalloonItem[] };
/** Prostředí příkazů výkresu v aplikaci: doplňky razítka a otevřené záložky (pro „výkres model "záložka"“). */
export type DrawingEnv = { extras?: (doc: CadDoc) => DrawingExtras; tabs?: () => { title: string; doc: CadDoc }[] };

const fmtN = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
/** název pohledu; pohled dalšího modelu na listu (`m:<id>`) názvem modelu z voleb listu */
const VIEW_NAME = (k: string, o?: Partial<DrawingOptions>) =>
  k.startsWith("m:") ? (o?.models?.find((m) => modelViewKey(m.id) === k)?.name ?? k) : k.startsWith("aux:") ? tr("pohled {0}", k.slice(4)) : k.startsWith("cut:") ? tr("řez {0}–{0}", k.slice(4)) : tr(k === "section" ? "řez" : k === "sheet" ? "list" : VIEW_CS[k as keyof typeof VIEW_CS] ?? k);

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
    meta: { name: doc.name, number: doc.props?.number ?? "", author: doc.props?.author ?? "", revision: doc.props?.revision ?? "", tolerance: "" },
    annotations: [],
  };
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
export function mergeSmart(ann: DrawingAnnotation[], opts: Partial<DrawingOptions>, smart: SmartDims, force = false): { annotations: DrawingAnnotation[]; gen: string } | null {
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
      // revize (trojúhelník) a zobrazení úchylek uložení zůstávají u přegenerované kóty
      if (o.rev) keep.rev = o.rev;
      if (o.tolShow) keep.tolShow = o.tolShow;
      return keep;
    });
  // vygenerovaná kóta s úpravou uživatele (tolerance, revize), která se tentokrát nevešla, zůstane (souřadnice pohledu jdou s ním)
  const dropped = new Set(smart.report.dropped ?? []);
  const have = new Set(gen.map((a) => a.auto));
  const kept = ann.filter((a) => a.auto && dropped.has(a.auto) && !have.has(a.auto) && !off.has(a.auto) && userEdited(a));
  return { annotations: [...user, ...gen, ...kept], gen: smart.gen };
}

/** vygenerovaná poznámka s úpravou uživatele (tolerance / přípona, vlastní text, revize, zobrazení úchylek) */
function userEdited(a: DrawingAnnotation): boolean {
  if (a.rev || a.tolShow) return true;
  if (a.type === "dim") return !!splitSuffix(a).user.trim() || a.text !== undefined;
  return a.type === "callout" && !!a.tol?.trim();
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

/** `file` = soubor z `výkres export …` (aplikace ho uloží / stáhne) */
export type DrawingCmdResult = { doc: CadDoc; log: string[]; changed: boolean; open: boolean; file?: DrawingExportResult };

const TITLE_KEY: Record<TitleField, string> = { name: "název", number: "číslo", author: "kreslil", revision: "revize", date: "datum", material: "materiál", tolerance: "nepředepsané", edges: "hrany", note: "poznámka" };
const today = () => new Date().toLocaleDateString(cadLocale());

/** Razítko a revize do protokolu / stavu. */
function titleLines(doc: CadDoc, s: DrawingDoc): string[] {
  const m = s.meta as Partial<DrawingMeta>;
  const v = (x?: string) => x?.trim() || "—";
  const revs = m.revisions ?? [];
  return [
    tr("Razítko: název {0} · číslo {1} · kreslil {2} · revize {3} · datum {4} · materiál {5}", v(m.name || doc.name), v(m.number), v(m.author), v(m.revision), m.date?.trim() || today(), v(materialLabel(doc))),
    revs.length ? tr("Revize ({0}): {1}", revs.length, revs.map((r) => `${r.rev} ${r.date || "—"} „${r.note}“${r.author ? ` (${r.author})` : ""}`).join(" · ")) : tr("Revize: žádné"),
  ];
}

/**
 * Provede příkaz výkresu nad dokumentem – nad aktivním listem (`výkres list N`; chybí-li list, založí se první).
 * `compute` = výpočet výkresu v jádře; `env` = doplňky aplikace (kusovník, pozice, hmotnost, otevřené záložky).
 */
export async function applyDrawingCmd(doc0: CadDoc, cmd: DrawingCmd, compute: DrawingCompute, env: DrawingEnv = {}): Promise<DrawingCmdResult> {
  if (doc0.kind === "assembly" && cmd.k === "dim" && cmd.mode === "smart") throw new Error(tr("Chytré kóty jsou pro díly – u sestavy použijte „kótovat celkově“ a pozice"));
  const doc: CadDoc = { ...doc0, drawings: doc0.drawings?.length ? [...doc0.drawings] : [newSheet(doc0)] };
  const created = !doc0.drawings?.length;
  let idx = activeSheetIndex(doc);
  const sheet = (): DrawingDoc => doc.drawings![idx];
  const put = (s: DrawingDoc) => (doc.drawings![idx] = s);
  const log: string[] = [];
  if (created) log.push(tr("✓ nový list výkresu „{0}“ (Chytré kóty)", sheet().name));
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
    return { doc, log, ...r };
  };
  switch (cmd.k) {
    case "set": {
      const o = { ...sheetOptions(sheet()), ...cmd.opts };
      put({ ...sheet(), options: o as unknown as Record<string, unknown> });
      log.push(tr("✓ výkres: {0}", cmd.summary.join(", ") || tr("beze změny voleb")));
      return done({ changed: true, open: true });
    }
    case "meta": {
      const m = { ...(sheet().meta as Record<string, unknown>) };
      if (cmd.field === "roughness") {
        // razítko nemá pole drsnosti → obecná drsnost jako poznámka u razítka (ISO 1302)
        const base = String(m.note ?? "").replace(/\s*·?\s*Nepředepsaná drsnost [^·]*/u, "").trim();
        m.note = [base, tr("Nepředepsaná drsnost {0}", cmd.value)].filter(Boolean).join(" · ");
        log.push(tr("✓ obecná drsnost {0} (poznámka u razítka)", cmd.value));
      } else {
        m[cmd.field] = cmd.value;
        log.push(cmd.field === "note" ? tr("✓ poznámka: {0}", cmd.value || "—") : cmd.field === "tolerance" ? tr("✓ nepředepsané tolerance {0}", cmd.value) : tr("✓ hrany: {0}", cmd.value));
      }
      put({ ...sheet(), meta: m });
      return done({ changed: true, open: false });
    }
    case "dim": {
      const o: DrawingOptions = { ...sheetOptions(sheet()), dimensions: cmd.mode, ...(cmd.style ? { dimStyle: cmd.style } : {}) };
      if (cmd.mode !== "smart") {
        const keep = sheet().annotations.filter((a) => !a.auto);
        const removed = sheet().annotations.length - keep.length;
        put({ ...sheet(), options: { ...o, smartGen: undefined, smartOff: undefined } as unknown as Record<string, unknown>, annotations: keep });
        log.push(cmd.mode === "overall" ? tr("✓ kóty: jen celkové rozměry (odstraněno vygenerovaných: {0})", removed) : cmd.mode === "auto" ? tr("✓ kóty: Auto + Ø – základní kóty zapečené do pohledů (odstraněno vygenerovaných: {0})", removed) : tr("✓ kóty: žádné automatické (odstraněno vygenerovaných: {0})", removed));
        return done({ changed: true, open: true });
      }
      const res = await compute(doc, sheetMeta(doc, sheet(), idx, extras), o);
      if (!res.smart) throw new Error(tr("jádro nevrátilo Chytré kóty"));
      const m = mergeSmart(sheet().annotations, o, res.smart, true)!;
      put({ ...sheet(), options: { ...o, smartGen: m.gen, smartOff: [] } as unknown as Record<string, unknown>, annotations: m.annotations });
      const rep = res.smart.report;
      const per = Object.entries(rep.perView).map(([k, n]) => `${VIEW_NAME(k, o)} ${n}`).join(", ");
      log.push(tr("✓ Chytré kóty ({0}): {1} kót a popisů – {2} · očekávaných rozměrů {3}", o.dimStyle === "baseline" ? tr("od základny") : tr("řetězově"), res.smart.annotations.filter((a) => a.type !== "centerline").length, per || "—", rep.expected));
      for (const s of rep.skipped) log.push(tr("! vynecháno: {0}", s));
      return done({ changed: true, open: true });
    }
    case "tol": {
      const res = await computeSheet();
      const views = res.views;
      const anns = sheet().annotations;
      const so = sheetOptions(sheet());
      let hits = findDims(views, anns, cmd.target);
      if (/^a\d+$/i.test(cmd.target)) hits = resolveAnns(views, anns, cmd.target, true).map((i) => anns[i]);
      if (!hits.length) throw new Error(tr("kóta „{0}“ na výkrese není – kóty: {1}", cmd.target, anns.filter((a) => a.type === "dim" || a.type === "callout").map((a) => annLabel(views, a)).join(", ") || "—"));
      // pomocná kóta v závorce se netoleruje (ISO 129-1): shoduje-li se zadání i s jinou kótou, platí ta jiná
      const isRef = (a: DrawingAnnotation) => a.type === "dim" && a.prefix === "(";
      if (hits.some(isRef) && !hits.every(isRef)) hits = hits.filter((a) => !isRef(a));
      if (hits.every(isRef)) {
        const ref = hits[0] as Extract<DrawingAnnotation, { type: "dim" }>;
        const chain = ref.auto?.startsWith("len:c:");
        const others = anns.filter((a) => a.type === "dim" && !isRef(a) && a.view === ref.view && a.kind === ref.kind && (!chain || !!a.auto?.startsWith("len:c:")));
        throw new Error(tr("kóta „{0}“ je pomocná (v závorce) – pomocná kóta se netoleruje (ISO 129-1); tolerujte jiný článek řetězu: {1}", annLabel(views, ref), others.map((a) => annLabel(views, a)).join(", ") || "—"));
      }
      if (hits.length > 1) throw new Error(tr("kóta „{0}“ není jednoznačná ({1}×: {2}) – upřesněte ji (např. celým popiskem)", cmd.target, hits.length, hits.map((a) => `${annLabel(views, a)} (${VIEW_NAME(a.view, so)})`).join(", ")));
      const h = hits[0];
      const fit = /^[A-Za-z]{1,2}\d/.test(cmd.tol); // lícování (h6, H7, 6H) bez mezery, ±0,1 také bez mezery (ISO 129)
      // pole tolerance ISO 286 (H7, g6, H7/g6): úchylky podle jmenovitého rozměru kóty (výkres uložení je vyžaduje)
      const holeD = h.type === "callout" ? /Ø(\d+(?:[.,]\d+)?)/.exec(h.lines[0] ?? "") : null;
      const iso = parseFit(cmd.tol) && ((h.type === "dim" && h.prefix !== "M") || holeD) ? cmd.tol.replace(/\s+/g, "") : null;
      const nominal = !iso ? 0 : h.type === "dim" ? dimValue(views, h) : Number(holeD![1].replace(",", "."));
      if (cmd.fit) {
        if (!parseFit(cmd.tol)) throw new Error(tr("„{0}“ není pole tolerance ISO 286 – např. H7, g6, js6, H7/g6", cmd.tol));
        if (!iso) throw new Error(tr("uložení ISO 286 patří ke kótě rozměru nebo díry (Ø40, 25, Ø12 skrz) – u závitu použijte výkres tolerance M8 6H"));
        if (!(iso && (iso.includes("/") ? iso.split("/").every((z) => fitDeviations(nominal, z)) : fitDeviations(nominal, iso)))) throw new Error(tr("pole {0} není pro rozměr {1} mm v ISO 286 definováno (tabulky do 500 mm)", cmd.tol, fmtN(nominal)));
      }
      const next = anns.map((a) => {
        if (a.id !== h.id) return a;
        if (a.type === "dim") {
          // závit: „M20×1,5“ + „-6g“; jinak tolerance za hodnotou. Vygenerovaná část přípony (stoupání, „ (=90)“) zůstane,
          // dřívější tolerance se nahradí
          const p = splitSuffix(a);
          const t = a.prefix === "M" ? `-${cmd.tol}` : fit || /^[±+-]/.test(cmd.tol) ? cmd.tol : ` ${cmd.tol}`;
          return { ...a, suffix: `${p.head}${t}${p.tail}`, ...(cmd.show ? { tolShow: cmd.show } : {}) };
        }
        return a.type === "callout" ? { ...a, tol: cmd.tol, ...(cmd.show ? { tolShow: cmd.show } : {}) } : a;
      });
      put({ ...sheet(), annotations: next });
      const dev = iso ? fitSuffix(nominal, iso, cmd.show ?? h.tolShow ?? so.fitShow ?? "dev") : "";
      log.push(tr("✓ tolerance {0} → {1} ({2})", cmd.tol, annLabel(views, next.find((a) => a.id === h.id)!) + (dev ? ` ${dev}` : ""), VIEW_NAME(h.view, so)));
      return done({ changed: true, open: false });
    }
    case "views": {
      const r = await applyViewsCmd({ doc, sheet, put, compute: computeSheet }, cmd.cmd);
      log.push(...r.log);
      return done({ changed: r.changed, open: r.open });
    }
    case "status": {
      const st = await drawingStatus(doc, compute, { sheet: cmd.sheet, extras });
      if (st.doc) Object.assign(doc, { drawings: st.doc.drawings });
      log.push(st.text);
      return { doc, log, changed: !!st.doc || created, open: false };
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
          list.push(inDrawing({ ...s, name, meta: { name: cur.name ?? doc.name, number: cur.number ?? "", author: cur.author ?? "", revision: cur.revision ?? "", date: cur.date ?? "", tolerance: cur.tolerance ?? "" } }, drawingKey(sheet())));
          idx = list.length - 1;
          activeSheet.set(sheet().id);
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
      for (const w of r.warnings ?? []) log.push(tr("! {0}", w));
      return { doc: doc0, log, changed: false, open: false, file: r };
    }
    case "title": {
      const f = cmd.fields;
      const keys = Object.keys(f) as TitleField[];
      if (!keys.length) {
        log.push(...titleLines(doc, sheet()));
        return { doc, log, changed: created, open: false };
      }
      const m = { ...(sheet().meta as Record<string, unknown>) };
      for (const k of keys) if (k !== "material") m[k] = f[k];
      put({ ...sheet(), meta: m });
      // číslo, autor a revize i do dokumentu (výchozí pro nové listy, sdílí se se souborem) – jako výkresové prostředí
      if (f.number !== undefined || f.author !== undefined || f.revision !== undefined) {
        doc.props = { ...(doc.props ?? {}), ...(f.number !== undefined ? { number: f.number } : {}), ...(f.author !== undefined ? { author: f.author } : {}), ...(f.revision !== undefined ? { revision: f.revision } : {}) };
      }
      if (f.material !== undefined) doc.materialName = f.material.trim() || undefined;
      log.push(tr("✓ razítko: {0}", keys.map((k) => `${tr(TITLE_KEY[k])} „${f[k]}“`).join(", ")));
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
    case "mark": {
      const res = await computeSheet();
      const o = sheetOptions(sheet());
      const anns = sheet().annotations;
      const { ann, where } = makeMark(res, o, anns, cmd.mark, cmd.target, cmd.shift);
      put({ ...sheet(), annotations: [...anns, ann] });
      log.push(tr("✓ značka {0} · {1}", where, shortId(anns.length)));
      const over = overlappingTexts(res, anns, ann);
      if (over.length) log.push(tr("! popisek se překrývá s „{0}“ – posuňte ho: výkres upravit {1} posun=\"dx dy\" (mm listu)", over.join("“, „"), shortId(anns.length)));
      if (outsideFrame(res, ann)) log.push(tr("! značka přesahuje rámeček listu – posuňte ji: výkres upravit {0} posun=\"dx dy\"", shortId(anns.length)));
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
      if (over.length) log.push(tr("! text kóty se překrývá s „{0}“ – změňte odsazení: výkres upravit {1} odsazení=…", over.join("“, „"), shortId(anns.length)));
      if (outsideFrame(res, ann)) log.push(tr("! kóta přesahuje rámeček listu – zmenšete odsazení: výkres upravit {0} odsazení=…", shortId(anns.length)));
      return done({ changed: true, open: true });
    }
    case "edit": {
      const res = await computeSheet();
      const o = sheetOptions(sheet());
      const anns = sheet().annotations;
      const i = resolveOne(res.views, anns, cmd.target, o);
      const before = annLabel(res.views, anns[i]);
      const next = patchAnn(anns[i], cmd.patch, res.views.find((v) => v.key === anns[i].view)?.s ?? 1);
      put({ ...sheet(), annotations: anns.map((a, k) => (k === i ? next : a)) });
      const off = cmd.patch.offset !== undefined ? tr(" (odsazení {0})", fmtN(cmd.patch.offset)) : cmd.patch.shift ? tr(" (posun {0} {1})", fmtN(cmd.patch.shift[0]), fmtN(cmd.patch.shift[1])) : "";
      log.push(tr("✓ upraveno {0}: {1} → {2}{3}", shortId(i), before, annLabel(res.views, next), off));
      const over = overlappingTexts(res, anns.filter((_, k) => k !== i), next);
      if (over.length) log.push(tr("! text se překrývá s „{0}“", over.join("“, „")));
      if (outsideFrame(res, next)) log.push(tr("! přesahuje rámeček listu"));
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
      const placeAt = (scale: number, r: number) => (cmd.place ? (((p) => [p[0] - r * scale, p[1] - r * scale])(agentToSheet(H, cmd.place)) as [number, number]) : undefined);
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
 * se do stavu započítají a vrátí se i upravený dokument (`doc`) k uložení.
 */
export async function drawingStatus(doc0: CadDoc, compute: DrawingCompute, opts: { sheet?: SheetRef | "all"; extras?: DrawingExtras } = {}): Promise<{ text: string; doc?: CadDoc }> {
  if (!doc0.features.length && !doc0.components?.length) return { text: tr("Výkres: model je prázdný – nejdřív vymodelujte díl") };
  const has = !!doc0.drawings?.length;
  const doc: CadDoc = has ? { ...doc0, drawings: [...doc0.drawings!] } : { ...doc0, drawings: [newSheet(doc0)] };
  // „vše“ = všechny listy aktivního výkresu (cad/drawing-sets.ts)
  const which = opts.sheet === "all" ? setSheets(doc, activeSheetIndex(doc)) : [opts.sheet === undefined ? activeSheetIndex(doc) : resolveSheet(doc, opts.sheet)];
  let changed = false;
  const blocks: string[] = [];
  for (const i of which) {
    const r = await sheetStatus(doc, i, has, compute, opts.extras, blocks.length === 0);
    changed = changed || r.changed;
    blocks.push(r.text);
  }
  return { text: blocks.join("\n\n"), ...(changed ? { doc } : {}) };
}

/** Stav jednoho listu (mění `doc.drawings[idx]`, když se doplnily Chytré kóty). */
async function sheetStatus(doc: CadDoc, idx: number, has: boolean, compute: DrawingCompute, extras: DrawingExtras | undefined, first: boolean): Promise<{ text: string; changed: boolean }> {
  const s = doc.drawings![idx];
  const o = sheetOptions(s);
  const res = await compute(doc, sheetMeta(doc, s, idx, extras), o);
  let anns = s.annotations;
  let changed = false;
  if (o.dimensions === "smart" && res.smart) {
    const m = mergeSmart(anns, o, res.smart);
    if (m) {
      anns = m.annotations;
      doc.drawings![idx] = { ...s, options: { ...o, smartGen: m.gen } as unknown as Record<string, unknown>, annotations: anns };
      changed = true;
    }
  }
  const views = res.views;
  const { pos, count: n } = sheetPos(doc, idx);
  const L: string[] = [];
  const mode = o.dimensions === "smart" ? tr("Chytré kóty ({0})", o.dimStyle === "baseline" ? tr("od základny") : tr("řetězově")) : o.dimensions === "auto" ? tr("Auto + Ø (zapečené)") : o.dimensions === "overall" ? tr("jen celkové (zapečené)") : tr("bez automatických kót");
  const where = has ? (n > 1 ? tr(" (list {0}/{1})", pos + 1, n) : "") : tr(" (zatím neuložený – výchozí volby)");
  L.push(tr("Výkres „{0}“{1}: list {2} {3} · měřítko {4} · pohledy: {5} · kóty: {6}", s.name, where, res.sheet.name, o.orientation === "portrait" ? tr("na výšku") : tr("na šířku"), res.scale, [...views.map((v) => VIEW_NAME(v.key, o)), ...(o.views.iso ? [VIEW_NAME("iso")] : [])].join(", ") || "—", mode));
  if (first) L.push(sheetsLine(doc, activeSheetIndex(doc)));
  const extra = [o.rotation ? tr("otočení {0}°", o.rotation) : "", o.section ? tr("řez {0} {1}", o.section.plane, o.section.kind === "half" ? tr("poloviční") : tr("celý")) : "", o.bomTable === false ? tr("bez kusovníku") : "", o.balloons === false ? tr("bez balónků") : ""].filter(Boolean);
  if (extra.length) L.push(tr("Volby: {0}", extra.join(" · ")));
  const dims = anns.filter((a) => a.type === "dim" || a.type === "callout");
  L.push(tr("Kóty a popisy ({0}, z toho vygenerovaných {1}):", dims.length, dims.filter((a) => a.auto).length));
  const byView = new Map<string, string[]>();
  for (const a of dims) byView.set(a.view, [...(byView.get(a.view) ?? []), annLabel(views, a) + (a.auto ? "" : " *")]);
  for (const [k, list] of byView) L.push(`  ${VIEW_NAME(k, o)}: ${list.join(" · ")}`);
  if (dims.some((a) => !a.auto)) L.push(tr("  (* = vlastní kóta uživatele)"));
  const others = anns.filter((a) => a.type !== "dim" && a.type !== "callout");
  if (others.length) L.push(tr("Poznámky a značky: {0}", others.map((a) => annLabel(views, a)).join(" · ")));
  if (anns.length) L.push(tr("Id (výkres upravit / smazat / značka na <id>): {0}", annList(views, anns, o)));
  const dup = dimDuplicates(views, dims);
  L.push(dup.length ? tr("Duplicity ({0}): {1}", dup.length, dup.map((g) => g.map((a) => `${annLabel(views, a)} (${VIEW_NAME(a.view, o)})`).join(" = ")).join("; ")) : tr("Duplicity: žádné"));
  const out = withAnnotations(res, anns);
  const bbox = docBbox(res);
  const chk = dimCheck(doc, bbox, out.texts);
  const miss = chk.filter((x) => !x.present);
  L.push(miss.length ? tr("Kontrola kót: chybí {0} z {1}: {2}", miss.length, chk.length, miss.map((x) => `${x.label} (${x.source})`).join("; ")) : tr("Kontrola kót: všech {0} očekávaných rozměrů je na listu", chk.length));
  if (res.smart?.report.skipped.length) L.push(tr("Vynecháno (nevešlo se nebo nejde okótovat automaticky): {0}", res.smart.report.skipped.join("; ")));
  const m = s.meta as Partial<DrawingMeta>;
  L.push(tr("U razítka: nepředepsané tolerance {0} · hrany {1} · poznámka {2}", m.tolerance?.trim() || "—", m.edges?.trim() || "—", m.note?.trim() || "—"));
  L.push(...titleLines(doc, doc.drawings![idx]));
  if (o.models?.length) L.push(tr("Další modely: {0}", o.models.map((x) => `„${x.name}“ (${VIEW_NAME(x.view)}, ${x.scale === "auto" ? tr("auto") : scaleLabel(x.scale)})`).join(" · ")));
  L.push(...viewsStatusLines(res, o, anns, s.meta as Partial<DrawingMeta>));
  L.push(...viewRangeLines(res, o));
  if (res.warnings.length) L.push(tr("Varování výkresu: {0}", res.warnings.join("; ")));
  return { text: L.join("\n"), changed };
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
