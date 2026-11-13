/**
 * Provedení textových příkazů výkresu (cad/agent-drawing.ts) nad dokumentem a textový stav výkresu pro agenty:
 * list, měřítko, pohledy, každá kóta s pohledem, duplicity, chybějící rozměry (Kontrola kót), co se nevešlo.
 * Sloučení Chytrých kót: vygenerované poznámky (`auto`) se nahradí, vlastní zůstanou; úpravy vygenerovaných kót
 * (tolerance, přípona, text) se podle klíče přenesou.
 */
import type { DrawingCmd } from "./agent-drawing";
import { VIEW_CS } from "./agent-drawing";
import { angleGeom, annToSheet, defaultDrawingOptions, dimLabel, isRadialDim, modelViewKey, scaleLabel, withAnnotations, type DrawingMeta, type DrawingOptions, type DrawingResult, type PlacedView } from "./drawing";
import { linMeaning, type SmartDims } from "./drawing-dims";
import { calloutLines } from "./drawing-symbols";
import { threadsOfDoc } from "./drawing-doc";
import { dimCheck } from "./dim-check";
import { tr } from "./i18n";
import { uid, type CadDoc, type DrawingAnnotation, type DrawingDoc, type Vec3 } from "./types";

export type SmartResult = DrawingResult & { smart?: SmartDims };
export type DrawingCompute = (doc: CadDoc, meta: DrawingMeta, opts: Partial<DrawingOptions>) => Promise<SmartResult>;

const fmtN = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");
/** název pohledu; pohled dalšího modelu na listu (`m:<id>`) názvem modelu z voleb listu */
const VIEW_NAME = (k: string, o?: Partial<DrawingOptions>) =>
  k.startsWith("m:") ? (o?.models?.find((m) => modelViewKey(m.id) === k)?.name ?? k) : tr(k === "section" ? "řez" : k === "sheet" ? "list" : VIEW_CS[k as keyof typeof VIEW_CS] ?? k);

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

/** Volby listu (doplněné o výchozí). */
export function sheetOptions(s: DrawingDoc): DrawingOptions {
  const o = s.options as Partial<DrawingOptions>;
  return { ...defaultDrawingOptions, ...o, views: { ...defaultDrawingOptions.views, ...(o.views ?? {}) } };
}

/** Údaje razítka pro výpočet výkresu z dokumentu (jako výkresové prostředí). */
export function sheetMeta(doc: CadDoc, s: DrawingDoc): DrawingMeta {
  const m = s.meta as Partial<DrawingMeta>;
  return { ...m, name: m.name || doc.name, material: doc.materialName ?? doc.material ?? "", threads: threadsOfDoc(doc), sheetIndex: 1, sheetCount: Math.max(1, doc.drawings?.length ?? 1) };
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
      return keep;
    });
  return { annotations: [...user, ...gen], gen: smart.gen };
}

// ---------------------------------------------------------------- popisky a duplicity

/** hodnota kóty (mm modelu nebo °) */
export function dimValue(views: PlacedView[], a: Extract<DrawingAnnotation, { type: "dim" }>): number {
  if (isRadialDim(a)) return a.kind === "diameter" ? 2 * a.r : a.r;
  if (a.kind === "angle") {
    const S = (q: [number, number]) => annToSheet(views, a.view, q);
    return angleGeom(S(a.a), S(a.b), S(a.a2), S(a.b2), a.ang)?.angle ?? 0;
  }
  // kóty v mm listu („sheet“) mají hodnotu v měřítku listu – tady jen kóty pohledů (mm modelu)
  if (a.kind === "horizontal") return Math.abs(a.b[0] - a.a[0]);
  if (a.kind === "vertical") return Math.abs(a.b[1] - a.a[1]);
  return Math.hypot(a.b[0] - a.a[0], a.b[1] - a.a[1]);
}

/** Popisek poznámky, jak je na listu (kóty s hodnotou, popisy po řádcích). */
export function annLabel(views: PlacedView[], a: DrawingAnnotation): string {
  switch (a.type) {
    case "dim":
      return dimLabel(a, dimValue(views, a));
    case "callout":
      return calloutLines(a).join(" / ");
    case "note":
    case "text":
      return a.text;
    case "roughness":
      return a.ra;
    case "gdt":
      return `${a.symbol} ${a.value}${a.datum ? ` ${a.datum}` : ""}`;
    case "datum":
      return a.label;
    case "centerline":
      return tr("osa souměrnosti");
  }
}

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

// ---------------------------------------------------------------- tolerance ke kótě

