/**
 * Souhrny dokumentů běhu – řádky `D` protokolu (CAD-HEADLESS-NAVRH.md kap. 3.1, 4.2) v CLI / HTTP (cli/job.ts `finishRun`)
 * i v prohlížeči (`window.mncad.run(text, { protocol: "short" })`, engine/run-protocol.ts). Přesunuto z cli/job.ts (vlna E,
 * balík runs), aby prohlížeč dával tytéž řádky D jako CLI.
 *
 * Co se postaví a změří (vlna E, bod 2 „každý dokument vícedokumentového běhu má řádek D s čísly“):
 * * hlavní dokument (`--doc`, jinak poslední sestava, jinak aktivní) a s `--all-docs` všechny dokumenty – jako dřív;
 * * NAVÍC každý dokument, který běh založil nebo změnil (`Workspace.runDocKeys`): díl se nestaví znovu, výsledek je
 *   v mezipaměti dílů sestavy (`ws.asm.cache` – RunVerifier ho postavil, když běh dokument opustil), jinak se postaví;
 * * dokumenty z dřívějších běhů relace, které běh nezměnil, zůstávají bez stavby (`V=-`) – relace se 70 díly nestaví 70×;
 * * prázdný dokument, který běh založil (prázdná sestava, B1), má řádek D vždy; prázdný úvodní díl relace ne.
 */
import { flattenLeaves } from "../asm-flatten";
import { sourceKey } from "../assembly";
import { clashStale } from "../clash-class";
import { entryCounts } from "../clash-report";
import { docHasContent } from "../draft/doc";
import { featureCounts } from "../feature-levels";
import { tr } from "../i18n";
import type { BuildResult, CadDoc } from "../types";
import { MATERIALS } from "@/lib/mesh-metrics";
import { checkKernelGeneration } from "./asm-env";
import { asmStatus } from "./asm-status";
import { codeEntry, featureWarnCode, type Code, type CodeEntryInit } from "./codes";
import { validityOf } from "./validity-store";
import type { EngineHost } from "./host";
import { matesCount } from "./kv";
import { checkClashes, clashFindings } from "./ops/clash";
import type { ReportBuilder } from "./protocol";
import type { DocSummary } from "./protocol-types";
import { staleResults } from "./result-key";
import { modelId, staleOutputKinds } from "../doc-outputs";
import { docOfTab, runDocKeySet } from "./runs";
import type { Workspace } from "./workspace";

export type DocItem = { id: string; doc: CadDoc; key?: string };
const docKind = (d: CadDoc): DocSummary["kind"] => (d.kind === "assembly" ? "assembly" : d.kind === "draft" ? "draft" : "part");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * dokumenty všech záložek (bez záložek výkresu – sdílejí dokument zdrojové záložky); dokument se čte bez přepnutí záložky
 * (`Workspace.docOf`), u hostitele bez něj přepnutím (aktivní záložka se obnoví)
 */
export async function workspaceDocs(ws: Workspace): Promise<{ items: DocItem[]; activeId: string | null }> {
  const all = ws.tabs();
  const tabs = all.filter((t) => t.kind !== "drawing");
  const act = all.find((t) => t.active) ?? null;
  const items: DocItem[] = [];
  let switched = false;
  for (const t of tabs) {
    const r = await docOfTab(ws, t.id);
    switched ||= r.switched;
    items.push({ id: t.id, doc: r.doc, key: ws.docKey(t.id) });
  }
  if (switched && act) await ws.activate(act.id);
  // aktivní záložka výkresu (aplikace) → záložka jejího dokumentu
  const present = act && act.kind === "drawing" ? ws.present() : null;
  const activeId = act ? (act.kind !== "drawing" ? act.id : (items.find((x) => x.doc === present)?.id ?? null)) : null;
  return { items, activeId };
}

/** hlavní dokument (kap. 3.1): `--doc`, jinak poslední sestava, jinak aktivní dokument */
export function pickMain(items: DocItem[], activeId: string | null, name?: string): DocItem | null | "missing" {
  if (name) {
    const f = name.trim().toLowerCase();
    return items.find((x) => x.doc.name.trim().toLowerCase() === f) ?? "missing";
  }
  return [...items].reverse().find((x) => x.doc.kind === "assembly" && docHasContent(x.doc)) ?? items.find((x) => x.id === activeId) ?? items[items.length - 1] ?? null;
}

export type BuildOutcome = { summary: DocSummary; built: boolean };

