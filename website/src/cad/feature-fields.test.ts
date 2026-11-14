/** Tabulka polí prvků (feature-fields.ts) je v souladu s types.ts; nápověda `prvek nápověda <typ>` vypíše všechna pole (CS / EN / DE). */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FEATURE_TYPES, featureDefaults, parseAgentText } from "./agent";
import { newFeature, type NewFeatureType } from "./defaults";
import { allExt } from "./ext/registry";
import { COMMON_FIELDS, featureFields, fieldsOf, textGaps, type FieldSpec } from "./feature-fields";
import { setLang } from "./i18n";
import { emptyDoc, type FeatureType } from "./types";
import "./ext/index";

afterEach(() => setLang("cs"));

/** Pole variant `Feature` přímo ze zdrojového textu types.ts: typ → pole → [nepovinné?] po variantách (pole má 5 variant). */
function typesFromSource(): Map<string, Map<string, boolean[]>> {
  const src = readFileSync(path.resolve(__dirname, "types.ts"), "utf8");
  const body = src.slice(src.indexOf("export type Feature ="), src.indexOf("export type FeatureType"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  const out = new Map<string, Map<string, boolean[]>>();
  // varianty = objektové literály na nejvyšší úrovni sjednocení
  let depth = 0;
  let start = -1;
  const variants: string[] = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) variants.push(body.slice(start, i));
    }
  }
  for (const v of variants) {
    // pole na nejvyšší úrovni objektu (středníky uvnitř {…} [ ] ( ) < > se nepočítají)
    const parts: string[] = [];
    let d = 0;
    let cur = "";
    for (const ch of v) {
      if ("{[(<".includes(ch)) d++;
      else if ("}])>".includes(ch)) d--;
      if ((ch === ";" || ch === "\n") && d === 0) {
        if (cur.trim()) parts.push(cur);
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    const fields = parts.map((p) => /^\s*(\w+)(\?)?\s*:/.exec(p)).filter((m): m is RegExpExecArray => !!m);
    const type = parts.map((p) => /^\s*type\s*:\s*"(\w+)"/.exec(p)?.[1]).find(Boolean);
    if (!type) continue; // společná část { id; name; suppressed; body }
    const map = out.get(type) ?? new Map<string, boolean[]>();
    for (const m of fields) if (m[1] !== "type") map.set(m[1], [...(map.get(m[1]) ?? []), !!m[2]]);
    out.set(type, map);
  }
  return out;
}

describe("tabulka polí ↔ types.ts", () => {
  const table = featureFields();
  const src = typesFromSource();

  it("zdroj types.ts se přečetl celý (36 typů, pole s 5 variantami)", () => {
    expect([...src.keys()].sort()).toEqual([...FEATURE_TYPES].sort());
    expect(src.get("hole")!.has("tipAngle")).toBe(true);
    expect(src.get("pattern")!.get("featureId")).toHaveLength(5);
  });

  it("každý typ prvku má v tabulce právě všechna svá pole a volitelnost odpovídá (?:)", () => {
    for (const type of FEATURE_TYPES) {
      const fields = table[type].fields as Record<string, FieldSpec>;
      const want = src.get(type)!;
      expect(Object.keys(fields).sort(), type).toEqual([...want.keys()].sort());
      for (const [k, opts] of want) expect(!!fields[k].opt, `${type}.${k} nepovinné`).toBe(opts.every(Boolean));
    }
  });

  it("výchozí prvky formuláře (newFeature) nemají pole mimo tabulku", () => {
    const doc = emptyDoc("t");
    for (const type of FEATURE_TYPES) {
      if (type === "sketch" || type === "import" || type === "pattern" || type === "ext") continue;
      const f = newFeature(doc, type as NewFeatureType) as unknown as Record<string, unknown>;
      const extra = Object.keys(f).filter((k) => !(COMMON_FIELDS as readonly string[]).includes(k) && !(k in table[type].fields));
      expect(extra, type).toEqual([]);
    }
  });

  it("každé pole má popis, výčty mají hodnoty, mezery textu se počítají bez otisků", () => {
    for (const type of FEATURE_TYPES) {
      for (const [k, f] of fieldsOf(type)) {
        expect(f.desc.length, `${type}.${k}`).toBeGreaterThan(2);
        if (f.k === "enum") expect(f.values?.length, `${type}.${k}`).toBeGreaterThan(1);
      }
    }
    const gaps = textGaps();
    expect(gaps).toHaveLength(FEATURE_TYPES.length);
    const cone = gaps.find((g) => g.type === "cone")!;
    expect(cone.missing).toEqual([]); // primitiva jdou celá textem (12. vlna)
    expect(gaps.find((g) => g.type === "fillet")!.missing).toContain("radii");
    expect(gaps.find((g) => g.type === "fillet")!.missing).not.toContain("edgeSigs");
  });
});

const info = (text: string): string[] => {
  const p = parseAgentText(text);
  expect(p.errors, text).toEqual([]);
  const op = p.ops[0] as { k: string; lines: string[] };
  expect(op.k, text).toBe("info");
  return op.lines;
};

describe("prvek nápověda <typ>", () => {
  it("vypíše každé pole typu – název, druh, výchozí / povinné, význam a textový zápis", () => {
    for (const type of FEATURE_TYPES) {
      const lines = info(`prvek nápověda ${type}`);
      expect(lines[0], type).toContain(`(${type})`);
      for (const [k] of fieldsOf(type as FeatureType)) expect(lines.some((l) => l.startsWith(` • ${k} – `)), `${type}.${k}`).toBe(true);
    }
    const cone = info("prvek nápověda kužel");
    expect(cone[0]).toBe("Kužel (cone) – pole pro „prvek cone klíč=hodnota“ i „upravit <prvek> klíč=hodnota“:");
    expect(cone[1]).toMatch(/^textový příkaz: kužel D1 D2 H/);
    expect(cone.find((l) => l.startsWith(" • dirDef"))).toMatch(/směr \(JSON Direction\), např\. dirDef=\{"kind":"vector","v":\[0,0,-1\]\} · nepovinné – .* · text: osa -Z/);
    expect(cone.find((l) => l.startsWith(" • position"))).toMatch(/vektor x;y;z \[mm\].*výchozí 0;0;0/);
    expect(cone.find((l) => l.startsWith(" • radius1"))).toMatch(/povinné/);
    expect(cone.find((l) => l.startsWith(" • mode"))).toMatch(/výčet new\|add\|cut\|intersect · výchozí add/);
    expect(cone.some((l) => l.startsWith("příklad: prvek cone"))).toBe(true);
  });
  it("nápověda díra / help / hilfe; slovo příkazu i pružina; pole jen přes prvek je označené", () => {
    const hole = info("nápověda díra");
    expect(hole[0]).toMatch(/^Díra \(hole\)/);
    expect(hole.find((l) => l.startsWith(" • fit"))).toMatch(/jen prvek \/ upravit \/ JSON/);
    expect(info("help pružina")[0]).toMatch(/\(spring\)/);
    expect(info("prvek nápověda Pole").find((l) => l.startsWith(" • angle"))).toMatch(/pole kind=circular/);
    expect(info("prvek nápověda rotovat")[0]).toMatch(/\(revolve\)/);
  });
  it("vlna 12 po sloučení: díra (tapDrill, ploché dno) a vysunutí (směr, sklon, úkos ven, břit, rohy, výška) mají textový zápis", () => {
    const hole = info("nápověda díra");
    expect(hole.find((l) => l.startsWith(" • tapDrill"))).toMatch(/table\|minor\|custom.*jádro \| vrták N/);
    expect(hole.find((l) => l.startsWith(" • tipAngle"))).toMatch(/180 = ploché dno.*hrot N \| dno ploché/);
    expect(hole.find((l) => l.startsWith(" • tipAngle"))).not.toMatch(/jen prvek/);
    const ex = info("nápověda vysunout");
    for (const [k, txt] of [["dir", /sklon a \[k \+X\]/], ["draftAngle", /úkos a \[dovnitř\|ven\]/], ["draftLand", /břit N/], ["draftCorners", /ostré rohy \| zaoblené rohy/], ["normalHeight", /výška H/], ["extent", /k tělesu/]] as const)
      expect(ex.find((l) => l.startsWith(` • ${k} `)), k).toMatch(txt);
    expect(ex.find((l) => l.startsWith(" • draftCorners"))).toMatch(/výčet sharp\|round/);
  });
  it("prvek <typ>: klíč mimo pole typu = chyba s výčtem polí, velikost písmen se opraví (dřív tiché pole navíc)", () => {
    const e = parseAgentText("prvek hole foo=1 position=1;2;3 diameter=5").errors[0];
    expect(e?.message).toMatch(/^prvek hole: neznámý klíč „foo“ – pole: name, suppressed, body, .*tapDrill.*\(popis: prvek nápověda hole\)/);
    expect(parseAgentText("prvek cone radius1=5 radius2=0 height=5 bar=2").errors[0]?.message).toMatch(/neznámý klíč „bar“/);
    expect(parseAgentText("prvek hole position=1;2;3 diameter=5 TIPANGLE=180").ops[0]).toMatchObject({ k: "feature", feature: { type: "hole", tipAngle: 180 } });
    expect(parseAgentText("prvek extrude sketchId=$last distance=20 mode=cut draftAngle=-2 draftLand=3 draftCorners=sharp").errors).toEqual([]);
    expect(parseAgentText("prvek datum planeDef.kind=base").errors).toEqual([]); // vnořená cesta: kontroluje se první část
  });
  it("přehled typů s mezerami textu", () => {
    const lines = info("prvek nápověda");
    for (const type of FEATURE_TYPES) expect(lines.some((l) => l.startsWith(` • ${type} (`)), type).toBe(true);
    expect(lines.find((l) => l.startsWith(" • cone"))).toMatch(/text ✓ · vše textem/);
    expect(lines.find((l) => l.startsWith(" • sweep"))).toMatch(/bez textového příkazu/);
  });
  it("rozšíření: každý parametr každého prvku rozšíření", () => {
    const exts = allExt().filter((d) => !d.action);
    expect(exts.length).toBeGreaterThan(30);
    for (const d of exts) {
      const lines = info(`prvek nápověda ${d.ext}`);
      expect(lines[0], d.ext).toContain(`(${d.ext})`);
      for (const p of d.params ?? []) expect(lines.some((l) => l.startsWith(` • ${p.key} („`)), `${d.ext}.${p.key}`).toBe(true);
    }
    const act = allExt().find((d) => d.action);
    if (act) expect(info(`prvek nápověda ${act.ext}`)[0]).toMatch(/není prvek, ale akce/);
  });
  it("neznámý typ = chyba s výčtem; běžný prvek … dál funguje", () => {
    expect(parseAgentText("prvek nápověda xyz").errors[0].message).toMatch(/^nápověda: neznámý typ prvku „xyz“ – typy: sketch, extrude/);
    expect(parseAgentText("prvek cone radius1=10 radius2=5 height=20").ops[0]).toMatchObject({ k: "feature", feature: { type: "cone", radius1: 10 } });
    expect(parseAgentText("prvek Pole featureId=$last count=3 spacing=10 direction=1;0;0").ops[0]).toMatchObject({ k: "feature", feature: { type: "pattern" } });
  });
  it("výchozí hodnoty v nápovědě = výchozí hodnoty příkazu prvek (normalizeFeatures)", () => {
    for (const type of FEATURE_TYPES) {
      const dflt = featureDefaults(type)!; // díra: bez výchozí polohy (povinné pole)
      const lines = info(`prvek nápověda ${type}`);
      for (const [k] of fieldsOf(type as FeatureType)) {
        const l = lines.find((x) => x.startsWith(` • ${k} – `))!;
        expect(l.includes(" · výchozí "), `${type}.${k}`).toBe(k in dflt);
      }
    }
  });
  it("anglicky a německy", () => {
    setLang("en");
    const en = info("feature help cone");
    expect(en[0]).toBe("Cone (cone) – fields for “feature cone key=value” and “edit <feature> key=value”:");
    expect(en.find((l) => l.startsWith(" • dirDef"))).toMatch(/optional/);
    expect(info("help hole")[0]).toMatch(/\(hole\)/);
    setLang("de");
    const de = info("element hilfe kegel");
    expect(de[0]).toMatch(/^Kegel \(cone\)/);
    expect(info("hilfe feder")[0]).toMatch(/\(spring\)/);
    expect(info("hilfe bohrung")[0]).toMatch(/\(hole\)/);
  });
});
