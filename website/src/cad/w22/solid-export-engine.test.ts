/**
 * Vlna 22, bod 22c se skutečným jádrem in-process (stejný běh jako konzole aplikace, CLI i `mncad serve`):
 * repro S/w22/repro/22c (C1 otevřená plocha, C2 uzavřená skořepina bez „Uzavřít do tělesa“, C3 kvádr + volná plocha,
 * C4 forma s kanálem po spline – oprava 4. 11.), výstupy `--formats` (CLI) v normálním i přísném režimu, JSON,
 * STL / „bez kontroly“, sestava se jmény komponent, objem a hmotnost jen z těles a NEZÁVISLÁ kontrola STEP
 * (scripts/cad-harness/step-check.ts – vlastní instance OCCT, přesný BRepCheck) pro díl i sestavu.
 * Na starém kódu (G2 4c0961a): C1/C2 „✓ kontrola STEP … těles: 0 … → věrná kopie modelu“, F check=ok, --strict bez STOP,
 * JSON ok:true, C3 V=29,14 cm³.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { stepCheck, stepCheckProblems } from "../../../scripts/cad-harness/step-check";
import { engineRun, finishRun, type OutputPolicy } from "../cli/job";
import type { EngineHost, MemoryFiles } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { finalizeReport, ReportBuilder } from "../engine/protocol";
import { runReport } from "../engine/run-protocol";
import { setLang } from "../i18n";
import { greenThenRed, realHost } from "./real-host";

let host: () => EngineHost;
beforeAll(async () => {
  setLang("cs");
  host = await realHost();
}, 120_000);

const C1 = 'nový díl "Plech"\nskica XY: čára 0 0 50 0 50 30 otevřená\nprvek surf.extrude sketchId="Skica 1" distance=20';
const C2 = 'nový díl "Deska A"\nskica XY: obdélník 40 30\nprvek surf.extrude sketchId="Skica 1" distance=20\nskica XY: obdélník 40 30\nprvek surf.planar sketchId="Skica 2"\nskica XY odsazení 20: obdélník 40 30\nprvek surf.planar sketchId="Skica 3"\nprvek surf.sew tolerance=0.01';
const C3 = 'nový díl "Deska B"\nkvádr 40 30 20\nskica XZ: čára -10 5 50 5 otevřená\nprvek surf.extrude sketchId="Skica 1" distance=60 symmetric=ano';
const C4 = 'nový díl "Deska C"\nkvádr 120 100 40 v -60 -50 0\nskica XY odsazení 35: spline -60 45 -20 30 20 45 60 30\nprvek sweep pathId="Skica 1" circleRadius=3 mode=cut';

/** běh jako konzole / `mncad run --full` – soubory v paměti hostitele */
const full = async (text: string) => {
  const h = host();
  const r = finalizeReport(await runReport(new MemoryWorkspace(), text, h, { lang: "cs" }), { full: true });
  return { r, files: (h.files as MemoryFiles).files, text: r.full ?? "" };
};

/** běh jako CLI s `--formats` (engine/files.ts writeDocFormat) – normální / přísný, report jako JSON */
const cliRun = async (script: string, p: Partial<OutputPolicy>) => {
  const h = host();
  const ws = new MemoryWorkspace();
  const strict = p.strict ?? false;
  const rb = new ReportBuilder({ lang: "cs", lines: script.split("\n").length, strict: !!strict });
  const noop = { opStart: () => undefined, opEnd: () => undefined };
  await engineRun(ws, script, h, rb, { strict, open: [] }, noop);
  const fin = await finishRun(ws, h, rb, { formats: ["step"], allDocs: false, noOutputOnError: false, share: false, ...p }, noop);
  const files = (h.files as MemoryFiles).files;
  const r = finalizeReport(rb.finish({ docs: fin.docs, files: [...files.values()].map((f) => f.file) }), {});
  return { r, files, rb };
};

