/**
 * Automatizační rozhraní pro AI agenty – provedení se stavem aplikace (prohlížeč):
 *  - textové příkazy z agent-api.ts (řez, styl zobrazení, barva ploch, akce rozšíření, analýzy, formařské nástroje),
 *  - metody `window.mncad`: importFile, screenshot, compare, share, settings / setSettings, selection / select /
 *    clearSelection, action, export skici DXF (`exportFile("dxf")`) a save (projekt .mncad bez dialogu, agent-out-host.ts).
 * Aplikace (cad-app.tsx) předá přístup ke svému stavu objektem `ApiHost` (obnovuje se při každém vykreslení).
 */
import type { Dispatch, SetStateAction } from "react";
import { cad } from "@/cad/client";
import { cadLocale, tr } from "@/cad/i18n";
import { selectFaces, type MncadApi } from "@/cad/agent";
import {
  applySettingsPatch,
  bytesToBase64,
  captureActionApi,
  checkScreenshotOptions,
  coolingReport,
  curvatureReport,
  draftReport,
  ejectorsReport,
  fileLine,
  parseSelectionId,
  partingPlane,
  partingReport,
  resolveAction,
  apiActions,
  sectionReport,
  shotSize,
  thicknessReport,
  type ApiCmd,
  type CapturedFile,
  type CompareApiOptions,
  type CompareApiResult,
  type ImportFileInput,
  type MncadApiExt,
  type Screenshot,
  type ScreenshotOptions,
  type SelectionEntry,
  type ShareApiOptions,
} from "@/cad/agent-api";
import { applyShrinkage, coolingCircuit, defaultCooling, draftAnalysis, ejectorHoles, ejectorLength, ejectorPinPlacement, suggestEjectors } from "@/cad/mold";
import { curvatureColors, wallThickness } from "@/cad/analysis";
import { ejectorPin, emptyAssembly, partComponent } from "@/cad/assembly";
import { prepareImport } from "@/cad/formats/import";
import { dataBytes, internBlobs } from "@/cad/blobs";
import { createShareLink, shareMessage, SHARE_DEFAULT_DAYS } from "@/cad/share";
import { compareReportCsv, compareReportText, regionHint, regionList } from "@/cad/compare-report";
import type { CompareOptions, ReferenceFile } from "@/cad/compare";
import { distanceColors } from "@/cad/mesh-distance";
import { projectionRange, type PlaneMesh, type SectionState } from "@/cad/section-plane";
import { sketchToDxf } from "@/cad/sketch";
import { loadSettings, type Settings } from "@/cad/settings";
import { uid, type AsmComponent, type BuildResult, type CadDoc, type Feature, type SketchEntity, type Vec3 } from "@/cad/types";
import { getExtUi, type ExtActionApi } from "./ext";
import { asmImportOutcome, partImportOutcome, subassemblyComponent, type PendingImport } from "./import-watch";
import { flattenLeaves } from "./asm-flatten";
import { compRef, leafByRef } from "./leaf-ref";
import type { DraftSetup, SurfaceSetup } from "./mold-panel";
import { rememberLink, saveProjectFile } from "./agent-out-host";
import type { MncadOutApi } from "@/cad/agent-out";
import type { DrawingExtras } from "@/cad/drawing-agent";
import type { CompareView } from "./compare-dialog";
import type { SelItem } from "./selection";
import type { DisplayMode, Section, ViewName, ViewportHandle } from "./viewport";

type SketchFeature = Extract<Feature, { type: "sketch" }>;

/** Přístup ke stavu aplikace (cad-app.tsx). Funkce čtou vždy poslední vykreslený stav. */
export type ApiHost = {
  doc: () => CadDoc;
  /** výsledek stavby zobrazeného dílu (u sestavy null) */
  result: () => BuildResult | null;
  vp: () => ViewportHandle | null;
  /** otevřená skica ve skicáři */
  sketch: () => SketchFeature | null;
  openSketch: (id: string) => void;
  prefs: () => Settings;
  applySettings: (s: Settings) => void;
  /** styl 3D okna; `persist` = uložit do nastavení (jako Zobrazení ▸ styl), jinak jen dočasně (snímek) */
  setDisplay: (m: DisplayMode, persist: boolean) => void;
  /** CSS pozadí pracovní plochy (snímek s „background: current“) */
  bgCss: () => string;
  section: () => Section;
  setSection: (s: Section) => void;
  /** sítě pro rozsah řezu (díl nebo komponenty sestavy) */
  sectionItems: () => PlaneMesh[];
  explode: () => number;
  setExplode: (v: number) => void;
  hintsOn: () => boolean;
  setHints: (on: boolean) => void;
  selection: () => SelItem[];
  setSelection: (s: SelItem[]) => void;
  inspect: (it: SelItem | null) => void;
  setAsmSel: (id: string | null) => void;
  /** výsledek stavby listové komponenty sestavy (id jako u výběru, podsestavy „a/b“) */
  leafResult: (leafId: string) => BuildResult | undefined;
  setDraft: Dispatch<SetStateAction<DraftSetup>>;
  setSurface: Dispatch<SetStateAction<SurfaceSetup>>;
  setPartingZ: (p: { z: number; perimeter: number } | null) => void;
  setCmpView: (v: CompareView | null) => void;
  commit: (d: CadDoc) => void;
  openDocInTab: (d: CadDoc) => string;
  insertComponent: (c: AsmComponent) => void;
  insertPart: (d: CadDoc, group?: string) => void;
  docId: () => string;
  setPending: (p: PendingImport | null) => void;
  /** výsledky dílů otevřené sestavy, když jsou načtené všechny (jinak null) */
  asmParts: () => (BuildResult | undefined)[] | null;
  /** textový stav dokumentu (jako window.mncad.status) */
  status: () => Promise<string>;
  exportModel: (format: string) => Promise<void>;
  /** hmotnost, kusovník a balónky pro razítko výkresu (výstupy z konzole – agent-out-host.ts) */
  drawEnv?: () => DrawingExtras;
  /** projekt uložen (neuložené změny = žádné) */
  markSaved?: (d: CadDoc) => void;
};

