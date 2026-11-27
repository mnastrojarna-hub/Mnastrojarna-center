/**
 * Označení materiálu do razítka a třída hustoty – JEDNO pravidlo pro všechna místa, kde se zadává (vlna 22, kolo 6):
 * textový příkaz dílu `materiál …`, komponenta sestavy `sestava komponenta "X" materiál "…"`, pole „Označení materiálu
 * (razítko)“ v GUI (Hmotnostní vlastnosti, správce dílu, razítko výkresu).
 *
 * * text = třída hustoty (ocel, steel, Hliník, 1.2311 …) → jen třída, označení se smaže;
 * * jiný text = označení do razítka; pozná-li se z něj třída (ČSN 11 423 → ocel, 1.4301 → nerez, EN AW-6082 → hliník –
 *   `materialClass`), nastaví se i třída hustoty: ℹ `material.class`;
 * * třída se z označení nepozná (Hardox 400) → hustota zůstává podle třídy dokumentu, ale je to PŘEDPOKLAD:
 *   ⚠ `material.density-assumed` – nikdy ✓ (vlna 22: žádná falešná zelená);
 * * označení patří JINÉ třídě, než má dokument (třída změněna po označení: `materiál nerez` po `materiál ČSN 11 423`,
 *   nabídka Materiál v GUI) → ⚠ `material.class-conflict` (kolo 7); označení se samo nemaže – opraví ho člověk.
 */
import { MATERIALS } from "@/lib/mesh-metrics";
import { materialClass } from "./agent-strict";
import { codeText } from "./engine/codes";
import { tr } from "./i18n";

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss");

/** anglické a německé názvy tříd materiálu → id (hustota) */
const ALIASES: Record<string, string> = Object.fromEntries(
  (
    [
      ["ocel", "steel", "stahl", "mild steel", "baustahl"],
      ["nerez", "stainless", "stainless steel", "inox", "edelstahl", "rostfrei", "nirosta"],
      ["hlinik", "aluminium", "aluminum", "alu", "alloy"],
      ["mosaz", "brass", "messing"],
      ["med", "copper", "kupfer"],
      ["titan", "titanium"],
      ["pom", "plastic", "plast", "kunststoff", "delrin", "acetal"],
    ] as const
  ).flatMap(([id, ...names]) => names.map((n) => [fold(n), id] as const)),
);

/** id třídy hustoty, je-li text třídou (id, popisek, první slovo popisku, anglický / německý název), jinak null */
export function knownMaterialId(text: string): string | null {
  const f = fold(text.trim());
  if (!f) return null;
  const hit = MATERIALS.find((m) => fold(m.id) === f || fold(m.label) === f || fold(m.label).split(" ")[0] === f || ALIASES[f] === m.id);
  return hit?.id ?? null;
}

export type MaterialPatch = { material?: string; materialName?: string };

/**
 * Co zadání materiálu změní: `{ material }` (třída), `{ materialName, material }` (označení s rozpoznanou třídou) nebo
 * `{ materialName }` (jen označení – hustota zůstává). `known` = výsledek `knownMaterialId` (volající ho může mít).
 */
export function designationPatch(text: string, known: string | null = knownMaterialId(text)): MaterialPatch {
  const q = text.trim();
  if (known) return { material: known };
  const cls = materialClass(q);
  return cls ? { materialName: q, material: cls } : { materialName: q };
}

export type MaterialNote = { code: "material.class" | "material.class-family" | "material.density-assumed" | "material.class-conflict"; args: (string | number)[] };

/**
 * skupina třídy hustoty: podtřídy oceli v `MATERIALS` (1.2311, 1.2343, 1.1730 …) patří do skupiny „ocel“ – označení jiné
 * oceli proti nim NENÍ rozpor tříd (kolo 7b: dřív „ČSN 11 523 je třídy Ocel, hustota podle třídy 1.2311 … si odporují“)
 */
export const materialFamily = (id: string): string => (MATERIALS.some((x) => x.id === id) ? (materialClass(id) ?? id) : id);

