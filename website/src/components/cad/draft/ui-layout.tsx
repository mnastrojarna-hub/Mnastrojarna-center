"use client";

/**
 * GUI rozšíření 2D výkresu – bloky, rozvržení, výřezy, tisk PDF (balík 3). Soubor patří balíku; jádro ho jen zařadí do
 * UI_EXTS (ui-exts.ts). Smlouva: website/CAD-2D-NAVRH.md.
 *
 * - karty Bloky (blok, vložit, úprava bloku, atributy, uložit blok, vyčistit), Rozvržení (nové rozvržení A4–A0 s rámečkem
 *   a razítkem, vzhled stránky, výřezy, měřítko výřezu, zamknutí, modelový / papírový prostor) a Výstup (Tisk PDF
 *   s náhledem – Ctrl+P, export PDF všech rozvržení, PNG, SVG);
 * - záložky Model / rozvržení ve stavovém řádku, pruh úpravy bloku (Uložit / Zahodit);
 * - papír listu pod entitami (underlay), v modelovém prostoru výřezu okolí listu a ztmavení mimo výřez (overlay);
 * - poklepání do výřezu = modelový prostor výřezu, poklepání mimo něj = zpět na papír; poklepání na blok s atributy =
 *   panel Atributy, na blok bez atributů = úprava bloku;
 * - panely Bloky, Atributy, Vzhled stránky (formát, styl tisku, výřezy: měřítko, zámek, zmrazené hladiny; razítko) a Tisk.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { tr } from "@/cad/i18n";
import { xfPt, type Affine } from "@/cad/draft/geom";
import { findLayer } from "@/cad/draft/layers";
import type { DraftEntity, DraftModel, Vec2 } from "@/cad/draft/model";
import { drawEntities, toScreen, type View } from "@/cad/draft/render";
import { blockAttDefs, blockUseCount, findBlock } from "@/cad/draft/layout/blocks";
import { syncGeometry, viewportContent } from "@/cad/draft/layout/kinds";
import { styleFromTable, plotPages, type PlotRequest } from "@/cad/draft/layout/cmd-plot";
import { blockWordPrompts } from "@/cad/draft/layout/cmd-blocks";
import { layoutWordPrompts } from "@/cad/draft/layout/cmd-layout";
import { drawPage } from "@/cad/draft/layout/raster";
import { findLayout, layoutsOf, printableRect, sheetRect, SHEET_NAMES, syncTitleScale, TITLE_BLOCK } from "@/cad/draft/layout/sheets";
import { activeViewport, layoutState, setSpace } from "@/cad/draft/layout/state";
import type { DInsert, DViewport } from "@/cad/draft/layout/types";
import { MENU_SCALES, parseRatio, ratioLabel, ratioToScale, scaleToRatio, vpInv, vpPolygon, vpScaleLabel, vpXf } from "@/cad/draft/layout/util";
import { cn } from "@/lib/cn";
import { CadIcon, type CadIconName } from "../cad-icons";
import type { DraftUiApi, DraftUiExt, RGroup, RMenuEntry } from "./ui-ext";

const field = "w-full min-w-0 rounded border border-[#cfd6de] bg-white px-1.5 py-0.5 text-[12px] outline-none focus:border-brand";
const btn = "rounded border border-[#cfd6de] bg-white px-2 py-0.5 text-[11.5px] hover:bg-[#eef2f6] disabled:opacity-40";
const btnMain = "rounded bg-brand px-3 py-1 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-40";

/** text do příkazového řádku (uvozovky kolem názvů s mezerami) */
const q = (s: string) => (/[\s"„“';]/.test(s) || !s ? (s.includes('"') ? `„${s}“` : `"${s}"`) : s);

const layoutOfSpace = (api: DraftUiApi): string | null => {
  const sp = api.session.space;
  if (sp.startsWith("layout:")) return sp.slice(7);
  return activeViewport(api.session, api.model)?.layout ?? null;
};
const curLayout = (api: DraftUiApi) => {
  const id = layoutOfSpace(api) ?? layoutState(api.session).lastLayout;
  return id ? (findLayout(api.model, id) ?? null) : null;
};
const selectedViewports = (api: DraftUiApi): DViewport[] => {
  const l = curLayout(api);
  if (!l) return [];
  const av = activeViewport(api.session, api.model);
  if (av) return [av.vp];
  const sel = new Set(api.session.sel);
  const vps = l.entities.filter((e) => e.type === "viewport") as DViewport[];
  const picked = vps.filter((v) => sel.has(v.id));
  return picked.length ? picked : vps.length === 1 ? vps : [];
};

/** měřítko prvního výřezu rozvržení (razítko ho ukazuje v atributu MERITKO) */
const firstVpLabel = (m: DraftModel, layoutId: string) => {
  const v = findLayout(m, layoutId)?.entities.find((e) => e.type === "viewport") as DViewport | undefined;
  return v ? vpScaleLabel(m, v) : undefined;
};

/** změna entit papírového prostoru rozvržení jako jeden krok historie (panel, pás karet) */
function commitLayoutEntities(api: DraftUiApi, layoutId: string, fn: (e: DraftEntity) => DraftEntity, extra?: (m: DraftModel) => DraftModel) {
  const m = api.model;
  const locked: string[] = [];
  let changed = 0;
  let out: DraftModel = {
    ...m,
    layouts: (m.layouts ?? []).map((l) =>
      l.id === layoutId
        ? {
            ...l,
            entities: l.entities.map((e) => {
              const n = fn(e);
              if (n === e) return e;
              // zamčená hladina: entita se nemění (jako příkazy)
              if (findLayer(m, e.layer)?.locked) {
                locked.push(e.id);
                return e;
              }
              changed++;
              return n;
            }),
          }
        : l,
    ),
  };
  if (locked.length) api.flash(tr("{0}: na zamčené hladině – nejdřív hladinu odemkněte", locked.join(", ")));
  if (!changed) return;
  if (extra) out = extra(out);
  api.commit(out);
}

/**
 * Obsah výřezů, jejichž hladina je vypnutá / zmrazená: jádro takový výřez přeskočí celý, ale skrýt se má jen rám
 * (obsah zůstane – jako AutoCAD a tisk). Kreslí se pod entity listu. `frame` = papír → obrazovka (u MSPACE).
 */
function drawHiddenVpContent(ctx: CanvasRenderingContext2D, m: DraftModel, list: readonly DraftEntity[], view: View, dark: boolean, xf: Affine | null) {
  for (const e of list) {
    if (e.type !== "viewport") continue;
    const L = findLayer(m, e.layer);
    if (!L || (L.on && !L.frozen)) continue;
    const content = viewportContent(e as DViewport);
    if (content.length) drawEntities(ctx, m, content, null, view, { dark, lwdisplay: m.vars.lwdisplay }, { xf });
  }
}

/** přechod do modelového prostoru výřezu se zachováním polohy na obrazovce (výřez zůstane, kde byl) */
export function enterMspace(api: DraftUiApi, layoutId: string, vp: DViewport) {
  const v = api.view();
  const inv = vpInv(vp);
  setSpace(api.session, "model", { layout: layoutId, id: vp.id });
  if (v) {
    const s = toScreen(v, vp.c);
    const qm = xfPt(inv, vp.c);
    const ns = v.scale * vp.scale;
    api.setView({ scale: ns, cx: qm[0] - (s[0] - v.w / 2) / ns, cy: qm[1] + (s[1] - v.h / 2) / ns });
  }
  api.flash(tr("Modelový prostor výřezu {0} ({1}) – poklepáním mimo výřez zpět na papír", vp.id, vpScaleLabel(api.model, vp)));
}
/** zpět na papír se zachováním polohy výřezu na obrazovce */
export function leaveMspace(api: DraftUiApi) {
  const av = activeViewport(api.session, api.model);
  const v = api.view();
  if (!av) return;
  setSpace(api.session, `layout:${av.layout}`);
  if (v) {
    const inv = vpInv(av.vp);
    const s = toScreen(v, xfPt(inv, av.vp.c));
    const ns = v.scale / av.vp.scale;
    api.setView({ scale: ns, cx: av.vp.c[0] - (s[0] - v.w / 2) / ns, cy: av.vp.c[1] + (s[1] - v.h / 2) / ns });
  }
}

function goSpace(api: DraftUiApi, target: string | null) {
  if (target === null) {
    setSpace(api.session, "model");
    api.session.zoom = { kind: "extents" };
  } else {
    const l = findLayout(api.model, target);
    if (!l) return;
    setSpace(api.session, `layout:${l.id}`);
    const s = sheetRect(l);
    const pad = Math.max(s.x1 - s.x0, s.y1 - s.y0) * 0.03;
    api.session.zoom = { kind: "window", box: { x0: s.x0 - pad, y0: s.y0 - pad, x1: s.x1 + pad, y1: s.y1 + pad } };
  }
  api.redraw();
}

const toDev = (v: View, p: Vec2): [number, number] => {
  const s = toScreen(v, p);
  return [s[0] * v.dpr, s[1] * v.dpr];
};

// ---------------------------------------------------------------- stavový řádek: Model / rozvržení, úprava bloku

function LayoutStatus({ api }: { api: DraftUiApi }) {
  const m = api.model;
  const s = api.session;
  const layouts = layoutsOf(m);
  const av = activeViewport(s, m);
  const sp = s.space;
  const apiRef = useRef(api);
  apiRef.current = api;
  // Ctrl+P = Tisk (panel s náhledem)
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        e.stopPropagation();
        apiRef.current.openPanel("plot");
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);
  // mezera potvrdí i výzvy na jedno slovo (název bloku, značka atributu, měřítko výřezu) – jako v AutoCADu; výzva
  // „text“ jádra jinak bere celý řádek. Rozepsaný název v uvozovkách („MŮJ BLOK“) mezeru dostane.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      const line = t.closest("[data-draft-cmdline]");
      if (!line) return;
      const pr = line.querySelector("[data-draft-prompt]")?.getAttribute("title") ?? "";
      if (!pr || ![...blockWordPrompts(), ...layoutWordPrompts()].some((w) => w && pr.startsWith(w))) return;
      const v = t.value.trim();
      if (/^["„]/.test(v) && !/^(".*"|„.*[“”"])$/.test(v)) return;
      e.preventDefault();
      e.stopPropagation();
      t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);
  // rozvržení / blok zmizel (zpět, smazání) → modelový prostor; kontrola se zpožděním – příkaz přepne prostor dřív,
  // než aplikace zapíše nový model
  useEffect(() => {
    const t = setTimeout(() => {
      const a = apiRef.current;
      const cur = a.session.space;
      if ((cur.startsWith("layout:") && !findLayout(a.model, cur.slice(7))) || (cur.startsWith("block:") && !findBlock(a.model, cur.slice(6)))) setSpace(a.session, "model");
    }, 400);
    return () => clearTimeout(t);
  }, [m, sp, s]);
  const activeId = sp.startsWith("layout:") ? sp.slice(7) : (av?.layout ?? null);
  const tab = (id: string | null, label: string) => (
    <button
      key={id ?? "model"}
      type="button"
      data-layout-tab={id ?? "model"}
      data-active={activeId === id && !sp.startsWith("block:") ? "1" : "0"}
      onClick={() => goSpace(api, id)}
      className={cn("shrink-0 rounded-t border-x border-t px-2 py-0.5 text-[11px]", activeId === id && !sp.startsWith("block:") ? "border-[#b9c3ce] bg-white font-semibold text-[#1f2933]" : "border-transparent text-[#4a5664] hover:bg-white/60")}
    >
      {label}
    </button>
  );
  return (
    <span className="mr-2 flex shrink-0 items-center gap-0.5" data-layout-status>
      {sp.startsWith("block:") ? (
        <span className="flex items-center gap-1 rounded bg-[#fde68a] px-2 py-0.5 text-[11px] font-semibold text-[#713f12]" data-bedit-bar>
          {tr("Úprava bloku „{0}“", sp.slice(6))}
          <button type="button" className="rounded bg-white/70 px-1.5 font-normal hover:bg-white" onClick={() => api.command("BCLOSE", ["_save"])}>
            {tr("Uložit")}
          </button>
          <button type="button" className="rounded bg-white/70 px-1.5 font-normal hover:bg-white" onClick={() => api.command("BCLOSE", ["_discard"])}>
            {tr("Zahodit")}
          </button>
        </span>
      ) : (
        <>
          {tab(null, tr("Model"))}
          {layouts.map((l) => tab(l.id, l.name))}
          <button type="button" title={tr("Nové rozvržení A3")} data-layout-add onClick={() => void api.run("rozvržení nové A3")} className="shrink-0 rounded px-1.5 text-[13px] leading-none text-[#4a5664] hover:bg-white">
            +
          </button>
          {av && (
            <button type="button" data-mspace-badge onClick={() => leaveMspace(api)} title={tr("Zpět na papír (PAPÍROVÝ-PROSTOR)")} className="ml-1 shrink-0 rounded bg-[#2563eb] px-1.5 py-0.5 text-[10.5px] font-semibold text-white">
              {tr("MODEL ve výřezu {0} · {1}", av.vp.id, vpScaleLabel(m, av.vp))}
            </button>
          )}
          {sp.startsWith("layout:") && (
            <span className="ml-1 shrink-0 rounded bg-[#e5e7eb] px-1.5 py-0.5 text-[10.5px] font-semibold text-[#4a5664]" data-pspace-badge>
              {tr("PAPÍR")}
            </span>
          )}
        </>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- papír, okolí listu, maska výřezu

/** tmavé pozadí plátna (nastavení pracovní plochy v prohlížeči; výchozí tmavé) – čte se nejvýš 2× za sekundu */
let darkCache = { t: 0, v: true };
function darkBg(): boolean {
  const now = Date.now();
  if (now - darkCache.t < 500) return darkCache.v;
  let v = true;
  try {
    const raw = localStorage.getItem("mn-cad-draft-prefs-v1");
    if (raw) v = (JSON.parse(raw) as { dark?: boolean }).dark !== false;
  } catch {
    /* soukromý režim */
  }
  darkCache = { t: now, v };
  return v;
}

function paperUnderlay(ctx: CanvasRenderingContext2D, api: DraftUiApi, view: View) {
  const m = api.model;
  const s = api.session;
  const av = activeViewport(s, m);
  syncGeometry(m, s.space.startsWith("layout:") || !!av);
  const lid = s.space.startsWith("layout:") ? s.space.slice(7) : av?.layout;
  if (!lid) return;
  const l = findLayout(m, lid);
  if (!l) return;
  const dark = darkBg();
  // papír → obrazovka (u modelového prostoru výřezu přes inverzní transformaci výřezu)
  const p2w: Affine | null = av ? vpInv(av.vp) : null;
  const P = (p: Vec2): [number, number] => toDev(view, p2w ? xfPt(p2w, p) : p);
  const sr = sheetRect(l);
  const corners: Vec2[] = [
    [sr.x0, sr.y0],
    [sr.x1, sr.y0],
    [sr.x1, sr.y1],
    [sr.x0, sr.y1],
  ];
  ctx.save();
  ctx.fillStyle = dark ? "#171c22" : "#c3cad3";
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  // stín a list
  ctx.beginPath();
  corners.forEach((c, i) => {
    const [x, y] = P(c);
    if (i) ctx.lineTo(x + 4 * view.dpr, y + 4 * view.dpr);
    else ctx.moveTo(x + 4 * view.dpr, y + 4 * view.dpr);
  });
  ctx.closePath();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fill();
  ctx.beginPath();
  corners.forEach((c, i) => (i ? ctx.lineTo(...P(c)) : ctx.moveTo(...P(c))));
  ctx.closePath();
  ctx.fillStyle = dark ? "#262d36" : "#ffffff";
  ctx.fill();
  // tisknutelná plocha
  const pr = printableRect(l);
  if (pr.x0 > sr.x0 || pr.y0 > sr.y0 || pr.x1 < sr.x1 || pr.y1 < sr.y1) {
    ctx.setLineDash([4 * view.dpr, 3 * view.dpr]);
    ctx.strokeStyle = dark ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)";
    ctx.lineWidth = view.dpr;
    ctx.beginPath();
    ([[pr.x0, pr.y0], [pr.x1, pr.y0], [pr.x1, pr.y1], [pr.x0, pr.y1]] as Vec2[]).forEach((c, i) => (i ? ctx.lineTo(...P(c)) : ctx.moveTo(...P(c))));
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
  // v modelovém prostoru výřezu: ostatní obsah listu (razítko, jiné výřezy) v souřadnicích modelu
  if (av && p2w) {
    const others = l.entities.filter((e) => e.id !== av.vp.id);
    ctx.save();
    ctx.globalAlpha = 0.55;
    drawHiddenVpContent(ctx, m, others, view, dark, p2w);
    drawEntities(ctx, m, others, null, view, { dark, lwdisplay: m.vars.lwdisplay }, { xf: p2w });
    ctx.restore();
  } else drawHiddenVpContent(ctx, m, l.entities, view, dark, null);
}

function mspaceOverlay(ctx: CanvasRenderingContext2D, api: DraftUiApi, view: View) {
  const av = activeViewport(api.session, api.model);
  if (!av) return;
  const inv = vpInv(av.vp);
  const pts = vpPolygon(av.vp).map((p) => toDev(view, xfPt(inv, p)));
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, ctx.canvas.width, ctx.canvas.height);
  pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
  ctx.closePath();
  ctx.fillStyle = "rgba(15,23,42,0.32)";
  ctx.fill("evenodd");
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p)));
  ctx.closePath();
  ctx.lineWidth = 2.5 * view.dpr;
  ctx.strokeStyle = "#2563eb";
  ctx.stroke();
  ctx.restore();
}