/**
 * Závěrečná stavba a souhrn dokumentu (řádek D). Díl se postaví v jádře; u sestavy se díly komponent postaví před
 * souhrnem (`asmStatus` → `ensureLeaves`, engine/asm-status.ts): objem Σ (V.sum), hmotnost, obálka a stav vazeb z běhu.
 * `o.cached`: díl, který není hlavním dokumentem, vezme výsledek z mezipaměti dílů (`ws.asm.cache`, postavil ho běh), a
 * postaví se jen tehdy, když tam není. Takový vedlejší dokument běhu bez tělesa (jen skica – profil, dráha) není chyba:
 * řádek D ukáže `V=-`, ✗ `build.failed` „model nemá těleso“ patří jen dokumentu, který se má odevzdat (hlavní, `--all-docs`).
 */
export async function summarize(d: CadDoc, kernel: EngineHost["kernel"], rb: ReportBuilder, build: boolean, ws?: Workspace, key?: string, o: { cached?: boolean } = {}): Promise<BuildOutcome> {
  const s: DocSummary = { ref: d.name, name: d.name, kind: docKind(d) };
  if (d.drawings?.length) s.sheets = d.drawings.length;
  // revize modelu u dokumentu s výstupy (listy, záznamy exportů) – řádek D `rev=`, JSON `docs[].rev` (vlna 22, bod 20)
  if (d.kind !== "draft" && (d.drawings?.length || d.outputs?.length)) s.rev = modelId(d).rev;
  if (s.kind === "assembly") {
    s.components = d.components?.length ?? 0;
    s.parts = new Set((d.components ?? []).map((c) => sourceKey(c.source))).size;
    if (ws && s.components > 0)
      try {
        // stav vazeb a kolize pod klíčem dokumentu záložky (přejmenování ho nezmění); chybějící stav vazeb se přepočítá
        const st = await asmStatus(ws, kernel, d, key !== undefined ? { key } : {});
        if (st?.volume != null) s.volume_mm3 = st.volume;
        if (st?.massKg != null) s.mass_kg = st.massKg;
        // obálka přesně z jádra (asmStatus → engine/asm-box.ts; zkouška 959: rohy lokálních obálek natočených dílů ji zvětšily o 3 mm)
        if (st?.bbox) s.bbox = st.bbox;
        reportLeafParts(d, ws, rb);
        const m = matesCount(d, st?.mates);
        if (m) s.mates = m;
        // třídy kolizí z poslední kontroly kolizí sestavy (`kolize`, `kontrola sestava`) – řádek D i Σ; objem sjednocení
        // V.union = V.sum − průniky dvojic (rozhodnutí 15.1; přesné, nepřekrývají-li se v jednom místě tři komponenty).
        // Změnila-li se sestava po kontrole (vložená / posunutá komponenta…), výsledek se pro konečný stav přepočítá
        // (mezipaměť dvojic v jádře – počítají se jen změněné dvojice) a jeho ⚠ jdou do protokolu: D, Σ i --strict tak
        // vždy odpovídají odevzdávané sestavě (ℹ clash.rechecked s řádkem původní kontroly).
        const ckey = key ?? ws.docKey();
        let ck = ws.asm.clash.get(ckey);
        if (ck && clashStale(ck, d)) {
          const was = ck.line;
          const { list, res } = await checkClashes(ws, kernel, d, ckey, was ?? null);
          rb.code("clash.rechecked", { doc: d.name, args: [was ? `L${was}` : "-"] });
          const emit = (c: Code, o: CodeEntryInit) => void rb.code(c, { ...o, doc: d.name });
          clashFindings({ coded: emit, quiet: emit }, d, list, res);
          ck = ws.asm.clash.get(ckey);
        }
        // třídy po pravidlech KONEČNÉHO dokumentu (pracovní kontakt, dotyk – vlna 22, bod 5; clash-report.ts), bez seznamu uložené počty
        const cl = ck ? (ck.list ? entryCounts(ck, d) : ck.classes) : undefined;
        if (cl) s.clashes = { total: cl.total, thread: cl.thread, underhead: cl.underhead, real: cl.real, undetermined: cl.undetermined, ...(cl.touch ? { touch: cl.touch } : {}), ...(cl.work ? { work: cl.work } : {}) };
        if (cl && s.volume_mm3 !== undefined) s.volume_union_mm3 = s.volume_mm3 - ck!.res.reduce((a, x) => a + x.volume, 0);
        markStale(s, ws, ckey, d);
      } catch (e) {
        rb.code("build.failed", { doc: d.name, args: [errText(e)] });
        return { summary: s, built: false };
      }
    return { summary: s, built: true };
  }
  if (s.kind === "draft" || !build) return { summary: s, built: s.kind === "draft" };
  if (!d.features.length) {
    s.features = { ok: 0, warn: 0, error: 0 };
    return { summary: s, built: false };
  }
  try {
    const res = (o.cached && ws ? cachedPart(ws, kernel, d) : null) ?? (await kernel.build(d));
    const names = new Map(d.features.map((f) => [f.id, f.name]));
    // výsledek prvku, který už ohlásil běh skriptu (s řádkem prvku), se ze závěrečné stavby neopakuje
    const seen = new Set(rb.entries.map((e) => `${e.code}\u0000${e.doc ?? ""}\u0000${e.text}`));
    const report = (code: Code, args: string[]) => {
      const e = codeEntry(code, { doc: d.name, args });
      if (!seen.has(`${e.code}\u0000${e.doc}\u0000${e.text}`)) rb.add(e);
    };
    for (const st of res.status) {
      if (!st.ok) report("feature.failed", [names.get(st.id) ?? st.id, st.error ?? ""]);
      else if (st.warning) report(featureWarnCode(st), [names.get(st.id) ?? st.id, st.warning]);
    }
    for (const pe of res.paramErrors ?? []) rb.code("build.failed", { doc: d.name, args: [pe] });
    // prvek bez kontroly platnosti tělesa se mezi ✓ nepočítá (vlastní počet `unchecked`, feature-levels.ts)
    s.features = featureCounts(res.status);
    if (res.metrics) {
      // bez objemového tělesa (22c) objem ani hmotnost nejsou – řádek D `V=- m=-`, JSON bez `volume_mm3` / `mass_kg`
      const noSolid = res.metrics.solids === 0;
      if (!noSolid) s.volume_mm3 = res.metrics.volume;
      s.bbox = res.metrics.bbox;
      if (res.metrics.solids !== undefined) s.solids = res.metrics.solids;
      if (res.metrics.free) s.free = res.metrics.free;
      s.valid = res.metrics.valid ?? null;
      if (typeof s.valid === "boolean") s.validCheck = res.metrics.validCheck ?? "fast";
      // přesná kontrola pro tuto geometrii (kontrola přesně / export) má přednost před rychlou (engine/validity-store.ts)
      const exact = ws && key !== undefined ? validityOf(ws, key, d) : undefined;
      if (exact && exact.valid !== null) {
        s.valid = exact.valid;
        s.validCheck = "exact";
      }
      const mt = MATERIALS.find((m) => m.id === d.material);
      if (mt) {
        s.density = mt.density;
        if (!noSolid) s.mass_kg = (res.metrics.volume / 1e6) * mt.density;
      }
    }
    const error = s.features.error;
    const built = !!res.metrics && error === 0 && !(res.paramErrors?.length);
    if (!built && !error && !(o.cached && !res.metrics && !res.paramErrors?.length)) rb.code("build.failed", { doc: d.name, args: [tr("model nemá těleso")] });
    if (ws && key !== undefined) markStale(s, ws, key, d);
    return { summary: s, built };
  } catch (e) {
    rb.code("build.failed", { doc: d.name, args: [errText(e)] });
    return { summary: s, built: false };
  }
}