/* ───────────────────────── pomocné ───────────────────────── */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** počká na vykreslení změn stavu Reactu (dva snímky, nejvýš ~0,3 s i ve skryté kartě) */
async function settle(ms = 120) {
  for (let i = 0; i < 2; i++) await Promise.race([new Promise<void>((r) => requestAnimationFrame(() => r())), sleep(150)]);
  await sleep(ms);
}
async function waitFor(cond: () => boolean, timeoutMs: number, what: string) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(tr("{0} – nedokončeno do {1} s", what, Math.round(timeoutMs / 1000)));
    await sleep(200);
  }
}
const safeName = (s: string) => (s || "model").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(0, 60);
function base64ToBytes(s: string): Uint8Array {
  const b = atob(s.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
  const u8 = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i);
  return u8;
}
const extOf = (name: string) => (/\.([^.]+)$/.exec(name)?.[1] ?? "").toLowerCase();
const isPartDoc = (d: CadDoc) => d.kind !== "assembly";
const emptyDocLike = (d: CadDoc) => !d.features.length && !d.components?.length;
const DISPLAY_LABEL: Record<DisplayMode, string> = { shadedEdges: "Stínovaný s hranami", shaded: "Stínovaný", wireframe: "Drátový", hiddenLine: "Skryté hrany", xray: "Průhledný" };
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** bod po umístění maticí 4×4 (po sloupcích) */
const place = (m: ArrayLike<number>, p: Vec3): Vec3 => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];

/** těleso dílu pro analýzy (síť a obálka) – z dokumentu, se kterým právě pracuje agent */
async function bodyOf(d: CadDoc, what: string): Promise<BuildResult & { mesh: NonNullable<BuildResult["mesh"]>; metrics: NonNullable<BuildResult["metrics"]> }> {
  if (!isPartDoc(d)) throw new Error(tr("{0}: otevřený dokument je sestava – formařské nástroje a analýzy pracují s dílem", what));
  const r = await cad.build(d);
  if (!r.mesh || !r.metrics || !r.mesh.triangles.length) throw new Error(tr("{0}: díl nemá těleso – nejdřív vytvořte tvar", what));
  return r as BuildResult & { mesh: NonNullable<BuildResult["mesh"]>; metrics: NonNullable<BuildResult["metrics"]> };
}

/* ───────────────────────── skica → DXF ───────────────────────── */
function sketchDxf(host: ApiHost, doc: CadDoc, name?: string): CapturedFile & { sketch: SketchFeature } {
  const sketches = doc.features.filter((f): f is SketchFeature => f.type === "sketch");
  let sk: SketchFeature | undefined;
  if (name) {
    sk = sketches.find((s) => s.id === name || s.name.toLowerCase() === name.toLowerCase());
    if (!sk) throw new Error(tr("skica „{0}“ v dokumentu není – skici: {1}", name, sketches.map((s) => s.name).join(", ") || "—"));
  } else {
    const open = host.sketch();
    sk = (open && sketches.find((s) => s.id === open.id)) || sketches[sketches.length - 1];
    if (!sk) throw new Error(tr("dokument nemá žádnou skicu k exportu DXF"));
  }
  if (!sk.entities.length) throw new Error(tr("skica „{0}“ je prázdná", sk.name));
  const u8 = new TextEncoder().encode(sketchToDxf(sk.entities));
  return { name: `${safeName(sk.name)}.dxf`, mime: "application/dxf", bytes: u8.length, base64: bytesToBase64(u8), sketch: sk };
}

/* ───────────────────────── akce rozšíření ───────────────────────── */
const FILE_ACTIONS = new Set(["sheet.dxf", "sheet.svg", "sketch.dxf"]);
/** Spustí akci rozšíření se zachytávacím API (bez okna a bez stažení). `d` = dokument, se kterým pracuje agent. */
async function runAction(host: ApiHost, id: string, d?: CadDoc): Promise<{ label: string; log: string; files: CapturedFile[] }> {
  const a = resolveAction(id);
  const doc = d ?? host.doc();
  if (a.id === "sketch.dxf") {
    const f = sketchDxf(host, doc);
    return { label: a.label, log: tr("Export skici „{0}“ ({1} entit) do DXF", f.sketch.name, f.sketch.entities.length), files: [{ name: f.name, mime: f.mime, bytes: f.bytes, base64: f.base64 }] };
  }
  const ui = getExtUi(a.id);
  if (!ui?.action) throw new Error(tr("akce „{0}“ nemá v této verzi provedení", a.label));
  const result = isPartDoc(doc) ? (d ? await cad.build(doc).catch(() => null) : (host.result() ?? (await cad.build(doc).catch(() => null)))) : null;
  let notices = 0;
  const cap = captureActionApi<Omit<ExtActionApi, "flash" | "notice" | "download">>({ doc, result, selection: host.selection(), commit: host.commit, exportModel: host.exportModel });
  const notice = cap.api.notice;
  cap.api.notice = (t, b) => {
    notices++;
    notice(t, b);
  };
  await ui.action(cap.api);
  const out = await cap.done();
  if (FILE_ACTIONS.has(a.id) ? !out.files.length : !notices) throw new Error(tr("akce „{0}“ nic nevytvořila: {1}", a.label, out.log || tr("bez hlášky")));
  return { label: a.label, ...out };
}

/* ───────────────────────── textové příkazy ───────────────────────── */
export type ApiRun = { log: string[]; doc?: CadDoc; added?: Feature[]; open?: CadDoc };

