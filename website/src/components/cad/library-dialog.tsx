"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cad } from "@/cad/client";
import { GROUPS, LIBRARY, byGroup, defaults, familyById, loadFavorites, loadLibRecent, pushLibRecent, search, toggleFavorite, type Family, type ParamSchema, type SearchResult, type Values } from "@/cad/library";
import type { BuildResult, CadDoc } from "@/cad/types";
import { MATERIALS, fmtNum, massKg } from "@/lib/mesh-metrics";
import { cn } from "@/lib/cn";
import { CadIcon, type CadIconName } from "./cad-icons";
import { MiniViewport } from "./mini-viewport";
import { Num } from "./props";
import { Btn, Kbd, Modal, Row, Toggle, inputCls } from "./ui";

type Props = {
  onInsertPart: (doc: CadDoc) => void;
  onInsertComponent: (doc: CadDoc, group: string) => void;
  onClose: () => void;
  isAssembly: boolean;
  /** předvyplněný dotaz (např. z palety příkazů) */
  initialQuery?: string;
};

const GROUP_ICON: Record<string, CadIconName> = {
  "Spojovací materiál": "thread",
  "Kolíky a pera": "cylinder",
  "Pojistné kroužky": "tube",
  Ložiska: "tube",
  "Ozubení a řetězy": "settings",
  Řemenice: "settings",
  "Ocelové profily a trubky": "box",
  "Pružiny a těsnění": "sweep",
  "Normálie forem": "layers",
};

