/**
 * Otevření velké sestavy STEP: zrušení (Zrušit při čtení struktury v jádře) a pád jádra nejsou „formát nelze otevřít“.
 */
import { describe, expect, it } from "vitest";
import { prepareImport } from "./import";

/** sestava STEP ≥ 1 MB (strukturu dál nečteme – rozdělení dělá zkušební „jádro“) */
function bigAssemblyStep(): File {
  const head = "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((''),'2;1');\nFILE_NAME('a','',(''),(''),'','','');\nFILE_SCHEMA(('AUTOMOTIVE_DESIGN'));\nENDSEC;\nDATA;\n";
  const nauo = "#1=NEXT_ASSEMBLY_USAGE_OCCURRENCE('1','a','',#2,#3,$);\n";
  const pad = Array.from({ length: 30_000 }, (_, i) => `#${i + 10}=CARTESIAN_POINT('',(${i}.,0.,0.));\n`).join("");
  return new File([head + nauo + pad + "ENDSEC;\nEND-ISO-10303-21;\n"], "stroj.step");
}

class CadCancelled extends Error {
  constructor() {
    super("Výpočet zrušen.");
    this.name = "CadCancelled";
  }
}

describe("otevření sestavy STEP: zrušení a chyba jádra", () => {
  it("zrušení při rozdělování sestavy se předá volajícímu (ohlásí „Otevírání souboru … zrušeno“), ne jako nepodporovaný formát", async () => {
    const f = bigAssemblyStep();
    expect(f.size).toBeGreaterThan(1024 * 1024);
    await expect(
      prepareImport(f, async () => {
        throw new CadCancelled();
      }),
    ).rejects.toThrow(CadCancelled);
  });

  it("pád jádra při rozdělování: titulek „Soubor … se nepodařilo otevřít“ s textem chyby", async () => {
    const r = await prepareImport(bigAssemblyStep(), async () => {
      throw new Error("Výpočetnímu jádru došla paměť.");
    });
    expect(r.kind).toBe("unsupported");
    if (r.kind !== "unsupported") return;
    expect(r.title).toBe("Soubor stroj.step se nepodařilo otevřít");
    expect(r.message).toBe("stroj.step: Výpočetnímu jádru došla paměť.");
  });
});
