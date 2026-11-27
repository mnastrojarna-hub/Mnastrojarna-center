/**
 * Označení materiálu do razítka a třída hustoty – JEDNO pravidlo pro všechna místa, kde se zadává (vlna 22, kolo 6):
 * textový příkaz dílu `materiál …`, komponenta sestavy `sestava komponenta "X" materiál "…"`, pole „Označení materiálu
 * (razítko)“ v GUI (Hmotnostní vlastnosti, správce dílu, razítko výkresu).
 *
 * * text = třída hustoty (ocel, steel, Hliník, 1.2311 …) → jen třída, označení se smaže;
 * * jiný text = označení do razítka; pozná-li se z něj třída (ČSN 11 423 → ocel, 1.4301 → nerez, EN AW-6082 → hliník –
 *   `materialClass`), nastaví se i třída hustoty: ℹ `material.class`;
 * * třída se z označení nepozná (Hardox 400) nebo s ním nesouhlasí → hustota zůstává podle třídy dokumentu, ale je to
 *   PŘEDPOKLAD: ⚠ `material.density-assumed` – nikdy ✓ (vlna 22: žádná falešná zelená).
 */
import { MATERIALS } from "@/lib/mesh-metrics";
import { materialClass } from "./agent-strict";

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

export type MaterialNote = { code: "material.class" | "material.density-assumed"; args: (string | number)[] };

/**
 * Hláška k označení materiálu dokumentu: třída rozpoznaná z označení = třída dokumentu → ℹ `material.class`; jinak ⚠
 * `material.density-assumed` (hustota podle třídy dokumentu je předpoklad). Bez označení null.
 */
export function designationNote(materialName: string | undefined, material: string | undefined): MaterialNote | null {
  const n = materialName?.trim();
  if (!n) return null;
  const cls = MATERIALS.find((x) => x.id === material) ?? MATERIALS[0];
  return materialClass(n) === cls.id ? { code: "material.class", args: [n, `${cls.label} (${cls.density} g/cm³)`] } : { code: "material.density-assumed", args: [n, cls.density, cls.label] };
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