/** Knihovna normálií – vyhledávání textem („M8x30“), kategorie, parametry, náhled a vložení. */
export function LibraryDialog({ onInsertPart, onInsertComponent, onClose, isAssembly, initialQuery = "" }: Props) {
  const [q, setQ] = useState(initialQuery);
  const [group, setGroup] = useState<string | "fav" | "recent" | null>(null);
  const [famId, setFamId] = useState<string>(LIBRARY[0].id);
  const [values, setValues] = useState<Values>(() => defaults(LIBRARY[0]));
  const [fav, setFav] = useState<string[]>(() => loadFavorites());
  const [result, setResult] = useState<BuildResult | null>(null);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const family = familyById(famId) ?? LIBRARY[0];

  useEffect(() => input.current?.focus(), []);

  // výsledky hledání (živě)
  const results = useMemo<SearchResult[]>(() => (q.trim() ? search(q, 10) : []), [q]);
  // při změně dotazu převzít nejlepší shodu
  useEffect(() => {
    if (!results.length) return;
    const best = results[0];
    if (best.score < 0.3) return;
    setFamId(best.family.id);
    setValues(best.values);
    setGroup(null);
  }, [results]);

  const pick = (f: Family, v?: Values) => {
    setFamId(f.id);
    setValues(v ?? defaults(f));
  };

  // dokument + náhled (debounce 400 ms)
  const made = useMemo<{ doc: CadDoc | null; err: string | null }>(() => {
    try {
      return { doc: family.make(values), err: null };
    } catch (e) {
      return { doc: null, err: (e as Error).message };
    }
  }, [family, values]);
  const doc = made.doc;
  const designation = useMemo(() => {
    try {
      return family.describe(values);
    } catch {
      return family.name;
    }
  }, [family, values]);
  useEffect(() => {
    if (!doc) {
      setError(made.err);
      return;
    }
    let alive = true;
    setError(null);
    const t = setTimeout(async () => {
      setBuilding(true);
      try {
        const res = await cad.build(doc);
        if (!alive) return;
        setResult(res);
        const bad = res.status.find((s) => !s.ok);
        setError(bad ? bad.error ?? "Chyba stavby" : null);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setBuilding(false);
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [doc, made.err]);

  const mat = MATERIALS.find((m) => m.id === doc?.material);
  const mass = result?.metrics && mat ? massKg(result.metrics.volume, mat.density) : null;

  const insert = (asComponent: boolean) => {
    if (!doc) return;
    pushLibRecent({ familyId: family.id, values, designation });
    if (asComponent) onInsertComponent(doc, family.group);
    else onInsertPart(doc);
    onClose();
  };

  // seznam rodin pro střední sloupec
  const listed: { f: Family; v?: Values; sub?: string }[] = useMemo(() => {
    if (q.trim()) return results.map((r) => ({ f: r.family, v: r.values, sub: r.designation }));
    if (group === "fav") return LIBRARY.filter((f) => fav.includes(f.id)).map((f) => ({ f }));
    if (group === "recent") return loadLibRecent().map((r) => ({ f: familyById(r.familyId)!, v: r.values, sub: r.designation })).filter((x) => x.f);
    if (group) return LIBRARY.filter((f) => f.group === group).map((f) => ({ f }));
    return LIBRARY.map((f) => ({ f }));
  }, [q, results, group, fav]);

  const sizes = family.sizes;
  const sizeKey = sizes?.key;

  return (
    <Modal
      title="Knihovna normálií"
      icon="table"
      tone="create"
      onClose={onClose}
      width="max-w-6xl"
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-[#6b7785]">
            {LIBRARY.length} rodin · {GROUPS.length} skupin · <Kbd k="Enter" /> vloží · <Kbd k="Esc" /> zavře
          </span>
          <Btn onClick={onClose}>Zavřít</Btn>
          {isAssembly && (
            <Btn onClick={() => insert(true)} disabled={!doc || !!error} primary>
              Vložit do sestavy
            </Btn>
          )}
          <Btn onClick={() => insert(false)} disabled={!doc || !!error} primary={!isAssembly}>
            {isAssembly ? "Otevřít jako nový díl" : "Vložit jako nový díl"}
          </Btn>
        </>
      }
    >
      <div className="-m-4 flex h-[640px] max-h-[78vh] flex-col">
        {/* hledání */}
        <div className="border-b border-[#e3e8ee] bg-[#f7f9fb] px-4 py-3">
          <div className="flex items-center gap-2 rounded-md border border-[#cfd6de] bg-white px-3 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/15">
            <CadIcon name="measure" className="h-4 w-4 text-[#8a95a3]" />
            <input
              ref={input}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && doc && !error) insert(isAssembly);
              }}
              placeholder="Napište, co potřebujete: M8x30 · matice M10 · ložisko 6205 2RS · kolo m2 z24 · řetězka 08B z19 · IPE 200 L=1500 · jäkl 40x40x3 · pero 8x7x40 · pružina d1.6 D12 L40 n10"
              className="h-10 w-full bg-transparent text-[13.5px] outline-none placeholder:text-[#a0a9b4]"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="text-[#8a95a3] hover:text-[#1f2933]" aria-label="Smazat">
                <CadIcon name="x" className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1.5 flex items-center gap-2 text-[12px] text-[#5b6776]">
            {q.trim() ? (
              results.length ? (
                <>
                  <span className="rounded bg-[#e6f4ea] px-1.5 py-0.5 font-medium text-[#1e7d3a]">Rozpoznáno</span>
                  <span className="font-medium text-[#1f2933]">{designation}</span>
                  <span className="text-[#8a95a3]">· {family.standards[0]}</span>
                </>
              ) : (
                <span className="text-brand">Nic nenalezeno – zkuste normu (ISO 4762), název (matice, ložisko, jäkl) nebo rozměr (M8x30).</span>
              )
            ) : (
              <span>Příklady: „m8x30“ (imbus) · „šestihranný m8x30“ · „podložka 8“ · „kolík 6x30“ · „HEB 100 L=3000“ · „trubka 33.7x2.6“ · „vyhazovač 6x160“</span>
            )}
          </p>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* kategorie */}
          <nav className="w-52 shrink-0 overflow-y-auto border-r border-[#e3e8ee] bg-[#f7f9fb] py-2 text-[12.5px]">
            {[
              { id: null, l: "Vše", n: LIBRARY.length, icon: "layers" as CadIconName },
              { id: "fav", l: "Oblíbené", n: fav.length, icon: "check" as CadIconName },
              { id: "recent", l: "Nedávno použité", n: loadLibRecent().length, icon: "undo" as CadIconName },
            ].map((g) => (
              <button key={String(g.id)} type="button" onClick={() => { setGroup(g.id); setQ(""); }} className={cn("flex w-full items-center gap-2 px-4 py-1.5 text-left", group === g.id && !q ? "bg-white font-semibold text-brand shadow-[inset_3px_0_0_#E03930]" : "text-[#3c4856] hover:bg-white/70")}>
                <CadIcon name={g.icon} className="h-4 w-4" />
                <span className="flex-1">{g.l}</span>
                <span className="font-mono text-[10.5px] text-[#8a95a3]">{g.n}</span>
              </button>
            ))}
            <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[#8a95a3]">Kategorie</p>
            {byGroup().map((g) => (
              <button key={g.group} type="button" onClick={() => { setGroup(g.group); setQ(""); }} className={cn("flex w-full items-center gap-2 px-4 py-1.5 text-left", group === g.group && !q ? "bg-white font-semibold text-brand shadow-[inset_3px_0_0_#E03930]" : "text-[#3c4856] hover:bg-white/70")}>
                <CadIcon name={GROUP_ICON[g.group] ?? "cube"} tone="create" className="h-4 w-4" />
                <span className="flex-1">{g.group}</span>
                <span className="font-mono text-[10.5px] text-[#8a95a3]">{g.families.length}</span>
              </button>
            ))}
          </nav>

          {/* seznam rodin */}
          <div className="w-[300px] shrink-0 overflow-y-auto border-r border-[#e3e8ee]">
            {listed.length === 0 && <p className="p-4 text-[12.5px] text-[#6b7785]">{group === "fav" ? "Zatím žádné oblíbené – klikněte na hvězdičku u rodiny." : "Nic k zobrazení."}</p>}
            {listed.map(({ f, v, sub }, i) => (
              <div key={f.id + i} className={cn("group flex items-start gap-2.5 border-b border-[#f0f3f6] px-3 py-2", f.id === famId && (!v || JSON.stringify(v) === JSON.stringify(values)) ? "bg-[#eaf0f6]" : "hover:bg-[#f7f9fb]")}>
                <button type="button" onClick={() => pick(f, v)} onDoubleClick={() => insert(isAssembly)} className="flex min-w-0 flex-1 items-start gap-2.5 text-left">
                  <CadIcon name={(f.icon as CadIconName) ?? "cube"} tone="create" className="mt-0.5 h-5 w-5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-medium text-[#1f2933]">{f.name}</span>
                    <span className="block truncate text-[11px] text-[#6b7785]">{sub ?? f.standards.join(" · ")}</span>
                  </span>
                </button>
                <button type="button" title={fav.includes(f.id) ? "Odebrat z oblíbených" : "Přidat do oblíbených"} onClick={() => setFav(toggleFavorite(f.id))} className={cn("text-[14px] leading-none", fav.includes(f.id) ? "text-amber-500" : "text-[#c9d1da] opacity-0 group-hover:opacity-100 hover:text-amber-500")}>
                  ★
                </button>
              </div>
            ))}
          </div>

          {/* parametry */}
          <div className="w-[300px] shrink-0 overflow-y-auto border-r border-[#e3e8ee] p-4">
            <div className="mb-3 flex items-start gap-2">
              <CadIcon name={(family.icon as CadIconName) ?? "cube"} tone="create" className="mt-0.5 h-6 w-6 shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-tight">{family.name}</p>
                <p className="text-[11px] text-[#6b7785]">{family.standards.join(" · ")}</p>
              </div>
            </div>
            <div className="space-y-2.5">
              {family.params.map((p) => (
                <ParamField key={p.key} p={p} value={values[p.key]} onChange={(v) => setValues({ ...values, [p.key]: v })} />
              ))}
            </div>
            <button type="button" onClick={() => setValues(defaults(family))} className="mt-3 text-[11.5px] text-[#6b7785] underline-offset-2 hover:text-brand hover:underline">
              Výchozí hodnoty
            </button>
            {sizes && sizeKey && (
              <div className="mt-4">
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[#8a95a3]">Tabulka rozměrů</p>
                <div className="max-h-56 overflow-auto rounded border border-[#e3e8ee]">
                  <table className="w-full border-collapse text-[11px]">
                    <thead className="sticky top-0 bg-[#f3f6f9]">
                      <tr>
                        <th className="px-1.5 py-1 text-left font-semibold">{family.params.find((p) => p.key === sizeKey)?.label ?? sizeKey}</th>
                        {sizes.columns.map((c) => (
                          <th key={c.key} className="px-1.5 py-1 text-right font-semibold">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sizes.rows.map((row, i) => {
                        const key = String(row[sizeKey]);
                        const active = String(values[sizeKey]) === key;
                        return (
                          <tr key={i} onClick={() => setValues({ ...values, [sizeKey]: family.params.find((p) => p.key === sizeKey)?.kind === "number" ? Number(key) : key })} className={cn("cursor-pointer border-t border-[#f0f3f6]", active ? "bg-[#fde3e1] font-semibold" : "hover:bg-[#f7f9fb]")}>
                            <td className="px-1.5 py-0.5 font-mono">{key}</td>
                            {sizes.columns.map((c) => (
                              <td key={c.key} className="px-1.5 py-0.5 text-right font-mono">
                                {row[c.key] ?? ""}
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* náhled */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1" style={{ background: "linear-gradient(180deg,#9fb1c4 0%,#d3dce6 52%,#f3f5f8 100%)" }}>
              <MiniViewport mesh={result?.mesh ?? null} color={doc?.color ?? "#b9c2cc"} />
              {building && <span className="absolute right-3 top-3 rounded bg-white/85 px-2 py-0.5 font-mono text-[10.5px] text-[#5b6776]">stavím…</span>}
              {error && <p className="absolute inset-x-3 bottom-3 rounded border border-brand/30 bg-white/95 px-2.5 py-1.5 text-[11.5px] text-brand-600">{error}</p>}
            </div>
            <div className={cn("border-t border-[#e3e8ee] bg-white p-3 transition-opacity", building && "opacity-50")}>
              <p className="truncate text-[13px] font-semibold">{designation}</p>
              <Row k="Materiál" v={mat?.label ?? doc?.material ?? "—"} mono={false} />
              {result?.metrics && (
                <>
                  <Row k="Rozměry" v={`${fmtNum(result.metrics.bbox[1][0] - result.metrics.bbox[0][0], 1)} × ${fmtNum(result.metrics.bbox[1][1] - result.metrics.bbox[0][1], 1)} × ${fmtNum(result.metrics.bbox[1][2] - result.metrics.bbox[0][2], 1)} mm`} />
                  <Row k="Hmotnost" v={mass != null ? `${fmtNum(mass, mass < 0.1 ? 4 : 3)} kg` : "—"} strong />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function ParamField({ p, value, onChange }: { p: ParamSchema; value: Values[string]; onChange: (v: Values[string]) => void }) {
  if (p.kind === "enum")
    return (
      <label className="block">
        <span className="mb-1 flex items-baseline justify-between text-[11px] font-medium uppercase tracking-wider text-ink-700/55">
          {p.label}
          {p.hint && <span className="normal-case tracking-normal text-ink-700/40">{p.hint}</span>}
        </span>
        <select value={String(value ?? p.default)} onChange={(e) => onChange(e.target.value)} className={inputCls}>
          {p.options.map((o) => (
            <option key={o.v} value={o.v}>
              {o.l}
            </option>
          ))}
        </select>
      </label>
    );
  if (p.kind === "bool") return <Toggle label={p.label} hint={p.hint} checked={value === undefined ? p.default : value === true} onChange={onChange} />;
  return <Num label={p.label} value={Number(value ?? p.default)} step={p.step ?? 1} min={p.min} suffix={p.unit ?? "mm"} hint={p.hint} onChange={(v) => onChange(p.max != null ? Math.min(p.max, v) : v)} />;
}
