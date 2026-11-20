"use client";

/**
 * Tabulka kola – TATÁŽ v průvodci, ve formuláři úpravy prvku i v soukolí: řádky z popisu druhu (`KINDS[druh].rows`,
 * `PAIR_ROWS[druh]`) po skupinách (Základní · Ozubení · Tělo kola · Umístění a výstup · Další), povinné řádky tučně
 * nahoře, jednotka, nápověda s normou vždy viditelná pod polem, hláška kontroly přímo pod řádkem (✗ červeně, ⚠ oranžově)
 * a pod tím živě spočtené řádky (tabulka ozubení) šedě, jen ke čtení.
 *
 * Automatizace: tabulka `[data-gear-table]`, řádek `[data-gear-row="<klíč>"]` (uvnitř `input` / `select`), hláška
 * `[data-gear-issue="<klíč>"]`, spočtený řádek `[data-gear-calc="<klíč>"]`, skupina `[data-gear-group="body"]`.
 */
import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getLang, tr } from "@/cad/i18n";
import { evalExpr, exprRefs, isExpression } from "@/cad/params";
import type { GearData, GearDataRow, GearRow, Issue } from "@/cad/gears";
import { cn } from "@/lib/cn";
import { ParamContext } from "../props";
import { tableRows, type GroupId } from "./wizard-state";

export const cellIn = "w-full min-w-0 rounded border border-[#cfd6de] bg-white px-2 py-1 text-[13px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";

/** číslo k zobrazení (desetinná čárka podle jazyka, bez zbytečných nul) */
export const showNum = (v: unknown): string => {
  if (typeof v === "number" && Number.isFinite(v)) {
    const s = String(Math.round(v * 1e6) / 1e6);
    return getLang() === "en" ? s : s.replace(".", ",");
  }
  return typeof v === "string" ? v : "";
};
/** text → číslo (čárka i tečka, výraz 25/2); null = zatím neplatné */
export function parseNum(t: string): number | null {
  const s = t.trim().replace(/\s*(mm|°)$/i, "");
  if (!s) return null;
  if (/^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(s)) {
    const v = Number(s.replace(",", "."));
    return Number.isFinite(v) ? v : null;
  }
  try {
    const v = evalExpr(s.replace(/(\d),(\d)/g, "$1.$2"));
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Číselná buňka: píše se volně (čárka i tečka, výraz); platné číslo jde do dat hned (průvodce) nebo po 450 ms bez psaní
 * (formulář úprav – model se nestaví po každé klávese), vždy po opuštění pole / Enter. S `bind` (formulář úprav) jde
 * hodnotu navázat na proměnné dílu zápisem „=d*2“ – pak se ukáže ƒx a hodnota výrazu.
 */
export function NumCell({ value, onChange, label, placeholder, debounce = 0, bind, preset, autoFocus }: { value: unknown; onChange: (v: number) => void; label: string; placeholder?: string; debounce?: number; bind?: string; preset?: number[]; autoFocus?: boolean }) {
  const ctx = useContext(ParamContext);
  const bound = bind && ctx ? ctx.bindings[bind] : undefined;
  const [text, setText] = useState(bound != null ? `=${bound}` : showNum(value));
  const [focus, setFocus] = useState(false);
  const [err, setErr] = useState(false);
  const timer = useRef<number | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!focus) setText(bound != null ? `=${bound}` : showNum(value));
  }, [value, focus, bound]);
  useEffect(() => () => void (timer.current != null && window.clearTimeout(timer.current)), []);
  const send = (v: number) => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    if (debounce > 0) timer.current = window.setTimeout(() => latest.current(v), debounce);
    else latest.current(v);
  };
  const commit = (t: string) => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
    // vazba na proměnné dílu (jen formulář úprav)
    if (bind && ctx && isExpression(t) && exprRefs(t.replace(/^=\s*/, "")).length) {
      const e = t.trim().replace(/^=\s*/, "");
      try {
        evalExpr(e, ctx.values);
        ctx.setBinding(bind, e);
        setErr(false);
      } catch {
        setErr(true);
      }
      return;
    }
    const v = parseNum(t.replace(/^=\s*/, ""));
    if (v === null) {
      setErr(!!t.trim());
      if (!t.trim()) setText(showNum(value));
      return;
    }
    setErr(false);
    if (bound != null && bind && ctx) ctx.setBinding(bind, null);
    latest.current(v);
  };
  const listId = preset?.length ? `gear-preset-${label.replace(/[^a-z0-9]/gi, "")}` : undefined;
  return (
    <span className="flex min-w-0 items-center gap-1">
      {bound != null && (
        // span (ne button): řádek tabulky je <label> a klik na popisek nesmí vazbu zrušit
        <span role="button" tabIndex={0} title={tr("Parametr je navázaný na proměnné – kliknutím vazbu zrušíte")} onClick={(e) => (e.preventDefault(), bind && ctx?.setBinding(bind, null))} onKeyDown={(e) => e.key === "Enter" && bind && ctx?.setBinding(bind, null)} className="cursor-pointer rounded bg-sky-600 px-1 font-mono text-[10px] font-bold italic text-white hover:bg-brand">
          ƒx
        </span>
      )}
      <input
        className={cn(cellIn, "font-mono", err && "border-brand", bound != null && "border-sky-500/60 bg-sky-50")}
        inputMode={bind && ctx ? "text" : "decimal"}
        aria-label={label}
        value={text}
        placeholder={placeholder}
        list={listId}
        autoFocus={autoFocus}
        spellCheck={false}
        onFocus={() => setFocus(true)}
        onBlur={(e) => {
          setFocus(false);
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
        }}
        onChange={(e) => {
          const t = e.target.value;
          setText(t);
          if (t.trim().startsWith("=")) return;
          const s = t.trim();
          if (!/^[-+]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(s)) return; // výraz nebo rozepsané číslo – až po Enter / opuštění
          const v = Number(s.replace(",", "."));
          if (Number.isFinite(v)) send(v);
        }}
      />
      {listId && (
        <datalist id={listId}>
          {preset!.map((p) => (
            <option key={p} value={showNum(p)} />
          ))}
        </datalist>
      )}
    </span>
  );
}

