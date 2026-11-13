"use client";
/**
 * Mikronávod u ikony (bublina): název + zkratka, co příkaz dělá, kdy ho použít, co vybrat, očíslovaný postup,
 * textový příkaz a tip. Texty jsou v src/cad/help/tips.ts (balíky tips/*.ts), tady je jen chování a vzhled.
 *
 * Chování jako v desktopových CADech:
 * - objeví se po ~400 ms nad tlačítkem nebo hned při přechodu klávesnicí (focus-visible); při přejetí na sousední
 *   tlačítko se přepne hned, bez nové prodlevy;
 * - zmizí po opuštění, kliknutí, Esc, posunu (scroll), změně karty;
 * - funguje i nad neaktivním tlačítkem (události poslouchá obal – neaktivní tlačítko má pointer-events: none) a pak
 *   ukáže i důvod, proč je neaktivní (`why`), je-li znám;
 * - dotyk: dlouhý stisk (~500 ms) ukáže návod a příkaz se nespustí; běžné klepnutí příkaz spustí; klepnutí jinam návod skryje;
 * - bez návodu ukáže náhradu: název, zkratku a dosavadní krátkou nápovědu (nikdy prázdný rámeček);
 * - vypíná se v Nastavení → Obecné → „Mikronávody u ikon“ (pak se vrátí nativní `title`).
 *
 * Jediná bublina pro celou aplikaci: stav je v modulu, vykresluje ho `MicroTipLayer` (portál do body) – stačí jedna
 * instance (vkládá ji pás karet; další instance se nevykreslí).
 */
import { tr } from "@/cad/i18n";
import { lookupTip, onTipsLoaded } from "@/cad/help/tips";
import { loadSettings } from "@/cad/settings";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

export type TipSpec = {
  /** id tlačítka = klíč návodu */
  id: string;
  /** kontext: karta pásu („create“…), „menu:<id rodiče>“, „drawing-ws“, „quick“ */
  ctx?: string;
  label: string;
  kbd?: string;
  /** dosavadní krátká nápověda (náhrada, když návod chybí) */
  hint?: string;
  disabled?: boolean;
  /** proč je tlačítko neaktivní (ukáže se jen u neaktivního) */
  why?: string;
  /** umístění: pod tlačítko (pás, lišty) nebo vedle nabídky (položky rozbalovací nabídky) */
  place?: "below" | "side";
};

export const TIP_DOM_ID = "cad-microtip";
const DELAY = 400;
const LONG_PRESS = 500;
/** po skrytí opuštěním tlačítka se další bublina ukáže hned (přejíždění po pásu) */
const WARM = 600;
const MOVE_TOL = 10;

type Active = { get: () => TipSpec; anchor: HTMLElement };
let active: Active | null = null;
let version = 0;
const subs = new Set<() => void>();
const emit = () => {
  version++;
  for (const s of subs) s();
};
let timer: ReturnType<typeof setTimeout> | undefined;
let timerFor: HTMLElement | null = null;
let warmUntil = 0;
/** tlačítko, na které se kliklo / u kterého se bublina zavřela Esc – do opuštění myší se znovu neukáže */
let suppressed: HTMLElement | null = null;

/** Zapnuté mikronávody (Nastavení → Obecné)? Čte se při vykreslení i při zobrazení. */
export const microTipsEnabled = (): boolean => loadSettings().microTips !== false;

/** Nativní bublina (když jsou mikronávody vypnuté): „Název (kbd) – nápověda“. */
export const nativeTitle = (s: Pick<TipSpec, "label" | "kbd" | "hint">) => [s.label, s.kbd ? `(${s.kbd})` : "", s.hint ? `– ${s.hint}` : ""].filter(Boolean).join(" ");

const buttonOf = (el: HTMLElement): HTMLElement => (el.matches("button") ? el : el.querySelector<HTMLElement>("button")) ?? el;

function describe(a: Active | null, on: boolean) {
  if (!a) return;
  const b = buttonOf(a.anchor);
  if (on) b.setAttribute("aria-describedby", TIP_DOM_ID);
  else if (b.getAttribute("aria-describedby") === TIP_DOM_ID) b.removeAttribute("aria-describedby");
}