describe("22c: objemový export bez tělesa – konzole / CLI", () => {
  it("C1 otevřená plocha: ✗ out.no-solid, zápis jen ℹ, žádné „věrná kopie“, objem a hmotnost „–“", { timeout: 180_000 }, async () => {
    const { r, text, files } = await full(`${C1}\nstav\nexport step c1-plocha`);
    expect(text).toMatch(/^✗ L5 out\.no-solid "Plech": kontrola STEP: soubor neobsahuje objemové těleso \(těles 0, volných skořepin 1, volných ploch 0\)/m);
    expect(text).toMatch(/^ℹ L5 msg\.note "Plech": export STEP: c1-plocha\.step · /m);
    expect(text).not.toMatch(/věrná kopie/);
    expect(text).not.toMatch(/^✓ L5 /m);
    expect(text).toMatch(/Rozměry: 50 × 30 × 20 mm .* · objem – \(žádné těleso\) · ploch 2/);
    expect(text).toMatch(/= L4 status "Plech" part feat=2\/0\/0 V=- m=- bbox=50x30x20 solids=0/);
    expect(r.protocol).toMatch(/^F step "c1-plocha\.step" \d+B check=fail/m);
    expect(r.protocol).toMatch(/^D "Plech" part feat=2\/0\/0 V=- m=- /m);
    expect(r.ok).toBe(false);
    expect(r.docs[0].volume_mm3).toBeUndefined();
    expect(r.docs[0].mass_kg).toBeUndefined();
    expect(r.docs[0].solids).toBe(0);
    // nezávislá kontrola souboru: opravdu 0 solidů
    const c = await stepCheck(files.get("c1-plocha.step")!.data);
    expect(c.solids).toBe(0);
    expect(stepCheckProblems(c)[0]).toMatch(/^no solid/);
    expect(greenThenRed(r.entries)).toEqual([]);
  });

  it("C2 uzavřená skořepina (nález z 3. 11.): ✗ out.no-solid s „uzavřených 1“, F check=fail, stav „objem –“", { timeout: 180_000 }, async () => {
    const { r, text, files } = await full(`${C2}\nexport step c2-skorepina`);
    expect(text).toMatch(/^✗ L9 out\.no-solid "Deska A": kontrola STEP: soubor neobsahuje objemové těleso \(těles 0, volných skořepin 1 \(uzavřených 1\), volných ploch 0\) – objem ani hmotnost z ploch nejsou; plochy uzavřete do tělesa \(Plochy → Uzavřít do tělesa, prvek surf\.close\)/m);
    expect(text).not.toMatch(/věrná kopie/);
    expect(r.files[0]).toMatchObject({ name: "c2-skorepina.step", check: { ok: false } });
    const c = await stepCheck(files.get("c2-skorepina.step")!.data);
    expect(c).toMatchObject({ solids: 0, shells: 1, closedShells: 1, freeShells: 1 });
  });

  it("C3 kvádr + volná plocha: objem jen z tělesa (24 cm³, ne 29,14), ⚠ out.free-surfaces, ne věrná kopie", { timeout: 180_000 }, async () => {
    const { r, text, files } = await full(`${C3}\nstav\nměřit těleso\nexport step c3`);
    expect(text).toMatch(/= L5 status "Deska B" part feat=3\/0\/0 V=24cm3 m=0\.188kg bbox=60x60x20 solids=1 valid=1 free=1/);
    expect(text).toMatch(/Geometrie: platná · 1 těleso · ploch mimo tělesa 1 \(objem jen z těles\)/);
    expect(text).toMatch(/objem 24[\s  ]?000(,0+)? mm³ \(24(,0+)? cm³\)/); // měřit těleso – jen těleso
    expect(text).toMatch(/^⚠ L7 out\.free-surfaces "Deska B": kontrola STEP: soubor obsahuje vedle těles \(1\) i plochy mimo tělesa \(volných skořepin 1, volných ploch 0\)/m);
    expect(text).not.toMatch(/věrná kopie/);
    expect(r.docs[0].volume_mm3).toBeCloseTo(24000, 3);
    expect(r.docs[0].mass_kg).toBeCloseTo(0.1884, 4);
    const c = await stepCheck(files.get("c3.step")!.data);
    expect(c.volumeSolids).toBeCloseTo(24000, 1);
    expect(stepCheckProblems(c)).toEqual(["free shells 1, free faces 0"]);
  });

  it("C4 forma s kanálem po spline (oprava 4. 11.): platné těleso, ✓ věrná kopie, nezávislá kontrola čistá", { timeout: 180_000 }, async () => {
    const { r, text, files } = await full(`${C4}\nexport step c4-forma`);
    expect(text).toMatch(/^✓ L5 kontrola STEP: soubor znovu načten jádrem – těles: 1, objem 476[\s ]356 mm³ .* → věrná kopie modelu$/m);
    expect(r.entries.filter((e) => e.level === "error" || e.level === "warn")).toEqual([]);
    const c = await stepCheck(files.get("c4-forma.step")!.data);
    expect(stepCheckProblems(c, { solids: 1 })).toEqual([]);
    expect(c.volumeSolids).toBeCloseTo(476356.381, 0);
  });

  it("STL a „bez kontroly“: model bez tělesa = ✗ out.no-solid (bez zpětného čtení), STL tělesa bez hlášky", { timeout: 180_000 }, async () => {
    const a = await full(`${C2}\nexport stl\nexport step bez kontroly`);
    expect(a.text).toMatch(/^✗ L9 out\.no-solid "Deska A": STL: model nemá objemové těleso \(těles 0, ploch mimo tělesa 6\)/m);
    expect(a.text).toMatch(/^✗ L10 out\.no-solid "Deska A": STEP: model nemá objemové těleso/m);
    expect(a.r.files.map((f) => f.check?.ok)).toEqual([false, false]);
    const b = await full("nový díl Kostka\nkvádr 10 10 10\nexport stl");
    expect(b.r.entries.filter((e) => e.code === "out.no-solid" || e.code === "out.free-surfaces")).toEqual([]);
  });

  it("--formats step (CLI): normálně ✗ out.no-solid, F check=fail, JSON ok:false a docs[0].solids=0; --strict = STOP, nic se nezapíše", { timeout: 180_000 }, async () => {
    const n = await cliRun(C2, {});
    expect(n.r.ok).toBe(false);
    expect(n.r.counts.errors).toBe(1);
    expect(n.r.protocol).toMatch(/^MNCAD\/1 FAIL /);
    expect(n.r.protocol).toMatch(/^✗ L- out\.no-solid "Deska A": kontrola STEP: soubor neobsahuje objemové těleso/m);
    expect(n.r.protocol).toMatch(/^F step "Deska A\.step" \d+B check=fail/m);
    expect(n.r.protocol).toMatch(/^D "Deska A" part feat=7\/0\/0 V=- m=- bbox=40x30x20 solids=0 valid=1 free=6$/m);
    expect(n.r.protocol).toMatch(/^Σ docs=1 V=- m=- /m);
    expect(n.r.docs[0]).toMatchObject({ solids: 0, free: 6 });
    expect(n.r.docs[0].volume_mm3).toBeUndefined();
    expect(n.r.files[0].check).toMatchObject({ ok: false });
    expect(JSON.stringify(n.r)).not.toMatch(/věrná kopie/);
    const s = await cliRun(C2, { strict: true });
    expect(s.rb.stopped).toEqual({ line: null, code: "out.no-solid" });
    expect(s.files.size).toBe(0);
    expect(s.r.protocol).toMatch(/^MNCAD\/1 STOP /);
    expect(s.r.protocol).toMatch(/stop=L-:out\.no-solid/);
    // C4 platné těleso: přísně projde, F check=ok
    const ok = await cliRun(C4, { strict: true });
    expect(ok.rb.stopped).toBeUndefined();
    // za check= smějí být jen přídavná pole key=value jiných balíků (D2 rev=r·…; pravidlo řádků D/F: jen připojovat na konec)
    expect(ok.r.protocol).toMatch(/^F step "Deska C\.step" \d+B check=ok(?: [a-z.]+=\S+)*$/m);
    expect(stepCheckProblems(await stepCheck(ok.files.get("Deska C.step")!.data), { solids: 1 })).toEqual([]);
  });
});

