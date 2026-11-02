"use client";

/**
 * Pole odkazu na geometrii („chytré vstupní pole“ jako v ZW3D): hodnotu lze
 *  – vybrat klikem v 3D okně (tlačítko Vybrat → stav čekání na klik),
 *  – napsat (X;Y;Z, @dx;dy;dz od posledního bodu, nebo číslo u vzdáleností),
 *  – zvolit z nabídky pravého tlačítka / tlačítka ⋯ (střed hrany, střed kružnice, mezi dvěma body, průsečík…).
 * Výběr v 3D směruje aplikace přes `RefPickContext`.
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { cad } from "@/cad/client";
import {
  AXIS_KINDS,
  DIRECTION_KINDS,
  EXTENT_KINDS,
  PLANE_KINDS,
  POINT_OPTIONS,
  START_KINDS,
  THIN_SIDES,
  defaultExtent,
  isPlaceholder,
  refLabel,
  type AxisDef,
  type Direction,
  type Extent,
  type ExtentKind,
  type PlaneDef,
  type PointOption,
  type Ref,
  type StartFrom,
  type Thin,
} from "@/cad/refs";
import type { Axis, CadDoc, Feature, PlaneName, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { ContextMenu, type RMenuEntry } from "./ribbon";

export type Want = "point" | "vertex" | "edge" | "face" | "plane" | "axis" | "any";

export type RefPickTarget = { id: string; want: Want; label: string; onPick: (ref: Ref) => void };

export const RefPickContext = createContext<{
  doc: CadDoc;
  target: RefPickTarget | null;
  request: (t: RefPickTarget | null) => void;
  /** vybrané entity (pro „použít výběr“) */
  selectionRefs: Ref[];
  lastPoint: Vec3 | null;
} | null>(null);

let seq = 0;
const nid = () => `rp${++seq}`;

const WANT_LABEL: Record<Want, string> = { point: "bod", vertex: "vrchol", edge: "hranu", face: "plochu", plane: "rovinnou plochu / pomocnou rovinu", axis: "hranu / válcovou plochu (osu)", any: "entitu" };

const fieldCls = "flex min-h-[32px] w-full items-center gap-1 rounded-lg border px-2 py-1 text-[12.5px]";

function parseXyz(text: string, last: Vec3 | null): Vec3 | null {
  let t = text.trim();
  let rel = false;
  if (t.startsWith("@")) {
    rel = true;
    t = t.slice(1);
  }
  const parts = t.split(/[;,\s]+/).filter(Boolean).map((x) => Number(x.replace(",", ".")));
  if (parts.length < 2 || parts.some((v) => !Number.isFinite(v))) return null;
  const p: Vec3 = [parts[0], parts[1], parts[2] ?? 0];
  if (rel && last) return [last[0] + p[0], last[1] + p[1], last[2] + p[2]];
  return p;
}

