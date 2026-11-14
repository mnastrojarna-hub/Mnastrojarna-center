/**
 * Pracovní dokument běhu skriptu (dřív lokální proměnné a funkce smyčky `runAgentText` v cad-app.tsx, přesunuto beze změny
 * chování): zápis rozpracovaného dokumentu (`flush`), příprava prvku (`prepare` – výchozí název, odkazy názvem a `$last`,
 * tělesa, režim, duplicitní id), stavba a topologie přes jádro hostitele.
 */
import { bodiesAt, isNewBodyMode, nextBodyName } from "../bodies";
import { resolveDatumNames } from "../agent-prim";
import { freeName } from "../agent-edit";
import { getExt } from "../ext/registry";
import { tr } from "../i18n";
import { uid, type CadDoc, type Feature, type FeatureType } from "../types";
import type { OpCtx, RunState } from "./ops/registry";
import { codeDef, type Code, type CodeEntryInit } from "./codes";
import { canon, FEATURE_LABEL } from "../agent";

/**
 * záznam s kódem na řádku právě prováděné operace (jako `coded` v ops/util.ts – tady bez cyklického importu); ℹ (neškodná
 * normalizace) jen do protokolu – konzole zůstává beze změny, ⚠ i do konzole
 */
const note = (ctx: OpCtx, code: Code, o: CodeEntryInit) => {
  const e = { line: ctx.line, ...(ctx.run.doc?.name !== undefined ? { doc: ctx.run.doc.name } : {}), ...o };
  if (ctx.log && codeDef(code)?.level !== "note") ctx.log.coded(ctx.line, code, e);
  else ctx.report.code(code, e);
};
/** řádek operace obsahuje výslovné „přidat“ (EN add, DE hinzufügen) – ne příkaz `sloučit` */
const explicitAdd = (ctx: OpCtx) => {
  const w = (ctx.run.srcLines?.[ctx.line - 1] ?? "").trim().split(/\s+/);
  return canon(w[0] ?? "") !== "add" && w.slice(1).some((x) => canon(x) === "add");
};
/** výchozí název prvku („Kvádr 3“) – přečíslování je pak automatické (ℹ), jinak výslovné (⚠) */
const isDefaultName = (f: Feature, name: string) => new RegExp(`^${(tr(FEATURE_LABEL[f.type] ?? f.type)).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\d+$`).test(name);

/** stav běhu se všemi poli (engine/run.ts ho tak zakládá) */
export type EngineRun = RunState & Required<Pick<RunState, "added" | "currentBody" | "openDrawingAfter" | "tabbed">>;
export const runOf = (ctx: OpCtx): EngineRun => ctx.run as EngineRun;

/** typy prvků s tělesem (pro „přidat“ bez tělesa → nové těleso) */
const SOLID = new Set(["extrude", "revolve", "box", "cylinder", "sphere", "cone", "tube", "import", "sweep", "loft", "spring", "thicken", "text", "ext"]);
/** prvky, které tělesu nepatří (skica, pomocná geometrie) */
export const NO_BODY_TYPES = new Set<FeatureType>(["sketch", "datum", "datumAxis", "datumPoint", "csys"]);

export const hasSolid = (d: CadDoc) => d.features.some((f) => SOLID.has(f.type) && !f.suppressed);
const lastSketch = (d: CadDoc) => [...d.features].reverse().find((f) => f.type === "sketch");
const lastFeature = (d: CadDoc) => d.features[d.features.length - 1];

/**
 * Zapíše dosavadní změny (před přechodem na jiný dokument v témže vstupu): nový dokument do nové záložky (jen poprvé –
 * další změny téhož dokumentu jdou do jeho záložky), jinak krok historie aktivní záložky.
 */
export async function flush(ctx: OpCtx): Promise<void> {
  const r = runOf(ctx);
  if (!r.changed) return;
  if (r.openNew && !r.tabbed) {
    await ctx.ws.openInTab(r.doc, r.docId ? { docId: r.docId } : {});
    r.tabbed = true;
  } else ctx.ws.commit(r.doc);
  r.changed = false;
}

/**
 * Nový dokument běhu (nový díl / sestava, JSON, normálie, rám formy, 2D výkres): zatím bez záložky, s vlastním klíčem
 * (`docId`). `openNew: false` (JSON s `inPlace`) nahradí dokument aktivní záložky – stav vazeb a kolizí původního
 * dokumentu pod klíčem záložky se zahodí (patřil jinému dokumentu).
 */
