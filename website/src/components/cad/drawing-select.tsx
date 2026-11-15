"use client";

/**
 * Výkres dílu / sestavy: výběr poznámek a kót (kóty, poznámky, drsnosti, tolerance, základny, texty, popisy, osy)
 * kliknutím, Ctrl+klikem a oknem; posun tažením nebo šipkami, Delete smaže vybrané. Vybrat jdou i vygenerované kóty
 * celkových rozměrů a pozice (balónky) sestavy: Delete je skryje, tažení / šipky posunou (DrawingOptions.genEdit).
 *
 * Myš na listu: klik = vybrat (Ctrl/Shift přepne, Ctrl+Shift/Alt odebere, klik do prázdna výběr zruší), tažení z poznámky
 * = posun vybraných, tažení odjinud = okno (zleva doprava celé uvnitř, zprava doleva i protnuté; Ctrl/Shift přidá,
 * Ctrl+Shift/Alt odebere). Posun listu: prostřední nebo pravé tlačítko, levé mimo papír, jeden prst; dlouhý stisk prstem
 * a tažení = okno. Esc zruší okno / posun, pak výběr. Pravidla: `@/cad/box-select-2d`, logika poznámek: `@/cad/drawing-boxsel`.
 */
import { tr } from "@/cad/i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { boxMode, clickMode, HOLD_MS, holdPhase, isCrossing, isDrag, mergeSelection, rectFrom, type BoxMods, type BoxShape } from "@/cad/box-select-2d";
import { annotationAt, annotationShapes, annotationsInBox, deleteAnnotations, generatedShapes, genDelta, hideGenerated, isGenId, moveAnnotations, moveGenerated } from "@/cad/drawing-boxsel";
import type { DrawingResult, GenEdit } from "@/cad/drawing";
import type { DrawingAnnotation, Vec2 } from "@/cad/types";
import { BoxSelectSvg, boxLabel } from "./box-select-2d-ui";

type View = { x: number; y: number; z: number };
type Mods = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };
const modsOf = (e: Mods): BoxMods => ({ ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey });
const PICK_PX = 6;

type Gesture =
  | { k: "press"; p0: Vec2; q0: Vec2; hit: string | null; mods: BoxMods }
  | { k: "box"; p0: Vec2; p1: Vec2; mods: BoxMods[]; cur?: BoxMods; touch?: boolean }
  | { k: "move"; q0: Vec2; q1: Vec2; ids: string[] };

