"use client";
/**
 * Výběr hran / ploch prvku ze seznamu (zaoblení, sražení, skořepina, úkos, přímé úpravy, prvky rozšíření):
 * – všechny plochy nebo hrany tělesa PŘED prvkem s popisem (typ, směr, poloha, velikost) a zaškrtávátky,
 * – výběr pravidlem stejným jako v textových příkazech („horní kruhové“, „svislé“, „+Z“, „poloměr 5“),
 * – hledání a filtr typu. Změny se propisují hned, takže výběr je vidět v modelu.
 * Indexy se čtou jedním dotazem do jádra (`cad.topology`) nad dokumentem oříznutým před upravovaným prvkem.
 */
import { useEffect, useMemo, useState } from "react";
import { selectEdges, selectFaces, type EdgeLite, type FaceLite } from "@/cad/agent";
import { cad, type TopologyResult } from "@/cad/client";
import { cadLocale, tr } from "@/cad/i18n";
import type { CadDoc, Feature, Vec3 } from "@/cad/types";
import { cn } from "@/lib/cn";
import { Btn, Modal, inputCls } from "./ui";

type Kind = "faces" | "edges";
const SURF: Record<string, string> = { PLANE: "rovinná", CYLINDRE: "válcová", CONE: "kuželová", SPHERE: "kulová", TORUS: "toroidní" };
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const num = (v: number, d = 2) => v.toLocaleString(cadLocale(), { maximumFractionDigits: d });
const vec = (v?: Vec3) => (v ? `[${v.map((x) => num(x, 1)).join("; ")}]` : "");
/** směr jako ±X / ±Y / ±Z, je-li rovnoběžný s osou; jinak složky */
const dirText = (v?: Vec3) => {
  if (!v) return "";
  const l = Math.hypot(...v) || 1;
  const u = v.map((x) => x / l);
  const i = u.findIndex((x) => Math.abs(Math.abs(x) - 1) < 1e-6);
  return i >= 0 ? `${u[i] > 0 ? "+" : "−"}${"XYZ"[i]}` : `(${u.map((x) => num(x, 2)).join("; ")})`;
};

/** Popis plochy / hrany pro seznamy a formuláře: „rovinná · normála +Z · 1 200 mm²“, „kružnice R8 · 50,27 mm“. */
export function describeFace(f: FaceLite): string {
  const type = f.planar ? tr("rovinná") : tr(SURF[f.surface ?? ""] ?? "obecná");
  return [type, f.planar && f.normal ? tr("normála {0}", dirText(f.normal)) : "", f.area != null ? `${num(f.area, 1)} mm²` : ""].filter(Boolean).join(" · ");
}
export function describeEdge(e: EdgeLite): string {
  const c = fold(e.curve ?? "");
  const type = c.includes("usecka") || c === "line" ? tr("úsečka") : e.radius != null ? tr("kružnice R{0}", num(e.radius)) : (e.curve ?? tr("křivka"));
  return [type, e.dir && e.radius == null ? tr("směr {0}", dirText(e.dir)) : "", e.length != null ? `${num(e.length)} mm` : ""].filter(Boolean).join(" · ");
}

/** dokument před prvkem `f` (těleso, na které se indexy ploch a hran prvku vztahují) */
export function docBefore(doc: CadDoc, f: Feature): CadDoc {
  const i = doc.features.findIndex((x) => x.id === f.id);
  return { ...doc, features: i >= 0 ? doc.features.slice(0, i) : doc.features, activeBody: f.body ?? doc.activeBody };
}