/**
 * `stale=` řádku D: uložené výsledky dokumentu (kolize, stav vazeb, pohyb, měření, porovnání), které jeho konečnému stavu
 * neodpovídají (engine/result-key.ts). Kolize a stav vazeb se před tím přepočítají – zůstanou jen ty, které přepočítat nešly.
 */
function markStale(s: DocSummary, ws: Workspace, key: string, d: CadDoc): void {
  // + vydané listy a záznamy exportů ze starší revize modelu (`drawing`, `export` – vlna 22, bod 20, cad/doc-outputs.ts)
  const stale = [...staleResults(ws, key, d), ...staleOutputKinds(d)];
  if (stale.length) s.stale = stale;
}

/**
 * výsledek dílu z mezipaměti dílů sestavy (klíč jako RunVerifier / `vložit`: `sourceKey` dílu) – jen pro tutéž generaci
 * jádra (po restartu se mezipaměť vyprázdní a díl se postaví)
 */
function cachedPart(ws: Workspace, kernel: EngineHost["kernel"], d: CadDoc): BuildResult | null {
  checkKernelGeneration(ws, kernel);
  return ws.asm.cache.get(sourceKey({ kind: "part", doc: { ...d, kind: "part" } })) ?? null;
}

/**
 * ⚠/✗ prvků dílů komponent sestavy ze stavby listů (`ensureLeaves` → `ws.asm.cache`): sestava otevřená z JSON / `--open`
 * nebo relace jinak své díly jen sečte (zkouška 959: osmkrát „neplatná geometrie“ u jednoho dílu, přesto --strict prošel).
 * Jeden záznam na prvek a díl (stejný díl ve více komponentách jednou); co už ohlásil běh skriptu na řádku prvku, se
 * neopakuje. Stručný protokol hlášky dílu se stejným textem sloučí (protocol.ts `mergeSimilar`).
 */