/** Pole odkazu. `want` omezuje druh entity, `allowXyz` dovolí psát souřadnice. */
export function RefField({ label, value, onChange, want = "point", allowXyz = want === "point" || want === "any", hint, compact }: { label: string; value: Ref | undefined; onChange: (r: Ref) => void; want?: Want; allowXyz?: boolean; hint?: string; compact?: boolean }) {
  const ctx = useContext(RefPickContext);
  const [id] = useState(nid);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [opt, setOpt] = useState<{ o: PointOption; got: Ref[] } | null>(null);
  const active = ctx?.target?.id === id;
  const empty = !value || isPlaceholder(value);

  // živý popis vyřešené geometrie
  useEffect(() => {
    if (!ctx || !value || isPlaceholder(value)) {
      setInfo(null);
      return;
    }
    let dead = false;
    // krátké zpoždění: při tažení hodnot (live) se dokument mění mnohokrát za sekundu
    const t = setTimeout(() => {
      cad.refInfo(ctx.doc, value).then(
        (r) => {
          if (dead) return;
          if (r.error) setInfo("⚠ " + r.error);
          else if (r.geo?.point) setInfo(`${r.geo.kindLabel ?? ""} ${r.geo.point.map((v) => String(Math.round(v * 100) / 100).replace(".", ",")).join("; ")}`.trim());
          else setInfo(null);
        },
        () => undefined,
      );
    }, 180);
    return () => {
      dead = true;
      clearTimeout(t);
    };
  }, [ctx, value]);

  const startPick = (w: Want, lbl: string, done: (r: Ref) => void) => {
    ctx?.request({ id, want: w, label: lbl, onPick: done });
  };
  const pickPlain = () => {
    if (!ctx) return;
    if (active) return ctx.request(null);
    startPick(want, `${label}: vyberte ${WANT_LABEL[want]}`, (r) => {
      onChange(r);
      ctx.request(null);
    });
  };
  const runOption = (o: PointOption) => {
    setMenu(null);
    if (!o.picks.length) {
      if (o.id === "xyz") return setTyping(true);
      return finishOption(o, []);
    }
    const got: Ref[] = [];
    const step = () => {
      const k = o.picks[got.length];
      setOpt({ o, got: [...got] });
      startPick(k.want === "point" ? "point" : k.want, `${o.label}: vyberte ${k.label} (${got.length + 1}/${o.picks.length})`, (r) => {
        got.push(r);
        if (got.length < o.picks.length) step();
        else {
          ctx?.request(null);
          setOpt(null);
          finishOption(o, got);
        }
      });
    };
    step();
  };
  const finishOption = (o: PointOption, got: Ref[]) => {
    let v: number | undefined;
    if (o.needsValue) {
      const raw = window.prompt(o.needsValue.label, String(o.needsValue.def));
      if (raw === null) return;
      v = Number(raw.replace(",", "."));
      if (!Number.isFinite(v)) return;
    }
    onChange(o.make(got, v));
  };
  const commitText = () => {
    const p = parseXyz(text, ctx?.lastPoint ?? null);
    if (!p) {
      setErr("Zadejte X; Y; Z (např. 10; 20; 0 nebo @5; 0; 0)");
      return;
    }
    setErr(null);
    setTyping(false);
    onChange({ kind: "xyz", p });
  };
  const useSelection = () => {
    const r = ctx?.selectionRefs.find((x) => want === "any" || want === "point" || x.kind === want || (want === "plane" && x.kind === "face") || (want === "axis" && (x.kind === "edge" || x.kind === "face")));
    if (r) onChange(r);
  };
  const entries: RMenuEntry[] = [
    ...(want === "point" || want === "any" || want === "vertex" ? POINT_OPTIONS.filter((o) => want !== "vertex" || ["vertex", "edgeMid", "edgeStart", "edgeEnd", "center", "faceCenter", "percent", "mid", "between", "offset", "project", "intersect", "origin", "xyz"].includes(o.id)).map((o) => ({ id: o.id, label: o.label, icon: o.picks[0]?.want === "edge" ? "edge" : o.picks[0]?.want === "face" ? "face" : "point", hint: o.hint, onClick: () => runOption(o) })) : []),
    ...(want === "face" || want === "plane" ? [{ id: "face", label: "Vybrat plochu klikem", icon: "face", onClick: pickPlain }] : []),
    ...(want === "edge" || want === "axis" ? [{ id: "edge", label: "Vybrat hranu klikem", icon: "edge", onClick: pickPlain }] : []),
    { divider: true },
    { id: "sel", label: "Použít aktuální výběr", icon: "select", disabled: !ctx?.selectionRefs.length, onClick: useSelection },
    { id: "clear", label: "Vymazat", icon: "delete", onClick: () => onChange({ kind: want === "face" || want === "plane" ? "face" : want === "edge" || want === "axis" ? "edge" : "vertex", index: -1 }) },
  ];

  return (
    <div className={compact ? "" : "block"}>
      {!compact && (
        <span className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-ink-700/55">
          {label}
          {hint && <span className="normal-case tracking-normal text-ink-700/40">{hint}</span>}
        </span>
      )}
      {typing ? (
        <div className="flex gap-1">
          <input
            autoFocus
            className="w-full rounded-lg border border-brand px-2 py-1 text-[12.5px] outline-none"
            placeholder="X; Y; Z  nebo  @dx; dy; dz"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitText();
              if (e.key === "Escape") setTyping(false);
            }}
            onBlur={() => (text.trim() ? commitText() : setTyping(false))}
          />
        </div>
      ) : (
        <div
          className={cn(fieldCls, active ? "border-brand bg-brand/5 ring-2 ring-brand/20" : empty ? "border-dashed border-ink-700/25 bg-white" : "border-ink-700/12 bg-white")}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
          title="Pravé tlačítko: další způsoby zadání"
        >
          <button type="button" onClick={pickPlain} className={cn("flex-1 truncate text-left", empty && !active && "text-ink-700/45")}>
            {active ? (opt ? `${opt.o.label} – ${opt.got.length + 1}/${opt.o.picks.length}…` : `Klikněte v modelu (${WANT_LABEL[want]})…`) : empty ? `Vyberte ${WANT_LABEL[want]}` : refLabel(value)}
          </button>
          {allowXyz && (
            <button type="button" title="Zadat souřadnice" onClick={() => setTyping(true)} className="rounded px-1 font-mono text-[11px] text-ink-700/60 hover:bg-steel-100">
              xyz
            </button>
          )}
          <button type="button" title="Další způsoby zadání (pravé tlačítko)" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })} className="rounded px-1.5 text-[13px] leading-none text-ink-700/70 hover:bg-steel-100">
            ⋯
          </button>
        </div>
      )}
      {err && <p className="mt-0.5 text-[11px] text-brand">{err}</p>}
      {info && !err && <p className="mt-0.5 truncate text-[11px] text-ink-700/50">{info}</p>}
      {menu && <ContextMenu x={menu.x} y={menu.y} entries={entries} close={() => setMenu(null)} />}
    </div>
  );
}