/**
 * Hláška k označení materiálu dokumentu: třída rozpoznaná z označení = třída dokumentu → ℹ `material.class`; jinak ⚠
 * `material.density-assumed` (hustota podle třídy dokumentu je předpoklad). Bez označení null.
 */
export function designationNote(materialName: string | undefined, material: string | undefined): MaterialNote | null {
  const n = materialName?.trim();
  if (!n) return null;
  const cls = MATERIALS.find((x) => x.id === material) ?? MATERIALS[0];
  const of = materialClass(n);
  if (of === cls.id) return { code: "material.class", args: [n, `${cls.label} (${cls.density} g/cm³)`] };
  // označení oceli u podtřídy oceli (ČSN 11 523 × 1.2311): stejná skupina – hustota podle zvolené podtřídy, žádný rozpor (ℹ)
  if (of && of === materialFamily(cls.id)) return { code: "material.class-family", args: [n, MATERIALS.find((x) => x.id === of)?.label ?? of, cls.label, cls.density] };
  // označení JINÉ rozpoznané třídy (ČSN 11 423 = ocel, třída dokumentu nerez – `materiál nerez` po označení, nabídka Materiál
  // v GUI): hustota podle třídy dokumentu odporuje označení v razítku – ⚠, nikdy tiše (vlna 22, bod 22g – kolo 7)
  const ofCls = of ? MATERIALS.find((x) => x.id === of) : undefined;
  if (ofCls) return { code: "material.class-conflict", args: [n, ofCls.label, cls.label, cls.density] };
  return { code: "material.density-assumed", args: [n, cls.density, cls.label] };
}

/** dokument (díl) po zadání materiálu – prázdný text nebo popisek současné třídy = bez označení (pole GUI) */
export function withDesignation<T extends { material: string; materialName?: string }>(doc: T, text: string): T {
  const t = text.trim();
  const cur = MATERIALS.find((x) => x.id === doc.material);
  if (!t || (cur && t === cur.label)) {
    if (doc.materialName === undefined) return doc;
    const { materialName: _n, ...rest } = doc;
    void _n;
    return rest as T;
  }
  const p = designationPatch(t);
  const next = { ...doc, ...(p.material ? { material: p.material } : {}) } as T;
  if (p.materialName) next.materialName = p.materialName;
  else delete next.materialName;
  return next;
}

/**
 * Díly dokumentu, jejichž označení v razítku patří jiné třídě, než podle které se počítá hustota (⚠ material.class-conflict):
 * díl sám, u sestavy díly komponent (i v podsestavách, každý díl jednou). Pro `stav`, kusovník (text i panel GUI) a export
 * výkresu / kusovníku – konflikt se dřív hlásil jen na řádku příkazu `materiál` a pod polem GUI (kolo 7b, bod 22g).
 */
export function materialConflicts(doc: { kind?: string; name: string; material?: string; materialName?: string; components?: readonly { source: { kind: string; doc?: unknown } }[] }): { part: string; note: MaterialNote }[] {
  const out: { part: string; note: MaterialNote }[] = [];
  const seen = new Set<string>();
  const visit = (d: typeof doc, depth: number) => {
    if (depth > 16) return;
    if (d.kind === "assembly") {
      for (const c of d.components ?? []) if ((c.source.kind === "part" || c.source.kind === "asm") && c.source.doc) visit(c.source.doc as typeof doc, depth + 1);
      return;
    }
    const note = designationNote(d.materialName, d.material);
    const key = `${d.name}|${d.materialName}|${d.material}`;
    if (note?.code !== "material.class-conflict" || seen.has(key)) return;
    seen.add(key);
    out.push({ part: d.name, note });
  }
  visit(doc, 0);
  return out;
}

/** texty ⚠ material.class-conflict dokumentu: u sestavy s názvem dílu („díl „Deska A“: …“), u dílu text kódu */
export function materialConflictLines(doc: Parameters<typeof materialConflicts>[0]): { part: string; text: string }[] {
  return materialConflicts(doc).map((x) => ({ part: x.part, text: doc.kind === "assembly" ? tr("díl „{0}“: {1}", x.part, codeText("material.class-conflict", ...x.note.args)) : codeText("material.class-conflict", ...x.note.args) }));
}
