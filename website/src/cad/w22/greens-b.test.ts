/**
 * Vlna 22, kolo 6 (balík b) – „greens“: úspěšné texty, které body tohoto balíku mění, se NEvypíšou, když kontrola
 * neproběhla nebo výsledek je jen předpoklad.
 *
 * * materiál zadaný označením, ze kterého se třída nepozná (Hardox 400): hustota je předpoklad → žádné ✓ na řádku, jen
 *   → (ℹ) + ⚠ material.density-assumed (dřív „✓ materiál … hustota zůstává“ vedle ⚠ – falešná zelená, engine/ops/meta.ts);
 * * komponenta sestavy `sestava komponenta "X" materiál "…"` = totéž pravidlo jako příkaz dílu (dřív se třída z označení
 *   nepoznala a hustota zůstala, bez hlášky – asm-agent.ts);
 * * pole označení v GUI = totéž pravidlo (`withDesignation`, `designationNote` – material-designation.ts).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import type { EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { runScript } from "../engine/run";
import { designationNote, designationPatch, knownMaterialId, withDesignation } from "../material-designation";
import { emptyDoc, type CadDoc } from "../types";
import { docToScript } from "../doc-script";
import { realHost } from "./real-host";

let host: () => EngineHost;
beforeAll(async () => {
  setLang("cs");
  host = await realHost();
}, 120_000);

const at = (r: Awaited<ReturnType<typeof runScript>>, line: number) => r.entries.filter((e) => e.line === line);

describe("greens b: označení materiálu bez rozpoznané třídy není ✓", () => {
  it("díl: `materiál Hardox 400` → žádné ✓ na řádku, ⚠ material.density-assumed; `materiál ČSN 11 423` → ✓ + ℹ material.class", async () => {
    const r = await runScript(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 10 10 10\nmateriál Hardox 400\nmateriál ČSN 11 423', host());
    const l3 = at(r, 3);
    expect(l3.filter((e) => e.level === "ok"), JSON.stringify(l3)).toEqual([]);
    expect(l3.some((e) => e.level === "warn" && e.code === "material.density-assumed")).toBe(true);
    const l4 = at(r, 4);
    expect(l4.some((e) => e.code === "material.class")).toBe(true);
    expect(l4.some((e) => e.code === "material.density-assumed")).toBe(false);
  }, 60_000);

  it("komponenta: `sestava komponenta … materiál \"ČSN 11 423\"` nastaví třídu Ocel z označení (ℹ), „Hardox 400“ = ⚠ (jako příkaz dílu)", async () => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, 'nový díl "Deska A"\nkvádr 10 10 10\nmateriál hliník\nnová sestava "S"\nvložit "Deska A"\nsestava komponenta "Deska A" materiál "ČSN 11 423"\nsestava komponenta "Deska A" materiál "Hardox 400"', host());
    const l6 = at(r, 6);
    expect(l6.some((e) => e.code === "material.class"), JSON.stringify(l6)).toBe(true);
    expect(l6.some((e) => e.level === "ok" && /ČSN 11 423.*hustota podle: Ocel/.test(e.text))).toBe(true);
    const l7 = at(r, 7);
    expect(l7.some((e) => e.level === "warn" && e.code === "material.density-assumed"), JSON.stringify(l7)).toBe(true);
    // kolo 6, oponent: dřív „✓ komponenta … materiál „Hardox 400“ (hustota podle: Ocel)“ vedle ⚠ – falešná zelená; teď jako díl
    expect(l7.filter((e) => e.level === "ok"), JSON.stringify(l7)).toEqual([]);
    expect(l7.some((e) => e.code === "msg.note" && /Hardox 400.*uložen jako označení/.test(e.text ?? ""))).toBe(true);
    const asm = ws.present();
    const src = asm.components?.[0]?.source;
    expect(src?.kind).toBe("part");
    if (src?.kind === "part") expect([src.doc.material, src.doc.materialName]).toEqual(["ocel", "Hardox 400"]);
  }, 60_000);

  it("komponenta: materiál bez rozpoznané třídy + jiná změna v jednom příkazu → ✓ jen pro tu změnu, materiál „→“ + ⚠", async () => {
    const r = await runScript(new MemoryWorkspace(), 'nový díl "Deska A"\nkvádr 10 10 10\nnová sestava "S"\nvložit "Deska A"\nsestava komponenta "Deska A" materiál "Hardox 400" barva #ff0000', host());
    const l5 = at(r, 5);
    const oks = l5.filter((e) => e.level === "ok");
    expect(oks.length, JSON.stringify(l5)).toBe(1);
    expect(oks[0].text).toMatch(/barva #ff0000/);
    expect(oks[0].text).not.toMatch(/Hardox/);
    expect(l5.some((e) => e.level === "warn" && e.code === "material.density-assumed")).toBe(true);
  }, 60_000);
});

describe("greens b: GUI pole označení = pravidlo textového příkazu", () => {
  const part = (material: string, materialName?: string): CadDoc => ({ ...emptyDoc("Deska A"), material, ...(materialName ? { materialName } : {}) });
  it("withDesignation dává totéž co `materiál …` (designationPatch) a hláška pod polem má kód protokolu", () => {
    for (const t of ["ČSN 11 423", "1.4301", "EN AW-6082", "Hardox 400", "nerez", "steel"]) {
      const gui = withDesignation(part("hlinik"), t);
      const p = designationPatch(t);
      expect([gui.material, gui.materialName], t).toEqual([p.material ?? "hlinik", p.materialName]);
    }
    expect(designationNote("ČSN 11 423", withDesignation(part("hlinik"), "ČSN 11 423").material)?.code).toBe("material.class");
    expect(designationNote("Hardox 400", "ocel")?.code).toBe("material.density-assumed");
    // třída změněná po označení (ČSN 11 423 = ocel, ale vybraný hliník) – hustota je předpoklad, ne ℹ „zařazen jako“
    expect(designationNote("ČSN 11 423", "hlinik")?.code).toBe("material.density-assumed");
    expect(designationNote(undefined, "ocel")).toBeNull();
    // prázdné pole nebo popisek současné třídy = bez označení
    expect(withDesignation(part("ocel", "X"), "").materialName).toBeUndefined();
    expect(withDesignation(part("ocel", "X"), "Ocel").materialName).toBeUndefined();
    expect(knownMaterialId("Stahl")).toBe("ocel");
  });
});

/**
 * Kolo 7 (oponent kola 6, balík b): „jedno pravidlo“ musí platit pro SKUTEČNÝ stav dokumentu, ne jen pro designationPatch().
 * Oprava dílu (razítko textem = pole razítka, `materiál nerez` po označení = nabídka Materiál: označení zůstává + ⚠) je ve stopě D
 * (meta.ts, drawing-agent.ts, drawing-cmd.ts – vlastník bodu 22g). Tady zbylé rozdíly téhož textu:
 * * komponenta `sestava komponenta "X" materiál "nerez"` po označení dřív označení SMAZALA (withDesignation), díl ho nechá –
 *   dva výsledky téhož zadání (asm-agent.ts);
 * * skript z dokumentu (doc-script.ts) psal třídu PŘED označení – po přečtení nastavilo označení svou třídu a hustota se tiše
 *   změnila (dokument hliník + označení ČSN 11 423 → po skriptu ocel).
 */