function reportLeafParts(d: CadDoc, ws: Workspace, rb: ReportBuilder): void {
  const seen = new Set(rb.entries.map((e) => `${e.code}\u0000${e.doc ?? ""}\u0000${e.text}`));
  const done = new Set<string>();
  for (const l of flattenLeaves(d)) {
    if (done.has(l.key) || l.comp.source.kind !== "part") continue;
    done.add(l.key);
    const pd = l.comp.source.doc;
    const status = ws.asm.cache.get(l.key)?.status ?? [];
    const names = new Map(pd.features.map((f) => [f.id, f.name]));
    for (const st of status) {
      if (st.ok !== false && !st.warning) continue;
      const failed = st.ok === false;
      const e = codeEntry(failed ? "feature.failed" : featureWarnCode(st), { doc: pd.name || l.comp.name, args: [names.get(st.id) ?? st.id, (failed ? st.error : st.warning) ?? ""] });
      const k = `${e.code}\u0000${e.doc ?? ""}\u0000${e.text}`;
      if (seen.has(k)) continue;
      seen.add(k);
      rb.add(e);
    }
  }
}

/**
 * Řádky D dokumentů `items` (viz hlavička modulu): `main` = hlavní dokument (označen `main`), `targets` = id dokumentů, které
 * se postaví vždy (hlavní, `--all-docs`). Vrací souhrny v pořadí záložek a příznak „postaveno bez chyby“ podle id.
 */
export async function docSummaries(ws: Workspace, kernel: EngineHost["kernel"], rb: ReportBuilder, items: DocItem[], main: DocItem | null, targets: ReadonlySet<string>): Promise<{ docs: DocSummary[]; built: Map<string, boolean> }> {
  const ofRun = runDocKeySet(ws);
  const docs: DocSummary[] = [];
  const built = new Map<string, boolean>();
  for (const it of items) {
    const mine = it.key !== undefined && ofRun.has(it.key);
    // prázdný úvodní díl relace se nehlásí; prázdný dokument, který běh založil (prázdná sestava – B1), ano
    if (!docHasContent(it.doc) && it.id !== main?.id && !mine) continue;
    const target = targets.has(it.id);
    const o = await summarize(it.doc, kernel, rb, target || mine, ws, it.key, { cached: !target });
    if (it.id === main?.id) o.summary.main = true;
    built.set(it.id, o.built);
    docs.push(o.summary);
  }
  return { docs, built };
}

/**
 * Souhrny dokumentů po běhu jako v CLI s `--formats none` (prohlížeč – engine/run-protocol.ts): dokumenty záložek, hlavní
 * dokument, řádky D. `doc` = hlavní dokument podle názvu (CLI `--doc`), `allDocs` = postavit všechny (CLI `--all-docs`).
 */
export async function runSummaries(ws: Workspace, kernel: EngineHost["kernel"], rb: ReportBuilder, o: { doc?: string; allDocs?: boolean } = {}): Promise<{ docs: DocSummary[]; main: DocItem | null }> {
  const { items, activeId } = await workspaceDocs(ws);
  const picked = pickMain(items, activeId, o.doc);
  if (picked === "missing") rb.code("op.failed", { args: [tr("dokument „{0}“ (--doc) není otevřený – otevřené: {1}", o.doc, items.map((x) => x.doc.name).join(", ") || "—")] });
  const main = picked === "missing" ? null : picked;
  const targets = new Set((o.allDocs ? items : main ? [main] : []).filter((x) => docHasContent(x.doc)).map((x) => x.id));
  const { docs } = await docSummaries(ws, kernel, rb, items, main, targets);
  return { docs, main };
}