describe("22c: sestava – jména komponent, nezávislá kontrola STEP sestavy", () => {
  it("sestava s dílem bez tělesa: ⚠ out.free-surfaces se jménem komponenty; sestava těles: ✓ a nezávislá kontrola čistá", { timeout: 240_000 }, async () => {
    const mix = await full(`${C2}\nnový díl "Deska D"\nkvádr 40 30 10\nnová sestava "Sestava S"\nvložit "Deska D" ukotvit\nvložit "Deska A" v 0 0 50\nexport step sestava-smes`);
    expect(mix.text).toMatch(/out\.free-surfaces "Sestava S": kontrola STEP: soubor obsahuje vedle těles \(1\) i plochy mimo tělesa .* – komponenty bez tělesa: Deska A/);
    expect(mix.text).not.toMatch(/věrná kopie/);
    const c0 = await stepCheck(mix.files.get("sestava-smes.step")!.data);
    expect(c0.solids).toBe(1);
    expect(c0.freeShells).toBe(1);
    const good = await full('nový díl "Deska"\nkvádr 80 60 10\nnový díl "Čep"\nválec 10 30\nnová sestava "Uložení"\nvložit "Deska" ukotvit\nvložit "Čep" v 100 0 0\nvložit "Čep" v 150 0 0\nexport step ulozeni');
    expect(good.text).toMatch(/^✓ L9 kontrola STEP: soubor znovu načten jádrem – těles: 3, .* → věrná kopie modelu$/m);
    const c = await stepCheck(good.files.get("ulozeni.step")!.data);
    expect(stepCheckProblems(c, { solids: 3 })).toEqual([]);
  });
});