export function startDoc(ctx: OpCtx, d: CadDoc, o: { openNew?: boolean } = {}): void {
  const r = runOf(ctx);
  r.doc = d;
  r.openNew = o.openNew ?? true;
  r.tabbed = false;
  r.changed = true;
  r.docId = r.openNew ? uid() : undefined;
  if (!r.openNew) {
    const k = ctx.ws.docKey();
    ctx.ws.asm.mateStatus.delete(k);
    ctx.ws.asm.clash.delete(k);
  }
}

/**
 * Klíč pracovního dokumentu běhu pro stav vazeb a kolizí (`ws.asm.mateStatus` / `ws.asm.clash`): nový dokument bez záložky
 * = jeho `docId`, jinak klíč aktivní záložky (pracovní dokument je vždy dokument aktivní záložky nebo nový dokument běhu).
 */
export const docKeyOf = (ctx: OpCtx): string => {
  const r = runOf(ctx);
  return r.openNew && !r.tabbed && r.docId ? r.docId : ctx.ws.docKey();
};

/** odkaz na skicu / prvek: id, název (bez ohledu na velikost písmen) nebo `$last` */
export function refId(d: CadDoc, v: unknown, what: "sketch" | "feature"): unknown {
  if (typeof v !== "string" || d.features.some((x) => x.id === v)) return v;
  if (v === "$last") {
    const hit = what === "sketch" ? lastSketch(d) : lastFeature(d);
    if (!hit) throw new Error(what === "sketch" ? tr("není žádná skica – nejdřív „skica XY: …“") : tr("není žádný prvek, na který by se pole / zrcadlení vztahovalo"));
    return hit.id;
  }
  const hit = [...d.features].reverse().find((x) => (what === "feature" || x.type === "sketch") && x.name.toLowerCase() === v.toLowerCase());
  if (!hit) throw new Error(tr("„{0}“ v historii není – k dispozici: {1}", v, d.features.filter((x) => what === "feature" || x.type === "sketch").map((x) => x.name).join(", ") || "—"));
  return hit.id;
}

/**
 * Příprava prvku k přidání do pracovního dokumentu: volný výchozí název, odkazy názvem / `$last`, pomocná geometrie
 * názvem, tělesa („nové“, „těleso N“), režim přidání bez tělesa, duplicitní id → nové.
 */
