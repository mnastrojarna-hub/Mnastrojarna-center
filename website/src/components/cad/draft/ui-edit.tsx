/**
 * GUI rozšíření 2D výkresu – úpravy (balík 1). Soubor patří balíku; jádro ho jen zařadí do UI_EXTS (ui-exts.ts).
 * Smlouva: website/CAD-2D-NAVRH.md.
 *
 * - Karta Úpravy: skupiny Upravit objekty (posun … rozměřit), Pole (obdélníkové, polární, po dráze), Uspořádat
 *   (přenést vlastnosti, pořadí, duplicity) – každé tlačítko spustí příkaz v příkazovém řádku (výzvy, volby, myš).
 * - Úchopy vybraných entit: najetí na úchop ho zvýrazní; táhnutí úchopu (stisk – posun – puštění) ho protáhne
 *   s uchopením a ORTHO, Esc táhnutí zruší; klik na úchop spustí ÚCHOP (protáhnout → mezera / Enter = posun, otočit,
 *   měřítko, zrcadlit; volby Základní bod, Kopie, Zpět) – jako horký úchop v AutoCADu. Každá úprava = 1 krok historie.
 * - Shift při výběru u OŘÍZNOUT / PRODLOUŽIT = opačná operace, u ZAOBLIT / ZKOSIT = roh (MOD.shift).
 * - Kontextová nabídka s výběrem: Posun, Kopie, Otočit, Měřítko, Zrcadlit, Ekvidistanta, Rozložit.
 */
import { tr } from "@/cad/i18n";
import { MOD, PRESET } from "@/cad/draft/edit";
import { dist } from "@/cad/draft/geom";
import { kindOf } from "@/cad/draft/kinds";
import { entityById, spaceEntities, type DraftEntity, type NewEntity, type Vec2 } from "@/cad/draft/model";
import { drawPreview, drawSnapMarker, toScreen, type View } from "@/cad/draft/render";
import { DEFAULT_SNAPS, findSnap, orthoPoint } from "@/cad/draft/snap";
import type { SnapKind } from "@/cad/draft/kinds";
import { spatialIndex } from "@/cad/draft/spatial";
import type { CadIconName } from "../cad-icons";
import type { DraftPointerEvent, DraftUiApi, DraftUiExt, RGroup, RMenuEntry } from "./ui-ext";

type Hot = { id: string; i: number; p: Vec2 };
/** stav úchopů (jeden plátno – jedna relace najednou) */
const G = {
  hover: null as Vec2 | null,
  drag: null as null | { p0: Vec2; s0: Vec2; hot: Hot[]; cur: Vec2; snap: SnapKind | null; moved: boolean },
  api: null as DraftUiApi | null,
};

const PREFS_KEY = "mn-cad-draft-prefs-v1";
/** nastavení plátna (uchopení, ORTHO, pozadí) uložené pracovní plochou */
function prefs(): { osnap: boolean; osmodes: SnapKind[]; ortho: boolean; dark: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as { osnap?: boolean; osmodes?: SnapKind[]; ortho?: boolean; dark?: boolean };
    return { osnap: p.osnap ?? true, osmodes: p.osmodes ?? DEFAULT_SNAPS, ortho: !!p.ortho, dark: p.dark ?? true };
  } catch {
    return { osnap: true, osmodes: DEFAULT_SNAPS, ortho: false, dark: true };
  }
}

/** vybrané entity zobrazeného prostoru */
function selected(api: DraftUiApi): DraftEntity[] {
  const list = spaceEntities(api.model, api.space) ?? api.model.entities;
  return api.session.sel.map((id) => entityById(list, id)).filter((e): e is DraftEntity => !!e);
}

/** úchopy vybraných entit v okruhu tol od bodu */
function gripsNear(api: DraftUiApi, p: Vec2, tol: number): Hot[] {
  const ents = selected(api);
  if (!ents.length || ents.length > 300) return [];
  let best: Vec2 | null = null;
  let bd = tol;
  const all: Hot[] = [];
  for (const e of ents)
    (kindOf(e)?.grips(e, { model: api.model }) ?? []).forEach((g, i) => {
      all.push({ id: e.id, i, p: g });
      const d = dist(g, p);
      if (d <= bd) {
        bd = d;
        best = g;
      }
    });
  if (!best) return [];
  const b: Vec2 = best;
  return all.filter((h) => dist(h.p, b) <= 1e-9 * Math.max(1, Math.abs(b[0]), Math.abs(b[1])));
}