describe("greens b (kolo 7): stejný text = stejný stav dílu i komponenty, skript vrací týž materiál", () => {
  // stejné hlášky se v protokolu slučují (protocol.ts mergeEntries: `lines` = všechny řádky) – hledat i v `lines`
  const atL = (r: Awaited<ReturnType<typeof runScript>>, line: number) => r.entries.filter((e) => e.line === line || e.lines?.includes(line));
  const partState = async (lines: string[]) => {
    const ws = new MemoryWorkspace();
    await runScript(ws, ['nový díl "Deska A"', "kvádr 10 10 10", ...lines.map((t) => `materiál ${t}`)].join("\n"), host());
    const d = ws.present();
    return [d.material, d.materialName] as const;
  };
  const compRun = async (lines: string[]) => {
    const ws = new MemoryWorkspace();
    const r = await runScript(ws, ['nový díl "Deska A"', "kvádr 10 10 10", 'nová sestava "S"', 'vložit "Deska A"', ...lines.map((t) => `sestava komponenta "Deska A" materiál "${t}"`)].join("\n"), host());
    const src = ws.present().components?.[0]?.source;
    return { r, mat: src?.kind === "part" ? ([src.doc.material, src.doc.materialName] as const) : null };
  };

  it("komponenta: `materiál \"nerez\"` po `\"ČSN 11 423\"` = jako díl: třída nerez, označení zůstává, „→“ + ⚠ (žádné ✓ za materiál)", async () => {
    const { r, mat } = await compRun(["ČSN 11 423", "nerez"]);
    expect(mat).toEqual(["nerez", "ČSN 11 423"]);
    expect(mat).toEqual(await partState(["ČSN 11 423", "nerez"]));
    const l6 = atL(r, 6);
    expect(l6.filter((e) => e.level === "ok"), JSON.stringify(l6)).toEqual([]);
    expect(l6.some((e) => e.level === "warn" && /^material\./.test(e.code ?? "")), JSON.stringify(l6)).toBe(true);
    expect(l6.some((e) => e.code === "msg.note" && /materiál = Nerez.*„ČSN 11 423“ v razítku zůstává/.test(e.text ?? ""))).toBe(true);
  }, 60_000);

  it("komponenta: řada zadání dává po každém kroku týž materiál a označení jako příkaz dílu", async () => {
    const seq = ["ČSN 11 423", "nerez", "Hardox 400", "EN AW-6082", "Ocel", "1.4301", "Hardox 400", "Nerez"];
    for (let k = 1; k <= seq.length; k++) {
      const steps = seq.slice(0, k);
      const { mat } = await compRun(steps);
      expect(mat, steps.join(" | ")).toEqual(await partState(steps));
    }
  }, 300_000);

  it("skript z dokumentu: označení jiné třídy, než má dokument, se po přečtení vrátí se stejnou třídou (třída až za označením)", async () => {
    const cases: [string, string | undefined][] = [["hlinik", "ČSN 11 423"], ["nerez", "ČSN 11 423"], ["ocel", "1.4301"], ["ocel", "ČSN 11 423"], ["hlinik", "EN AW-6082"], ["nerez", "Hardox 400"], ["ocel", "Hardox 400"], ["hlinik", undefined]];
    for (const [material, materialName] of cases) {
      const doc: CadDoc = { ...emptyDoc("Deska A"), material, ...(materialName ? { materialName } : {}) };
      const s = docToScript(doc);
      const ws = new MemoryWorkspace();
      const r = await runScript(ws, s.text, host());
      expect(r.entries.filter((e) => e.level === "error"), s.text).toEqual([]);
      const d = ws.present();
      expect([d.material, d.materialName], `${material} / ${materialName}: ${s.text}`).toEqual([material, materialName]);
    }
  }, 120_000);
});