const inPoly = (p: Vec2, poly: Vec2[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi || 1e-300) + xi) inside = !inside;
  }
  return inside;
};

// poklepání (dvě stisknutí do 350 ms na stejném místě) – jádro posílá jen „down“ / „move“ / „up“
let lastDown: { t: number; x: number; y: number } | null = null;
function pointerHook(api: DraftUiApi, ev: { kind: string; world: Vec2; screen: Vec2; button: number }): boolean {
  if (ev.kind !== "down" || ev.button !== 0) return false;
  const now = Date.now();
  const dbl = !!lastDown && now - lastDown.t < 350 && Math.hypot(ev.screen[0] - lastDown.x, ev.screen[1] - lastDown.y) < 6;
  lastDown = dbl ? null : { t: now, x: ev.screen[0], y: ev.screen[1] };
  if (!dbl) return false;
  const m = api.model;
  const sp = api.session.space;
  const av = activeViewport(api.session, m);
  const cancelWindow = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  if (av) {
    // poklepání mimo aktivní výřez = zpět na papír
    const paper = xfPt(vpXf(av.vp), ev.world);
    if (!inPoly(paper, vpPolygon(av.vp))) {
      cancelWindow();
      leaveMspace(api);
      return true;
    }
    return false;
  }
  if (sp.startsWith("layout:")) {
    const l = findLayout(m, sp.slice(7));
    const vp = l?.entities.find((e) => e.type === "viewport" && (e as DViewport).on !== false && findLayer(m, e.layer)?.on !== false && inPoly(ev.world, vpPolygon(e as DViewport))) as DViewport | undefined;
    if (l && vp) {
      cancelWindow();
      enterMspace(api, l.id, vp);
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------- panely

function BlocksPanel({ api }: { api: DraftUiApi }) {
  const m = api.model;
  const [filter, setFilter] = useState("");
  const hasAtt = api.session.sel.some((id) => {
    const e = spaceList(api).find((x) => x.id === id);
    return e?.type === "insert" && !!(e as DInsert).attribs?.length;
  });
  const blocks = (m.blocks ?? []).filter((b) => !b.anonymous && !b.name.startsWith("*") && b.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-2 p-2 text-[12px]" data-blocks-panel>
      {hasAtt && (
        <div className="rounded border border-brand/40 bg-[#fff7f6]">
          <AttribsPanel api={api} />
        </div>
      )}
      <div className="flex gap-1">
        <input className={field} placeholder={tr("Hledat blok…")} value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button type="button" className={btn} onClick={() => api.command("BLOCK")} title={tr("Nový blok z vybraných objektů")}>
          {tr("Nový")}
        </button>
      </div>
      {!blocks.length && <div className="text-[#6b7785]">{tr("Výkres nemá žádné bloky – vyberte objekty a stiskněte Nový (BLOK).")}</div>}
      {blocks.map((b) => {
        const n = blockUseCount(m, b.name);
        const atts = blockAttDefs(b);
        return (
          <div key={b.name} className="rounded border border-[#e3e8ee] p-1.5" data-block-row={b.name}>
            <div className="flex items-center gap-1">
              <CadIcon name="cube" className="h-3.5 w-3.5 text-[#4a5664]" />
              <span className="flex-1 truncate font-semibold">{b.name}</span>
              <span className="text-[10.5px] text-[#6b7785]">{tr("{0} entit · {1}× vloženo", b.entities.length, n)}</span>
            </div>
            {atts.length > 0 && <div className="mt-0.5 truncate text-[10.5px] text-[#6b7785]">{tr("Atributy: {0}", atts.map((a) => a.tag).join(", "))}</div>}
            <div className="mt-1 flex flex-wrap gap-1">
              <button type="button" className={btn} onClick={() => api.command("INSERT", [b.name])}>
                {tr("Vložit")}
              </button>
              <button type="button" className={btn} onClick={() => api.command("BEDIT", [b.name])}>
                {tr("Upravit")}
              </button>
              <button type="button" className={btn} onClick={() => void api.run(`uložit-blok ${q(b.name)} dxf`)}>
                DXF
              </button>
              <button type="button" className={btn} onClick={() => void api.run(`uložit-blok ${q(b.name)} dwg`)}>
                DWG
              </button>
              <button type="button" className={btn} disabled={n > 0} title={n ? tr("Blok je vložený – nejdřív smažte vložení") : tr("Odstranit nepoužitý blok")} onClick={() => void api.run(`vyčistit bloky ${q(b.name)}`)}>
                {tr("Odstranit")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AttribsPanel({ api }: { api: DraftUiApi }) {
  const m = api.model;
  const list = (api.session.space.startsWith("layout:") ? findLayout(m, api.session.space.slice(7))?.entities : api.session.space.startsWith("block:") ? findBlock(m, api.session.space.slice(6))?.entities : m.entities) ?? [];
  const ins = api.session.sel.map((id) => list.find((e) => e.id === id)).find((e) => e?.type === "insert" && (e as DInsert).attribs?.length) as DInsert | undefined;
  const [vals, setVals] = useState<Record<string, string>>({});
  const key = ins ? `${ins.id}:${(ins.attribs ?? []).map((a) => a.value).join("|")}` : "";
  useEffect(() => setVals(Object.fromEntries((ins?.attribs ?? []).map((a) => [a.tag, a.value]))), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ins) return <div className="p-2 text-[12px] text-[#6b7785]">{tr("Vyberte vložení bloku s atributy (poklepáním na blok se panel otevře).")}</div>;
  const blk = findBlock(m, ins.block);
  const defs = blockAttDefs(blk);
  const apply = () => {
    const pairs = (ins.attribs ?? []).filter((a) => vals[a.tag] !== undefined && vals[a.tag] !== a.value).map((a) => q(`${a.tag}=${vals[a.tag]}`));
    if (pairs.length) void api.run(`upravit-atributy ${ins.id} ${pairs.join(" ")}`);
  };
  return (
    <div className="space-y-1.5 p-2 text-[12px]" data-attribs-panel>
      <div className="font-semibold">
        {ins.block} <span className="font-normal text-[#6b7785]">({ins.id})</span>
      </div>
      {(ins.attribs ?? []).map((a) => (
        <label key={a.tag} className="block">
          <span className="text-[10.5px] text-[#6b7785]">
            {defs.find((d) => d.tag === a.tag)?.prompt || a.tag} <span className="font-mono">({a.tag})</span>
          </span>
          <input className={field} value={vals[a.tag] ?? ""} data-att={a.tag} onChange={(e) => setVals((v) => ({ ...v, [a.tag]: e.target.value }))} onKeyDown={(e) => e.key === "Enter" && apply()} />
        </label>
      ))}
      <button type="button" className={btnMain} onClick={apply} data-att-apply>
        {tr("Použít")}
      </button>
    </div>
  );
}

function PageSetupPanel({ api }: { api: DraftUiApi }) {
  const m = api.model;
  const l = curLayout(api);
  const [name, setName] = useState(l?.name ?? "");
  useEffect(() => setName(l?.name ?? ""), [l?.id, l?.name]);
  if (!l) return <div className="p-2 text-[12px] text-[#6b7785]">{tr("Přepněte na rozvržení (záložka ve stavovém řádku) nebo založte nové: Rozvržení → Nové rozvržení.")}</div>;
  const vps = l.entities.filter((e) => e.type === "viewport") as DViewport[];
  const tb = l.entities.find((e) => e.type === "insert" && (e as DInsert).block === TITLE_BLOCK) as DInsert | undefined;
  const style = styleFromTable(l.plot?.styleTable);
  const run = (t: string) => void api.run(t);
  const setVp = (vp: DViewport, patch: Partial<DViewport>) => commitLayoutEntities(api, l.id, (e) => (e.id === vp.id ? ({ ...e, ...patch } as DraftEntity) : e));
  return (
    <div className="space-y-3 p-2 text-[12px]" data-pagesetup-panel>
      <section className="space-y-1">
        <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#6b7785]">{tr("List")}</div>
        <div className="flex gap-1">
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== l.name && run(`rozvržení přejmenovat ${q(l.name)} ${q(name.trim())}`)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} aria-label={tr("Název rozvržení")} />
          <button type="button" className={btn} onClick={() => run(`rozvržení smazat ${q(l.name)}`)} title={tr("Smazat rozvržení (Ctrl+Z vrátí)")}>
            <CadIcon name="trash" className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <select className={cn(field, "w-auto")} value={SHEET_NAMES.includes(l.paper.size) ? l.paper.size : ""} onChange={(e) => run(`vzhled-stránky ${e.target.value} ${l.paper.landscape ? "na-šířku" : "na-výšku"}`)} data-ps-size>
            {!SHEET_NAMES.includes(l.paper.size) && <option value="">{l.paper.size}</option>}
            {SHEET_NAMES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button type="button" className={cn(btn, l.paper.landscape && "border-brand text-brand")} onClick={() => run(`vzhled-stránky ${l.paper.size} na-šířku`)}>
            {tr("Na šířku")}
          </button>
          <button type="button" className={cn(btn, !l.paper.landscape && "border-brand text-brand")} onClick={() => run(`vzhled-stránky ${l.paper.size} na-výšku`)}>
            {tr("Na výšku")}
          </button>
          <span className="text-[10.5px] text-[#6b7785]">
            {l.paper.w} × {l.paper.h} mm
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[#6b7785]">{tr("Styl tisku")}</span>
          {(["color", "mono", "gray"] as const).map((s) => (
            <button key={s} type="button" className={cn(btn, style === s && "border-brand text-brand")} onClick={() => run(`vzhled-stránky styl ${s === "color" ? "barva" : s === "mono" ? "mono" : "šedá"}`)}>
              {s === "color" ? tr("Barevně") : s === "mono" ? tr("Černobíle") : tr("Odstíny šedi")}
            </button>
          ))}
          <label className="ml-1 flex items-center gap-1">
            <input type="checkbox" checked={l.plot?.lineweights !== false} onChange={(e) => run(`vzhled-stránky tloušťky ${e.target.checked ? "ano" : "ne"}`)} />
            {tr("Tloušťky čar")}
          </label>
        </div>
      </section>
      <section className="space-y-1">
        <div className="flex items-center text-[10.5px] font-semibold uppercase tracking-wide text-[#6b7785]">
          <span className="flex-1">{tr("Výřezy ({0})", vps.length)}</span>
          <button type="button" className={btn} onClick={() => api.command("MVIEW")}>
            + {tr("Výřez listu")}
          </button>
        </div>
        {!vps.length && <div className="text-[#6b7785]">{tr("Rozvržení nemá výřez – Rozvržení → Výřez.")}</div>}
        {vps.map((vp) => (
          <VpRow key={vp.id} api={api} vp={vp} layoutId={l.id} onPatch={(p) => setVp(vp, p)} />
        ))}
      </section>
      {tb && (
        <section className="space-y-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-[#6b7785]">{tr("Razítko ISO 7200")}</div>
          <TitleFields api={api} ins={tb} />
        </section>
      )}
    </div>
  );
}

function VpRow({ api, vp, layoutId, onPatch }: { api: DraftUiApi; vp: DViewport; layoutId: string; onPatch: (p: Partial<DViewport>) => void }) {
  const m = api.model;
  const [open, setOpen] = useState(false);
  const label = vpScaleLabel(m, vp);
  const frozen = new Set((vp.frozenLayers ?? []).map((x) => x.toLowerCase()));
  const setScale = (raw: string) => {
    if (vp.locked) return api.flash(tr("Výřez {0} je zamčený – nejdřív ho odemkněte", vp.id));
    try {
      const r = parseRatio(raw);
      const prev = firstVpLabel(m, layoutId);
      commitLayoutEntities(api, layoutId, (e) => (e.id === vp.id ? ({ ...e, scale: ratioToScale(m, r) } as DraftEntity) : e), (mm) => syncTitleScale({ ...mm, vars: { ...mm.vars, cannoscale: r } }, layoutId, prev));
    } catch (e) {
      api.flash((e as Error).message);
    }
  };
  return (
    <div className="rounded border border-[#e3e8ee] p-1.5" data-vp-row={vp.id}>
      <div className="flex flex-wrap items-center gap-1">
        <button type="button" className="font-mono text-[11px] text-brand hover:underline" onClick={() => api.select([vp.id])} title={tr("Vybrat výřez")}>
          {vp.id}
        </button>
        <select className={cn(field, "w-[88px]")} value={MENU_SCALES.some(([a, b]) => ratioLabel(a / b) === label) ? label : "custom"} onChange={(e) => e.target.value !== "custom" && setScale(e.target.value)} data-vp-scale={vp.id} disabled={vp.locked}>
          {MENU_SCALES.map(([a, b]) => (
            <option key={`${a}:${b}`} value={ratioLabel(a / b)}>
              {ratioLabel(a / b)}
            </option>
          ))}
          <option value="custom">{MENU_SCALES.some(([a, b]) => ratioLabel(a / b) === label) ? tr("vlastní…") : label}</option>
        </select>
        <input className={cn(field, "w-[70px]")} placeholder="1:25" disabled={vp.locked} onKeyDown={(e) => e.key === "Enter" && setScale((e.target as HTMLInputElement).value)} aria-label={tr("Vlastní měřítko")} />
        <label className="flex items-center gap-0.5" title={tr("Zamčený výřez: měřítko a pohled se nezmění")}>
          <input type="checkbox" checked={!!vp.locked} onChange={(e) => onPatch({ locked: e.target.checked })} data-vp-lock={vp.id} />
          <CadIcon name="lock" className="h-3 w-3" />
        </label>
        <label className="flex items-center gap-0.5" title={tr("Zapnutý (obsah se zobrazuje)")}>
          <input type="checkbox" checked={vp.on !== false} onChange={(e) => onPatch({ on: e.target.checked })} />
          <CadIcon name="eye" className="h-3 w-3" />
        </label>
        <button type="button" className={btn} onClick={() => setOpen((o) => !o)}>
          {tr("Hladiny")} {frozen.size ? `(${frozen.size})` : ""}
        </button>
        <button type="button" className={btn} onClick={() => enterMspace(api, layoutId, vp)} title={tr("Modelový prostor výřezu")}>
          MS
        </button>
      </div>
      {open && (
        <div className="mt-1 max-h-40 overflow-auto rounded bg-[#f6f8fa] p-1">
          <div className="mb-0.5 text-[10.5px] text-[#6b7785]">{tr("Zaškrtnuté hladiny jsou v tomto výřezu zmrazené (VPLAYER)")}</div>
          {m.layers.map((ly) => (
            <label key={ly.name} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={frozen.has(ly.name.toLowerCase())}
                data-vp-freeze={`${vp.id}:${ly.name}`}
                onChange={(e) => void api.run(`hladiny-výřezu ${e.target.checked ? "zmrazit" : "rozmrazit"} ${q(ly.name)} výřez ${vp.id}`)}
              />
              {ly.name}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function TitleFields({ api, ins }: { api: DraftUiApi; ins: DInsert }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const key = (ins.attribs ?? []).map((a) => a.value).join("|");
  useEffect(() => setVals(Object.fromEntries((ins.attribs ?? []).map((a) => [a.tag, a.value]))), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const lid = layoutOfSpace(api);
  const save = (tag: string) => {
    const a = ins.attribs?.find((x) => x.tag === tag);
    if (!a || vals[tag] === a.value || !lid) return;
    commitLayoutEntities(api, lid, (e) => (e.id === ins.id ? ({ ...e, attribs: (e as DInsert).attribs!.map((x) => (x.tag === tag ? { ...x, value: vals[tag] } : x)) } as DraftEntity) : e));
  };
  return (
    <div className="grid grid-cols-2 gap-1">
      {(ins.attribs ?? []).map((a) => (
        <label key={a.tag} className="block">
          <span className="text-[10.5px] text-[#6b7785]">{a.tag}</span>
          <input className={field} value={vals[a.tag] ?? ""} data-title-att={a.tag} onChange={(e) => setVals((v) => ({ ...v, [a.tag]: e.target.value }))} onBlur={() => save(a.tag)} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- tisk (náhled)

type PlotUi = { target: string; format: "pdf" | "png" | "svg"; size: string; orient: "auto" | "land" | "port"; scale: string; style: "auto" | "color" | "mono" | "gray"; lw: boolean; dpi: number };
let plotUi: PlotUi = { target: "current", format: "pdf", size: "", orient: "auto", scale: "", style: "auto", lw: true, dpi: 150 };

function plotCommand(p: PlotUi, api: DraftUiApi): string {
  const parts = ["tisk"];
  if (p.target === "model") parts.push("model");
  else if (p.target === "all") parts.push("vše");
  else if (p.target !== "current") parts.push("rozvržení", q(findLayout(api.model, p.target)?.name ?? p.target));
  else parts.push(curLayout(api) && layoutOfSpace(api) ? "aktuální" : "model");
  parts.push(p.format);
  if (p.size) parts.push(p.size);
  if (p.orient !== "auto") parts.push(p.orient === "land" ? "na-šířku" : "na-výšku");
  if (p.scale) parts.push("měřítko", p.scale);
  if (p.style !== "auto") parts.push(p.style === "color" ? "barevně" : p.style === "mono" ? "mono" : "šedě");
  if (!p.lw) parts.push("tloušťky", "ne");
  if (p.format === "png") parts.push("dpi", String(p.dpi));
  return parts.join(" ");
}

function PlotPanel({ api }: { api: DraftUiApi }) {
  const [p, setP] = useState<PlotUi>(plotUi);
  const set = (x: Partial<PlotUi>) => setP((o) => (plotUi = { ...o, ...x }));
  const m = api.model;
  const layouts = layoutsOf(m);
  const canvas = useRef<HTMLCanvasElement>(null);
  const req = useMemo((): PlotRequest | null => {
    const cur = layoutOfSpace(api);
    const target: PlotRequest["target"] = p.target === "model" ? { kind: "model" } : p.target === "all" ? { kind: "all" } : p.target === "current" ? (cur ? { kind: "layout", id: cur } : { kind: "model" }) : { kind: "layout", id: p.target };
    try {
      return {
        target,
        format: p.format,
        ...(p.size ? { size: p.size } : {}),
        ...(p.orient !== "auto" ? { landscape: p.orient === "land" } : {}),
        ...(p.scale ? { ratio: p.scale === "fit" ? ("fit" as const) : parseRatio(p.scale) } : {}),
        ...(p.style !== "auto" ? { style: p.style } : {}),
        lineweights: p.lw,
      };
    } catch {
      return null;
    }
  }, [p, api]);
  const [info, setInfo] = useState("");
  useEffect(() => {
    const c = canvas.current;
    if (!c || !req) return;
    let pages;
    try {
      pages = plotPages(m, req);
    } catch (e) {
      setInfo((e as Error).message);
      return;
    }
    const pg = pages[0];
    const W = c.clientWidth || 320;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const k = Math.min((W - 16) / pg.w, 360 / pg.h);
    c.width = Math.round(W * dpr);
    c.height = Math.round((pg.h * k + 16) * dpr);
    c.style.height = `${pg.h * k + 16}px`;
    const g = c.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#c3cad3";
    g.fillRect(0, 0, W, pg.h * k + 16);
    drawPage(g, pg, k, [(W - pg.w * k) / 2, 8]);
    setInfo(tr("{0} · {1} × {2} mm · měřítko {3}{4}", pg.name, Math.round(pg.w * 10) / 10, Math.round(pg.h * 10) / 10, pg.ratio, pages.length > 1 ? ` · ${tr("{0} stran", pages.length)}` : ""));
  }, [req, m]);
  const sel = (label: string, value: string, opts: [string, string][], on: (v: string) => void, attr?: string) => (
    <label className="flex items-center gap-1">
      <span className="w-20 shrink-0 text-[#6b7785]">{label}</span>
      <select className={field} value={value} onChange={(e) => on(e.target.value)} data-plot={attr}>
        {opts.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="space-y-1.5 p-2 text-[12px]" data-plot-panel>
      {sel(tr("Co tisknout"), p.target, [["current", tr("Aktuální ({0})", curLayout(api) && layoutOfSpace(api) ? curLayout(api)!.name : tr("model"))], ["model", tr("Model – rozsah")], ...layouts.map((l) => [l.id, l.name] as [string, string]), ...(layouts.length > 1 ? [["all", tr("Všechna rozvržení")] as [string, string]] : [])], (v) => set({ target: v }), "target")}
      {sel(tr("Výstup"), p.format, [["pdf", "PDF"], ["png", "PNG"], ["svg", "SVG"]], (v) => set({ format: v as PlotUi["format"] }), "format")}
      {sel(tr("Papír"), p.size, [["", tr("podle rozvržení (A3 u modelu)")], ...SHEET_NAMES.map((s) => [s, s] as [string, string])], (v) => set({ size: v }), "size")}
      {sel(tr("Orientace"), p.orient, [["auto", tr("automaticky")], ["land", tr("na šířku")], ["port", tr("na výšku")]], (v) => set({ orient: v as PlotUi["orient"] }))}
      {sel(tr("Měřítko"), p.scale, [["", tr("1:1 (rozvržení) / vejít (model)")], ["fit", tr("Vejít na papír")], ...MENU_SCALES.map(([a, b]) => [ratioLabel(a / b), ratioLabel(a / b)] as [string, string])], (v) => set({ scale: v }), "scale")}
      {sel(tr("Styl"), p.style, [["auto", tr("podle vzhledu stránky")], ["color", tr("Barevně")], ["mono", tr("Černobíle")], ["gray", tr("Odstíny šedi")]], (v) => set({ style: v as PlotUi["style"] }), "style")}
      <label className="flex items-center gap-1">
        <input type="checkbox" checked={p.lw} onChange={(e) => set({ lw: e.target.checked })} />
        {tr("Tisknout tloušťky čar")}
      </label>
      {p.format === "png" && (
        <label className="flex items-center gap-1">
          <span className="w-20 shrink-0 text-[#6b7785]">DPI</span>
          <input type="number" min={30} max={1200} className={field} value={p.dpi} onChange={(e) => set({ dpi: Math.max(30, Math.min(1200, Number(e.target.value) || 150)) })} />
        </label>
      )}
      <canvas ref={canvas} className="block w-full rounded" data-plot-preview />
      <div className="text-[10.5px] text-[#6b7785]" data-plot-info>
        {info}
      </div>
      <div className="flex gap-1">
        <button type="button" className={btnMain} onClick={() => void api.run(plotCommand(p, api))} data-plot-go>
          {tr("Tisk {0}", p.format.toUpperCase())}
        </button>
        {layouts.length > 1 && (
          <button type="button" className={btn} onClick={() => void api.run(`export-pdf${p.style !== "auto" ? ` ${p.style === "color" ? "barevně" : p.style === "mono" ? "mono" : "šedě"}` : ""}`)}>
            {tr("PDF všech rozvržení")}
          </button>
        )}
      </div>
      <div className="text-[10.5px] text-[#6b7785]">{tr("Text: {0}", plotCommand(p, api))}</div>
    </div>
  );
}

// ---------------------------------------------------------------- pás karet

function ribbon(api: DraftUiApi): Partial<Record<"blocks" | "layout" | "output", RGroup[]>> {
  const m = api.model;
  const sp = api.session.space;
  const blocks = (m.blocks ?? []).filter((b) => !b.anonymous && !b.name.startsWith("*"));
  const run = (t: string) => void api.run(t);
  const blockMenu = (fn: (name: string) => void, icon: CadIconName): RMenuEntry[] => (blocks.length ? blocks.map((b) => ({ id: `b-${b.name}`, label: b.name, icon, onClick: () => fn(b.name) })) : [{ id: "none", label: tr("(žádné bloky)"), icon: "info" as CadIconName, disabled: true }]);
  const inLayout = sp.startsWith("layout:");
  const av = activeViewport(api.session, m);
  const selIns = api.session.sel.length === 1 ? ((spaceList(api).find((e) => e.id === api.session.sel[0] && e.type === "insert") as DInsert | undefined) ?? null) : null;
  const vpScale = (r: number) => {
    const vps = selectedViewports(api);
    const l = curLayout(api);
    if (!vps.length || !l) return api.flash(tr("Vyberte výřez (klik na jeho rám) nebo pracujte v jeho modelovém prostoru"));
    const locked = vps.filter((v) => v.locked);
    if (locked.length) api.flash(tr("Zamčené výřezy se nezměnily: {0}", locked.map((v) => v.id).join(", ")));
    const ids = new Set(vps.filter((v) => !v.locked).map((v) => v.id));
    const prev = firstVpLabel(m, l.id);
    commitLayoutEntities(api, l.id, (e) => (ids.has(e.id) ? ({ ...e, scale: ratioToScale(m, r) } as DraftEntity) : e), (mm) => syncTitleScale({ ...mm, vars: { ...mm.vars, cannoscale: r } }, l.id, prev));
  };
  const vpLock = (lock: boolean) => {
    const vps = selectedViewports(api);
    const l = curLayout(api);
    if (!vps.length || !l) return api.flash(tr("Vyberte výřez (klik na jeho rám)"));
    const ids = new Set(vps.map((v) => v.id));
    commitLayoutEntities(api, l.id, (e) => (ids.has(e.id) ? ({ ...e, locked: lock } as DraftEntity) : e));
  };
  const mspace = () => {
    const l = curLayout(api);
    const vps = selectedViewports(api);
    if (l && vps.length === 1 && inLayout) return enterMspace(api, l.id, vps[0]);
    api.command("MSPACE");
  };
  const curVp = av?.vp ?? selectedViewports(api)[0];
  return {
    blocks: [
      {
        label: tr("Blok"),
        big: 3,
        items: [
          { id: "lo-block", label: tr("Vytvořit blok"), icon: "cube", tone: "sketch", kbd: "B", hint: tr("z vybraných objektů – název, bod vložení"), onClick: () => api.command("BLOCK") },
          { id: "lo-insert", label: tr("Vložit blok"), icon: "import", tone: "sketch", kbd: "I", onClick: () => api.command("INSERT"), menu: [{ id: "ins-cmd", label: tr("Vložit… (název na příkazovém řádku)"), icon: "import", onClick: () => api.command("INSERT") }, { divider: true }, ...blockMenu((n) => api.command("INSERT", [n]), "cube")] },
          { id: "lo-blocks", label: tr("Správce bloků"), icon: "table", tone: "view", onClick: () => api.openPanel("blocks") },
          { id: "lo-bedit", label: tr("Upravit blok"), icon: "edit", kbd: "BE", onClick: () => api.command("BEDIT", selIns ? [selIns.block] : []), menu: [{ id: "be-cmd", label: selIns ? tr("Vybraný blok „{0}“", selIns.block) : tr("Upravit… (název na příkazovém řádku)"), icon: "edit", onClick: () => api.command("BEDIT", selIns ? [selIns.block] : []) }, { divider: true }, ...blockMenu((n) => api.command("BEDIT", [n]), "edit")] },
          { id: "lo-bclose", label: tr("Zavřít blok"), icon: "check", disabled: !sp.startsWith("block:"), onClick: () => api.command("BCLOSE") },
          { id: "lo-wblock", label: tr("Uložit blok jako soubor"), icon: "save", kbd: "W", onClick: () => (selIns ? run(`uložit-blok ${q(selIns.block)} dxf`) : api.openPanel("blocks")), menu: [...blockMenu((n) => run(`uložit-blok ${q(n)} dxf`), "save"), { divider: true }, { id: "lo-wblock-sel", label: tr("Výběr jako DXF"), icon: "select", onClick: () => run("uložit-blok výběr dxf") }, { id: "lo-wblock-all", label: tr("Celý výkres jako .mncad"), icon: "save", onClick: () => run("uložit-blok * mncad") }] },
        ],
      },
      {
        label: tr("Atributy"),
        items: [
          { id: "lo-attdef", label: tr("Definovat atribut"), icon: "text", kbd: "ATT", onClick: () => api.command("ATTDEF") },
          { id: "lo-attedit", label: tr("Upravit atributy"), icon: "edit", kbd: "ATE", onClick: () => (selIns?.attribs?.length ? api.openPanel("blocks") : api.command("ATTEDIT")) },
          { id: "lo-attext", label: tr("Atributy do CSV"), icon: "table", onClick: () => run("extrahovat-atributy") },
        ],
      },
      {
        label: tr("Vyčistit"),
        items: [
          {
            id: "lo-purge",
            label: tr("Vyčistit nepoužité"),
            icon: "trash",
            kbd: "PU",
            onClick: () => run("vyčistit"),
            menu: [
              { id: "pu-all", label: tr("Vše nepoužité"), icon: "trash", onClick: () => run("vyčistit") },
              { id: "pu-blocks", label: tr("Bloky"), icon: "cube", onClick: () => run("vyčistit bloky") },
              { id: "pu-layers", label: tr("Hladiny"), icon: "layers", onClick: () => run("vyčistit hladiny") },
              { id: "pu-lt", label: tr("Typy čar"), icon: "centerline", onClick: () => run("vyčistit typy-čar") },
              { id: "pu-st", label: tr("Textové styly"), icon: "text", onClick: () => run("vyčistit styly") },
            ],
          },
        ],
      },
    ],
    layout: [
      {
        label: tr("Rozvržení"),
        big: 2,
        items: [
          {
            id: "lo-new",
            label: tr("Nové rozvržení"),
            icon: "drawing",
            tone: "file",
            kbd: "LO",
            onClick: () => run("rozvržení nové A3"),
            menu: [
              ...SHEET_NAMES.map((s) => ({ id: `new-${s}`, label: tr("{0} s rámečkem a razítkem", s), icon: "drawing" as CadIconName, onClick: () => run(`rozvržení nové ${s}${s === "A4" ? " na-výšku" : ""}`) })),
              { divider: true as const },
              { id: "new-plain", label: tr("A3 bez rámečku a razítka"), icon: "rect" as CadIconName, onClick: () => run("rozvržení nové A3 bez-rámečku bez-razítka") },
              { id: "new-copy", label: tr("Kopie aktuálního rozvržení"), icon: "copy" as CadIconName, disabled: !curLayout(api), onClick: () => run("rozvržení kopírovat") },
            ],
          },
          { id: "lo-pagesetup", label: tr("Vzhled stránky"), icon: "settings", tone: "view", onClick: () => api.openPanel("pagesetup") },
        ],
      },
      {
        label: tr("Výřezy"),
        big: 1,
        items: [
          {
            id: "lo-mview",
            label: tr("Výřez listu"),
            icon: "rect",
            tone: "sketch",
            kbd: "MV",
            disabled: !inLayout,
            onClick: () => api.command("MVIEW"),
            menu: [
              { id: "mv-rect", label: tr("Obdélník (dva rohy)"), icon: "rect", onClick: () => api.command("MVIEW") },
              { id: "mv-fit", label: tr("Vejít do kreslicí plochy"), icon: "fit", onClick: () => api.command("MVIEW", ["_fit"]) },
              { id: "mv-2v", label: tr("Dva vedle sebe"), icon: "rect", onClick: () => api.command("MVIEW", ["_two", "_vertical"]) },
              { id: "mv-2h", label: tr("Dva nad sebou"), icon: "rect", onClick: () => api.command("MVIEW", ["_two", "_horizontal"]) },
              { id: "mv-3", label: tr("Tři"), icon: "rect", onClick: () => api.command("MVIEW", ["_three"]) },
              { id: "mv-4", label: tr("Čtyři"), icon: "rect", onClick: () => api.command("MVIEW", ["_four"]) },
              { id: "mv-poly", label: tr("Mnohoúhelník"), icon: "polygon", onClick: () => api.command("MVIEW", ["_polygonal"]) },
              { id: "mv-obj", label: tr("Z objektu (kružnice, uzavřená křivka)"), icon: "circle", onClick: () => api.command("MVIEW", ["_object"]) },
            ],
          },
          {
            id: "lo-vpscale",
            label: curVp ? tr("Měřítko {0}", vpScaleLabel(m, curVp)) : tr("Měřítko výřezu"),
            icon: "scale",
            menu: MENU_SCALES.map(([a, b]) => ({ id: `sc-${a}-${b}`, label: ratioLabel(a / b), icon: "scale" as CadIconName, active: !!curVp && Math.abs(scaleToRatio(m, curVp.scale) - a / b) < 1e-12, onClick: () => vpScale(a / b) })),
          },
          { id: "lo-vplock", label: curVp?.locked ? tr("Odemknout výřez") : tr("Zamknout výřez"), icon: "lock", active: !!curVp?.locked, onClick: () => vpLock(!curVp?.locked) },
          { id: "lo-vplayer", label: tr("Hladiny výřezu"), icon: "layers", onClick: () => api.openPanel("pagesetup") },
          { id: "lo-mspace", label: tr("Modelový prostor"), icon: "cube", kbd: "MS", active: !!av, disabled: !inLayout && !av, onClick: mspace },
          { id: "lo-pspace", label: tr("Papírový prostor"), icon: "drawing", kbd: "PS", active: inLayout, disabled: !av, onClick: () => leaveMspace(api) },
        ],
      },
    ],
    output: [
      {
        label: tr("Tisk"),
        big: 2,
        items: [
          { id: "lo-plot", label: tr("Tisk / PDF"), icon: "export", tone: "file", kbd: "Ctrl+P", hint: tr("náhled, papír, měřítko, styl tisku"), onClick: () => api.openPanel("plot") },
          { id: "lo-exportpdf", label: tr("PDF všech rozvržení"), icon: "export", tone: "file", onClick: () => run("export-pdf") },
          { id: "lo-png", label: tr("Obrázek PNG"), icon: "export", onClick: () => run("tisk png") },
          { id: "lo-svg", label: tr("Vektor SVG"), icon: "export", onClick: () => run("tisk svg") },
        ],
      },
    ],
  };
}

const spaceList = (api: DraftUiApi): DraftEntity[] => {
  const sp = api.session.space;
  const m = api.model;
  if (sp.startsWith("layout:")) return findLayout(m, sp.slice(7))?.entities ?? [];
  if (sp.startsWith("block:")) return findBlock(m, sp.slice(6))?.entities ?? [];
  return m.entities;
};

export const layoutUi: DraftUiExt = {
  id: "layout",
  ribbon,
  panels: {
    blocks: { title: () => tr("Bloky"), icon: "cube", render: (api) => <BlocksPanel api={api} /> },
    pagesetup: { title: () => tr("Stránka"), icon: "settings", render: (api) => <PageSetupPanel api={api} /> },
    plot: { title: () => tr("Tisk"), icon: "export", render: (api) => <PlotPanel api={api} /> },
  },
  statusLeft: (api) => <LayoutStatus key="layout-status" api={api} />,
  context: (api) => {
    const out: RMenuEntry[] = [];
    const av = activeViewport(api.session, api.model);
    if (av) out.push({ divider: true }, { id: "ctx-pspace", label: tr("Zpět na papír (PAPÍROVÝ-PROSTOR)"), icon: "drawing", onClick: () => leaveMspace(api) });
    const vps = api.session.space.startsWith("layout:") ? selectedViewports(api).filter((v) => api.session.sel.includes(v.id)) : [];
    if (vps.length === 1) {
      const l = curLayout(api)!;
      out.push({ divider: true }, { id: "ctx-ms", label: tr("Modelový prostor výřezu"), icon: "cube", onClick: () => enterMspace(api, l.id, vps[0]) }, { id: "ctx-vps", label: tr("Měřítko a hladiny výřezu…"), icon: "scale", onClick: () => api.openPanel("pagesetup") });
    }
    const ins = api.session.sel.length === 1 ? (spaceList(api).find((e) => e.id === api.session.sel[0] && e.type === "insert") as DInsert | undefined) : undefined;
    if (ins) {
      out.push({ divider: true }, { id: "ctx-bedit", label: tr("Upravit blok „{0}“", ins.block), icon: "edit", onClick: () => api.command("BEDIT", [ins.block]) });
      if (ins.attribs?.length) out.push({ id: "ctx-att", label: tr("Upravit atributy"), icon: "table", onClick: () => api.openPanel("blocks") });
    }
    out.push({ divider: true }, { id: "ctx-plot", label: tr("Tisk… (Ctrl+P)"), icon: "export", onClick: () => api.openPanel("plot") });
    return out;
  },
  underlay: (ctx, api, view) => paperUnderlay(ctx, api, view),
  overlay: (ctx, api, view) => mspaceOverlay(ctx, api, view),
  dblclick: (api, id) => {
    const e = spaceList(api).find((x) => x.id === id);
    if (!e) return false;
    if (e.type === "viewport") {
      const l = curLayout(api);
      if (!l) return false;
      enterMspace(api, l.id, e as DViewport);
      return true;
    }
    if (e.type === "insert") {
      const ins = e as DInsert;
      api.select([ins.id]);
      if (ins.attribs?.length) api.openPanel("blocks");
      else api.command("BEDIT", [ins.block]);
      return true;
    }
    return false;
  },
  pointer: (api, ev) => pointerHook(api, ev),
};