function clearTimer() {
  clearTimeout(timer);
  timer = undefined;
  timerFor = null;
}

/** Ukáže bublinu u prvku hned. */
export function showTip(get: () => TipSpec, anchor: HTMLElement) {
  clearTimer();
  if (!microTipsEnabled() || !anchor.isConnected) return;
  if (active && active.anchor !== anchor) describe(active, false);
  active = { get, anchor };
  describe(active, true);
  emit();
}

/** Skryje bublinu (je-li vidět) a zruší čekající zobrazení. */
export function hideTip() {
  clearTimer();
  if (!active) return;
  describe(active, false);
  active = null;
  emit();
}

function hoverEnter(get: () => TipSpec, el: HTMLElement) {
  if (suppressed === el || !microTipsEnabled()) return;
  if (active || Date.now() < warmUntil) return showTip(get, el);
  clearTimer();
  timerFor = el;
  timer = setTimeout(() => showTip(get, el), DELAY);
}

function hoverLeave(el: HTMLElement) {
  if (suppressed === el) suppressed = null;
  if (timerFor === el) clearTimer();
  if (active?.anchor === el) {
    warmUntil = Date.now() + WARM;
    hideTip();
  }
}

type Press = { x: number; y: number; fired: boolean; t?: ReturnType<typeof setTimeout> };

export type TipWrapProps = {
  "data-tip-id"?: string;
  "data-tip-ctx"?: string;
  onPointerEnter?: React.PointerEventHandler<HTMLElement>;
  onPointerLeave?: React.PointerEventHandler<HTMLElement>;
  onPointerDown?: React.PointerEventHandler<HTMLElement>;
  onPointerMove?: React.PointerEventHandler<HTMLElement>;
  onPointerUp?: React.PointerEventHandler<HTMLElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLElement>;
  onClickCapture?: React.MouseEventHandler<HTMLElement>;
  onContextMenu?: React.MouseEventHandler<HTMLElement>;
  onFocus?: React.FocusEventHandler<HTMLElement>;
  onBlur?: React.FocusEventHandler<HTMLElement>;
};

/**
 * Chování mikronávodu pro jedno tlačítko. `wrap` patří na obal tlačítka (prvek s vlastním rámečkem – kvůli neaktivním
 * tlačítkům, která mají `pointer-events: none`), `on` říká, zda jsou návody zapnuté (jinak dát tlačítku `title`).
 * `enabled = false` → žádné chování (např. kontextová nabídka bez návodů).
 */
export function useMicroTip(spec: TipSpec, enabled = true): { on: boolean; wrap: TipWrapProps } {
  const specRef = useRef(spec);
  specRef.current = spec;
  const getRef = useRef(() => specRef.current);
  const elRef = useRef<HTMLElement | null>(null);
  const press = useRef<Press | null>(null);
  useEffect(
    () => () => {
      const el = elRef.current;
      clearTimeout(press.current?.t);
      if (!el) return;
      if (active?.anchor === el) hideTip();
      if (timerFor === el) clearTimer();
      if (suppressed === el) suppressed = null;
    },
    [],
  );
  const on = enabled && microTipsEnabled();
  if (!on) return { on, wrap: {} };
  const get = getRef.current;
  // React posílá události z portálů (rozbalovací nabídka tlačítka) i obalu tlačítka – ty se tu nepočítají
  const own = (e: React.SyntheticEvent<HTMLElement>) => e.currentTarget.contains(e.target as Node);
  const endPress = () => {
    const p = press.current;
    if (p && !p.fired) {
      clearTimeout(p.t);
      press.current = null;
    }
  };
  return {
    on,
    wrap: {
      "data-tip-id": spec.id,
      "data-tip-ctx": spec.ctx,
      onPointerEnter: (e) => {
        elRef.current = e.currentTarget;
        if (e.pointerType !== "touch" && own(e)) hoverEnter(get, e.currentTarget);
      },
      onPointerLeave: (e) => {
        if (e.pointerType !== "touch") hoverLeave(e.currentTarget);
      },
      onPointerDown: (e) => {
        if (!own(e)) return;
        const el = (elRef.current = e.currentTarget);
        if (e.pointerType !== "touch") {
          // kliknutí: bublinu zavřít a do opuštění tlačítka neukazovat
          suppressed = el;
          warmUntil = 0;
          hideTip();
          return;
        }
        // dotyk: dlouhý stisk ukáže návod místo spuštění příkazu
        clearTimeout(press.current?.t);
        if (active && active.anchor !== el) hideTip();
        const p: Press = { x: e.clientX, y: e.clientY, fired: false };
        p.t = setTimeout(() => {
          p.fired = true;
          showTip(get, el);
        }, LONG_PRESS);
        press.current = p;
      },
      onPointerMove: (e) => {
        const p = press.current;
        if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOL) endPress();
      },
      onPointerUp: endPress,
      onPointerCancel: () => {
        clearTimeout(press.current?.t);
        press.current = null;
      },
      onClickCapture: (e) => {
        if (!own(e) || !press.current?.fired) return;
        // klepnutí, které jen ukončilo dlouhý stisk, příkaz nespouští
        e.preventDefault();
        e.stopPropagation();
        press.current = null;
      },
      onContextMenu: (e) => {
        if (own(e) && press.current) e.preventDefault(); // dlouhý stisk na Androidu = kontextová nabídka prohlížeče
      },
      onFocus: (e) => {
        if (!own(e)) return;
        elRef.current = e.currentTarget;
        const t = e.target as HTMLElement;
        if (suppressed !== e.currentTarget && t.matches?.(":focus-visible")) showTip(get, e.currentTarget);
      },
      onBlur: (e) => {
        if (active?.anchor === e.currentTarget) hideTip();
      },
    },
  };
}

