/**
 * Akce rozšíření, které potřebují jen dokument a píšou text do protokolu (vlna 21): provádí je engine – stejně v aplikaci
 * i v příkazové řádce (`mncad run`), bez okna aplikace. Text i strojový řádek dává jedna čistá funkce; tlačítko / API okna
 * (`window.mncad.action`) volá tutéž funkci přes registraci UI akce (components/cad/springs/register.tsx).
 *
 *   spring.table – `pružina tabulka ["Název"|vše]`, `akce spring.table`: spočtené údaje pružin z tabulky (agent-springs.ts)
 *     = <loc> spring "<díl>" springs=1 name="Pružina" kind=compression d=2mm De=20mm L0=50mm n=8 R=3.494N/mm Ln=20mm …
 */
import type { CadDoc } from "../../types";
import { kv, num, type KvPairs } from "../kv";

export type DocActionOut = { kv: string; lines: string[] };
export type DocAction = (doc: CadDoc, arg: string) => Promise<DocActionOut>;

/** strojové údaje jedné pružiny z tabulky (výpočet `@/cad/springs`) */
function springPairs(t: { name: string; ext: string; calc: { kind: string; ok: boolean; v: Record<string, number>; issues: { level: string }[] } }): KvPairs {
  const v = t.calc.v;
  const mm = (k: string, d = 3) => num(v[k], d, "mm");
  return [
    ["name", t.name],
    ["kind", t.calc.kind],
    ["d", mm("d")],
    ["De", mm("De")],
    ["L0", mm("L0")],
    ["n", num(v.n, 3)],
    ["R", t.calc.kind === "torsion" ? num(v.RM, 4, "Nmm/deg") : num(v.R, 4, "N/mm")],
    ["Ln", mm("Ln")],
    ["F1", num(v.F1, 1, "N")],
    ["F2", num(v.F2, 1, "N")],
    ["Fn", num(v.Fn, 1, "N")],
    ["tau2", v.tau2 !== undefined && v.tauzul ? num((100 * v.tau2) / v.tauzul, 0, "%") : undefined],
    ["mass", num(v.mass !== undefined ? v.mass * 1000 : undefined, 2, "g")],
    ["warn", t.calc.issues.filter((i) => i.level === "warn").length || undefined],
    ["err", t.calc.issues.filter((i) => i.level === "error").length || undefined],
  ];
}

const springTable: DocAction = async (doc, arg) => {
  const [{ springTableLines, ALL_SPRINGS }, { springTablesOf }] = await Promise.all([import("../../agent-springs"), import("../../springs")]);
  const lines = springTableLines(doc, arg); // ✗ neznámá pojmenovaná pružina = chyba operace
  const all = springTablesOf(doc);
  const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const pick = arg === ALL_SPRINGS ? all : arg ? all.filter((t) => fold(t.name) === fold(arg)) : all.slice(-1);
  const pairs: KvPairs = pick.length === 1 ? [["springs", 1], ...springPairs(pick[0])] : [["springs", pick.length], ["names", pick.map((t) => t.name).join(", ")], ["lines", lines.length]];
  return { kv: kv(pairs), lines };
};

/** akce dokumentu podle id (null = akci provádí aplikace / není) */
export function docAction(id: string): DocAction | null {
  return id === "spring.table" ? springTable : null;
}
