"use client";

/**
 * Výběr ze seznamu (5. vlna): modální seznam ploch / hran / vrcholů aktuálního tělesa s filtrem podle typu
 * (rovinná / válcová…, úsečka / kružnice) a hledáním. Údaje (typ, střed, plocha / délka / poloměr) se načítají
 * přes `cad.refInfo` po dávkách (UI nezamrzne), nejvýš 300 položek na druh, stránkování po 40.
 * Počty entit dává `counts` (z `BuildResult.metrics` / vrcholů); bez nich se indexy zkoušejí, dokud jádro nehlásí konec.
 */
import { useEffect, useMemo, useState } from "react";
import { cad } from "@/cad/client";
import { fmtVec, type Ref, type Sig } from "@/cad/refs";
import type { CadDoc, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import type { Want } from "./ref-field";
import { Btn, Field, Modal, inputCls } from "./ui";

export type PickCounts = { faces: number; edges: number; vertices: number };
type Kind = "face" | "edge" | "vertex";
type Row = { kind: Kind; index: number; type: string; center: Vec3; size: number; radius?: number; sig: Sig | null };

const LIMIT = 300;
const BATCH = 25;
const PAGE = 40;

const KIND_LABEL: Record<Kind, { one: string; many: string }> = { face: { one: "Plocha", many: "Plochy" }, edge: { one: "Hrana", many: "Hrany" }, vertex: { one: "Vrchol", many: "Vrcholy" } };
const SURF: Record<string, string> = { PLANE: "rovinná", CYLINDRE: "válcová", CONE: "kuželová", SPHERE: "kulová", TORUS: "toroidní", BEZIER_SURFACE: "Bézierova", BSPLINE_SURFACE: "B-spline", REVOLUTION_SURFACE: "rotační", EXTRUSION_SURFACE: "vysunutá", OFFSET_SURFACE: "odsazená" };
const CURV: Record<string, string> = { LINE: "úsečka", CIRCLE: "kružnice / oblouk", ELLIPSE: "elipsa", HYPERBOLA: "hyperbola", PARABOLA: "parabola", BEZIER_CURVE: "Bézierova", BSPLINE_CURVE: "B-spline", OFFSET_CURVE: "odsazená" };
const FACE_FILTERS: { v: string; l: string }[] = [
  { v: "", l: "Všechny plochy" },
  { v: "PLANE", l: "Rovinné" },
  { v: "CYLINDRE", l: "Válcové" },
  { v: "CONE", l: "Kuželové" },
  { v: "SPHERE", l: "Kulové" },
  { v: "TORUS", l: "Toroidní" },
  { v: "other", l: "Ostatní (volné)" },
];
const EDGE_FILTERS: { v: string; l: string }[] = [
  { v: "", l: "Všechny hrany" },
  { v: "LINE", l: "Úsečky" },
  { v: "CIRCLE", l: "Kružnice / oblouky" },
  { v: "other", l: "Ostatní (křivky)" },
];

const fmt = (v: number, d = 2) => String(Math.round(v * 10 ** d) / 10 ** d).replace(".", ",");
const typeLabel = (r: Row) => (r.kind === "face" ? (SURF[r.type] ?? "obecná") : r.kind === "edge" ? (CURV[r.type] ?? "křivka") : "bod");
const sizeLabel = (r: Row) => (r.kind === "face" ? `${fmt(r.size, 1)} mm²` : r.kind === "edge" ? `${fmt(r.size)} mm` : "");
const refOf = (kind: Kind, index: number): Ref => (kind === "face" ? { kind, index } : kind === "edge" ? { kind, index, at: "mid" } : { kind, index });

/** Druhy entit nabízené pro daný požadavek pole. */
export function kindsFor(want: Want): Kind[] {
  if (want === "vertex") return ["vertex"];
  if (want === "edge") return ["edge"];
  if (want === "axis") return ["edge", "face"];
  if (want === "face" || want === "plane") return ["face"];
  return ["vertex", "edge", "face"];
}

export function PickList({ doc, counts, want, onPick, onClose, title = "Vybrat ze seznamu" }: { doc: CadDoc; counts?: PickCounts; want: Want; onPick: (ref: Ref) => void; onClose: () => void; title?: string }) {
  const kinds = useMemo(() => kindsFor(want), [want]);
  const [kind, setKind] = useState<Kind>(kinds[0]);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [filter, setFilter] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  // načtení položek po dávkách (max. LIMIT); bez `counts` se zkouší, dokud jádro nehlásí „už v modelu není“
  useEffect(() => {
    let dead = false;
    const max = counts ? Math.min(LIMIT, kind === "face" ? counts.faces : kind === "edge" ? counts.edges : counts.vertices) : LIMIT;
    setRows([]);
    setPage(0);
    setTruncated(!!counts && (kind === "face" ? counts.faces : kind === "edge" ? counts.edges : counts.vertices) > LIMIT);
    setLoading(true);
    (async () => {
      const acc: Row[] = [];
      for (let start = 0; start < max && !dead; start += BATCH) {
        const idx = Array.from({ length: Math.min(BATCH, max - start) }, (_, k) => start + k);
        const res = await Promise.all(idx.map((i) => cad.refInfo(doc, refOf(kind, i)).catch(() => ({ geo: null, sig: null, error: "x" }))));
        if (dead) return;
        let end = false;
        res.forEach((r, k) => {
          if (end) return;
          if (!r.sig) {
            // bez otisku = entita s tímto indexem neexistuje (konec seznamu) nebo není těleso
            if (!counts) end = true;
            return;
          }
          acc.push({ kind, index: idx[k], type: r.sig.t, center: r.sig.c, size: r.sig.s, radius: r.geo?.radius, sig: r.sig });
        });
        setRows([...acc]);
        if (end) break;
        await new Promise((ok) => setTimeout(ok, 0));
      }
      if (!dead) {
        if (!counts && acc.length >= LIMIT) setTruncated(true);
        setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, [doc, counts, kind]);

  const filters = kind === "face" ? FACE_FILTERS : kind === "edge" ? EDGE_FILTERS : [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(",", ".");
    return rows.filter((r) => {
      if (filter === "other") {
        if (kind === "face" && ["PLANE", "CYLINDRE", "CONE", "SPHERE", "TORUS"].includes(r.type)) return false;
        if (kind === "edge" && ["LINE", "CIRCLE"].includes(r.type)) return false;
      } else if (filter && r.type !== filter) return false;
      if (!q) return true;
      const text = `${KIND_LABEL[r.kind].one} ${r.index + 1} ${typeLabel(r)} ${fmtVec(r.center)} ${r.radius != null ? `r ${fmt(r.radius)} ø ${fmt(r.radius * 2)}` : ""}`.toLowerCase().replace(/,/g, ".");
      return q.split(/\s+/).every((w) => text.includes(w));
    });
  }, [rows, filter, query, kind]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const cur = Math.min(page, pages - 1);
  const slice = shown.slice(cur * PAGE, cur * PAGE + PAGE);

  const pick = (r: Row, at?: "center") => {
    const sig = r.sig ?? undefined;
    if (r.kind === "face") return onPick({ kind: "face", index: r.index, sig });
    if (r.kind === "edge") return onPick({ kind: "edge", index: r.index, at: at ?? (want === "point" || want === "any" || want === "vertex" ? "mid" : undefined), sig });
    onPick({ kind: "vertex", index: r.index, sig });
  };

  return (
    <Modal title={title} icon="select" tone="tool" onClose={onClose} width="max-w-2xl" footer={<Btn onClick={onClose}>Zavřít</Btn>}>
      <div className="space-y-2">
        {kinds.length > 1 && (
          <div className="flex rounded-md bg-[#eef2f6] p-0.5">
            {kinds.map((k) => (
              <button key={k} type="button" onClick={() => { setKind(k); setFilter(""); }} className={cn("flex-1 rounded px-2 py-1 text-[12.5px] font-medium transition", kind === k ? "bg-white text-[#1f2933] shadow-sm" : "text-[#5b6776] hover:text-[#1f2933]")}>
                {KIND_LABEL[k].many}
              </button>
            ))}
          </div>
        )}
        <div className={cn("grid gap-2", filters.length ? "grid-cols-2" : "grid-cols-1")}>
          {!!filters.length && (
            <Field label="Typ">
              <select className={inputCls} value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }}>
                {filters.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.l}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Hledat" hint="číslo, typ, souřadnice…">
            <input className={inputCls} value={query} placeholder="např. 12, válcová, 30; 20" onChange={(e) => { setQuery(e.target.value); setPage(0); }} />
          </Field>
        </div>
        <p className="text-[11px] text-[#6b7785]">
          {loading ? `Načítám… ${rows.length}` : `${shown.length} z ${rows.length} položek`}
          {truncated && ` · zobrazeno prvních ${LIMIT} – upřesněte hledáním`}
          {!loading && !rows.length && " · těleso nemá žádné entity tohoto druhu (nejdřív vytvořte tvar)"}
        </p>
        <ul className="max-h-[48vh] divide-y divide-[#edf1f5] overflow-y-auto rounded border border-[#e3e8ee]">
          {slice.map((r) => (
            <li key={`${r.kind}${r.index}`} className="flex items-center gap-2 px-2 py-1 text-[12.5px] hover:bg-[#f3f6f9]">
              <button type="button" onClick={() => pick(r)} className="flex flex-1 flex-wrap items-baseline gap-x-3 text-left">
                <span className="w-[86px] shrink-0 font-medium">
                  {KIND_LABEL[r.kind].one} {r.index + 1}
                </span>
                <span className="w-[112px] shrink-0 text-[#4a5664]">{typeLabel(r)}</span>
                <span className="w-[96px] shrink-0 font-mono text-[11.5px] text-[#4a5664]">{sizeLabel(r)}</span>
                {r.radius != null && <span className="font-mono text-[11.5px] text-[#4a5664]">R {fmt(r.radius)}</span>}
                <span className="font-mono text-[11px] text-[#8a95a3]">{r.kind === "vertex" ? fmtVec(r.center) : `střed ${fmtVec(r.center)}`}</span>
              </button>
              {r.kind === "edge" && r.radius != null && (want === "point" || want === "any" || want === "vertex") && (
                <button type="button" onClick={() => pick(r, "center")} className="shrink-0 rounded border border-[#cfd6de] px-1.5 py-0.5 text-[11px] hover:bg-white" title="Použít střed kružnice / oblouku">
                  střed kružnice
                </button>
              )}
            </li>
          ))}
        </ul>
        {pages > 1 && (
          <div className="flex items-center justify-between text-[12px]">
            <Btn onClick={() => setPage(Math.max(0, cur - 1))} disabled={cur === 0}>
              ‹ Předchozí
            </Btn>
            <span className="text-[#6b7785]">
              Strana {cur + 1} / {pages}
            </span>
            <Btn onClick={() => setPage(Math.min(pages - 1, cur + 1))} disabled={cur >= pages - 1}>
              Další ›
            </Btn>
          </div>
        )}
      </div>
    </Modal>
  );
}