/** cílový bod táhnutí: uchopení (bez taženého úchopu), ORTHO */
function dragPoint(api: DraftUiApi, raw: Vec2, base: Vec2, v: View): { p: Vec2; snap: SnapKind | null } {
  const pf = prefs();
  if (pf.osnap) {
    const list = spaceEntities(api.model, api.space) ?? api.model.entities;
    const hit = findSnap(api.model, spatialIndex(list, { model: api.model }), raw, 10 / v.scale, new Set(pf.osmodes), base);
    if (hit && dist(hit.p, base) > 1e-12) return { p: hit.p, snap: hit.kind };
  }
  return { p: pf.ortho ? orthoPoint(base, raw) : raw, snap: null };
}

const num = (x: number) => String(Math.abs(x) < 1e-300 ? 0 : x);
const pt = (p: Vec2) => `${num(p[0])},${num(p[1])}`;

function onPointer(api: DraftUiApi, ev: DraftPointerEvent): boolean {
  G.api = api;
  const v = api.view();
  if (!v) return false;
  if (ev.kind === "move") {
    if (G.drag) {
      if (dist(ev.screen, G.drag.s0) > 4) G.drag.moved = true;
      const r = dragPoint(api, ev.world, G.drag.p0, v);
      G.drag.cur = r.p;
      G.drag.snap = r.snap;
      api.redraw();
      return true;
    }
    const h = gripsNear(api, ev.world, 6 / v.scale);
    const np = h[0]?.p ?? null;
    if ((np === null) !== (G.hover === null) || (np && G.hover && dist(np, G.hover) > 0)) {
      G.hover = np;
      api.redraw();
    }
    return false;
  }
  if (ev.kind === "down") {
    if (ev.button !== 0 || ev.shift || ev.ctrl) return false;
    const h = gripsNear(api, ev.world, 6 / v.scale);
    if (!h.length) return false;
    G.drag = { p0: h[0].p, s0: ev.screen, hot: h, cur: h[0].p, snap: null, moved: false };
    return true;
  }
  // up
  const d = G.drag;
  if (!d) return false;
  G.drag = null;
  if (d.moved) {
    // táhnutí: protáhnout úchop(y) do bodu puštění – jeden krok historie
    if (dist(d.cur, d.p0) > 1e-12) void api.run(`úchop ${pt(d.p0)} ${pt(d.cur)}`);
  } else api.command("GRIPEDIT", [pt(d.p0)]);
  api.redraw();
  return true;
}

function overlay(g: CanvasRenderingContext2D, api: DraftUiApi, v: View) {
  const dev = (p: Vec2): Vec2 => {
    const s = toScreen(v, p);
    return [s[0] * v.dpr, s[1] * v.dpr];
  };
  const pf = prefs();
  const sq = (p: Vec2, color: string) => {
    const [x, y] = dev(p);
    const r = 4.5 * v.dpr;
    g.save();
    g.fillStyle = color;
    g.strokeStyle = "#ffffff";
    g.lineWidth = v.dpr;
    g.fillRect(x - r, y - r, 2 * r, 2 * r);
    g.strokeRect(x - r, y - r, 2 * r, 2 * r);
    g.restore();
  };
  if (G.drag) {
    const d = G.drag;
    const prev: NewEntity[] = [];
    for (const h of d.hot) {
      const e = entityById(spaceEntities(api.model, api.space) ?? api.model.entities, h.id);
      const k = e && kindOf(e);
      const n = e && k?.moveGrip ? k.moveGrip(e, h.i, d.cur, { model: api.model }) : null;
      if (n) {
        const { id: _i, ...rest } = n as DraftEntity;
        void _i;
        prev.push(rest as NewEntity);
      }
    }
    try {
      drawPreview(g, api.model, prev, v, pf.dark);
    } catch {
      /* neplatný náhled */
    }
    const [x0, y0] = dev(d.p0);
    const [x1, y1] = dev(d.cur);
    g.save();
    g.strokeStyle = pf.dark ? "#ffffffaa" : "#111827aa";
    g.setLineDash([4 * v.dpr, 3 * v.dpr]);
    g.lineWidth = v.dpr;
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
    g.restore();
    sq(d.p0, "#e03930");
    if (d.snap) drawSnapMarker(g, v, d.cur, d.snap);
    return;
  }
  if (G.hover && api.session.sel.length) sq(G.hover, "#22c55e");
}