/** Provede příkaz z agent-api.ts nad dokumentem `d`, se kterým pracuje běh textových příkazů. */
export async function runApiCmd(cmd: ApiCmd, d: CadDoc, host: ApiHost): Promise<ApiRun> {
  switch (cmd.kind) {
    case "section": {
      let items = host.sectionItems();
      let bbox: [Vec3, Vec3] | null = null;
      if (isPartDoc(d)) {
        const r = await cad.build(d);
        if (!r.mesh || !r.metrics) throw new Error(tr("řez: díl nemá těleso"));
        items = [r.mesh];
        bbox = r.metrics.bbox;
      }
      if (!items.length) throw new Error(tr("řez: v okně není žádný model"));
      const av: Vec3 = cmd.axis === "X" ? [1, 0, 0] : cmd.axis === "Y" ? [0, 1, 0] : [0, 0, 1];
      const range = projectionRange(items, av);
      const offset = cmd.offset ?? (range ? Math.round(((range[0] + range[1]) / 2) * 100) / 100 : 0);
      const s: SectionState = { axis: cmd.axis, offset, flip: cmd.flip };
      host.setSection(s);
      const out = sectionReport(s, bbox ?? (range ? ([av.map((c) => c * range[0]), av.map((c) => c * range[1])] as [Vec3, Vec3]) : null));
      return { log: [range && (offset < range[0] - 1e-6 || offset > range[1] + 1e-6) ? out + tr(" – ⚠ poloha je mimo model, řez nic neukáže") : out] };
    }
    case "sectionOff":
      host.setSection(null);
      return { log: [sectionReport(null)] };
    case "display":
      host.setDisplay(cmd.mode, true);
      return { log: [tr("✓ styl zobrazení: {0}", tr(DISPLAY_LABEL[cmd.mode]))] };
    case "fit":
      host.vp()?.fit();
      return { log: [tr("✓ pohled přizpůsoben modelu")] };
    case "select": {
      // výběr textem (jako klik): indexy se ověří proti dokumentu tohoto běhu (díl se mohl právě změnit)
      const res = isPartDoc(d) ? await cad.build(d).catch(() => null) : null;
      select(host, cmd.ids, { additive: cmd.additive }, res);
      const list = selectionOf(host);
      const ids = list.map((x) => x.id);
      // textové příkazy výběr nečtou (zaoblit 3 = všechny hrany) – návod, jak vybrané entity zadat čísly
      const edges = list.filter((x) => x.kind === "edge" && !x.compId).map((x) => x.id);
      const faces = list.filter((x) => x.kind === "face" && !x.compId).map((x) => x.id);
      const ex = [...(edges.length ? [tr("zaoblit {0} hrany {1}", 2, edges.join(";"))] : []), ...(faces.length ? [tr("skica plocha {0}", faces[0])] : [])];
      return { log: [tr("✓ výběr: {0} ({1}) – převezmou ho tlačítka Zaoblit / Sražení / Skica na pásu karet a „+ aktuální výběr“ ve formulářích; textové příkazy výběr nečtou{2}", ids.join(", "), ids.length, ex.length ? tr(" – textem: {0}", ex.join(" · ")) : "")] };
    }
    case "selectClear":
      setSel(host, []);
      host.inspect(null);
      return { log: [tr("✓ výběr zrušen")] };
    case "selectShow": {
      const list = selectionOf(host).map((x) => (x.title && x.kind === "vertex" ? `${x.id} ${x.title}` : x.id));
      return { log: [list.length ? tr("Výběr: {0}", list.join(", ")) : tr("Výběr je prázdný – klik do modelu, vyber F3 E2 nebo window.mncad.select([…])")] };
    }
    case "faceColor": {
      if (!isPartDoc(d)) throw new Error(tr("barva plochy: otevřený dokument je sestava – barvu ploch lze měnit v dílu"));
      const t = await cad.topology(d);
      if (!t) throw new Error(tr("barva plochy: díl nemá těleso"));
      let faces = cmd.faces;
      if (cmd.rule.length) {
        faces = selectFaces(cmd.rule, t.faces, t.bbox);
        if (!faces.length) throw new Error(tr("žádná plocha neodpovídá pravidlu „{0}“ (ploch celkem {1})", cmd.rule.join(" "), t.faces.length));
      }
      const bad = faces.filter((i) => i >= t.faces.length);
      if (bad.length) throw new Error(tr("plocha F{0} v tělese není – plochy F1 až F{1} (popisky pro výběr / window.mncad.hints())", bad[0] + 1, t.faces.length));
      const fc = { ...(d.faceColors ?? {}) };
      for (const i of faces) {
        if (cmd.color) fc[i] = cmd.color;
        else delete fc[i];
      }
      const ids = faces.map((i) => `F${i + 1}`).join(", ");
      return { doc: { ...d, faceColors: fc }, log: [cmd.color ? tr("✓ barva ploch {0} = {1} ({2} ploch)", ids, cmd.color, faces.length) : tr("✓ barva ploch {0} – výchozí (barva tělesa)", ids)] };
    }
    case "action": {
      if (!cmd.id) return { log: [tr("Akce: {0}", apiActions().map((a) => `${a.id} (${a.label})`).join(", "))] };
      const r = await runAction(host, cmd.id, d);
      return { log: [tr("✓ akce {0}", r.label), ...(r.log ? r.log.split("\n") : []), ...r.files.map(fileLine)] };
    }
    case "analyze": {
      if (cmd.what === "off") {
        host.setDraft((x) => ({ ...x, on: false }));
        host.setSurface((x) => ({ ...x, mode: "none" }));
        host.setCmpView(null);
        return { log: [tr("✓ barevné analýzy vypnuty")] };
      }
      if (cmd.what === "zebra") {
        if (!isPartDoc(d)) throw new Error(tr("analýza: otevřený dokument je sestava – formařské nástroje a analýzy pracují s dílem"));
        host.setDraft((x) => ({ ...x, on: false }));
        host.setSurface((x) => ({ ...x, mode: "zebra" }));
        return { log: [tr("✓ zebra pruhy zapnuty (návaznost ploch) – analýza vyp je vypne")] };
      }
      const r = await bodyOf(d, tr("analýza"));
      const shown = tr(" – barevná mapa zapnuta (analýza vyp ji vypne)");
      if (cmd.what === "draft") {
        const res = draftAnalysis(r.mesh, cmd.dir, cmd.min);
        if (cmd.show) {
          host.setSurface((x) => ({ ...x, mode: "none" }));
          host.setDraft((x) => ({ ...x, on: true, pull: unit(cmd.dir), minDeg: cmd.min, pullDef: undefined, pullFlip: undefined, pullRaw: undefined }));
        }
        return { log: ["✓ " + draftReport(res, cmd.dir, cmd.min) + (cmd.show ? shown : "")] };
      }
      if (cmd.what === "thickness") {
        const w = wallThickness(r.mesh, cmd.limit);
        if (cmd.show) {
          host.setDraft((x) => ({ ...x, on: false }));
          host.setSurface({ mode: "thickness", limit: cmd.limit });
        }
        return { log: [(w.avg > 0 ? "✓ " : "✗ ") + thicknessReport(w, cmd.limit) + (cmd.show ? shown : "")] };
      }
      const c = curvatureColors(r.mesh);
      if (cmd.show) {
        host.setDraft((x) => ({ ...x, on: false }));
        host.setSurface((x) => ({ ...x, mode: "curvature" }));
      }
      return { log: ["✓ " + curvatureReport(c) + (cmd.show ? shown : "")] };
    }
    case "parting": {
      const r = await bodyOf(d, tr("dělicí rovina"));
      const p = partingPlane(r.mesh, cmd.dir);
      if (!(p.perimeter > 0)) throw new Error(partingReport(p, cmd.dir));
      host.setSection(p.section);
      host.setPartingZ(cmd.dir[0] === 0 && cmd.dir[1] === 0 && cmd.dir[2] > 0 ? { z: p.offset, perimeter: p.perimeter } : null);
      return { log: ["✓ " + partingReport(p, cmd.dir)] };
    }
    case "ejectors": {
      const r = await bodyOf(d, tr("vyhazovače"));
      const bbox = r.metrics.bbox;
      const list = suggestEjectors(bbox, { dir: cmd.dir, ...(cmd.d !== undefined ? { diameter: cmd.d } : {}), ...(cmd.spacing !== undefined ? { maxSpacing: cmd.spacing } : {}) });
      const log = ["✓ " + ejectorsReport(list, cmd.dir)];
      if (cmd.mode === "holes") {
        const fs = ejectorHoles(list, bbox[1][2]);
        log.push(tr("→ {0} děr pro vyhazovače přidáno do historie (Vyhazovač 1…) – výsledek po výpočtu níže", fs.length));
        return { log, doc: { ...d, features: [...d.features, ...fs] }, added: fs };
      }
      if (cmd.mode === "assembly") {
        const len = ejectorLength(bbox, cmd.dir);
        const a = emptyAssembly(tr("Sestava – {0}", d.name));
        a.components = [
          partComponent(d, {}, { group: "Díly", fixed: true, color: d.color ?? "#b9c2cc" }),
          ...list.map((e) => partComponent(ejectorPin(e.d, len), ejectorPinPlacement(e, bbox, len), { group: "Vyhazování", color: "#e03930" })),
        ];
        log.push(tr("✓ sestava „{0}“: díl + {1} vyhazovačů Ø{2} × {3} mm – nová záložka", a.name, list.length, list[0]?.d ?? 0, len));
        return { log, open: a };
      }
      return { log };
    }
    case "cooling": {
      const r = await bodyOf(d, tr("chlazení"));
      const p = { ...defaultCooling(r.metrics.bbox), dir: cmd.dir };
      if (cmd.d !== undefined) p.diameter = cmd.d;
      if (cmd.depth !== undefined) p.depth = cmd.depth;
      if (cmd.rows !== undefined) p.rows = cmd.rows;
      if (cmd.overhang !== undefined) p.overhang = cmd.overhang;
      const c = coolingCircuit(p);
      const log = ["✓ " + coolingReport(p, c)];
      if (cmd.mode === "part") {
        const fs = c.features.map((f) => ({ ...f, id: uid(), ...(f.type === "cylinder" ? { mode: "cut" as const } : {}) })) as Feature[];
        log.push(tr("→ chladicí kanály vyvrtány do dílu ({0} prvků Kanál / Propojka) – výsledek po výpočtu níže", fs.length));
        return { log, doc: { ...d, features: [...d.features, ...fs] }, added: fs };
      }
      if (cmd.mode === "assembly") {
        const a = emptyAssembly(tr("Sestava – {0}", d.name));
        a.components = [partComponent(d, {}, { group: "Díly", fixed: true, color: d.color ?? "#b9c2cc" }), partComponent(c, {}, { group: "Chlazení", color: "#1c7ed6" })];
        log.push(tr("✓ sestava „{0}“: díl + chladicí okruh – nová záložka", a.name));
        return { log, open: a };
      }
      return { log };
    }
    case "shrinkage": {
      if (!isPartDoc(d)) throw new Error(tr("smrštění: otevřený dokument je sestava – smrštění se přidává do dílu"));
      if (!d.features.length) throw new Error(tr("smrštění: díl nemá těleso – nejdřív vytvořte tvar"));
      const next = applyShrinkage(d, cmd.pct);
      const f = next.features[next.features.length - 1];
      const scale = f.type === "transform" ? f.scale : 1;
      return { log: [tr("→ {0}{1}: měřítko {2} kolem počátku – výsledek po výpočtu níže", f.name, cmd.label ? ` (${cmd.label})` : "", String(scale).replace(".", ","))], doc: next, added: [f] };
    }
  }
}