const num = (s: string) => parseFloat(s.replace(",", "."));
/** Kóty / popisy, které odpovídají zadání (popisek kóty bez počtu, nebo první označení popisu: M8, Ø8,5, R2). */
export function findDims(views: PlacedView[], anns: DrawingAnnotation[], target: string): DrawingAnnotation[] {
  const t = target.trim().replace(/^ø/i, "Ø");
  const tn = num(t.replace(/^[ØMR]/, ""));
  const pre = /^[ØMR]/.exec(t)?.[0] ?? "";
  return anns.filter((a) => {
    if (a.type === "dim") {
      const label = dimLabel({ kind: a.kind, prefix: a.prefix === "(" ? "" : a.prefix, text: a.text }, dimValue(views, a)).replace(/^\d+× /, "");
      if (label === t) return true;
      const lp = /^[ØMR]/.exec(label)?.[0] ?? "";
      return lp === pre && Math.abs(num(label.replace(/^[ØMR]/, "")) - tn) < 1e-6;
    }
    if (a.type === "callout") {
      const first = a.lines[0].replace(/^\d+× /, "").split(" ")[0];
      if (first === t) return true;
      const fp = /^[ØMR]/.exec(first)?.[0] ?? "";
      return !!pre && fp === pre && Math.abs(num(first.replace(/^[ØMR]/, "")) - tn) < 1e-6;
    }
    return false;
  });
}

// ---------------------------------------------------------------- provedení příkazů

export type DrawingCmdResult = { doc: CadDoc; log: string[]; changed: boolean; open: boolean };

const viewsOf = (o: DrawingOptions) => (Object.keys(o.views) as (keyof DrawingOptions["views"])[]).filter((k) => o.views[k]);

/** Provede příkaz výkresu nad dokumentem (první list; chybí-li, založí se). `compute` = výpočet výkresu v jádře. */
export async function applyDrawingCmd(doc0: CadDoc, cmd: DrawingCmd, compute: DrawingCompute): Promise<DrawingCmdResult> {
  if (doc0.kind === "assembly" && cmd.k === "dim" && cmd.mode === "smart") throw new Error(tr("Chytré kóty jsou pro díly – u sestavy použijte „kótovat celkově“ a pozice"));
  const doc: CadDoc = { ...doc0, drawings: doc0.drawings?.length ? [...doc0.drawings] : [newSheet(doc0)] };
  const created = !doc0.drawings?.length;
  const sheet = (): DrawingDoc => doc.drawings![0];
  const put = (s: DrawingDoc) => (doc.drawings![0] = s);
  const log: string[] = [];
  if (created) log.push(tr("✓ nový list výkresu „{0}“ (Chytré kóty)", sheet().name));
  switch (cmd.k) {
    case "set": {
      const o = { ...sheetOptions(sheet()), ...cmd.opts };
      put({ ...sheet(), options: o as unknown as Record<string, unknown> });
      log.push(tr("✓ výkres: {0}", cmd.summary.join(", ") || tr("beze změny voleb")));
      return { doc, log, changed: true, open: true };
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
      return { doc, log, changed: true, open: false };
    }
    case "dim": {
      const o: DrawingOptions = { ...sheetOptions(sheet()), dimensions: cmd.mode, ...(cmd.style ? { dimStyle: cmd.style } : {}) };
      if (cmd.mode !== "smart") {
        const keep = sheet().annotations.filter((a) => !a.auto);
        const removed = sheet().annotations.length - keep.length;
        put({ ...sheet(), options: { ...o, smartGen: undefined, smartOff: undefined } as unknown as Record<string, unknown>, annotations: keep });
        log.push(cmd.mode === "overall" ? tr("✓ kóty: jen celkové rozměry (odstraněno vygenerovaných: {0})", removed) : tr("✓ kóty: žádné automatické (odstraněno vygenerovaných: {0})", removed));
        return { doc, log, changed: true, open: true };
      }
      const res = await compute(doc, sheetMeta(doc, sheet()), o);
      if (!res.smart) throw new Error(tr("jádro nevrátilo Chytré kóty"));
      const m = mergeSmart(sheet().annotations, o, res.smart, true)!;
      put({ ...sheet(), options: { ...o, smartGen: m.gen, smartOff: [] } as unknown as Record<string, unknown>, annotations: m.annotations });
      const rep = res.smart.report;
      const per = Object.entries(rep.perView).map(([k, n]) => `${VIEW_NAME(k, o)} ${n}`).join(", ");
      log.push(tr("✓ Chytré kóty ({0}): {1} kót a popisů – {2} · očekávaných rozměrů {3}", o.dimStyle === "baseline" ? tr("od základny") : tr("řetězově"), res.smart.annotations.filter((a) => a.type !== "centerline").length, per || "—", rep.expected));
      for (const s of rep.skipped) log.push(tr("! vynecháno: {0}", s));
      return { doc, log, changed: true, open: true };
    }
    case "tol": {
      const res = await compute(doc, sheetMeta(doc, sheet()), sheetOptions(sheet()));
      const views = res.views;
      let anns = sheet().annotations;
      // Chytré kóty ještě nevygenerované → nejdřív je vložit (tolerance se váže na kótu na listu)
      if (res.smart && sheetOptions(sheet()).dimensions === "smart") {
        const m = mergeSmart(anns, sheetOptions(sheet()), res.smart);
        if (m) {
          anns = m.annotations;
          put({ ...sheet(), options: { ...sheetOptions(sheet()), smartGen: m.gen } as unknown as Record<string, unknown>, annotations: anns });
        }
      }
      const so = sheetOptions(sheet());
      let hits = findDims(views, anns, cmd.target);
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
      const next = anns.map((a) => {
        if (a.id !== h.id) return a;
        if (a.type === "dim") {
          // závit: „M20×1,5“ + „-6g“; jinak tolerance za hodnotou. Vygenerovaná část přípony (stoupání, „ (=90)“) zůstane,
          // dřívější tolerance se nahradí
          const p = splitSuffix(a);
          const t = a.prefix === "M" ? `-${cmd.tol}` : fit || /^[±+-]/.test(cmd.tol) ? cmd.tol : ` ${cmd.tol}`;
          return { ...a, suffix: `${p.head}${t}${p.tail}` };
        }
        return a.type === "callout" ? { ...a, tol: cmd.tol } : a;
      });
      put({ ...sheet(), annotations: next });
      log.push(tr("✓ tolerance {0} → {1} ({2})", cmd.tol, annLabel(views, next.find((a) => a.id === h.id)!), VIEW_NAME(h.view, so)));
      return { doc, log, changed: true, open: false };
    }
    case "status": {
      const st = await drawingStatus(doc, compute);
      if (st.doc) Object.assign(doc, { drawings: st.doc.drawings });
      log.push(st.text);
      return { doc, log, changed: !!st.doc || created, open: false };
    }
  }
}

