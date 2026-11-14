/**
 * Provedení příkazu `měřit` a `window.mncad.measure` nad dokumentem: v dílu se dokument postaví a změří v jádře
 * (čísla F/E/V jako popisky pro výběr), v sestavě se entity adresují komponentou (`Hřídel:F3`), výběr pravidlem
 * (`měřit plocha horní`) se vyhodnotí nad topologií dílu stejně jako u skořepiny / zaoblení.
 */
import { cad } from "@/cad/client";
import { selectEdges, selectFaces } from "@/cad/agent";
import { measureApiResult, measureLines, measureTokens, parseMeasure, type MeasureApiResult, type MeasureCmd } from "@/cad/agent-measure";
import { tr } from "@/cad/i18n";
import type { ShapeSrc } from "@/cad/inspect";
import type { MeasureItem, MeasureQuery, MeasureReport } from "@/cad/measure";
import type { CadDoc, ComponentSource } from "@/cad/types";
import { MATERIALS } from "@/lib/mesh-metrics";
import { flattenLeaves } from "./asm-flatten";
import { leafByRef, leafRef } from "./leaf-ref";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const densityOf = (mat?: string) => MATERIALS.find((x) => x.id === mat)?.density ?? 7.85;
/** nejvýš tolik entit vypíše měření pravidlem */
const MAX_LIST = 200;

export async function runMeasure(d: CadDoc, cmd: MeasureCmd): Promise<MeasureReport> {
  const asm = d.kind === "assembly";
  const leaves = asm ? flattenLeaves(d) : [];
  const names = () => leaves.map((l) => l.comp.name).join(", ") || "—";
  const sources = new Map<string, ComponentSource>();
  let density = densityOf(d.material);
  const srcOf = (comp?: string): { src: ShapeSrc; prefix: string } => {
    if (!asm) {
      if (comp) throw new Error(tr("„{0}:“ – komponentu lze uvést jen v sestavě; v dílu stačí F3, E5, V2", comp));
      return { src: { kind: "part" }, prefix: "" };
    }
    if (!comp) throw new Error(tr("v sestavě uveďte komponentu: měřit Hřídel:F3 Deska:F1 – komponenty: {0}", names()));
    // název, cesta nebo pořadí #2 (stejně pojmenované komponenty) – shodně s výběrem (leaf-ref.ts)
    const leaf = leafByRef(d, leaves, comp);
    sources.set(leaf.key, leaf.comp.source);
    density = densityOf(leaf.comp.source.kind === "part" ? leaf.comp.source.doc.material : (leaf.comp.material ?? "ocel"));
    return { src: { kind: "comp", key: leaf.key, matrix: leaf.matrix }, prefix: `${leafRef(d, leaves, leaf)}:` };
  };
  let q: MeasureQuery;
  if (cmd.kind === "entities") {
    const items: MeasureItem[] = cmd.items.map((it) => {
      if (it.ref.kind === "point") return { src: { kind: "part" }, ref: it.ref, label: it.label };
      const { src, prefix } = srcOf(it.comp);
      return { src, ref: it.ref, label: it.comp ? prefix + it.label.slice(it.label.lastIndexOf(":") + 1) : it.label };
    });
    // bod v sestavě: měří se proti tělesu komponenty druhé entity
    const real = items.find((x) => x.ref.kind !== "point");
    for (const x of items) if (x.ref.kind === "point" && real) x.src = real.src;
    q = { kind: "entities", items };
  } else if (cmd.kind === "rule") {
    if (asm) throw new Error(tr("výběr pravidlem měří jen v dílu – v sestavě zadejte entity číslem: měřit Hřídel:F3 Deska:F1"));
    const t = await cad.topology(d);
    if (!t) throw new Error(tr("žádné těleso – nejdřív vytvořte tvar (kvádr, vysunutí…)"));
    const idx = cmd.what === "faces" ? selectFaces(cmd.rule, t.faces, t.bbox) : selectEdges(cmd.rule, t.edges, t.bbox);
    if (!idx.length) throw new Error(cmd.what === "faces" ? tr("žádná plocha neodpovídá pravidlu „{0}“ (ploch celkem {1})", cmd.rule.join(" "), t.faces.length) : tr("žádná hrana neodpovídá pravidlu „{0}“ (hran celkem {1})", cmd.rule.join(" "), t.edges.length));
    const kind = cmd.what === "faces" ? "face" : "edge";
    q = { kind: "list", what: cmd.what, rule: cmd.rule.join(" "), items: idx.slice(0, MAX_LIST).map((i) => ({ src: { kind: "part" }, ref: { kind, index: i }, label: `${kind === "face" ? "F" : "E"}${i + 1}` })) };
  } else {
    const { src, prefix } = srcOf(cmd.comp);
    q = { kind: cmd.kind, src, label: cmd.kind === "body" ? (prefix ? prefix.slice(0, -1) : tr("Těleso")) : prefix.slice(0, -1) };
  }
  return cad.measure(q, { doc: asm ? undefined : d, density, sources: [...sources].map(([key, source]) => ({ key, source })) });
}

/** řádky protokolu pro příkaz `měřit` */
export async function measureLog(d: CadDoc, cmd: MeasureCmd): Promise<string[]> {
  return measureLines(await runMeasure(d, cmd));
}

/** `window.mncad.measure(a, b?)`: a/b = „F3“, „E5“, „V2“, [x, y, z], „těleso“, „díry“, „válce“, „plocha horní“, „Hřídel:F3“ */
export async function measureApi(d: CadDoc, a: string | number[], b?: string | number[]): Promise<MeasureApiResult> {
  const toks = (v: string | number[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v.map(String) : measureTokens(String(v)));
  try {
    return measureApiResult(await runMeasure(d, parseMeasure([...toks(a), ...toks(b)])));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error, lines: [`✗ ${error}`] };
  }
}