/* ───────────────────────── snímek ───────────────────────── */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(tr("snímek se nepodařilo načíst jako obrázek")));
    img.src = src;
  });
}
/** pozadí podle CSS pracovní plochy (lineární / radiální přechod nebo barva) */
function paintBackground(ctx: CanvasRenderingContext2D, css: string, w: number, h: number) {
  const stops = [...css.matchAll(/(#[0-9a-f]{3,8})\s*(\d+(?:\.\d+)?)?%?/gi)].map((m, i, all) => ({ c: m[1], at: m[2] !== undefined ? Number(m[2]) / 100 : i / Math.max(1, all.length - 1) }));
  if (stops.length < 2) {
    ctx.fillStyle = stops[0]?.c ?? "#ffffff";
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const g = /radial/.test(css) ? ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2) : ctx.createLinearGradient(0, 0, 0, h);
  for (const s of stops) g.addColorStop(Math.min(1, Math.max(0, s.at)), s.c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}
/** složí snímek: pozadí, obrázek „contain“, popisky entit; vrátí PNG base64 */
async function compose(src: string, o: ScreenshotOptions, bg: string, hints: { id: string; x: number; y: number }[], hintScale: number): Promise<Screenshot> {
  const img = await loadImage(src);
  const { width, height } = shotSize(img.naturalWidth || img.width, img.naturalHeight || img.height, o);
  const cv = document.createElement("canvas");
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext("2d");
  if (!ctx) throw new Error(tr("snímek: prohlížeč nedovolil kreslit do plátna"));
  if (o.background === "current") paintBackground(ctx, bg, width, height);
  else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
  }
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  const k = Math.min(width / sw, height / sh);
  const dx = (width - sw * k) / 2;
  const dy = (height - sh * k) / 2;
  ctx.drawImage(img, dx, dy, sw * k, sh * k);
  if (hints.length) {
    const fs = Math.max(9, Math.round(10 * k * hintScale));
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.textBaseline = "middle";
    for (const hh of hints) {
      const x = dx + hh.x * hintScale * k;
      const y = dy + hh.y * hintScale * k;
      const tw = ctx.measureText(hh.id).width + 6;
      ctx.fillStyle = hh.id.startsWith("F") ? "rgba(37,99,235,0.92)" : hh.id.startsWith("E") ? "rgba(224,57,48,0.92)" : "rgba(31,41,51,0.92)";
      ctx.fillRect(x - tw / 2, y - fs * 0.65, tw, fs * 1.3);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(hh.id, x - tw / 2 + 3, y);
    }
  }
  const url = cv.toDataURL("image/png");
  return { mime: "image/png", width, height, base64: url.slice(url.indexOf(",") + 1) };
}
/** snímek skicáře: SVG plátna skici → PNG */
async function sketchShot(o: ScreenshotOptions): Promise<Screenshot> {
  const svg = document.querySelector("svg[data-sketch-canvas]") as SVGSVGElement | null;
  if (!svg) throw new Error(tr("screenshot: skicář není zobrazený"));
  const r = svg.getBoundingClientRect();
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(Math.round(r.width)));
  clone.setAttribute("height", String(Math.round(r.height)));
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", `0 0 ${Math.round(r.width)} ${Math.round(r.height)}`);
  // podklad (obrázek z paměti prohlížeče) se do snímku nevloží – obrázek SVG nesmí načítat cizí zdroje
  clone.querySelectorAll("image").forEach((x) => x.remove());
  const xml = new XMLSerializer().serializeToString(clone);
  return compose("data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml), { ...o, background: o.background ?? "white" }, "#fbfcfd", [], 1);
}

async function screenshot(h: () => ApiHost, o0?: ScreenshotOptions): Promise<Screenshot> {
  const o = checkScreenshotOptions(o0);
  const target = o.target ?? "auto";
  if (target === "sketch" || (target === "auto" && h().sketch())) {
    if (!h().sketch()) throw new Error(tr("screenshot: není otevřená skica (target: \"sketch\")"));
    return sketchShot(o);
  }
  const vp = h().vp();
  if (!vp) throw new Error(tr("screenshot: 3D okno není připravené"));
  const saved = { display: h().prefs().display, section: h().section(), explode: h().explode(), hints: h().hintsOn(), cam: vp.camera?.() ?? null };
  const changed = { display: false, section: false, explode: false, hints: false };
  try {
    if (o.display && o.display !== saved.display) {
      h().setDisplay(o.display, false);
      changed.display = true;
    }
    if (o.section !== undefined) {
      h().setSection(o.section ? { axis: o.section.axis, offset: o.section.offset, flip: !!o.section.flip } : null);
      changed.section = true;
    }
    if (o.explode !== undefined && !isPartDoc(h().doc())) {
      h().setExplode(o.explode);
      changed.explode = true;
    }
    if (o.hints && !saved.hints) {
      h().setHints(true);
      changed.hints = true;
    }
    if (changed.display || changed.section || changed.explode || changed.hints) await settle(250);
    const v = o.view ?? "current";
    if (v !== "current") h().vp()?.setView(v as ViewName);
    else if (o.fit) h().vp()?.fit();
    if (v !== "current" || o.fit || o.hints) await settle(o.hints ? 450 : 120);
    const cur = h().vp();
    const src = cur?.snapshot() ?? null;
    if (!src) throw new Error(tr("screenshot: 3D okno nemá co vyfotit (žádný model nebo okno ještě není připravené)"));
    const hints = o.hints ? (cur?.hintList() ?? []) : [];
    return await compose(src, o, h().bgCss(), hints, Math.min(window.devicePixelRatio || 1, 2));
  } finally {
    if (changed.display) h().setDisplay(saved.display, false);
    if (changed.section) h().setSection(saved.section);
    if (changed.explode) h().setExplode(saved.explode);
    if (changed.hints) h().setHints(false);
    if (saved.cam) h().vp()?.setCamera?.(saved.cam);
  }
}

/* ───────────────────────── import souboru ───────────────────────── */
function toFile(f: ImportFileInput): File {
  if (typeof File !== "undefined" && f instanceof File) return f;
  const o = f as { name?: unknown; base64?: unknown; text?: unknown } | null;
  if (!o || typeof o.name !== "string" || !o.name.trim()) throw new Error(tr("importFile potřebuje {0}, {1} nebo File", "{ name, base64 }", "{ name, text }"));
  if (typeof o.base64 === "string") return new File([base64ToBytes(o.base64) as BlobPart], o.name);
  if (typeof o.text === "string") return new File([o.text], o.name);
  throw new Error(tr("importFile: chybí obsah souboru – {0} nebo {1}", "base64", "text"));
}

async function importFile(h: () => ApiHost, input: ImportFileInput, opts?: { as?: "auto" | "tab" | "component" | "sketch" }): Promise<string> {
  const as = opts?.as ?? "auto";
  if (!["auto", "tab", "component", "sketch"].includes(as)) throw new Error(tr("importFile: volba as je auto | tab | component | sketch"));
  const file = toFile(input);
  const ext = extOf(file.name);
  const cur = h().doc();
  const asm = !isPartDoc(cur);
  const t0 = Date.now();
  const needAsm = () => {
    if (!asm) throw new Error(tr("{0}: vložit jako komponentu lze jen do otevřené sestavy – nejdřív „nová sestava“ (otevřený dokument je díl)", file.name));
  };
  let line = "";
  let wait: "part" | "asm" | "none" = "part";
  /** čekající import pro hlášku o výsledku; `announce` = předat ho i aplikaci (průběh a hláška jako u Otevřít) */
  let pending: PendingImport | null = null;
  let announce = true;

  if (ext === "mncad" || ext === "json") {
    let d: CadDoc;
    try {
      d = internBlobs(JSON.parse(await file.text()) as CadDoc);
    } catch {
      throw new Error(tr("{0}: soubor není platný projekt Mnástrojárna CAD (JSON).", file.name));
    }
    if (d?.app !== "mnastrojarna-cad" || !Array.isArray(d.features)) throw new Error(tr("{0}: soubor není platný projekt Mnástrojárna CAD (JSON).", file.name));
    if (as === "sketch") throw new Error(tr("{0}: do skici lze vložit jen 2D výkres DXF", file.name));
    if (as === "component" || (as === "auto" && asm && isPartDoc(d))) {
      needAsm();
      if (isPartDoc(d)) h().insertPart(d, "Díly");
      else h().insertComponent(subassemblyComponent(d));
      line = tr("✓ {0} „{1}“ vložen do sestavy jako komponenta", isPartDoc(d) ? tr("díl") : tr("podsestava"), d.name);
      wait = "asm";
    } else {
      h().openDocInTab(d);
      line = tr("✓ otevřeno: „{0}“ ({1})", d.name, isPartDoc(d) ? tr("díl") : tr("sestava"));
      wait = isPartDoc(d) ? "part" : "asm";
    }
    pending = { docId: h().docId(), name: d.name, t0, kind: wait === "asm" ? "asm" : "part", bytes: file.size };
    announce = file.size > 2 * 1048576; // jako Otevřít: projekt .mncad hlásí průběh jen u velkých souborů
  } else {
    const res = await prepareImport(file);
    if (res.kind === "unsupported") throw new Error(res.title ? `${res.title}: ${res.message}` : res.message);
    if (res.kind === "sketch") {
      if (as === "component") throw new Error(tr("{0}: 2D výkres DXF nelze vložit jako komponentu – použijte as: \"sketch\"", file.name));
      const ents: SketchEntity[] = res.entities.map((e) => ({ ...e, id: uid() }));
      const open = h().sketch();
      const now = h().doc(); // dokument mohl během čtení souboru změnit
      if (as === "sketch" && open) {
        h().commit({ ...now, features: now.features.map((f) => (f.id === open.id && f.type === "sketch" ? { ...f, entities: [...f.entities, ...ents] } : f)) });
        line = tr("✓ DXF {0}: {1} entit vloženo do otevřené skice „{2}“", file.name, ents.length, open.name);
      } else {
        if (as === "sketch" && asm) throw new Error(tr("{0}: skica patří do dílu – otevřený dokument je sestava", file.name));
        const f: SketchFeature = { id: uid(), name: res.name, type: "sketch", plane: { kind: "base", name: "XY", offset: 0 }, entities: ents };
        const here = as === "sketch" || (as === "auto" && !asm && emptyDocLike(now));
        if (here) h().commit({ ...now, ...(emptyDocLike(now) && now.name === tr("Nový díl") ? { name: res.name } : {}), features: [...now.features, f] });
        else h().openDocInTab({ app: "mnastrojarna-cad", version: 2, name: res.name, material: "ocel", kind: "part", features: [f] });
        h().openSketch(f.id);
        line = tr("✓ DXF {0}: nová skica „{1}“ ({2} entit, rovina XY){3}", file.name, f.name, ents.length, here ? "" : tr(" – nová záložka"));
      }
      if (res.note) line += ` · ${res.note}`;
      wait = "none";
    } else if (res.kind === "assembly") {
      if (as === "sketch") throw new Error(tr("{0}: 3D model nelze vložit do skici", file.name));
      if (as === "component" || (as === "auto" && asm)) {
        needAsm();
        h().insertComponent(subassemblyComponent(res.doc));
        line = tr("✓ sestava {0} vložena jako podsestava", file.name);
      } else {
        h().openDocInTab(res.doc);
        line = tr("✓ sestava {0} otevřena ({1} komponent)", file.name, res.doc.components?.length ?? 0);
      }
      if (res.note) line += ` · ${res.note}`;
      wait = "asm";
      pending = { docId: h().docId(), name: file.name, t0, kind: "asm", bytes: file.size };
    } else {
      if (as === "sketch") throw new Error(tr("{0}: 3D model nelze vložit do skici", file.name));
      if (as === "component" || (as === "auto" && asm)) {
        needAsm();
        h().insertComponent({ id: uid(), name: res.fileName.replace(/\.[^.]+$/, ""), source: { kind: "file", fileName: res.fileName, format: res.format, data: res.data }, placement: { position: [0, 0, 0], rotation: [0, 0, 0] }, group: "Díly", color: "#9fb4c8" });
        line = tr("✓ model {0} vložen do sestavy jako komponenta", file.name);
        wait = "asm";
        pending = { docId: h().docId(), name: file.name, t0, kind: "asm", bytes: file.size };
      } else {
        const name = file.name.replace(/\.[^.]+$/, "");
        const f: Feature = { id: uid(), name: `Import ${res.fileName}`, type: "import", fileName: res.fileName, format: res.format, data: res.data };
        const base = as === "tab" || !emptyDocLike(cur) || asm ? { app: "mnastrojarna-cad" as const, version: 2 as const, name, material: "ocel" } : { ...cur, name: cur.name === tr("Nový díl") ? name : cur.name };
        h().openDocInTab({ ...base, kind: "part", features: [f] });
        pending = { docId: h().docId(), name: file.name, t0, kind: "part", featureId: f.id, bytes: file.size };
        line = tr("✓ model {0} otevřen (prvek Import)", file.name);
      }
      if (res.note) line += ` · ${res.note}`;
    }
  }
  if (pending && announce) h().setPending(pending);
  await settle(200);
  if (wait === "asm") {
    await waitFor(() => !!h().asmParts(), 15 * 60_000, tr("Načítání sestavy {0}", file.name));
    await settle(200);
    if (pending) {
      const out = asmImportOutcome(h().asmParts() ?? [], pending);
      if (!out.ok) throw new Error(`${out.title}: ${out.body}`);
      line += ` · ${out.text}`;
    }
  } else if (wait === "part") {
    const res = await cad.build(h().doc());
    if (pending?.featureId) {
      const out = partImportOutcome(res, pending);
      if (!out.ok) throw new Error(`${out.title}: ${out.body}`);
      line += ` · ${out.text}`;
    }
  }
  return [line, "", await h().status()].join("\n");
}

/* ───────────────────────── porovnání, sdílení ───────────────────────── */
async function compare(host: ApiHost, ref: { name: string; base64: string }, o: CompareApiOptions = {}): Promise<CompareApiResult> {
  if (!ref || typeof ref.name !== "string" || typeof ref.base64 !== "string") throw new Error(tr("compare potřebuje referenci {0}", "{ name, base64 }"));
  const doc = host.doc();
  if (!isPartDoc(doc)) throw new Error(tr("porovnání s referencí pracuje s dílem – otevřený dokument je sestava"));
  if (!doc.features.length) throw new Error(tr("porovnání: díl nemá těleso"));
  if (o.align !== undefined && !["none", "center", "auto"].includes(o.align)) throw new Error(tr("compare: align je none | center | auto"));
  if (o.booleans !== undefined && !["auto", "always", "never"].includes(o.booleans)) throw new Error(tr("compare: booleans je auto | always | never"));
  const tol = o.tolerance ?? 0.1;
  if (!(tol > 0)) throw new Error(tr("compare: tolerance musí být kladná (mm)"));
  // reference = vždy jedno těleso: velkou sestavu STEP nerozkládat na komponenty (stejně jako dialog)
  const r = await prepareImport(new File([base64ToBytes(ref.base64) as BlobPart], ref.name), async () => null);
  if (r.kind !== "body") throw new Error(r.kind === "unsupported" ? r.message : tr("{0}: soubor obsahuje jen 2D výkres – jako referenci použijte 3D model (STEP).", ref.name));
  const file: ReferenceFile = { data: dataBytes(r.data, ref.name), format: r.format, fileName: ref.name };
  const opts: CompareOptions = { align: { mode: o.align ?? "none", rotate: o.rotate, offset: o.offset }, tolerance: tol, booleans: o.booleans ?? "auto", map: o.map ?? true };
  const res = await cad.compare(doc, file, opts);
  const meta = { model: doc.name, tolerance: tol, date: new Date().toLocaleString(cadLocale()) };
  const list = regionList(res);
  if (o.show && res.map) {
    const c = distanceColors(res.map.distances, tol, Math.max(1, tol * 1.0001));
    for (let i = 0; i < c.length; i++) c[i] = c[i] ** 2.2; // sRGB → lineární (jako dialog)
    host.setCmpView({ mesh: res.map.mesh, colors: c, ghosts: [] });
  } else if (o.show === false) host.setCmpView(null);
  const mapOk = res.map ? res.map.stats.max <= tol + res.map.accuracy : null;
  const ok = !list.length && (mapOk ?? !!(res.extra || res.missing));
  return {
    ok,
    text: compareReportText(res, meta),
    csv: compareReportCsv(res, meta),
    regions: list.map((g) => ({ n: g.n, side: g.side, volume: g.volume, center: g.center, hint: regionHint(g) })),
  };
}

async function share(host: ApiHost, o: ShareApiOptions = {}) {
  const doc = host.doc();
  if (emptyDocLike(doc)) throw new Error(tr("Prázdný dokument nelze sdílet – nejdřív vytvořte nebo otevřete díl."));
  if (o.view !== undefined && o.view !== "model" && o.view !== "drawing") throw new Error(tr("share: view je model | drawing"));
  if (o.mode !== undefined && o.mode !== "link" && o.mode !== "store" && o.mode !== "self") throw new Error(tr("share: mode je link | store | self"));
  if (o.days !== undefined && o.days !== null && !(typeof o.days === "number" && o.days > 0)) throw new Error(tr("share: days je počet dní (např. 10) nebo null = bez omezení"));
  const r = await createShareLink(doc, { days: o.days === undefined ? SHARE_DEFAULT_DAYS : o.days, password: o.password || undefined, from: o.from || undefined, view: o.view ?? "model", mode: o.mode });
  rememberLink({ url: r.url, mode: r.mode, bytes: r.bytes, exp: r.exp, name: doc.name, view: o.view ?? "model", password: r.password }); // příkaz „odkaz“
  return { url: r.url, mode: r.mode, bytes: r.bytes, exp: r.exp, message: shareMessage(doc.name, r), chars: r.url.length, ...(r.note ? { note: r.note } : {}) };
}

/* ───────────────────────── výběr ───────────────────────── */
/**
 * Výběr nastavený přes API, dokud ho aplikace nevykreslí (stav Reactu se projeví až po vykreslení) – selection() hned
 * po select() tak vrátí nový výběr. Po vykreslení (stav = tentýž seznam) nebo po 2 s platí zase stav aplikace.
 */
let pendingSel: { items: SelItem[]; until: number } | null = null;
function currentSel(host: ApiHost): SelItem[] {
  const s = host.selection();
  if (pendingSel && (s === pendingSel.items || Date.now() > pendingSel.until)) pendingSel = null;
  return pendingSel ? pendingSel.items : s;
}
function setSel(host: ApiHost, items: SelItem[]) {
  pendingSel = { items, until: Date.now() + 2000 };
  host.setSelection(items);
}
function selectionOf(host: ApiHost): SelectionEntry[] {
  const doc = host.doc();
  const leaves = !isPartDoc(doc) ? flattenLeaves(doc) : [];
  const compName = (id?: string) => (id ? (leaves.find((l) => l.id === id)?.comp.name ?? doc.components?.find((c) => c.id === id)?.name ?? id) : "");
  // id komponenty, které `select` přečte zpět na tutéž instanci (u stejně pojmenovaných #2 – leaf-ref.ts)
  const ref = (id?: string) => (id ? compRef(doc, leaves, id) : "");
  return currentSel(host).map((s): SelectionEntry => {
    if (s.kind === "feature") {
      const f = doc.features.find((x) => x.id === s.featureId);
      return { id: `feature:${f?.name ?? s.featureId}`, kind: "feature", title: f ? `${f.name} (${f.type})` : undefined };
    }
    if (s.kind === "component") return { id: `comp:${ref(s.compId)}`, kind: "component", compId: s.compId, title: compName(s.compId) };
    const pre = s.compId ? `${ref(s.compId)}:` : "";
    if (s.kind === "body") return { id: `${pre}${tr("těleso")}`, kind: "body", ...(s.compId ? { compId: s.compId } : {}) };
    const L = s.kind === "face" ? "F" : s.kind === "edge" ? "E" : "V";
    return { id: `${pre}${L}${s.index + 1}`, kind: s.kind, index: s.index, ...(s.compId ? { compId: s.compId } : {}), title: s.kind === "vertex" ? `[${s.point.map((v) => Math.round(v * 1000) / 1000).join("; ")}]` : undefined };
  });
}

function select(host: ApiHost, ids: string[], o: { additive?: boolean } = {}, partResult?: BuildResult | null): number {
  if (!Array.isArray(ids)) throw new Error(tr("select potřebuje pole id, např. {0}", '["F3", "E2"]'));
  const doc = host.doc();
  const asm = !isPartDoc(doc);
  const leaves = asm ? flattenLeaves(doc) : [];
  // název, cesta nebo pořadí #2; víceznačný název je chyba (ne tiše první instance) – leaf-ref.ts
  const leafBy = (name: string) => leafByRef(doc, leaves, name);
  const items: SelItem[] = ids.map((raw) => {
    const s = parseSelectionId(raw);
    if (s.kind === "feature") {
      const f = [...doc.features].reverse().find((x) => x.name.toLowerCase() === s.name.toLowerCase() || x.id === s.name);
      if (!f) throw new Error(tr("prvek „{0}“ v historii není – prvky: {1}", s.name, doc.features.map((x) => x.name).join(", ") || "—"));
      return { kind: "feature", featureId: f.id };
    }
    if (s.kind === "component") {
      if (!asm) throw new Error(tr("comp:… vybírá komponentu sestavy – otevřený dokument je díl"));
      const comps = doc.components ?? [];
      const nth = /^#(\d+)$/.exec(s.name.trim());
      const named = nth ? [comps[Number(nth[1]) - 1]].filter(Boolean) : comps.filter((c) => c.name.toLowerCase() === s.name.trim().toLowerCase());
      if (named.length > 1) throw new Error(tr("„{0}“ je v sestavě {1}× – zadejte pořadí: {2}", s.name, named.length, named.map((c) => `comp:#${comps.indexOf(c) + 1}`).join(", ")));
      const top = named[0];
      if (top) return { kind: "component", compId: top.id, topId: top.id };
      const l = leafBy(s.name);
      return { kind: "component", compId: l.id, topId: l.topId };
    }
    let res: BuildResult | null | undefined = partResult ?? host.result();
    let compId: string | undefined;
    let topId: string | undefined;
    let matrix: ArrayLike<number> | null = null;
    if (s.comp) {
      if (!asm) throw new Error(tr("„{0}“: v dílu se komponenta nepíše – jen F3, E2, V5", raw));
      const l = leafBy(s.comp);
      compId = l.id;
      topId = l.topId;
      res = host.leafResult(l.id);
      matrix = l.matrix;
      if (!res) throw new Error(tr("komponenta „{0}“ se ještě načítá", s.comp));
    } else if (asm && s.kind !== "body") throw new Error(tr("v sestavě pište komponentu: Komponenta:F3 (nebo comp:Název)"));
    if (s.kind === "body") return { kind: "body", ...(compId ? { compId, topId } : {}) };
    const m = res?.metrics;
    if (!m) throw new Error(tr("výběr: díl nemá těleso"));
    const count = s.kind === "face" ? m.faces : s.kind === "edge" ? m.edges : Math.floor((res?.vertices?.length ?? 0) / 3);
    const L = s.kind === "face" ? "F" : s.kind === "edge" ? "E" : "V";
    if (s.index >= count) throw new Error(tr("{0}{1} v tělese není – {2}1 až {3}{4}", L, s.index + 1, L, L, count));
    if (s.kind === "vertex") {
      const v = res!.vertices!;
      const p: Vec3 = [v[s.index * 3], v[s.index * 3 + 1], v[s.index * 3 + 2]];
      return { kind: "vertex", index: s.index, point: matrix ? place(matrix, p) : p, ...(compId ? { compId, topId } : {}) };
    }
    return { kind: s.kind, index: s.index, ...(compId ? { compId, topId } : {}) } as SelItem;
  });
  const key = (x: SelItem) => JSON.stringify([x.kind, "index" in x ? x.index : null, "compId" in x ? x.compId : null, x.kind === "feature" ? x.featureId : null]);
  const cur = o.additive ? currentSel(host) : [];
  const next = [...cur, ...items.filter((x) => !cur.some((c) => key(c) === key(x)))].filter((x, i, a) => a.findIndex((y) => key(y) === key(x)) === i);
  setSel(host, next);
  host.inspect(next.length === 1 ? next[0] : null);
  const top = next.find((x) => x.kind !== "feature" && "topId" in x && x.topId);
  if (asm && top && "topId" in top && top.topId) host.setAsmSel(top.topId.split("/")[0]);
  return next.length;
}

/**
 * Textové zaoblení / sražení bez `hrany` zpracuje všechny hrany – výběr (klik, `vyber`) textové příkazy nečtou. Je-li
 * vybraná nějaká hrana, protokol to řekne a ukáže zápis jen pro vybrané hrany (žádná tichá změna geometrie).
 */
export function textSelectionNote(f: Feature, host: ApiHost | null): string | null {
  if (!host || (f.type !== "fillet" && f.type !== "chamfer") || f.edges !== "all") return null;
  if (f.type === "fillet" && f.kind && f.kind !== "constant") return null;
  const edges = selectionOf(host).filter((x) => x.kind === "edge" && !x.compId).map((x) => x.id);
  if (!edges.length) return null;
  const how = f.type === "fillet" ? tr("zaoblit {0} hrany {1}", f.radius, edges.join(";")) : tr("srazit {0} hrany {1}", f.distance, edges.join(";"));
  return tr("! {0}: zpracují se všechny hrany – vybrané hrany ({1}) textové příkazy nečtou; jen vybrané: {2}", f.name, edges.join(", "), how);
}

/* ───────────────────────── window.mncad ───────────────────────── */
/**
 * Doplní `window.mncad` o metody tohoto modulu a export skici DXF (`exportFile("dxf", { sketch })`).
 * `getHost` vrací aktuální přístup ke stavu aplikace (obnovuje se při každém vykreslení).
 */
export function extendMncad(core: Omit<MncadApi, keyof MncadApiExt | keyof MncadOutApi>, getHost: () => ApiHost | null): MncadApi {
  const host = () => {
    const h = getHost();
    if (!h) throw new Error(tr("CAD ještě není připravený"));
    return h;
  };
  const baseExport = core.exportFile;
  return {
    ...core,
    exportFile: async (format, opts) => {
      if (format !== "dxf") return baseExport(format, opts);
      const h = host();
      const f = sketchDxf(h, h.doc(), opts?.sketch);
      return { name: f.name, mime: f.mime, bytes: f.bytes, base64: f.base64 };
    },
    importFile: (file, opts) => importFile(host, file, opts),
    screenshot: (opts) => screenshot(host, opts),
    compare: (ref, opts) => compare(host(), ref, opts),
    share: (opts) => share(host(), opts),
    // uložené nastavení (loadSettings drží poslední uložené hned, bez čekání na vykreslení; dočasný styl snímku se neuloží)
    settings: () => ({ ...loadSettings() }),
    setSettings: (patch) => {
      const next = applySettingsPatch(loadSettings(), patch);
      host().applySettings(next);
      return { ...next };
    },
    selection: () => selectionOf(host()),
    select: (ids, opts) => select(host(), ids, opts),
    clearSelection: () => {
      const h = host();
      setSel(h, []);
      h.inspect(null);
    },
    action: async (id) => {
      const r = await runAction(host(), id);
      return { log: r.log, files: r.files };
    },
    save: (name) => {
      const h = host();
      return saveProjectFile(h.doc(), name, h);
    },
  };
}