/**
 * Textový stav výkresu (první list) – zpětná vazba pro agenta. Chytré kóty, které ještě nejsou na listu (změna modelu),
 * se do stavu započítají a vrátí se i upravený dokument (`doc`) k uložení.
 */
export async function drawingStatus(doc0: CadDoc, compute: DrawingCompute): Promise<{ text: string; doc?: CadDoc }> {
  if (!doc0.features.length && !doc0.components?.length) return { text: tr("Výkres: model je prázdný – nejdřív vymodelujte díl") };
  const has = !!doc0.drawings?.length;
  const doc: CadDoc = has ? { ...doc0, drawings: [...doc0.drawings!] } : { ...doc0, drawings: [newSheet(doc0)] };
  const s = doc.drawings![0];
  const o = sheetOptions(s);
  const res = await compute(doc, sheetMeta(doc, s), o);
  let anns = s.annotations;
  let changed = false;
  if (o.dimensions === "smart" && res.smart) {
    const m = mergeSmart(anns, o, res.smart);
    if (m) {
      anns = m.annotations;
      doc.drawings![0] = { ...s, options: { ...o, smartGen: m.gen } as unknown as Record<string, unknown>, annotations: anns };
      changed = true;
    }
  }
  const views = res.views;
  const L: string[] = [];
  const mode = o.dimensions === "smart" ? tr("Chytré kóty ({0})", o.dimStyle === "baseline" ? tr("od základny") : tr("řetězově")) : o.dimensions === "auto" ? tr("Auto + Ø (zapečené)") : o.dimensions === "overall" ? tr("jen celkové (zapečené)") : tr("bez automatických kót");
  L.push(tr("Výkres „{0}“{1}: list {2} {3} · měřítko {4} · pohledy: {5} · kóty: {6}", s.name, has ? "" : tr(" (zatím neuložený – výchozí volby)"), res.sheet.name, o.orientation === "portrait" ? tr("na výšku") : tr("na šířku"), res.scale, [...views.map((v) => VIEW_NAME(v.key, o)), ...(o.views.iso ? [VIEW_NAME("iso")] : [])].join(", ") || "—", mode));
  const dims = anns.filter((a) => a.type === "dim" || a.type === "callout");
  L.push(tr("Kóty a popisy ({0}, z toho vygenerovaných {1}):", dims.length, dims.filter((a) => a.auto).length));
  const byView = new Map<string, string[]>();
  for (const a of dims) byView.set(a.view, [...(byView.get(a.view) ?? []), annLabel(views, a) + (a.auto ? "" : " *")]);
  for (const [k, list] of byView) L.push(`  ${VIEW_NAME(k, o)}: ${list.join(" · ")}`);
  if (dims.some((a) => !a.auto)) L.push(tr("  (* = vlastní kóta uživatele)"));
  const others = anns.filter((a) => a.type !== "dim" && a.type !== "callout");
  if (others.length) L.push(tr("Poznámky a značky: {0}", others.map((a) => annLabel(views, a)).join(" · ")));
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
  if (res.warnings.length) L.push(tr("Varování výkresu: {0}", res.warnings.join("; ")));
  return { text: L.join("\n"), ...(changed ? { doc } : {}) };
}

/** obálka modelu z pohledů výkresu (přední + horní / boční) – pro Kontrolu kót bez další stavby */
function docBbox(res: DrawingResult): [Vec3, Vec3] | null {
  const f = res.views.find((v) => v.key === "front");
  const t = res.views.find((v) => v.key === "top");
  const l = res.views.find((v) => v.key === "left" || v.key === "right");
  if (!f) return null;
  const W = t ? t.h : l ? l.w : 0;
  return [[0, 0, 0], [f.w, W, f.h]];
}