// Esc během táhnutí úchopu; Shift pro OŘÍZNOUT / PRODLOUŽIT / ZAOBLIT (posluchač se registruje před pracovní plochou)
if (typeof window !== "undefined") {
  const w = window as unknown as { __mnDraftEditKeys?: boolean };
  if (!w.__mnDraftEditKeys) {
    w.__mnDraftEditKeys = true;
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Shift") MOD.shift = true;
        if (e.key === "Escape" && G.drag) {
          e.preventDefault();
          e.stopImmediatePropagation();
          G.drag = null;
          G.api?.redraw();
        }
      },
      true,
    );
    window.addEventListener("keyup", (e) => {
      if (e.key === "Shift") MOD.shift = false;
    }, true);
    window.addEventListener("pointerdown", (e) => void (MOD.shift = e.shiftKey), true);
    window.addEventListener("blur", () => void (MOD.shift = false));
  }
}

// ---------------------------------------------------------------- pás karet

type It = { id: string; label: string; icon: CadIconName; cmd: string; pre?: string[]; kbd?: string; hint?: string; menu?: RMenuEntry[] };
const item = (api: DraftUiApi, x: It) => ({ id: x.id, label: x.label, icon: x.icon, tone: "sketch" as const, kbd: x.kbd, hint: x.hint, onClick: () => api.command(x.cmd, x.pre ?? []), ...(x.menu ? { menu: x.menu } : {}) });
const sub = (api: DraftUiApi, id: string, label: string, icon: CadIconName, cmd: string, pre: string[] = []): RMenuEntry => ({ id, label, icon, onClick: () => api.command(cmd, pre) });

/** Pořadí ▾: volba se předá příkazu přes PRESET (bez výběru by předaný token skončil ve výzvě výběru) */
const order = (api: DraftUiApi, id: string, label: string, icon: CadIconName, opt: string): RMenuEntry => ({
  id,
  label,
  icon,
  onClick: () => {
    PRESET.draworder = opt;
    api.command("DRAWORDER", []);
  },
});