const AXIS_OPTS = ["Z", "X", "Y", "-Z", "-X", "-Y"];
/** osa jako výběr X / Y / Z (i záporné) – průvodce; odkazy na geometrii nabízí formulář úprav */
export function axisKey(v: unknown): string {
  if (typeof v === "string" && AXIS_OPTS.includes(v.toUpperCase())) return v.toUpperCase();
  const o = v as { kind?: string; axis?: string; v?: number[] } | undefined;
  if (o?.kind === "axis" && o.axis) return o.axis;
  if (o?.kind === "vector" && Array.isArray(o.v)) {
    const [x, y, z] = o.v;
    const l = Math.hypot(x, y, z) || 1;
    for (const k of AXIS_OPTS) {
      const s = k.startsWith("-") ? -1 : 1;
      const ax = k.slice(-1);
      if (Math.abs(x / l - (ax === "X" ? s : 0)) + Math.abs(y / l - (ax === "Y" ? s : 0)) + Math.abs(z / l - (ax === "Z" ? s : 0)) < 1e-9) return k;
    }
  }
  return "";
}
export const axisValue = (k: string) => (k.startsWith("-") ? { kind: "vector", v: [k === "-X" ? -1 : 0, k === "-Y" ? -1 : 0, k === "-Z" ? -1 : 0] } : { kind: "axis", axis: k });

/** značka veličiny za popiskem – jen když ji popisek už neobsahuje („Modul mₙ“) */
const sym = (r: GearRow) => (r.symbol && !r.label.includes(r.symbol) ? <span className="ml-1 font-mono text-[11.5px] font-normal text-[#6b7785]">{r.symbol}</span> : null);
const unitOf = (r: GearRow) => (r.unit ? r.unit : "");

export type GearTableProps = {
  rows: GearRow[];
  data: GearData;
  onChange: (patch: GearData) => void;
  issues: Issue[];
  /** spočtené řádky (tabulka ozubení / výsledek soukolí) */
  computed?: GearDataRow[];
  computedTitle?: string;
  mode: "wizard" | "edit";
  /** formulář úprav: předpona vazby na proměnné („<id prvku>:data.“) a zpoždění zápisu čísel */
  bindPrefix?: string;
  /** formulář úprav: vlastní pole pro řádek (odkaz polohy, směr osy odkazem, operace) – null = běžné pole */
  special?: (row: GearRow) => ReactNode | null;
  /** fokus do prvního povinného řádku (průvodce: hned psát modul) */
  autoFocus?: boolean;
};