/** načte plochy a hrany tělesa před prvkem (u více těles jen cílové těleso – je ve výsledku první) */
export function useTopology(doc: CadDoc | null): { topo: TopologyResult | null; loading: boolean; error: string | null } {
  const key = doc ? JSON.stringify([doc.features, doc.variables ?? null, doc.bindings ?? null, doc.configs ?? null, doc.activeConfig ?? null, doc.activeBody ?? null]) : "";
  const [state, setState] = useState<{ key: string; topo: TopologyResult | null; error: string | null }>({ key: "", topo: null, error: null });
  useEffect(() => {
    if (!doc) return;
    let dead = false;
    cad.topology(doc).then(
      (t) => {
        if (dead) return;
        const act = t?.bodies && t.bodies.length > 1 ? t.bodies[0] : null;
        setState({ key, topo: t && act ? { ...t, faces: t.faces.filter((x) => x.index < act.faceCount), edges: t.edges.filter((x) => x.index < act.edgeCount) } : t, error: t ? null : tr("Těleso není k dispozici.") });
      },
      (e: Error) => !dead && setState({ key, topo: null, error: e.message }),
    );
    return () => {
      dead = true;
    };
    // klíč nese obsah dokumentu – objekt `doc` se při každém vykreslení mění
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { topo: state.key === key ? state.topo : null, loading: !!doc && state.key !== key, error: state.key === key ? state.error : null };
}

export function EntityMultiPick({ doc, kind, value, onChange, onClose, title }: { doc: CadDoc; kind: Kind; value: number[]; onChange: (v: number[]) => void; onClose: () => void; title?: string }) {
  const { topo, loading, error } = useTopology(doc);
  const [rule, setRule] = useState("");
  const [ruleErr, setRuleErr] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [onlySel, setOnlySel] = useState(false);
  const rows = useMemo(() => {
    if (!topo) return [];
    return kind === "faces" ? topo.faces.map((f) => ({ index: f.index, text: describeFace(f), center: f.center })) : topo.edges.map((e) => ({ index: e.index, text: describeEdge(e), center: e.center }));
  }, [topo, kind]);
  const sel = useMemo(() => new Set(value), [value]);
  const label = kind === "faces" ? tr("Plocha") : tr("Hrana");
  const shown = useMemo(() => {
    const q = fold(query.trim()).replace(/,/g, ".");
    return rows.filter((r) => {
      if (onlySel && !sel.has(r.index)) return false;
      if (!q) return true;
      const t = fold(`${label} ${r.index + 1} ${r.text} ${vec(r.center)}`).replace(/,/g, ".");
      return q.split(/\s+/).every((w) => t.includes(w));
    });
  }, [rows, query, onlySel, sel, label]);
  const toggle = (i: number) => onChange(sel.has(i) ? value.filter((x) => x !== i) : [...value, i].sort((a, b) => a - b));
  const applyRule = (mode: "set" | "add") => {
    if (!topo) return;
    try {
      const words = rule.trim().split(/\s+/).filter(Boolean).map(fold);
      if (!words.length) return setRuleErr(tr("Napište pravidlo, např. „horní kruhové“, „svislé“ nebo „+Z“."));
      const idx = kind === "faces" ? selectFaces(words, topo.faces, topo.bbox) : selectEdges(words, topo.edges, topo.bbox);
      if (!idx.length) return setRuleErr(tr("Pravidlu „{0}“ neodpovídá nic.", rule.trim()));
      setRuleErr(null);
      onChange(mode === "set" ? idx : [...new Set([...value, ...idx])].sort((a, b) => a - b));
    } catch (e) {
      setRuleErr((e as Error).message);
    }
  };
  return (
    <Modal title={title ?? (kind === "faces" ? tr("Vybrat plochy ze seznamu") : tr("Vybrat hrany ze seznamu"))} icon="table" tone="tool" onClose={onClose} width="max-w-2xl" footer={<Btn primary onClick={onClose}>{tr("Hotovo")}</Btn>}>
      <div className="space-y-2 text-[12.5px]" data-entity-pick={kind}>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[200px] flex-1">
            <span className="mb-0.5 block text-[11px] font-medium text-[#6b7785]">{tr("Pravidlo (jako v textových příkazech)")}</span>
            <input
              className={inputCls}
              data-entity-rule
              value={rule}
              placeholder={kind === "faces" ? tr("např. horní · boční · válcové · +Z · největší") : tr("např. horní kruhové · svislé · rovné · poloměr 5")}
              onChange={(e) => {
                setRule(e.target.value);
                setRuleErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  e.stopPropagation();
                  applyRule("set");
                }
              }}
            />
          </label>
          <Btn onClick={() => applyRule("set")}>{tr("Vybrat pravidlem")}</Btn>
          <Btn onClick={() => applyRule("add")}>{tr("Přidat k výběru")}</Btn>
        </div>
        {ruleErr && (
          <p className="text-[12px] text-brand" role="alert">
            {ruleErr}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <input className={cn(inputCls, "min-w-[160px] flex-1")} data-entity-search value={query} placeholder={tr("Hledat (číslo, typ, souřadnice)…")} onChange={(e) => setQuery(e.target.value)} />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" className="accent-[#E03930]" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} />
            {tr("jen vybrané")}
          </label>
          <Btn onClick={() => onChange([...new Set([...value, ...shown.map((r) => r.index)])].sort((a, b) => a - b))}>{tr("Vybrat zobrazené")}</Btn>
          <Btn onClick={() => onChange([])}>{tr("Zrušit výběr")}</Btn>
        </div>
        <p className="text-[11.5px] text-[#6b7785]" data-entity-count>
          {loading ? tr("Načítám plochy a hrany z jádra…") : error ? error : tr("Vybráno {0} z {1} · zobrazeno {2}", value.length, rows.length, shown.length)}
        </p>
        <div className="max-h-[46vh] overflow-y-auto rounded border border-[#e3e8ee]">
          {shown.slice(0, 400).map((r) => (
            <label key={r.index} data-entity-row={r.index} className={cn("flex cursor-pointer items-center gap-2 border-b border-[#eef2f6] px-2 py-1 last:border-b-0 hover:bg-[#f3f6f9]", sel.has(r.index) && "bg-brand/5")}>
              <input type="checkbox" className="accent-[#E03930]" checked={sel.has(r.index)} onChange={() => toggle(r.index)} />
              <span className="w-[74px] shrink-0 font-medium">
                {label} {r.index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate">{r.text}</span>
              <span className="shrink-0 font-mono text-[11px] text-[#8a95a3]">{vec(r.center)}</span>
            </label>
          ))}
          {shown.length > 400 && <p className="px-2 py-1.5 text-[11.5px] text-[#6b7785]">{tr("Zobrazeno prvních 400 – upřesněte hledání nebo použijte pravidlo.")}</p>}
          {!loading && !error && !shown.length && <p className="px-2 py-3 text-[#6b7785]">{tr("Nic neodpovídá.")}</p>}
        </div>
      </div>
    </Modal>
  );
}