function ribbon(api: DraftUiApi): Partial<Record<"modify", RGroup[]>> {
  const modify: RGroup = {
    // „Upravit“ už má jádro (Smazat, Vlastnosti) – popisek skupiny je v pásu klíčem, musí být jedinečný
    label: tr("Upravit objekty"),
    big: 4,
    items: [
      item(api, { id: "move", label: tr("Posun"), icon: "move", cmd: "MOVE", kbd: "M", hint: tr("základní bod → cílový bod") }),
      item(api, { id: "copy", label: tr("Kopie"), icon: "copy", cmd: "COPY", kbd: "CO", hint: tr("více kopií, pole v řadě") }),
      item(api, { id: "rotate", label: tr("Otočit"), icon: "rotate", cmd: "ROTATE", kbd: "RO", hint: tr("úhel, reference, kopie") }),
      item(api, { id: "mirror", label: tr("Zrcadlit"), icon: "mirror", cmd: "MIRROR", kbd: "MI" }),
      item(api, { id: "scale", label: tr("Měřítko"), icon: "scale", cmd: "SCALE", kbd: "SC" }),
      item(api, { id: "stretch", label: tr("Protáhnout"), icon: "transform", cmd: "STRETCH", kbd: "S", hint: tr("křížící okno") }),
      item(api, { id: "align", label: tr("Zarovnat"), icon: "move", cmd: "ALIGN", kbd: "AL" }),
      item(api, { id: "offset", label: tr("Ekvidistanta"), icon: "offset", cmd: "OFFSET", kbd: "O" }),
      item(api, { id: "trim", label: tr("Oříznout"), icon: "trim", cmd: "TRIM", kbd: "TR", hint: tr("Shift = prodloužit") }),
      item(api, { id: "extend", label: tr("Prodloužit"), icon: "extend", cmd: "EXTEND", kbd: "EX", hint: tr("Shift = oříznout") }),
      item(api, {
        id: "fillet",
        label: tr("Zaoblit"),
        icon: "fillet",
        cmd: "FILLET",
        kbd: "F",
        menu: [sub(api, "fillet-1", tr("Zaoblit dva objekty"), "fillet", "FILLET"), sub(api, "fillet-poly", tr("Zaoblit všechny vrcholy křivky"), "fillet", "FILLET", ["_polyline"]), sub(api, "fillet-0", tr("Roh (poloměr 0)"), "fillet", "FILLET", ["_radius", "0"])],
      }),
      item(api, { id: "chamfer", label: tr("Zkosit"), icon: "chamfer", cmd: "CHAMFER", kbd: "CHA", menu: [sub(api, "chamfer-1", tr("Zkosit dvě úsečky"), "chamfer", "CHAMFER"), sub(api, "chamfer-poly", tr("Zkosit všechny vrcholy křivky"), "chamfer", "CHAMFER", ["_polyline"])] }),
      item(api, { id: "break", label: tr("Přerušit"), icon: "split", cmd: "BREAK", kbd: "BR", menu: [sub(api, "break-2", tr("Přerušit mezi dvěma body"), "split", "BREAK"), sub(api, "breakatpoint", tr("Přerušit v bodě"), "split", "BREAKATPOINT")] }),
      item(api, { id: "join", label: tr("Spojit"), icon: "polyline", cmd: "JOIN", kbd: "J" }),
      item(api, { id: "explode", label: tr("Rozložit"), icon: "explode", cmd: "EXPLODE", kbd: "X" }),
      item(api, { id: "lengthen", label: tr("Prodloužení"), icon: "extend", cmd: "LENGTHEN", kbd: "LEN", hint: tr("delta, procenta, celkem, dynamicky") }),
      item(api, { id: "pedit", label: tr("Upravit křivku"), icon: "polyline", cmd: "PEDIT", kbd: "PE" }),
      item(api, { id: "splinedit", label: tr("Upravit spline"), icon: "spline", cmd: "SPLINEDIT", kbd: "SPE" }),
      item(api, { id: "reverse", label: tr("Obrátit"), icon: "undo", cmd: "REVERSE" }),
      item(api, { id: "divide", label: tr("Rozdělit"), icon: "point", cmd: "DIVIDE", kbd: "DIV" }),
      item(api, { id: "measure", label: tr("Rozměřit"), icon: "measure", cmd: "MEASURE", kbd: "ME" }),
    ],
  };
  const arrays: RGroup = {
    label: tr("Pole"),
    big: 3,
    items: [
      item(api, { id: "arrayrect", label: tr("Obdélníkové"), icon: "pattern", cmd: "ARRAYRECT", kbd: "AR" }),
      item(api, { id: "arraypolar", label: tr("Polární"), icon: "patternCircular", cmd: "ARRAYPOLAR" }),
      item(api, { id: "arraypath", label: tr("Po dráze"), icon: "spline", cmd: "ARRAYPATH" }),
    ],
  };
  const arrange: RGroup = {
    label: tr("Uspořádat"),
    big: 1,
    items: [
      item(api, { id: "matchprop", label: tr("Přenést vlastnosti"), icon: "palette", cmd: "MATCHPROP", kbd: "MA" }),
      item(api, {
        id: "draworder",
        label: tr("Pořadí"),
        icon: "layers",
        cmd: "DRAWORDER",
        kbd: "DR",
        menu: [order(api, "do-front", tr("Dopředu"), "up", "front"), order(api, "do-back", tr("Dozadu"), "down", "back"), order(api, "do-above", tr("Nad objekty"), "up", "above"), order(api, "do-under", tr("Pod objekty"), "down", "under")],
      }),
      item(api, { id: "overkill", label: tr("Odstranit duplicity"), icon: "check", cmd: "OVERKILL" }),
    ],
  };
  return { modify: [modify, arrays, arrange] };
}

function context(api: DraftUiApi): RMenuEntry[] {
  if (!api.session.sel.length) return [];
  return [
    { divider: true },
    sub(api, "ctx-move", tr("Posun"), "move", "MOVE"),
    sub(api, "ctx-copy", tr("Kopie"), "copy", "COPY"),
    sub(api, "ctx-rotate", tr("Otočit"), "rotate", "ROTATE"),
    sub(api, "ctx-scale", tr("Měřítko"), "scale", "SCALE"),
    sub(api, "ctx-mirror", tr("Zrcadlit"), "mirror", "MIRROR"),
    sub(api, "ctx-offset", tr("Ekvidistanta"), "offset", "OFFSET"),
    sub(api, "ctx-explode", tr("Rozložit"), "explode", "EXPLODE"),
  ];
}

export const editUi: DraftUiExt = { id: "edit", ribbon, context, pointer: onPointer, overlay };