export function GearTable({ rows, data, onChange, issues, computed, computedTitle, mode, bindPrefix, special, autoFocus }: GearTableProps) {
  const groups = tableRows(rows, data, mode);
  const [open, setOpen] = useState<Partial<Record<GroupId, boolean>>>({});
  const visKeys = new Set(groups.flatMap((g) => g.rows.map((r) => r.key)));
  // skupina s chybou se otevře sama (hláška musí být vidět)
  const errGroups = new Set(groups.filter((g) => g.rows.some((r) => issues.some((i) => i.key === r.key && i.level !== "info"))).map((g) => g.id));
  const firstReq = groups[0]?.rows.find((r) => r.required)?.key;
  // spočtené řádky bez opakování vstupů (modul, počet zubů, úhel… jsou už v tabulce nahoře)
  const inputs = new Set(rows.map((r) => r.key));
  const calc = (computed ?? []).filter((c) => !(c.group === "basic" && inputs.has(c.key)));
  const set = (k: string, v: unknown) => onChange({ [k]: v });
  return (
    <div className="space-y-2" data-gear-table>
      {groups.map((g) => {
        const isOpen = open[g.id] ?? (g.open || errGroups.has(g.id));
        return (
          <div key={g.id} data-gear-group={g.id}>
            <button type="button" onClick={() => setOpen((o) => ({ ...o, [g.id]: !isOpen }))} aria-expanded={isOpen} className="mb-0.5 flex w-full items-center gap-1 text-left text-[10.5px] font-semibold uppercase tracking-wider text-[#6b7785] hover:text-[#26303b]">
              <span className="inline-block w-3 text-center">{isOpen ? "▾" : "▸"}</span>
              {g.label}
              {!isOpen && <span className="ml-1 font-normal normal-case tracking-normal text-[#8a95a3]">({g.rows.length})</span>}
            </button>
            {isOpen && (
              <div className="divide-y divide-[#edf1f5] rounded border border-[#e3e8ee]">
                {g.rows.map((r) => {
                  const iss = issues.filter((i) => i.key === r.key);
                  const v = data[r.key];
                  const sp = special?.(r) ?? null;
                  // řádek s jedním polem = <label> (klik na popisek = fokus do pole); odkaz / tři souřadnice = <div>
                  const Row = sp || r.kind === "vec3" ? "div" : "label";
                  return (
                    <Row key={r.key} data-gear-row={r.key} className={cn("grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] items-start gap-x-2 px-2 py-1", r.required && "bg-[#fbfcfd]")}>
                      <div className="min-w-0 pt-0.5">
                        <p className={cn("text-[12.5px] leading-tight", r.required ? "font-semibold text-[#0b1f33]" : "text-[#26303b]")}>
                          {r.label}
                          {sym(r)}
                          {unitOf(r) ? <span className="text-[#6b7785]"> [{unitOf(r)}]</span> : null}
                        </p>
                        <p className="text-[10.5px] leading-snug text-[#6b7785]">{r.hint}</p>
                      </div>
                      <div className="min-w-0">{sp ?? <Field row={r} value={v} onSet={(x) => set(r.key, x)} mode={mode} bind={bindPrefix ? `${bindPrefix}${r.key}` : undefined} autoFocus={autoFocus && r.key === firstReq} />}</div>
                      {iss.map((i, k) => (
                        <p key={k} data-gear-issue={r.key} role={i.level === "error" ? "alert" : undefined} className={cn("col-span-2 mt-0.5 text-[11.5px] leading-snug", i.level === "error" ? "text-brand-600" : i.level === "warn" ? "text-amber-700" : "text-[#4b5866]")}>
                          {i.level === "error" ? "✗ " : i.level === "warn" ? "⚠ " : "ℹ "}
                          {i.text}
                        </p>
                      ))}
                    </Row>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {issues.filter((i) => !i.key || !visKeys.has(i.key)).map((i, k) => (
        <p key={k} data-gear-issue={i.key || "general"} className={cn("text-[11.5px] leading-snug", i.level === "error" ? "text-brand-600" : i.level === "warn" ? "text-amber-700" : "text-[#4b5866]")}>
          {i.level === "error" ? "✗ " : i.level === "warn" ? "⚠ " : "ℹ "}
          {i.text}
        </p>
      ))}
      {calc.length > 0 && <Computed rows={calc} title={computedTitle ?? tr("Vypočteno")} />}
    </div>
  );
}

/** spočtené řádky (šedě, jen ke čtení) */
export function Computed({ rows, title }: { rows: GearDataRow[]; title: string }) {
  return (
    <div>
      <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-[#6b7785]">{title}</p>
      <div className="divide-y divide-[#edf1f5] rounded border border-[#e3e8ee] bg-[#f3f6f9]" data-gear-calcs>
        {rows.map((c) => (
          <div key={c.key} data-gear-calc={c.key} className="flex items-baseline justify-between gap-3 px-2 py-0.5 text-[12px]">
            <span className="min-w-0 truncate text-[#4b5866]">
              {c.label}
              {c.symbol ? <span className="ml-1 font-mono text-[11px] text-[#6b7785]">{c.symbol}</span> : null}
            </span>
            <span className="shrink-0 text-right font-mono text-[#0b1f33]">
              {c.value}
              {c.unit ? <span className="text-[#6b7785]"> {c.unit}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** pole jednoho řádku podle druhu */
function Field({ row: r, value: v, onSet, mode, bind, autoFocus }: { row: GearRow; value: unknown; onSet: (v: unknown) => void; mode: "wizard" | "edit"; bind?: string; autoFocus?: boolean }) {
  switch (r.kind) {
    case "enum":
      return (
        <select className={cellIn} aria-label={r.label} value={String(v ?? r.def ?? "")} onChange={(e) => onSet(e.target.value)}>
          {(r.options ?? []).map((o) => (
            <option key={o.v} value={o.v}>
              {o.l}
            </option>
          ))}
        </select>
      );
    case "bool":
      return (
        <span className="flex items-center gap-1.5 pt-1 text-[12px] text-[#4b5866]">
          <input type="checkbox" aria-label={r.label} checked={v === true || v === "true"} onChange={(e) => onSet(e.target.checked)} className="accent-[#E03930]" />
          {v === true || v === "true" ? tr("ano") : tr("ne")}
        </span>
      );
    case "text":
    case "point":
      return <input className={cellIn} aria-label={r.label} value={typeof v === "string" ? v : ""} onChange={(e) => onSet(e.target.value)} />;
    case "direction":
      return (
        <select className={cellIn} aria-label={r.label} value={axisKey(v) || "Z"} onChange={(e) => onSet(axisValue(e.target.value))}>
          {AXIS_OPTS.map((a) => (
            <option key={a} value={a}>
              {a.replace("-", "−")}
            </option>
          ))}
        </select>
      );
    case "vec3": {
      const arr = Array.isArray(v) && v.length === 3 ? (v as number[]) : [0, 0, 0];
      return (
        <span className="grid grid-cols-3 gap-1">
          {(["x", "y", "z"] as const).map((ax, i) => (
            <NumCell key={ax} label={`${r.label} ${ax}`} value={arr[i]} debounce={mode === "edit" ? 450 : 0} onChange={(x) => onSet(arr.map((q, j) => (j === i ? x : q)))} />
          ))}
        </span>
      );
    }
    case "mode":
      return (
        <select className={cellIn} aria-label={r.label} value={String(v ?? "new")} onChange={(e) => onSet(e.target.value)}>
          <option value="new">{tr("Nové těleso")}</option>
          <option value="add">{tr("Přidat")}</option>
          <option value="cut">{tr("Odebrat")}</option>
        </select>
      );
    default:
      return <NumCell label={r.label} value={v} placeholder={showNum(r.def)} debounce={mode === "edit" ? 450 : 0} bind={bind} preset={r.preset} autoFocus={autoFocus} onChange={onSet} />;
  }
}
