/**
 * Provedení příkazů předlohy (parse.ts) nad dokumentem – bez Reactu: přístup k jádru (výkres modelu = promítnuté
 * pohledy), k připojeným souborům a ke stažení dostane zvenku (`RefEnv`). Výsledek: řádky protokolu, případně změněný
 * dokument (`doc.reference`) nebo nový dokument (předloha jako 2D výkres v nové záložce), data pro API.
 */
import { tr } from "../i18n";
import { b64ToBytes, blobId } from "../blobs";
import { emptyDraftDoc } from "../draft/doc";
import type { CadDoc } from "../types";
import { checkDims, compareGeo, modelGeo, refGeo, type Align, type Geo, type ModelEnt } from "./compare";
import { viewGeometry } from "./extract";
import { loadReference, type LoadOpts } from "./load";
import { viewName, type ModelViewKey, type RefCmd } from "./parse";
import { referenceStore, type RefState } from "./store";
import { compareLines, dimCheckLines, extractLines, statusLines } from "./text";
import type { RefCompare, RefDimCheck, RefDocInfo, RefView } from "./types";

type DrawingLike = { views: { key: string; ents?: ModelEnt[] }[] };
export type RefEnv = {
  /** výkres modelu (jádro – cad.drawing) */
  drawing: (doc: CadDoc, meta: { name: string; material: string }, opts: Record<string, unknown>) => Promise<DrawingLike>;
  /** připojený soubor podle názvu (konzole → Připojit soubor…) */
  file?: (name: string) => { name: string; bytes: Uint8Array } | null;
  /** seznam připojených souborů pro hlášku */
  attached?: () => string;
  /** stažení souboru bez dialogu (obrázek překryvu SVG) */
  download?: (name: string, bytes: Uint8Array, mime: string) => Promise<void>;
  load?: LoadOpts;
};
export type RefResult = { log: string[]; doc?: CadDoc; newDoc?: CadDoc; data?: unknown };

const docRef = (d: CadDoc) => d.reference;
const withRef = (d: CadDoc, r: RefDocInfo | undefined): CadDoc => {
  const { reference: _old, ...rest } = d;
  void _old;
  return r ? { ...rest, reference: r } : rest;
};
const safe = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 50);

/** bajty souboru z dat příkazu (data URL / base64) nebo z připojených souborů */
function fileBytes(cmd: Extract<RefCmd, { kind: "load" }>, env: RefEnv): { bytes: Uint8Array; name: string } {
  if (cmd.data) {
    try {
      return { bytes: b64ToBytes(cmd.data.replace(/^data:[^,]*,/, "")), name: cmd.name };
    } catch {
      throw new Error(tr("předloha „{0}“: data nejsou base64 ani data URL", cmd.name));
    }
  }
  const f = env.file?.(cmd.name);
  if (!f) throw new Error(tr("předloha „{0}“: soubor není připojený – připojte ho v konzoli tlačítkem „Připojit soubor…“ (nebo window.mncad.attach) a zopakujte příkaz; připojené: {1}", cmd.name, env.attached?.() || "—") + (/\.\w{2,4}$/.test(cmd.name) ? "" : tr(" (příkazy předlohy: stav, výtah, kontrola kót, otevřít, odebrat)")));
  // název připojeného souboru (zadaný i bez přípony nebo jiným písmem) – podle něj se předloha znovu najde po obnovení
  return { bytes: f.bytes, name: f.name };
}