// ---------------- složená pole ----------------

const selectCls = "w-full rounded-lg border border-ink-700/12 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-brand";

function NumIn({ label, value, onChange, suffix = "mm", min, step = 1 }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; min?: number; step?: number }) {
  const [t, setT] = useState(String(value).replace(".", ","));
  useEffect(() => setT(String(Math.round(value * 1e4) / 1e4).replace(".", ",")), [value]);
  const commit = () => {
    const v = Number(t.replace(",", "."));
    if (Number.isFinite(v)) onChange(min != null ? Math.max(min, v) : v);
    else setT(String(value));
  };
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</span>
      <span className="flex items-center rounded-lg border border-ink-700/12 bg-white pr-2 focus-within:border-brand">
        <input className="w-full bg-transparent px-2 py-1.5 text-[13px] outline-none" value={t} step={step} onChange={(e) => setT(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
        <span className="text-[11px] text-ink-700/45">{suffix}</span>
      </span>
    </label>
  );
}

/** Ukončení (vysunutí / díra): druh + doplňující hodnota nebo odkaz. */
export function ExtentField({ label, value, onChange, kinds, defaultDistance = 20 }: { label: string; value: Extent; onChange: (e: Extent) => void; kinds?: ExtentKind[]; defaultDistance?: number }) {
  const list = kinds ? EXTENT_KINDS.filter((k) => kinds.includes(k.v)) : EXTENT_KINDS;
  const cur = list.find((k) => k.v === value.kind) ?? list[0];
  return (
    <div className="space-y-2 rounded-lg border border-ink-700/10 bg-steel-50/60 p-2">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</span>
        <select className={selectCls} value={cur.v} onChange={(e) => onChange(defaultExtent(e.target.value as ExtentKind, "d" in value ? value.d : defaultDistance))} title={cur.hint}>
          {list.map((k) => (
            <option key={k.v} value={k.v} title={k.hint}>
              {k.l}
            </option>
          ))}
        </select>
      </label>
      {(value.kind === "blind" || value.kind === "midPlane") && <NumIn label={value.kind === "midPlane" ? "Celková délka" : "Vzdálenost"} value={value.d} min={0.001} onChange={(d) => onChange({ ...value, d })} />}
      {value.kind === "toVertex" && <RefField label="Vrchol / bod" value={value.ref} want="point" onChange={(ref) => onChange({ ...value, ref })} />}
      {value.kind === "toFace" && (
        <>
          <RefField label="Plocha / pomocná rovina" value={value.ref} want="face" onChange={(ref) => onChange({ ...value, ref })} />
          <NumIn label="Odsazení od plochy (0 = až k ploše)" value={value.offset ?? 0} onChange={(offset) => onChange({ ...value, offset })} />
        </>
      )}
      {value.kind === "offsetFromFace" && (
        <>
          <RefField label="Plocha / pomocná rovina" value={value.ref} want="face" onChange={(ref) => onChange({ ...value, ref })} />
          <NumIn label="Odsazení" value={value.d} onChange={(d) => onChange({ ...value, d })} />
        </>
      )}
      <p className="text-[11px] text-ink-700/45">{cur.hint}</p>
    </div>
  );
}

export function DirectionField({ label = "Směr", value, onChange, allowNormal = true }: { label?: string; value: Direction | undefined; onChange: (d: Direction | undefined) => void; allowNormal?: boolean }) {
  const v: Direction = value ?? { kind: "normal" };
  const list = allowNormal ? DIRECTION_KINDS : DIRECTION_KINDS.filter((k) => k.v !== "normal");
  const change = (kind: Direction["kind"]) => {
    switch (kind) {
      case "normal":
        return onChange(undefined);
      case "axis":
        return onChange({ kind, axis: "Z" });
      case "vector":
        return onChange({ kind, v: [0, 0, 1] });
      case "angle":
        return onChange({ kind, deg: 15 });
      case "twoPoints":
        return onChange({ kind, a: { kind: "vertex", index: -1 }, b: { kind: "vertex", index: -1 } });
      case "faceNormal":
        return onChange({ kind, ref: { kind: "face", index: -1 } });
      default:
        return onChange({ kind, ref: { kind: "edge", index: -1 } } as Direction);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-ink-700/10 bg-steel-50/60 p-2">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</span>
        <select className={selectCls} value={v.kind} onChange={(e) => change(e.target.value as Direction["kind"])}>
          {list.map((k) => (
            <option key={k.v} value={k.v}>
              {k.l}
            </option>
          ))}
        </select>
      </label>
      {v.kind === "axis" && (
        <div className="flex gap-1">
          {(["X", "Y", "Z"] as Axis[]).map((a) => (
            <button key={a} type="button" onClick={() => onChange({ kind: "axis", axis: a })} className={cn("flex-1 rounded-md border px-2 py-1 text-[12px]", v.axis === a ? "border-brand bg-brand/10 text-brand" : "border-ink-700/12 bg-white")}>
              {a}
            </button>
          ))}
        </div>
      )}
      {v.kind === "vector" && (
        <div className="grid grid-cols-3 gap-1">
          {(["X", "Y", "Z"] as const).map((a, i) => (
            <NumIn key={a} label={a} suffix="" value={v.v[i]} onChange={(n) => onChange({ kind: "vector", v: v.v.map((c, k) => (k === i ? n : c)) as Vec3 })} />
          ))}
        </div>
      )}
      {v.kind === "angle" && <NumIn label="Úhel od normály (kolem osy Y skici)" suffix="°" value={v.deg} onChange={(deg) => onChange({ kind: "angle", deg })} />}
      {v.kind === "twoPoints" && (
        <>
          <RefField label="Od bodu" value={v.a} want="point" onChange={(a) => onChange({ ...v, a })} />
          <RefField label="K bodu" value={v.b} want="point" onChange={(b) => onChange({ ...v, b })} />
        </>
      )}
      {(v.kind === "edge" || v.kind === "tangent") && <RefField label={v.kind === "edge" ? "Hrana / válcová plocha" : "Hrana (tečna)"} value={v.ref} want="axis" onChange={(ref) => onChange({ ...v, ref })} />}
      {v.kind === "faceNormal" && <RefField label="Plocha" value={v.ref} want="face" onChange={(ref) => onChange({ ...v, ref })} />}
    </div>
  );
}

export function StartField({ value, onChange }: { value: StartFrom | undefined; onChange: (s: StartFrom | undefined) => void }) {
  const v: StartFrom = value ?? { kind: "sketchPlane" };
  return (
    <div className="space-y-2 rounded-lg border border-ink-700/10 bg-steel-50/60 p-2">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Začátek</span>
        <select
          className={selectCls}
          value={v.kind}
          onChange={(e) => {
            const k = e.target.value as StartFrom["kind"];
            onChange(k === "sketchPlane" ? undefined : k === "offset" ? { kind: k, d: 5 } : k === "face" ? { kind: k, ref: { kind: "face", index: -1 } } : { kind: k, ref: { kind: "vertex", index: -1 } });
          }}
        >
          {START_KINDS.map((k) => (
            <option key={k.v} value={k.v}>
              {k.l}
            </option>
          ))}
        </select>
      </label>
      {v.kind === "offset" && <NumIn label="Odsazení" value={v.d} onChange={(d) => onChange({ kind: "offset", d })} />}
      {v.kind === "face" && <RefField label="Plocha" value={v.ref} want="face" onChange={(ref) => onChange({ kind: "face", ref })} />}
      {v.kind === "vertex" && <RefField label="Vrchol / bod" value={v.ref} want="point" onChange={(ref) => onChange({ kind: "vertex", ref })} />}
    </div>
  );
}

export function ThinField({ value, onChange }: { value: Thin | undefined; onChange: (t: Thin | undefined) => void }) {
  return (
    <div className="space-y-2 rounded-lg border border-ink-700/10 bg-steel-50/60 p-2">
      <label className="flex items-center gap-2 text-[12.5px]">
        <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked ? { side: "one", t1: 2 } : undefined)} className="accent-brand" />
        Tenká stěna (profil jako stěna dané tloušťky, funguje i pro otevřený profil)
      </label>
      {value && (
        <>
          <div className="flex gap-1">
            {THIN_SIDES.map((s) => (
              <button key={s.v} type="button" onClick={() => onChange({ ...value, side: s.v })} className={cn("flex-1 rounded-md border px-1 py-1 text-[11.5px]", value.side === s.v ? "border-brand bg-brand/10 text-brand" : "border-ink-700/12 bg-white")}>
                {s.l}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumIn label={value.side === "two" ? "Tloušťka ven" : "Tloušťka"} value={value.t1} min={0.01} onChange={(t1) => onChange({ ...value, t1 })} />
            {value.side === "two" && <NumIn label="Tloušťka dovnitř" value={value.t2 ?? value.t1} min={0.01} onChange={(t2) => onChange({ ...value, t2 })} />}
          </div>
        </>
      )}
    </div>
  );
}

export function AxisField({ value, onChange, sketch }: { value: AxisDef | undefined; onChange: (a: AxisDef | undefined) => void; sketch: Feature | undefined }) {
  const v: AxisDef = value ?? { kind: "sketchY" };
  const lines = sketch && sketch.type === "sketch" ? sketch.entities.filter((e) => e.type === "line") : [];
  const change = (kind: AxisDef["kind"]) => {
    switch (kind) {
      case "sketchY":
        return onChange(undefined);
      case "sketchX":
        return onChange({ kind });
      case "sketchLine":
        return onChange({ kind, entityId: lines[0]?.id ?? "" });
      case "global":
        return onChange({ kind, axis: "Z" });
      case "twoPoints":
        return onChange({ kind, a: { kind: "vertex", index: -1 }, b: { kind: "vertex", index: -1 } });
      case "datum":
        return onChange({ kind, featureId: "" });
      case "cylFace":
        return onChange({ kind, ref: { kind: "face", index: -1 } });
      default:
        return onChange({ kind: "edge", ref: { kind: "edge", index: -1 } });
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-ink-700/10 bg-steel-50/60 p-2">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">Osa rotace</span>
        <select className={selectCls} value={v.kind} onChange={(e) => change(e.target.value as AxisDef["kind"])}>
          {AXIS_KINDS.map((k) => (
            <option key={k.v} value={k.v}>
              {k.l}
            </option>
          ))}
        </select>
      </label>
      {v.kind === "sketchLine" && (
        <select className={selectCls} value={v.entityId} onChange={(e) => onChange({ kind: "sketchLine", entityId: e.target.value })}>
          {!lines.length && <option value="">— skica nemá úsečku —</option>}
          {lines.map((l, i) => (
            <option key={l.id} value={l.id}>
              Úsečka {i + 1}
            </option>
          ))}
        </select>
      )}
      {v.kind === "global" && (
        <div className="flex gap-1">
          {(["X", "Y", "Z"] as Axis[]).map((a) => (
            <button key={a} type="button" onClick={() => onChange({ kind: "global", axis: a })} className={cn("flex-1 rounded-md border px-2 py-1 text-[12px]", v.axis === a ? "border-brand bg-brand/10 text-brand" : "border-ink-700/12 bg-white")}>
              {a}
            </button>
          ))}
        </div>
      )}
      {v.kind === "edge" && <RefField label="Hrana" value={v.ref} want="edge" onChange={(ref) => onChange({ kind: "edge", ref })} />}
      {v.kind === "cylFace" && <RefField label="Válcová plocha" value={v.ref} want="face" onChange={(ref) => onChange({ kind: "cylFace", ref })} />}
      {v.kind === "twoPoints" && (
        <>
          <RefField label="První bod" value={v.a} want="point" onChange={(a) => onChange({ ...v, a })} />
          <RefField label="Druhý bod" value={v.b} want="point" onChange={(b) => onChange({ ...v, b })} />
        </>
      )}
      {v.kind === "datum" && <DatumPick value={v.featureId} onChange={(featureId) => onChange({ kind: "datum", featureId })} />}
    </div>
  );
}

function DatumPick({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const ctx = useContext(RefPickContext);
  const datums = ctx?.doc.features.filter((f) => f.type === "datum") ?? [];
  return (
    <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— vyberte pomocnou rovinu —</option>
      {datums.map((d) => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>
  );
}

const PLANES: PlaneName[] = ["XY", "XZ", "YZ"];

/** Definice roviny (15 způsobů) – pro skicu, pomocnou rovinu, zrcadlení, řez, úkos. */
export function PlaneDefField({ label = "Rovina", value, onChange, allowNone, noneLabel = "Základní / podle osy (původní zadání)" }: { label?: string; value: PlaneDef | undefined; onChange: (p: PlaneDef | undefined) => void; allowNone?: boolean; noneLabel?: string }) {
  const NOF: Ref = { kind: "face", index: -1 };
  const NOV: Ref = { kind: "vertex", index: -1 };
  const NOE: Ref = { kind: "edge", index: -1 };
  const change = (kind: PlaneDef["kind"] | "none") => {
    switch (kind) {
      case "none":
        return onChange(undefined);
      case "base":
        return onChange({ kind, name: "XY", offset: 0 });
      case "face":
        return onChange({ kind, ref: NOF, offset: 0 });
      case "threePoints":
        return onChange({ kind, a: NOV, b: NOV, c: NOV });
      case "pointLine":
        return onChange({ kind, p: NOV, line: NOE });
      case "pointNormal":
        return onChange({ kind, p: NOV, dir: { kind: "axis", axis: "Z" } });
      case "angle":
        return onChange({ kind, face: NOF, edge: NOE, deg: 30 });
      case "mid":
        return onChange({ kind, a: NOF, b: NOF });
      case "tangentCyl":
        return onChange({ kind, face: NOF, through: NOF });
      case "normalToCurve":
        return onChange({ kind, curve: NOE, at: NOV });
      case "twoEdges":
        return onChange({ kind, a: NOE, b: NOE });
      case "datum":
        return onChange({ kind, featureId: "", offset: 0 });
      case "custom":
        return onChange({ kind, origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] });
    }
  };
  const v = value;
  return (
    <div className="space-y-2 rounded-lg border border-ink-700/10 bg-steel-50/60 p-2">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-ink-700/55">{label}</span>
        <select className={selectCls} value={v?.kind ?? "none"} onChange={(e) => change(e.target.value as PlaneDef["kind"] | "none")}>
          {allowNone && <option value="none">{noneLabel}</option>}
          {PLANE_KINDS.map((k) => (
            <option key={k.v} value={k.v}>
              {k.l}
            </option>
          ))}
        </select>
      </label>
      {v?.kind === "base" && (
        <>
          <div className="flex gap-1">
            {PLANES.map((n) => (
              <button key={n} type="button" onClick={() => onChange({ ...v, name: n })} className={cn("flex-1 rounded-md border px-2 py-1 text-[12px]", v.name === n ? "border-brand bg-brand/10 text-brand" : "border-ink-700/12 bg-white")}>
                {n}
              </button>
            ))}
          </div>
          <NumIn label="Odsazení" value={v.offset} onChange={(offset) => onChange({ ...v, offset })} />
        </>
      )}
      {v?.kind === "face" && (
        <>
          <RefField label="Plocha / pomocná rovina" value={v.ref} want="face" onChange={(ref) => onChange({ ...v, ref })} />
          <div className="grid grid-cols-2 gap-2">
            <NumIn label="Odsazení" value={v.offset ?? 0} onChange={(offset) => onChange({ ...v, offset })} />
            <label className="mt-5 flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={!!v.flip} onChange={(e) => onChange({ ...v, flip: e.target.checked })} className="accent-brand" /> Obrátit
            </label>
          </div>
        </>
      )}
      {v?.kind === "threePoints" && (
        <>
          <RefField label="1. bod" value={v.a} want="point" onChange={(a) => onChange({ ...v, a })} />
          <RefField label="2. bod (směr X)" value={v.b} want="point" onChange={(b) => onChange({ ...v, b })} />
          <RefField label="3. bod" value={v.c} want="point" onChange={(c) => onChange({ ...v, c })} />
        </>
      )}
      {v?.kind === "pointLine" && (
        <>
          <RefField label="Bod" value={v.p} want="point" onChange={(p) => onChange({ ...v, p })} />
          <RefField label="Přímka (hrana)" value={v.line} want="edge" onChange={(line) => onChange({ ...v, line })} />
        </>
      )}
      {v?.kind === "pointNormal" && (
        <>
          <RefField label="Bod" value={v.p} want="point" onChange={(p) => onChange({ ...v, p })} />
          <DirectionField label="Normála" value={v.dir} allowNormal={false} onChange={(dir) => onChange({ ...v, dir: dir ?? { kind: "axis", axis: "Z" } })} />
        </>
      )}
      {v?.kind === "angle" && (
        <>
          <RefField label="Plocha (výchozí)" value={v.face} want="face" onChange={(face) => onChange({ ...v, face })} />
          <RefField label="Hrana (osa otáčení)" value={v.edge} want="edge" onChange={(edge) => onChange({ ...v, edge })} />
          <NumIn label="Úhel" suffix="°" value={v.deg} onChange={(deg) => onChange({ ...v, deg })} />
        </>
      )}
      {v?.kind === "mid" && (
        <>
          <RefField label="1. plocha" value={v.a} want="face" onChange={(a) => onChange({ ...v, a })} />
          <RefField label="2. plocha" value={v.b} want="face" onChange={(b) => onChange({ ...v, b })} />
        </>
      )}
      {v?.kind === "tangentCyl" && (
        <>
          <RefField label="Válcová plocha" value={v.face} want="face" onChange={(face) => onChange({ ...v, face })} />
          <RefField label="Rovnoběžně s plochou" value={v.through} want="face" onChange={(through) => onChange({ ...v, through })} />
        </>
      )}
      {v?.kind === "normalToCurve" && (
        <>
          <RefField label="Křivka (hrana)" value={v.curve} want="edge" onChange={(curve) => onChange({ ...v, curve })} />
          <RefField label="Bod na křivce" value={v.at} want="point" onChange={(at) => onChange({ ...v, at })} />
        </>
      )}
      {v?.kind === "twoEdges" && (
        <>
          <RefField label="1. hrana" value={v.a} want="edge" onChange={(a) => onChange({ ...v, a })} />
          <RefField label="2. hrana" value={v.b} want="edge" onChange={(b) => onChange({ ...v, b })} />
        </>
      )}
      {v?.kind === "datum" && (
        <>
          <DatumPick value={v.featureId} onChange={(featureId) => onChange({ ...v, featureId })} />
          <NumIn label="Odsazení" value={v.offset ?? 0} onChange={(offset) => onChange({ ...v, offset })} />
        </>
      )}
      {v?.kind === "custom" && (
        <>
          {(["origin", "normal", "xDir"] as const).map((k) => (
            <div key={k} className="grid grid-cols-3 gap-1">
              {[0, 1, 2].map((i) => (
                <NumIn key={i} label={`${{ origin: "Počátek", normal: "Normála", xDir: "Osa X" }[k]} ${"XYZ"[i]}`} suffix="" value={v[k][i]} onChange={(n) => onChange({ ...v, [k]: v[k].map((c, j) => (j === i ? n : c)) as Vec3 })} />
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Seznam bodů (více poloh díry apod.). */
export function RefListField({ label, value, onChange, want = "point" }: { label: string; value: Ref[]; onChange: (v: Ref[]) => void; want?: Want }) {
  const ctx = useContext(RefPickContext);
  const [id] = useState(nid);
  const active = ctx?.target?.id === id;
  const addPick = () => {
    if (!ctx) return;
    if (active) return ctx.request(null);
    const loop = () =>
      ctx.request({
        id,
        want,
        label: `${label}: klikejte na body (Esc = konec)`,
        onPick: (r) => {
          value = [...value, r];
          onChange(value);
          loop();
        },
      });
    loop();
  };
  return (
    <div className="space-y-1">
      <span className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-ink-700/55">
        {label}
        <span className="normal-case tracking-normal text-ink-700/40">{value.length} ks</span>
      </span>
      {value.map((r, i) => (
        <div key={i} className="flex items-center gap-1">
          <div className="flex-1">
            <RefField compact label={`Bod ${i + 1}`} value={r} want={want} onChange={(nr) => onChange(value.map((x, k) => (k === i ? nr : x)))} />
          </div>
          <button type="button" onClick={() => onChange(value.filter((_, k) => k !== i))} className="rounded px-1.5 text-[13px] text-ink-700/50 hover:bg-steel-100" title="Odebrat">
            ×
          </button>
        </div>
      ))}
      <div className="flex gap-1">
        <button type="button" onClick={addPick} className={cn("flex-1 rounded-md border border-dashed px-2 py-1.5 text-[12px]", active ? "border-brand bg-brand/5 text-brand" : "border-ink-700/25 text-ink-700/70 hover:bg-steel-100")}>
          {active ? "Klikejte na body v modelu… (Esc = konec)" : "+ Přidat body klikem"}
        </button>
        <button type="button" onClick={() => onChange([...value, { kind: "xyz", p: [0, 0, 0] }])} className="rounded-md border border-ink-700/12 bg-white px-2 py-1.5 text-[12px]" title="Přidat bod zadaný souřadnicemi">
          + XYZ
        </button>
        {!!ctx?.selectionRefs.length && (
          <button type="button" onClick={() => onChange([...value, ...ctx.selectionRefs])} className="rounded-md border border-ink-700/12 bg-white px-2 py-1.5 text-[12px]" title="Přidat vybrané entity">
            + výběr
          </button>
        )}
      </div>
    </div>
  );
}

/** Převod položky výběru 3D okna na odkaz. */
export function selToRef(it: { kind: string; index?: number; point?: Vec3 }, want: Want): Ref | null {
  if (it.kind === "vertex" && it.index != null) return { kind: "vertex", index: it.index };
  if (it.kind === "edge" && it.index != null) return { kind: "edge", index: it.index, at: want === "point" ? "mid" : undefined };
  if (it.kind === "face" && it.index != null) return { kind: "face", index: it.index };
  if (want === "point" && it.point) return { kind: "xyz", p: it.point };
  return null;
}

/** Hook: aktuální cíl výběru + Esc ruší. */
export function useRefPickEscape(target: RefPickTarget | null, cancel: () => void) {
  const ref = useRef(cancel);
  ref.current = cancel;
  useEffect(() => {
    if (!target) return;
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        ref.current();
      }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [target]);
}