export function prepare(ctx: OpCtx, f0: Feature, keepName = false): Feature {
  const r = runOf(ctx);
  const d = r.doc;
  const f = { ...f0 } as Feature;
  if (!keepName) {
    const given = f.name;
    f.name = freeName(d.features, f); // „Skica 1“ z dřívějšího běhu už v dílu je → „Skica 2“ (odkazy názvem jednoznačné)
    // 5.2 č. 15: obsazený název nikdy tiše – výslovný název ⚠ name.renamed, výchozí ℹ name.renamed-auto
    if (f.name !== given) note(ctx, isDefaultName(f, given) ? "name.renamed-auto" : "name.renamed", { args: isDefaultName(f, given) ? [f.name] : [given, f.name] });
  }
  // odkazy názvem (obecný příkaz „prvek“): skici a prvky podle názvu nebo `$last`
  const rec = f as unknown as Record<string, unknown>;
  for (const k of ["sketchId", "profileId", "pathId", "guideId"]) if (k in rec && rec[k] !== "$last") rec[k] = refId(d, rec[k], "sketch");
  for (const k of ["sketchIds", "profileIds", "guideIds"]) if (Array.isArray(rec[k])) rec[k] = (rec[k] as unknown[]).map((v) => refId(d, v, "sketch"));
  if ("featureId" in rec && rec.featureId !== "$last") rec.featureId = refId(d, rec.featureId, "feature");
  if (typeof rec.partingSketchId === "string" && rec.partingSketchId) rec.partingSketchId = refId(d, rec.partingSketchId, "sketch"); // úkos s dělicí křivkou (název / $last)
  if (Array.isArray(rec.featureIds)) rec.featureIds = (rec.featureIds as unknown[]).map((v) => refId(d, v, "feature"));
  if (f.type === "ext") {
    const data = { ...(f.data ?? {}) } as Record<string, unknown>;
    for (const prm of getExt(f.ext)?.params ?? []) {
      if (prm.kind === "sketch" && data[prm.key]) data[prm.key] = refId(d, data[prm.key], "sketch");
      else if (prm.kind === "feature" && data[prm.key]) data[prm.key] = refId(d, data[prm.key], "feature");
      else if (prm.kind === "sketches" && Array.isArray(data[prm.key])) data[prm.key] = (data[prm.key] as unknown[]).map((v) => refId(d, v, "sketch"));
      else if (prm.kind === "features" && Array.isArray(data[prm.key])) data[prm.key] = (data[prm.key] as unknown[]).map((v) => refId(d, v, "feature"));
    }
    (f as { data: Record<string, unknown> }).data = data;
  }
  resolveDatumNames(f, d.features, !keepName); // pomocná rovina / osa / bod názvem → id (agent-prim.ts); celý dokument bez chyby
  // více těles: „nové“ = nové těleso s dalším volným názvem; „těleso N“ = cílové těleso dalších prvků
  if (f.body === "$new") f.body = hasSolid(d) ? nextBodyName(bodiesAt(d).names) : undefined;
  if (f.body) {
    const bs = bodiesAt(d);
    if (bs.started && !bs.names.includes(f.body) && !isNewBodyMode(f)) throw new Error(tr("těleso „{0}“ v dílu není – tělesa: {1}", f.body, bs.names.join(", ")));
    if (isNewBodyMode(f) && !bs.names.includes(f.body)) r.currentBody = null;
  } else if (r.currentBody && !NO_BODY_TYPES.has(f.type) && f.type !== "combine" && f.type !== "copyBody") f.body = r.currentBody;
  const g = f as Feature & { sketchId?: string; featureId?: string; profileId?: string; mode?: string };
  if (g.sketchId === "$last" || g.profileId === "$last") {
    const sk = lastSketch(d);
    if (!sk) throw new Error(tr("není žádná skica – nejdřív „skica XY: …“"));
    if (g.sketchId === "$last") g.sketchId = sk.id;
    if (g.profileId === "$last") g.profileId = sk.id;
  }
  if (g.featureId === "$last") {
    const lf = lastFeature(d);
    if (!lf) throw new Error(tr("není žádný prvek, na který by se pole / zrcadlení vztahovalo"));
    g.featureId = lf.id;
  }
  // 5.2 č. 16: výslovné „přidat“ (slovo na řádku) bez tělesa = nové těleso (ℹ mode.new-body); výchozí režim primitiv se nehlásí
  if (g.mode === "add" && !hasSolid(d) && SOLID.has(g.type) && explicitAdd(ctx)) note(ctx, "mode.new-body", {});
  if (g.mode === "$auto" || (g.mode === "add" && !hasSolid(d))) g.mode = hasSolid(d) ? "add" : "new";
  if (d.features.some((x) => x.id === g.id)) {
    // 5.2 č. 17: duplicitní id z JSON → nové id (odkazy jiných prvků na původní id míří na dřívější prvek)
    note(ctx, "json.id-renewed", { args: [g.id] });
    g.id = uid();
  }
  return g as Feature;
}

/** stavba pracovního dokumentu v jádře hostitele */
export const buildDoc = (ctx: OpCtx) => ctx.host.kernel.build(runOf(ctx).doc);

/** plochy a hrany tělesa, na kterém bude prvek pracovat (u více těles jen cílové těleso – je ve výsledku první) */
export async function topology(ctx: OpCtx, body?: string) {
  const d = runOf(ctx).doc;
  // sestavení a inspekce ploch/hran atomicky v jádře – mezi build() a inspect() by mohlo proběhnout sestavení jiné záložky
  const t = await ctx.host.kernel.topology(body ? { ...d, activeBody: body } : d);
  if (!t) throw new Error(tr("žádné těleso – nejdřív vytvořte tvar (kvádr, vysunutí…)"));
  const act = t.bodies && t.bodies.length > 1 ? t.bodies[0] : null;
  return act ? { ...t, faces: t.faces.filter((x) => x.index < act.faceCount), edges: t.edges.filter((x) => x.index < act.edgeCount) } : t;
}

/** skica otevřená ve skicáři aplikace (cíl entit / vazeb bez bloku) – jen když běh skicu nezaložil a dokument není nový */
export const openSketchFor = (ctx: OpCtx): string | null => {
  const r = runOf(ctx);
  return r.openNew || r.added.some((f) => f.type === "sketch") ? null : (ctx.host.ui?.openSketchId?.() ?? null);
};