/** načtená předloha dokumentu – z paměti, nebo znovu z připojeného souboru téhož obsahu */
async function current(doc: CadDoc, env: RefEnv, dims = false): Promise<RefState> {
  const info = docRef(doc);
  // „kontrola kót“ bez předlohy: nejspíš hledaná kontrola kót výkresu (tlačítko Kontrola kót / Maßprüfung, řádek výkres stav)
  if (!info && dims) throw new Error(tr("k dokumentu není připojená předloha – předloha kontrola kót porovnává kóty připojeného výkresu zákazníka s modelem; kontrolu kót vlastního výkresu (očekávané rozměry na listu, tlačítko Kontrola kót) vypíše výkres stav – řádek „Kontrola kót“"));
  if (!info) throw new Error(tr("k dokumentu není připojená předloha – předloha \"výkres.dwg\" (soubor připojte v konzoli tlačítkem „Připojit soubor…“)"));
  const st = referenceStore.get(info.id);
  if (st) return st;
  const f = env.file?.(info.name);
  if (f) {
    const again = await loadReference(info.name, f.bytes, env.load);
    if (again.info.id === info.id) return referenceStore.put({ ...again, info: { ...again.info, checks: info.checks } });
  }
  throw new Error(tr("předloha „{0}“ je zapsaná v dokumentu, ale soubor v této relaci není načtený – připojte ho znovu a zadejte předloha \"{0}\"", info.name));
}

/** promítnuté pohledy modelu (jádro) */
async function modelViews(doc: CadDoc, env: RefEnv, keys: ModelViewKey[], hidden: boolean, tol: number): Promise<Map<ModelViewKey, Geo>> {
  if (doc.kind === "draft") throw new Error(tr("porovnání s předlohou potřebuje 3D díl nebo sestavu (otevřený dokument je 2D výkres)"));
  if (!doc.features.length && !doc.components?.length) throw new Error(tr("model je prázdný – není co porovnat"));
  const views = { front: false, top: false, left: false, right: false, back: false, bottom: false, iso: false } as Record<string, boolean>;
  for (const k of keys) views[k] = true;
  const r = await env.drawing(doc, { name: doc.name, material: doc.materialName ?? doc.material }, { views, hidden, dimensions: "none", section: null, centerLines: false, balloons: false, holeTable: false, scale: 1, sheet: "auto" });
  const out = new Map<ModelViewKey, Geo>();
  for (const k of keys) {
    const v = r.views.find((x) => x.key === k);
    if (v?.ents?.length) out.set(k, modelGeo(v.ents, { hidden, tol }));
  }
  return out;
}

/**
 * Otisk modelu (geometrie dokumentu: prvky, proměnné, konfigurace, tělesa, komponenty a vazby) – uložené výsledky
 * porovnání a kontroly kót platí jen pro model se stejným otiskem (předloha stav jinak hlásí „zastaralé“).
 */
export function modelPrint(doc: CadDoc): string {
  const key = JSON.stringify({ f: doc.features, v: doc.variables, c: doc.configs, a: doc.activeConfig, b: doc.bodies, k: doc.kind, comp: doc.components, m: doc.mates });
  return blobId(new TextEncoder().encode(key));
}

/** měřítko geometrie pohledu předlohy (jednotky výkresu na 1 mm) z měřítka zadaného příkazem (1:2 → 0,5 × jednotky listu) */
const viewScale = (st: RefState, rv: RefView, scale?: number) => (scale === undefined ? undefined : scale * (st.extract.sheets.find((s) => s.n === rv.sheet)?.unitPerMm ?? 1));

/** pohledy předlohy k porovnání (zadaný, nebo všechny na listu / v předloze) */
function refViews(st: RefState, c: { refView?: string; sheet?: number }): RefView[] {
  const ex = st.extract;
  if (c.refView) {
    const v = ex.views.find((x) => x.id === c.refView);
    if (!v) throw new Error(tr("pohled předlohy {0} není – pohledy: {1}", c.refView, ex.views.map((x) => x.id).join(", ") || "—"));
    return [v];
  }
  const vs = ex.views.filter((v) => c.sheet === undefined || v.sheet === c.sheet);
  if (!vs.length) throw new Error(c.sheet !== undefined ? tr("na listu {0} předlohy nejsou pohledy", c.sheet) : tr("v předloze nejsou pohledy (geometrie)"));
  return vs;
}

/** jen viditelné hrany modelu (předloha v pohledu skryté hrany nekreslí) */
const visibleGeo = (g: Geo): Geo => {
  const segs = g.segs.filter((x) => !x.hidden);
  return segs.length === g.segs.length ? g : { ...g, segs };
};

