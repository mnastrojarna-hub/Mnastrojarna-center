/**
 * Tlačítko Pružina (pás karet Tvorba, paleta Ctrl+K, knihovna Pružiny): průvodce s tabulkou → prvek historie `spring.<druh>`.
 * Cíl: prázdný díl → do něj (díl se přejmenuje na pružinu); díl s prvky → nový díl v záložce, nebo do tohoto dílu;
 * sestava → nový díl vložený jako komponenta (skupina Pružiny).
 */
import { tr } from "@/cad/i18n";
import { springDataAt } from "@/cad/springs";
import { emptyDoc, uid, type CadDoc, type Feature } from "@/cad/types";
import { openSpringWizard, type SpringTarget, type SpringWizardOpts } from "./spring-wizard";

export type SpringFlowApi = {
  doc: CadDoc;
  isAsm: boolean;
  commit: (d: CadDoc) => void;
  openDocInTab: (d: CadDoc) => unknown;
  insertPart: (d: CadDoc, group?: string) => void;
  flash: (m: string) => void;
};

/** prvek pružiny z výsledku průvodce */
export const springFeature = (ext: string, name: string, data: Record<string, unknown>): Feature =>
  ({ id: uid(), name, type: "ext", ext, data: { at: [0, 0, 0], axis: "Z", mode: "new", ...data } }) as unknown as Feature;

/** díl s jedinou pružinou (nová záložka / komponenta sestavy) */
export const springPartDoc = (ext: string, name: string, data: Record<string, unknown>): CadDoc => ({ ...emptyDoc(name), features: [springFeature(ext, name, data)] });

export async function springFromTable(api: SpringFlowApi, opts: SpringWizardOpts = {}): Promise<boolean> {
  const empty = !api.isAsm && !api.doc.features.some((f) => f.type !== "datum");
  const targets: SpringTarget[] = api.isAsm ? ["asm", "new"] : empty ? ["this"] : ["new", "this"];
  const res = await openSpringWizard({ targets, target: targets[0], ...opts });
  if (!res) return false;
  if (res.target === "asm") {
    api.insertPart(springPartDoc(res.ext, res.name, res.data), tr("Pružiny"));
    api.flash(tr("{0} vložena do sestavy.", res.name));
  } else if (res.target === "new" || api.isAsm) {
    api.openDocInTab(springPartDoc(res.ext, res.name, res.data));
    api.flash(tr("{0} otevřena jako nový díl.", res.name));
  } else {
    const f = springFeature(res.ext, res.name, { ...res.data, mode: empty ? "new" : "add" });
    api.commit({ ...api.doc, ...(empty ? { name: res.name } : {}), features: [...api.doc.features, f] });
    api.flash(tr("{0} přidána do historie.", res.name));
  }
  return true;
}

/** data pružiny v jiné délce (stlačená v sestavě) – re-export pro UI */
export { springDataAt };

/** hodnoty knihovny (DIN 2095 / 2097 / 2088 / 2093) → druh a předvyplněná tabulka průvodce */
export function libraryToSpring(family: string, v: Record<string, unknown>): Pick<SpringWizardOpts, "kind" | "data"> {
  const out = libraryToSpringRaw(family, v);
  return { kind: out.kind, data: Object.fromEntries(Object.entries(out.data ?? {}).filter(([, x]) => x !== undefined)) };
}
function libraryToSpringRaw(family: string, v: Record<string, unknown>): Pick<SpringWizardOpts, "kind" | "data"> {
  const n = (k: string) => (typeof v[k] === "number" ? (v[k] as number) : Number(v[k]) || undefined);
  if (family === "springExt") {
    // DIN 2097: těsně vinuté tělo Lk = (n + 1) · d – zvolená délka těla L z knihovny určí počet závitů (celé = očka v jedné rovině)
    const d = n("d");
    const L = n("L");
    const turns = d && L ? Math.max(1, Math.round(L / d - 1)) : n("n");
    return { kind: "extension", data: { d, De: n("D"), n: turns } };
  }
  if (family === "springTorsion") {
    // úhel ramen ve volném stavu α0 = zlomek závitu (EN 13906-3): n = závity těla + úhel / 360 (knihovna: výchozí 90°)
    const turns = n("n");
    const angle = typeof v.angle === "number" || (typeof v.angle === "string" && v.angle !== "") ? Number(v.angle) : 90;
    return { kind: "torsion", data: { d: n("d"), De: n("D"), n: turns !== undefined && Number.isFinite(angle) ? Math.round((turns + (((angle % 360) + 360) % 360) / 360) * 1e4) / 1e4 : turns, l1: n("leg"), l2: n("leg") } };
  }
  if (family === "din2093") {
    const m = /^([ABC])-([\d.]+)x/.exec(String(v.size ?? ""));
    const count = Math.max(1, Math.round(n("count") ?? 1));
    const parallel = v.stack === "parallel";
    return { kind: "disc", data: { series: m?.[1] ?? "A", De: m ? Number(m[2]) : 40, ns: parallel ? 1 : count, np: parallel ? count : 1 } };
  }
  return { kind: "compression", data: { d: n("d"), De: n("D"), L0: n("L"), n: n("n") } };
}