/** Obal tlačítka s mikronávodem (pro místa mimo pás karet – lišty výkresu apod.). */
export function TipBox({ tip, className, children, enabled = true }: { tip: TipSpec; className?: string; children: React.ReactNode; enabled?: boolean }) {
  const t = useMicroTip(tip, enabled);
  return (
    <div className={className} {...t.wrap}>
      {children}
    </div>
  );
}

// ---------- vykreslení ----------

const subscribe = (fn: () => void) => {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
};
let layerOwner: symbol | null = null;

/** Bublina mikronávodu (portál). Vykreslí se jen jedna instance v aplikaci. */
export function MicroTipLayer() {
  const v = useSyncExternalStore(subscribe, () => version, () => 0);
  const [mine, setMine] = useState(false);
  const [loaded, setLoaded] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxH?: number } | null>(null);
  useEffect(() => {
    if (layerOwner) return;
    const me = Symbol("microtip");
    layerOwner = me;
    setMine(true);
    const off = onTipsLoaded(() => setLoaded((n) => n + 1));
    return () => {
      off();
      if (layerOwner === me) layerOwner = null;
      hideTip();
    };
  }, []);
  const a = mine ? active : null;
  useLayoutEffect(() => {
    if (!a || !ref.current) return setPos(null);
    setPos(placeTip(a.anchor, ref.current, a.get().place ?? "below"));
  }, [a, v, loaded]);
  // zavření: Esc, posun, klepnutí/kliknutí mimo tlačítko, změna velikosti okna, ztráta fokusu okna
  useEffect(() => {
    if (!a) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      suppressed = a.anchor;
      hideTip();
    };
    const away = (e: Event) => {
      if (!a.anchor.contains(e.target as Node)) hideTip();
    };
    const gone = () => hideTip();
    window.addEventListener("keydown", esc, true);
    window.addEventListener("scroll", gone, true);
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("resize", gone);
    window.addEventListener("blur", gone);
    return () => {
      window.removeEventListener("keydown", esc, true);
      window.removeEventListener("scroll", gone, true);
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("resize", gone);
      window.removeEventListener("blur", gone);
    };
  }, [a]);
  if (!a || typeof document === "undefined") return null;
  if (!a.anchor.isConnected) {
    queueMicrotask(hideTip);
    return null;
  }
  const spec = a.get();
  const tip = lookupTip(spec.id, spec.ctx);
  const why = spec.disabled ? spec.why : undefined;
  return createPortal(
    <div
      ref={ref}
      id={TIP_DOM_ID}
      role="tooltip"
      data-microtip={tip ? "full" : "fallback"}
      data-tip-for={spec.ctx ? `${spec.ctx}/${spec.id}` : spec.id}
      className="pointer-events-none fixed z-[130] w-max max-w-[min(340px,calc(100vw-16px))] select-none overflow-hidden rounded-lg border border-[#cfd6de] bg-white px-3 py-2 text-left text-[12px] leading-snug text-[#26303b] shadow-[0_12px_32px_-8px_rgba(15,23,42,.38)]"
      style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxH } : { left: 0, top: 0, visibility: "hidden" }}
    >
      <div className="flex items-start gap-3">
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-[#1f2933]">{spec.label}</p>
        {spec.kbd && <kbd className="shrink-0 rounded border border-[#cfd6de] bg-[#f3f6f9] px-1.5 py-px font-mono text-[10.5px] font-medium text-[#4a5664]">{spec.kbd}</kbd>}
      </div>
      {why && (
        <p data-tip-why className="mt-1 rounded bg-[#fff4e5] px-1.5 py-0.5 text-[11.5px] font-medium text-[#9a4a00]">
          {why}
        </p>
      )}
      {tip ? (
        <>
          <p data-tip-what className="mt-1 text-[12px] text-[#26303b]">
            {tip.what}
          </p>
          <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1 border-t border-[#e6eaef] pt-1.5">
            <Row label={tr("Kdy použít")}>{tip.when}</Row>
            {tip.select && <Row label={tr("Vyberte")}>{tip.select}</Row>}
            {tip.steps.length > 0 && (
              <Row label={tr("Postup")}>
                <ol className="list-decimal space-y-0.5 pl-4 marker:text-[#6b7785]">
                  {tip.steps.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </Row>
            )}
            {tip.cmd && (
              <Row label={tr("Příkaz")}>
                <code className="rounded bg-[#f3f6f9] px-1 py-px font-mono text-[11px] text-[#1f2933]">{tip.cmd}</code>
              </Row>
            )}
            {tip.note && <Row label={tr("Tip")}>{tip.note}</Row>}
          </dl>
        </>
      ) : (
        spec.hint && <p className="mt-1 text-[12px] text-[#4a5664]">{spec.hint}</p>
      )}
    </div>,
    document.body,
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="whitespace-nowrap pt-px text-[10px] font-semibold uppercase tracking-wide text-[#6b7785]">{label}</dt>
      <dd className="min-w-0 text-[11.5px] text-[#3a4552]">{children}</dd>
    </>
  );
}

/**
 * Umístění bubliny: pod tlačítko (nevejde-li se, nad něj, jinak vedle), vždy uvnitř okna a nikdy přes tlačítko.
 * Položky nabídky (`side`) mají bublinu vedle nabídky, aby nezakrývala sousední položky.
 */
export function placeTip(anchor: HTMLElement, tipEl: HTMLElement, place: "below" | "side"): { left: number; top: number; maxH?: number } {
  const M = 8;
  const G = 6;
  const r = anchor.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampX = (x: number) => Math.max(M, Math.min(x, vw - w - M));
  const clampY = (y: number) => Math.max(M, Math.min(y, vh - h - M));
  if (place === "side") {
    const menu = anchor.closest("[data-cad-menu]")?.getBoundingClientRect() ?? r;
    if (menu.right + G + w <= vw - M) return { left: menu.right + G, top: clampY(r.top) };
    if (menu.left - G - w >= M) return { left: menu.left - G - w, top: clampY(r.top) };
  }
  if (r.bottom + G + h <= vh - M) return { left: clampX(r.left), top: r.bottom + G };
  if (r.top - G - h >= M) return { left: clampX(r.left), top: r.top - G - h };
  if (vw - r.right - G - M >= w) return { left: r.right + G, top: clampY(r.top) };
  if (r.left - G - M >= w) return { left: r.left - G - w, top: clampY(r.top) };
  // nikam se celá nevejde: na větší stranu, oříznutá na výšku okna
  const below = vh - r.bottom > r.top;
  return below ? { left: clampX(r.left), top: r.bottom + G, maxH: vh - r.bottom - G - M } : { left: clampX(r.left), top: M, maxH: r.top - G - M };
}