export function useDrawingSelection(o: {
  res: DrawingResult | null;
  ann: DrawingAnnotation[];
  setAnn: (f: (a: DrawingAnnotation[]) => DrawingAnnotation[]) => void;
  /** smazané vygenerované kóty (klíče) – Chytré kóty je nevrátí */
  onSmartOff: (keys: string[]) => void;
  /** úprava vygenerovaných kót celkových rozměrů a pozic (skrytí, posun) – DrawingOptions.genEdit */
  onGenEdit: (f: (e: GenEdit | undefined) => GenEdit | undefined) => void;
  markDirty: () => void;
  view: View;
  host: React.RefObject<HTMLElement | null>;
  /** výběr je aktivní (žádný nástroj kót / pohledů) */
  enabled: boolean;
  /** dlouhý stisk prstem: zrušit rozjetý posun listu */
  cancelPan: () => void;
}) {
  const { res, ann, setAnn, onSmartOff, onGenEdit, markDirty, view, host, enabled, cancelPan } = o;
  const [sel, setSel] = useState<string[]>([]);
  const [g, setG] = useState<Gesture | null>(null);
  const gRef = useRef<Gesture | null>(null);
  const hold = useRef(0);
  const set = (x: Gesture | null) => {
    gRef.current = x;
    setG(x);
  };
  const shapes = useMemo<BoxShape[]>(() => (res ? [...annotationShapes(res, ann), ...generatedShapes(res)] : []), [res, ann]);
  // výběr jen existujících poznámek a vygenerovaných objektů (jiný list, smazání v seznamu, zpět, skrytí)
  useEffect(() => {
    setSel((s) => {
      const ids = new Set([...ann.map((a) => a.id), ...shapes.filter((x) => isGenId(x.id)).map((x) => x.id)]);
      const next = s.filter((id) => ids.has(id));
      return next.length === s.length ? s : next;
    });
  }, [ann, shapes]);
  useEffect(() => {
    if (!enabled) {
      set(null);
      setSel((s) => (s.length ? [] : s));
    }
  }, [enabled]);

  const local = (e: { clientX: number; clientY: number }): Vec2 => {
    const r = host.current?.getBoundingClientRect();
    return r ? [e.clientX - r.left, e.clientY - r.top] : [e.clientX, e.clientY];
  };
  const toSheet = (p: Vec2): Vec2 => [(p[0] - view.x) / view.z, (p[1] - view.y) / view.z];
  const onPaper = (q: Vec2) => !!res && q[0] >= 0 && q[1] >= 0 && q[0] <= res.sheet.w && q[1] <= res.sheet.h;
  const boxIds = (b: { p0: Vec2; p1: Vec2 }) => annotationsInBox(shapes, rectFrom(toSheet(b.p0), toSheet(b.p1)), isCrossing(b.p0, b.p1));

  /** stisk na listu – true = obslouženo (jinak se posouvá list) */
  const down = (e: React.PointerEvent): boolean => {
    if (!enabled || !res) return false;
    const p = local(e);
    const q = toSheet(p);
    if (e.pointerType === "touch") {
      // jeden prst posouvá list; dlouhý stisk na místě a tažení = okno
      clearTimeout(hold.current);
      const t = performance.now();
      const id = e.pointerId;
      const last = { p };
      const mv = (ev: PointerEvent) => {
        if (ev.pointerId === id) last.p = local(ev);
      };
      window.addEventListener("pointermove", mv);
      hold.current = window.setTimeout(() => {
        window.removeEventListener("pointermove", mv);
        if (holdPhase(p, t, last.p, performance.now()) !== "hold") return;
        cancelPan();
        set({ k: "box", p0: p, p1: last.p, mods: [{}], touch: true });
      }, HOLD_MS);
      window.addEventListener("pointerup", () => (clearTimeout(hold.current), window.removeEventListener("pointermove", mv)), { once: true });
      return false;
    }
    if (e.button !== 0 || !onPaper(q)) return false;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    set({ k: "press", p0: p, q0: q, hit: annotationAt(shapes, q, PICK_PX / view.z), mods: modsOf(e) });
    return true;
  };

  const move = (e: React.PointerEvent): boolean => {
    const cur = gRef.current;
    if (!cur) return false;
    const p = local(e);
    if (cur.k === "press") {
      if (!isDrag(cur.p0, p)) return true;
      if (cur.hit) {
        // tažení z poznámky: posun (nevybraná se nejdřív vybere – s Ctrl/Shift přidá k výběru)
        const add = cur.mods.ctrlKey || cur.mods.metaKey || cur.mods.shiftKey;
        const ids = sel.includes(cur.hit) ? sel : add ? [...sel, cur.hit] : [cur.hit];
        setSel(ids);
        set({ k: "move", q0: cur.q0, q1: toSheet(p), ids });
      } else set({ k: "box", p0: cur.p0, p1: p, mods: [cur.mods], cur: modsOf(e) });
      return true;
    }
    if (cur.k === "box") set({ ...cur, p1: p, cur: modsOf(e) });
    else set({ ...cur, q1: toSheet(p) });
    return true;
  };

  const up = (e: React.PointerEvent): boolean => {
    const cur = gRef.current;
    if (!cur) return false;
    set(null);
    const p = local(e);
    if (cur.k === "press") {
      if (cur.hit) setSel((s) => mergeSelection(s, [cur.hit!], clickMode([cur.mods, modsOf(e)])));
      else if (boxMode([cur.mods, modsOf(e)]) === "replace") setSel([]);
      return true;
    }
    if (cur.k === "box") {
      if (!isDrag(cur.p0, p) && cur.touch) return true;
      const ids = boxIds({ p0: cur.p0, p1: cur.touch ? p : cur.p1 });
      const mode = boxMode([...cur.mods, modsOf(e)]);
      setSel((s) => mergeSelection(s, ids, mode));
      host.current?.setAttribute("data-ann-boxsel", JSON.stringify({ n: ids.length, mode, crossing: isCrossing(cur.p0, cur.p1) }));
      return true;
    }
    const d: Vec2 = [cur.q1[0] - cur.q0[0], cur.q1[1] - cur.q0[1]];
    if (res && Math.hypot(d[0], d[1]) > 1e-6) shiftSel(cur.ids, d);
    return true;
  };

  /** posun vybraných: poznámky přímo, vygenerované kóty a pozice přes volby listu (přepočet výkresu) */
  const shiftSel = (ids: readonly string[], d: Vec2) => {
    if (!res) return;
    if (ids.some((id) => !isGenId(id))) setAnn((l) => moveAnnotations(res.views, l, ids, d));
    if (ids.some(isGenId)) onGenEdit((e) => moveGenerated(e, ids, d));
    markDirty();
  };

  const removeSel = useCallback(() => {
    if (!sel.length) return 0;
    const r = deleteAnnotations(ann, sel);
    if (r.removed) setAnn(() => r.anns);
    if (r.smartOff.length) onSmartOff(r.smartOff);
    // vygenerované kóty celkových rozměrů a pozice se skryjí (Obnovit vygenerované je vrátí)
    const gen = sel.filter(isGenId);
    if (gen.length) onGenEdit((e) => hideGenerated(e, gen));
    setSel([]);
    markDirty();
    return r.removed + gen.length;
  }, [sel, ann, setAnn, onSmartOff, onGenEdit, markDirty]);

  /** klávesy pracovní plochy výkresu – true = obslouženo */
  const key = (e: KeyboardEvent): boolean => {
    if (!enabled) return false;
    if (e.key === "Escape") {
      if (gRef.current && gRef.current.k !== "press") {
        set(null);
        return true;
      }
      if (sel.length) {
        setSel([]);
        return true;
      }
      return false;
    }
    if ((e.key === "Delete" || e.key === "Backspace") && sel.length) {
      e.preventDefault();
      removeSel();
      return true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && shapes.length) {
      e.preventDefault();
      setSel(shapes.map((s) => s.id));
      return true;
    }
    const arrows: Record<string, Vec2> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && sel.length && res) {
      // šipky posunou vybrané o 1 mm listu (Shift 10 mm)
      e.preventDefault();
      const k = e.shiftKey ? 10 : 1;
      shiftSel(sel, [arrows[e.key][0] * k, arrows[e.key][1] * k]);
      return true;
    }
    return false;
  };

  /** řádek seznamu poznámek: klik vybere (Ctrl/Shift přepne) */
  const rowClick = (id: string, e: Mods) => setSel((s) => mergeSelection(s, [id], clickMode(modsOf(e))));

  // ---- zobrazení: vybrané poznámky, posun, okno, nápověda
  const byId = useMemo(() => new Map(shapes.map((s) => [s.id, s])), [shapes]);
  const moving = g?.k === "move" ? g : null;
  const shown = moving ? moving.ids : sel;
  const dx = moving ? moving.q1[0] - moving.q0[0] : 0;
  const dy = moving ? moving.q1[1] - moving.q0[1] : 0;
  const px = 1 / view.z;
  let overlay: ReactNode = null;
  if (res && (shown.length || g?.k === "box")) {
    overlay = (
      <>
        {shown.length > 0 && (
          <svg data-ann-selection={shown.length} data-ann-sel-ids={shown.join(" ")} className="pointer-events-none absolute left-0 top-0 overflow-visible" width={res.sheet.w * view.z} height={res.sheet.h * view.z} style={{ transform: `translate(${view.x}px,${view.y}px)` }} viewBox={`0 0 ${res.sheet.w} ${res.sheet.h}`}>
            <g stroke="#2563eb" fill="none" strokeWidth={2 * px} opacity={moving ? 0.9 : 0.75}>
              {shown.flatMap((id) => {
                const s = byId.get(id);
                if (!s) return [];
                // vygenerovaná kóta celkového rozměru se posouvá jen kolmo k sobě (jako ji pak nakreslí jádro)
                const [sx, sy] = isGenId(id) ? genDelta(id, [dx, dy]) : [dx, dy];
                return [
                  <g key={id} transform={`translate(${sx},${sy})`} data-gen={isGenId(id) ? "" : undefined}>
                    {(s.polys ?? []).map((pl, i) => <polyline key={`p${i}`} points={pl.map((q) => q.join(",")).join(" ")} />)}
                    {(s.rects ?? []).map((r, i) => <rect key={`r${i}`} x={r.x0 - px * 2} y={r.y0 - px * 2} width={r.x1 - r.x0 + px * 4} height={r.y1 - r.y0 + px * 4} strokeDasharray={`${4 * px} ${2 * px}`} />)}
                  </g>,
                ];
              })}
            </g>
          </svg>
        )}
        {g?.k === "box" && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            <BoxSelectSvg a={g.p0} b={g.p1} crossing={isCrossing(g.p0, g.p1)} label={boxLabel(boxIds(g).length, isCrossing(g.p0, g.p1), modeTail(boxMode([...g.mods, ...(g.cur ? [g.cur] : [])])))} />
          </svg>
        )}
      </>
    );
  }
  const hint = enabled && res ? (
    <div data-ann-hint className="pointer-events-none absolute left-3 top-3 max-w-[min(560px,70%)] rounded-md bg-white/90 px-2 py-1 text-[11px] text-ink-700/70 shadow">
      {sel.length ? tr("Vybráno {0} · Delete smaže · táhněte = posun · šipky posunou o 1 mm (Shift 10 mm) · Esc zruší výběr", sel.length) : tr("Okno ⇢ celé uvnitř · ⇠ křížení · Ctrl/Shift přidá · Ctrl+Shift odebere · posun listu: prostřední / pravé tlačítko")}
    </div>
  ) : null;

  return { sel, setSel, down, move, up, key, rowClick, removeSel, overlay, hint, busy: !!g };
}

const modeTail = (m: "replace" | "add" | "remove") => (m === "replace" ? undefined : m);
