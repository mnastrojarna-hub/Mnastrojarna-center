/**
 * Skupiny komponent (Normálie, Díly, Vedení…): v dokumentu česky (jako rám formy, knihovna, import STEP), na obrazovce tr().
 * Skupina uložená přeloženě (starší dokument, ruční zápis „Standard parts“) se přiřadí ke své české skupině – ve stromu sestavy
 * pak nevzniknou dvě skupiny se stejným nadpisem (a duplicitní klíče Reactu), dokument z EN se v CS ukáže česky.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { groupComponents, groupKey, groupLabel } from "./asm-groups";
import { bomCsv, computeBom, defaultMoldBase, emptyAssembly, moldBase, partComponent } from "./assembly";
import { clearMissing, missingKeys, setLang } from "./i18n";
import { emptyDoc } from "./types";

afterEach(() => setLang("cs"));
const src = (rel: string) => fs.readFileSync(path.resolve(__dirname, "..", rel), "utf8");

describe("skupiny komponent sestavy", () => {
  it("klíč skupiny: český název, překlad EN/DE (i jinou velikostí písmen) → český, vlastní skupina beze změny", () => {
    expect(groupKey("Normálie")).toBe("Normálie");
    expect(groupKey("Standard parts")).toBe("Normálie");
    expect(groupKey("normteile")).toBe("Normálie");
    expect(groupKey("Parts")).toBe("Díly");
    expect(groupKey("Teile")).toBe("Díly");
    expect(groupKey("Guides")).toBe("Vedení");
    expect(groupKey("Plates")).toBe("Desky");
    expect(groupKey("Sub-assemblies")).toBe("Podsestavy");
    expect(groupKey(undefined)).toBe("Díly");
    expect(groupKey("  ")).toBe("Díly");
    expect(groupKey("Moje skupina")).toBe("Moje skupina");
  });

  it("popisek v jazyce rozhraní", () => {
    expect(groupLabel("Normálie")).toBe("Normálie");
    expect(groupLabel("Standard parts")).toBe("Normálie"); // dokument z EN otevřený v CS
    setLang("en");
    expect(groupLabel("Normálie")).toBe("Standard parts");
    setLang("de");
    expect(groupLabel("Standard parts")).toBe("Normteile");
    clearMissing();
    expect(groupLabel("Dorazy")).toBe("Dorazy"); // vlastní skupina uživatele se nepřekládá ani nehlásí jako chybějící překlad
    expect(missingKeys()).toEqual([]);
  });

  it("strom sestavy: rám formy + kroužek uložený přeloženě = jedna skupina Normálie (dřív dvě „Standard parts“)", () => {
    setLang("en");
    const a = moldBase(defaultMoldBase);
    const base = groupComponents(a.components ?? []);
    const nNorm = base.find((g) => g.key === "Normálie")?.items.length ?? 0;
    expect(nNorm).toBeGreaterThan(0);
    const extra = [partComponent(emptyDoc("Kroužek"), {}, { group: "Standard parts" }), partComponent(emptyDoc("Šroub"), {}, { group: "Normálie" }), partComponent(emptyDoc("Kolík"), {}, { group: "Díly" }), partComponent(emptyDoc("Kolík 2"), {}, { group: "Parts" }), partComponent(emptyDoc("X"), {})];
    const gs = groupComponents([...(a.components ?? []), ...extra]);
    const keys = gs.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length); // žádný duplicitní klíč
    const labels = gs.map((g) => g.label);
    expect(new Set(labels).size).toBe(labels.length); // žádný dvakrát stejný nadpis
    expect(gs.find((g) => g.key === "Normálie")?.items.length).toBe(nNorm + 2);
    expect(gs.find((g) => g.key === "Díly")?.items.length).toBe(3);
    expect(gs.find((g) => g.key === "Normálie")?.label).toBe("Standard parts");
    setLang("cs");
    expect(groupComponents(extra).map((g) => g.label)).toEqual(["Normálie", "Díly"]);
  });

  it("UI ukládá skupiny česky – žádné přeložené tr() do pole group (vložení přes insertComponent je navíc převede groupKey)", () => {
    for (const f of ["components/cad/cad-app.tsx", "components/cad/agent-api-host.ts"]) {
      const s = src(f);
      expect(s.match(/group: tr\(/g) ?? [], f).toEqual([]);
      expect(s.match(/group = tr\(/g) ?? [], f).toEqual([]);
    }
    expect(src("components/cad/cad-app.tsx")).toMatch(/group: groupKey\(c0\.group\)/);
    expect(src("components/cad/asm-panel.tsx")).toMatch(/groupComponents\(comps\)/);
  });

  it("kusovník řadí i přeložené skupiny (Desky před Normálie) a CSV je píše v jazyce rozhraní", () => {
    setLang("en");
    const a = emptyAssembly("T");
    a.components = [partComponent(emptyDoc("Šroub"), {}, { group: "Standard parts" }), partComponent(emptyDoc("Deska"), {}, { group: "Desky" }), partComponent(emptyDoc("Jiný"), {}, { group: "Vlastní" })];
    const bom = computeBom(a, () => ({}));
    expect(bom.map((r) => r.group)).toEqual(["Desky", "Standard parts", "Vlastní"]);
    const csv = bomCsv(bom).split("\r\n");
    expect(csv[1].endsWith(";Plates")).toBe(true);
    expect(csv[2].endsWith(";Standard parts")).toBe(true);
    expect(csv[3].endsWith(";Vlastní")).toBe(true);
    setLang("cs");
    const b = emptyAssembly("T");
    b.components = [partComponent(emptyDoc("Šroub"), {}, { group: "Normálie" }), partComponent(emptyDoc("Deska"), {}, { group: "Desky" })];
    expect(computeBom(b, () => ({})).map((r) => r.group)).toEqual(["Desky", "Normálie"]);
    expect(bomCsv(computeBom(b, () => ({}))).split("\r\n")[2].endsWith(";Normálie")).toBe(true);
  });
});