/**
 * Nejlepší shoda pohledu modelu s pohledy předlohy. `hidden`: true = se skrytými hranami, false = bez nich,
 * undefined = podle předlohy (pohled předlohy bez skrytých hran → jen viditelné hrany modelu). Zadaný pohled (N.M)
 * se porovná bez kontroly velikosti; `scale` = měřítko pohledu předlohy zadané příkazem.
 */
function bestMatch(st: RefState, mod: Geo, view: ModelViewKey, cands: RefView[], tol: number, hidden: boolean | undefined, align?: Partial<Align>, o: { forced?: boolean; scale?: number } = {}): { cmp: RefCompare; rv: RefView; geo: Geo; mod: Geo } | null {
  let best: { cmp: RefCompare; rv: RefView; geo: Geo; mod: Geo } | null = null;
  const mw = mod.box.x1 - mod.box.x0;
  const mh = mod.box.y1 - mod.box.y0;
  for (const rv0 of cands) {
    const gs = viewScale(st, rv0, o.scale);
    const rv: RefView = gs ? { ...rv0, geomScale: gs } : rv0;
    const w = rv.w / (rv.geomScale || 1);
    const h = rv.h / (rv.geomScale || 1);
    const fits = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, 0.03 * Math.max(a, b));
    if (!o.forced && cands.length > 1 && !align?.dx && !((fits(w, mw) && fits(h, mh)) || (fits(w, mh) && fits(h, mw)))) continue;
    const geo = refGeo(viewGeometry(st.model, st.extract, rv.id), rv, { hidden: hidden !== false, tol });
    if (!geo.segs.length) continue;
    const visibleOnly = hidden === undefined && !geo.segs.some((x) => x.hidden) && mod.segs.some((x) => x.hidden);
    const m = visibleOnly ? visibleGeo(mod) : mod;
    const cmp = compareGeo(geo, m, { tol, align, view: viewName(view), refView: rv.id + (rv.label ? ` ${rv.label}` : ""), anySize: o.forced });
    if (!cmp) continue;
    if (visibleOnly) cmp.visibleOnly = true;
    if (o.forced) cmp.forced = true;
    if (gs) cmp.scale = gs;
    if (!best || cmp.coverage + cmp.modelCoverage > best.cmp.coverage + best.cmp.modelCoverage) best = { cmp, rv, geo, mod: m };
  }
  return best;
}

const stamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** provedení příkazu předlohy */
export async function runReferenceCmd(cmd: RefCmd, doc: CadDoc, env: RefEnv): Promise<RefResult> {
  switch (cmd.kind) {
    case "load": {
      const { bytes, name } = fileBytes(cmd, env);
      const st = referenceStore.put(await loadReference(name, bytes, env.load));
      const info: RefDocInfo = { ...st.info, ...(docRef(doc)?.id === st.info.id && docRef(doc)?.checks ? { checks: docRef(doc)!.checks } : {}) };
      st.info = info;
      referenceStore.setLast({ kind: "status", info, extract: st.extract });
      const log = statusLines(st);
      log[0] = log[0].replace(/^✓ /, `✓ ${tr("připojeno")}: `);
      if (st.note) log.push(`· ${st.note.length > 600 ? `${st.note.slice(0, 600)} …` : st.note}`);
      return { log, doc: withRef(doc, info), data: { info, extract: st.extract } };
    }
    case "status": {
      const st = await current(doc, env);
      referenceStore.setLast({ kind: "status", info: st.info, extract: st.extract });
      return { log: statusLines({ ...st, info: docRef(doc) ?? st.info }, doc.kind === "draft" ? undefined : modelPrint(doc)), data: { info: st.info, extract: st.extract } };
    }
    case "extract": {
      const st = await current(doc, env);
      const lines = extractLines(st.extract, cmd.what, cmd);
      referenceStore.setLast({ kind: "extract", what: cmd.what, extract: st.extract });
      return { log: lines.length ? lines : [tr("· nic (filtr list / pohled)")], data: st.extract };
    }
    case "open": {
      const st = await current(doc, env);
      const nd: CadDoc = { ...emptyDraftDoc(tr("Předloha {0}", st.info.name.replace(/\.[^.]+$/, ""))), draft: st.model };
      return { log: [tr("✓ předloha „{0}“ otevřena jako 2D výkres v nové záložce (jen k prohlížení; změny předlohu v dokumentu nemění)", st.info.name)], newDoc: nd };
    }
    case "remove": {
      const info = docRef(doc);
      if (!info) return { log: [tr("· k dokumentu není připojená předloha")] };
      referenceStore.delete(info.id);
      return { log: [tr("✓ předloha „{0}“ odebrána z dokumentu", info.name)], doc: withRef(doc, undefined) };
    }
    case "compare": {
      const st = await current(doc, env);
      const tol = cmd.tol ?? 0.06;
      const mv = (await modelViews(doc, env, [cmd.view], cmd.hidden !== false, tol)).get(cmd.view);
      if (!mv) throw new Error(tr("pohled {0} modelu je prázdný", viewName(cmd.view)));
      const best = bestMatch(st, mv, cmd.view, refViews(st, cmd), tol, cmd.hidden, cmd.align, { forced: !!cmd.refView, scale: cmd.scale });
      if (!best && cmd.refView) throw new Error(tr("pohled předlohy {0} se s pohledem {1} modelu ({2} × {3} mm) nepodařilo sesouhlasit – zkuste měřítko 1:N, otočení 90 / zrcadlit nebo posun dx dy", cmd.refView, viewName(cmd.view), +(mv.box.x1 - mv.box.x0).toFixed(2), +(mv.box.y1 - mv.box.y0).toFixed(2)));
      if (!best) throw new Error(tr("žádný pohled předlohy{0} neodpovídá velikostí pohledu {1} modelu ({2} × {3} mm) – zadejte pohled předlohy (N.M), měřítko 1:N nebo posun", cmd.sheet !== undefined ? tr(" na listu {0}", cmd.sheet) : "", viewName(cmd.view), +(mv.box.x1 - mv.box.x0).toFixed(2), +(mv.box.y1 - mv.box.y0).toFixed(2)));
      const svgName = `porovnani-${safe(viewName(cmd.view))}-${best.rv.id}.svg`;
      if (env.download) await env.download(svgName, new TextEncoder().encode(best.cmp.svg), "image/svg+xml");
      st.lastCompare = best.cmp;
      const info: RefDocInfo = { ...(docRef(doc) ?? st.info) };
      info.checks = { ...info.checks, compare: { ...info.checks?.compare, [cmd.view]: { refView: best.rv.id, coverage: best.cmp.coverage, modelCoverage: best.cmp.modelCoverage, at: stamp(), model: modelPrint(doc) } } };
      st.info = info;
      referenceStore.setLast({ kind: "compare", ...best.cmp });
      return { log: compareLines(best.cmp, env.download ? svgName : undefined), doc: withRef(doc, info), data: best.cmp };
    }
    case "checkDims": {
      const st = await current(doc, env, true);
      const tol = cmd.tol ?? 0.06;
      const keys: ModelViewKey[] = cmd.view ? [cmd.view] : ["front", "top", "left", "right", "back", "bottom"];
      const mvs = await modelViews(doc, env, keys, true, tol);
      const cands = refViews(st, cmd);
      // každý pohled předlohy s kótami → nejlépe odpovídající pohled modelu (pokrytí aspoň 50 %)
      const found: { view: ModelViewKey; rv: RefView; cmp: RefCompare; mod: Geo }[] = [];
      for (const rv of cands) {
        if (!st.extract.dims.some((d) => d.view === rv.id)) continue;
        let pick: { view: ModelViewKey; rv: RefView; cmp: RefCompare; mod: Geo } | null = null;
        for (const [k, g] of mvs) {
          const b = bestMatch(st, g, k, [rv], tol, undefined, undefined, { forced: !!cmd.refView, scale: cmd.scale });
          if (b && b.cmp.coverage >= 50 && (!pick || b.cmp.coverage > pick.cmp.coverage)) pick = { view: k, rv: b.rv, cmp: b.cmp, mod: b.mod };
        }
        if (pick) found.push(pick);
      }
      if (!found.length) throw new Error(tr("žádný pohled předlohy s kótami neodpovídá pohledům modelu (pokrytí pod 50 %) – porovnat předloha pohled přední ukáže, co nesedí"));
      // výkres s více díly: jen list, který modelu odpovídá nejlépe (nejlepší pohled oběma směry; shoda názvu v razítku
      // rozhoduje při shodě) – kóty jiných dílů by daly falešné ✗ i ✓; jiný list: kontrola kót list N
      const sheetsOf = [...new Set(found.map((p) => p.rv.sheet))];
      let sheet = cmd.sheet;
      if (sheet === undefined && !cmd.refView && sheetsOf.length > 1) {
        const norm = (x?: string) => (x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
        const dn = norm(doc.name);
        const score = (n: number) => {
          const ss = found.filter((p) => p.rv.sheet === n).map((p) => Math.min(p.cmp.coverage, p.cmp.modelCoverage)).sort((a, b) => b - a);
          const t = st.extract.sheets.find((s) => s.n === n)?.title;
          const named = [t?.name, t?.number].some((x) => norm(x).length >= 3 && (dn.includes(norm(x)) || norm(x).includes(dn)));
          return { best: ss[0] ?? 0, second: ss[1] ?? 0, named };
        };
        sheet = sheetsOf.sort((a, b) => {
          const A = score(a);
          const B = score(b);
          return B.best + (B.named ? 2 : 0) - (A.best + (A.named ? 2 : 0)) || B.second - A.second || a - b;
        })[0];
      }
      const pairs = sheet === undefined ? found : found.filter((p) => p.rv.sheet === sheet);
      const log: string[] = [];
      const all: RefDimCheck[] = [];
      for (const p of pairs) {
        // body kót i na skrytých hranách modelu (řez předlohy ukazuje zahloubení, které je v pohledu modelu skryté)
        const rs = checkDims(st.extract.dims.filter((d) => d.view === p.rv.id), p.rv, mvs.get(p.view) ?? p.mod, { rot: p.cmp.align.rot, mirror: p.cmp.align.mirror, dx: p.cmp.align.dx, dy: p.cmp.align.dy }, { tol });
        all.push(...rs);
        log.push(...dimCheckLines(viewName(p.view), p.rv.id + (p.rv.label ? ` ${p.rv.label}` : ""), rs));
      }
      const ok = all.filter((r) => r.ok).length;
      const bad = all.filter((r) => !r.ok && r.how !== "none" && r.how !== "unchecked").length;
      const skipped = all.filter((r) => r.how === "none").length;
      const unchecked = all.filter((r) => r.how === "unchecked").length;
      st.lastDims = all;
      const info: RefDocInfo = { ...(docRef(doc) ?? st.info) };
      info.checks = { ...info.checks, dims: { ok, bad, skipped, unchecked, at: stamp(), ...(sheet !== undefined ? { sheet } : {}), model: modelPrint(doc) } };
      st.info = info;
      referenceStore.setLast({ kind: "dims", ok, bad, skipped, unchecked, ...(sheet !== undefined ? { sheet } : {}), rows: all.map((r) => ({ id: r.dim.id, view: r.dim.view, text: r.dim.text, value: r.dim.value, model: r.model, ok: r.ok, how: r.how, note: r.note })) });
      const mark = bad ? "✗" : skipped || !ok ? "⚠" : "✓";
      if (pairs.length > 1) log.push(tr("{0} celkem: {1} ✓, {2} ✗, {3} bez bodu v modelu, {4} nekontrolováno ({5} pohledů)", mark, ok, bad, skipped, unchecked, pairs.length));
      const others = sheetsOf.filter((n) => n !== sheet);
      if (sheet !== undefined && cmd.sheet === undefined && others.length) log.push(tr("· kontrolován list {0} (odpovídá modelu nejlépe); kóty listů {1} se nekontrolovaly – kontrola kót list N", sheet, others.join(", ")));
      return { log, doc: withRef(doc, info), data: referenceStore.last() };
    }
  }
}
