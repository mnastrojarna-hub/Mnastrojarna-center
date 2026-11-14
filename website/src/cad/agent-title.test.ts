/**
 * Razítko textem (w15, zpráva 959 kap. 5.4): `výkres razítko pole=hodnota` česky / anglicky / německy, šablona, logo
 * z připojeného souboru i z data URL, nepředepsané tolerance, stav razítka v protokolu, nový list a export bez
 * nepředepsaných tolerancí (⚠). Bez jádra – výkres počítá drawing-fixture.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import type { DrawingCmd } from "./agent-drawing";
import { titleFieldOf } from "./agent-title";
import { attachedFiles } from "./attached-files";
import type { DrawingMeta } from "./drawing";
import { activeSheet, applyDrawingCmd, drawingStatus } from "./drawing-agent";
import { exportDrawing, generalTolWarnings } from "./drawing-export";
import { fixtureCompute, plateDoc } from "./drawing-fixture";
import { setLang } from "./i18n";
import { encodePng, toDataUrl } from "./title-logo";
import type { CadDoc } from "./types";

const P = (text: string): DrawingCmd => {
  const p = parseAgentText(text);
  expect(p.errors, JSON.stringify(p.errors)).toEqual([]);
  const op = p.ops[0];
  if (op.k !== "drawingCmd") throw new Error(`není příkaz výkresu: ${text}`);
  return op.cmd;
};
async function run(doc: CadDoc, text: string) {
  let d = doc;
  const log: string[] = [];
  for (const line of text.split("\n").filter((l) => l.trim())) {
    const r = await applyDrawingCmd(d, P(line), fixtureCompute);
    d = r.doc;
    log.push(...r.log);
  }
  return { doc: d, log: log.join("\n") };
}
const meta = (d: CadDoc, i = 0) => d.drawings![i].meta as Partial<DrawingMeta>;
/** logo 60 × 20 px: červený pruh na bílém */
async function logoUrl() {
  const w = 60;
  const h = 20;
  const rgba = new Uint8Array(w * h * 4).fill(255);
  for (let y = 4; y < 16; y++) for (let x = 5; x < 55; x++) rgba.set([224, 57, 48, 255], (y * w + x) * 4);
  return toDataUrl("image/png", await encodePng({ w, h, rgba }));
}

beforeEach(() => {
  activeSheet.set(null, false);
  attachedFiles.clear();
  setLang("cs");
});

describe("výkres razítko – nová pole česky, anglicky, německy", () => {
  it("parser: klíče cs / en / de (bez diakritiky, s pomlčkou i podtržítkem)", () => {
    const cs = P('výkres razítko kontroloval="Ing. K" schválil="Ing. S" zákazník="ACME" projekt="123" polotovar="plech 40×160×185" počet=4 tepelné="kalit 58 HRC" povrch="černit" úhly="±0°30′" sražení="±0,2" firma="Mnástrojárna" šablona=nástrojářská');
    expect(cs).toEqual({ k: "title", fields: { checkedBy: "Ing. K", approvedBy: "Ing. S", customer: "ACME", project: "123", stock: "plech 40×160×185", quantity: "4", heatTreatment: "kalit 58 HRC", surfaceTreatment: "černit", angleTol: "±0°30′", chamferTol: "±0,2", company: "Mnástrojárna", template: "nástrojářská" } });
    expect(P('drawing titleblock checked="A" approved="B" customer="C" project="D" stock="E" quantity=2 heat="F" surface="G" angles="H" chamfers="I" company="J" template=toolmaker')).toMatchObject({ fields: { checkedBy: "A", approvedBy: "B", customer: "C", project: "D", stock: "E", quantity: "2", heatTreatment: "F", surfaceTreatment: "G", angleTol: "H", chamferTol: "I", company: "J", template: "toolmaker" } });
    expect(P('zeichnung schriftfeld geprüft="A" genehmigt="B" kunde="C" projekt="D" rohteil="E" menge=2 wärmebehandlung="F" oberflächenbehandlung="G" winkel="H" fasen="I" firma="J" vorlage=werkzeugbau')).toMatchObject({ fields: { checkedBy: "A", approvedBy: "B", customer: "C", project: "D", stock: "E", quantity: "2", heatTreatment: "F", surfaceTreatment: "G", angleTol: "H", chamferTol: "I", company: "J", template: "werkzeugbau" } });
    expect(["tepelné-zpracování", "povrchová_úprava", "počet-kusů", "tolerance-úhlů", "tolerance_sražení"].map(titleFieldOf)).toEqual(["heatTreatment", "surfaceTreatment", "quantity", "angleTol", "chamferTol"]);
    // neznámé pole: chyba s celou nápovědou (dřív bez nových polí)
    const p = parseAgentText("výkres razítko barva=červená");
    expect(p.errors[0].message).toMatch(/výkres razítko název=.*kontroloval=.*šablona=iso7200\|kompaktní\|nástrojářská.* – neznámé „barva=“/);
  });
  it("provedení: pole do listu, šablona, protokol ✓ a stav razítka (šablona, promítání, pole, tolerance, zalomení)", async () => {
    const { doc, log } = await run(plateDoc(), 'výkres razítko kreslil="Claude dle Vojtěchova zadání" kontroloval="Ing. Kontrolor" schválil="Ing. Schvalovatel" zákazník="ACME a.s." polotovar="Ø14×20" počet=4 šablona=nástrojářská');
    expect(meta(doc)).toMatchObject({ author: "Claude dle Vojtěchova zadání", checkedBy: "Ing. Kontrolor", approvedBy: "Ing. Schvalovatel", customer: "ACME a.s.", stock: "Ø14×20", quantity: "4", template: "toolmaker" });
    expect(log).toMatch(/✓ razítko: kreslil „Claude dle Vojtěchova zadání“, kontroloval „Ing\. Kontrolor“, schválil „Ing\. Schvalovatel“, zákazník „ACME a\.s\.“, polotovar „Ø14×20“, počet kusů „4“, šablona nástrojářská \(všechna pole\) \(180×64 mm\)/);
    const st = (await run(doc, "výkres razítko")).log;
    expect(st).toMatch(/Razítko: název Deska · číslo — · kreslil Claude dle Vojtěchova zadání/);
    expect(st).toMatch(/Šablona razítka: nástrojářská \(všechna pole\) 180×64 mm · promítání ISO E – značka ISO 5456-2 \(1\. kvadrant, kružnice vpravo\)/);
    expect(st).toMatch(/Další pole razítka: zákazník „ACME a\.s\.“ · kontroloval „Ing\. Kontrolor“ · schválil „Ing\. Schvalovatel“ · polotovar „Ø14×20“ · počet kusů „4“/);
    expect(st).toMatch(/Nepředepsané tolerance: nezadané – export výkresu dílu je ohlásí/);
    expect(st).not.toMatch(/⚠/);
    expect(st).toMatch(/Razítko bez zkracování textu: .*Kreslil (písmo|\d řádky) [\d,]+ mm/);
    // šablona ISO 7200: pole mimo šablonu jsou v patičce
    const iso = (await run(doc, "výkres razítko šablona=iso7200\nvýkres razítko")).log;
    expect(meta((await run(doc, "výkres razítko šablona=výchozí")).doc).template).toBeUndefined();
    expect(iso).toMatch(/zákazník „ACME a\.s\.“ \(v patičce\)/);
    await expect(run(doc, "výkres razítko šablona=velká")).rejects.toThrow(/šablona razítka „velká“ neexistuje – iso7200 \(výchozí\), kompaktní, nástrojářská/);
  });
  it("stav výkresu (výkres stav) obsahuje řádky razítka i v angličtině", async () => {
    const { doc } = await run(plateDoc(), 'výkres razítko zákazník="ACME"');
    expect((await drawingStatus(doc, fixtureCompute)).text).toMatch(/Šablona razítka: ISO 7200 \(výchozí\) 180×38 mm/);
    setLang("en");
    expect((await drawingStatus(doc, fixtureCompute)).text).toMatch(/Title block template: ISO 7200 \(default\) 180×38 mm · projection ISO E – ISO 5456-2 symbol \(first angle, circles on the right\)/);
  });
});

describe("logo: připojený soubor nebo data URL", () => {
  it("logo=\"firma.png\" z připojeného souboru; logo=data URL; logo=ne", async () => {
    const url = await logoUrl();
    await expect(run(plateDoc(), 'výkres razítko logo="firma.png"')).rejects.toThrow(/logo „firma\.png“: soubor není připojený – připojte ho v konzoli tlačítkem „Připojit soubor…“.*připojené: —/);
    attachedFiles.add({ name: "C:\\loga\\firma.png", mime: "image/png", dataUrl: url, bytes: 300 });
    let { doc, log } = await run(plateDoc(), 'výkres razítko logo="firma"');
    expect(log).toMatch(/✓ razítko: logo „firma\.png“ 60×20 px, obrys pro DXF\/DWG \d+ ploch/);
    expect(meta(doc).logo).toMatchObject({ name: "firma.png", w: 60, h: 20, src: url });
    expect((await run(doc, "výkres razítko")).log).toMatch(/logo „firma\.png“ 60×20 px/);
    ({ doc, log } = await run(doc, `výkres razítko logo=${url}`));
    expect(log).toMatch(/✓ razítko: logo „data URL“ 60×20 px/);
    ({ doc, log } = await run(doc, "výkres razítko logo=ne"));
    expect(meta(doc).logo).toBeUndefined();
    expect(log).toMatch(/✓ razítko: logo odstraněno/);
    await expect(run(doc, "výkres razítko logo=data:text/plain;base64,QUJD")).rejects.toThrow(/neznámý formát obrázku/);
  });
  it("logo je v SVG jako obrázek a v DXF jako plošky SOLID (export textem)", async () => {
    attachedFiles.add({ name: "firma.png", mime: "image/png", dataUrl: await logoUrl(), bytes: 300 });
    const { doc } = await run(plateDoc(), 'výkres razítko logo="firma.png" firma="ACME"\nvýkres nepředepsané mK');
    // fixtureCompute razítko nekreslí – export z jádra ověřuje drawing-titleblock.test.ts; zde stačí data listu
    expect(meta(doc).logo?.trace?.rects.length).toBeGreaterThan(0);
    const r = await exportDrawing(doc, "svg", {}, fixtureCompute);
    expect(r.warnings ?? []).toEqual([]);
  });
});

describe("nepředepsané tolerance textem a ⚠ při exportu", () => {
  it("výkres nepředepsané mK / f H / desetinná / ne", async () => {
    let { doc, log } = await run(plateDoc(), "výkres nepředepsané mK");
    expect(meta(doc).tolerance).toBe("ISO 2768-mK");
    expect(log).toMatch(/✓ nepředepsané tolerance ISO 2768-mK$/);
    ({ doc, log } = await run(doc, "výkres nepředepsané desetinná"));
    expect(meta(doc)).toMatchObject({ tolerance: "X. ±0,1 / X.X ±0,1 / X.XX ±0,01 / X.XXX ±0,005", tolTable: ["±0,1", "±0,1", "±0,01", "±0,005"] });
    ({ doc } = await run(doc, "drawing general f H"));
    expect(meta(doc).tolerance).toBe("ISO 2768-fH");
    expect(meta(doc).tolTable).toBeUndefined();
    ({ doc } = await run(doc, 'výkres razítko nepředepsané="X.XX=±0,02"'));
    expect(meta(doc).tolTable).toEqual(["±0,1", "±0,1", "±0,02", "±0,005"]);
    expect((await run(doc, "výkres razítko")).log).toMatch(/Nepředepsané tolerance: tabulka podle desetinných míst: X\. ±0,1 \/ X\.X ±0,1 \/ X\.XX ±0,02 \/ X\.XXX ±0,005/);
    ({ doc, log } = await run(doc, "výkres nepředepsané ne"));
    expect(meta(doc).tolerance).toBe("");
    expect(log).toMatch(/✓ nepředepsané tolerance zrušeny – export výkresu dílu to ohlásí ⚠/);
    // dosavadní zápis zůstává: ISO 2768-mK jako text
    ({ doc } = await run(doc, "výkres nepředepsané ISO 2768-mK"));
    expect(meta(doc).tolerance).toBe("ISO 2768-mK");
  });
  it("export dílu bez nepředepsaných tolerancí → varování (i u více listů s jejich názvy); s nimi a u sestavy bez varování", async () => {
    let { doc } = await run(plateDoc(), "výkres A3");
    const r = await exportDrawing(doc, "svg", {}, fixtureCompute);
    expect(r.warnings).toEqual([expect.stringMatching(/^Výkres nemá nepředepsané tolerance – zadejte je: výkres nepředepsané ISO 2768-mK/)]);
    ({ doc } = await run(doc, 'výkres nepředepsané mK\nvýkres list nový "Detail"\nvýkres nepředepsané ne'));
    const all = await exportDrawing(doc, "svg", { sheet: "all" }, fixtureCompute);
    expect(all.warnings?.some((w) => /^Výkres nemá nepředepsané tolerance \(listy: „Detail“\)/.test(w))).toBe(true);
    ({ doc } = await run(doc, "výkres nepředepsané desetinná"));
    expect((await exportDrawing(doc, "svg", {}, fixtureCompute)).warnings ?? []).toEqual([]);
    expect(generalTolWarnings({ ...doc, kind: "assembly" }, [{ name: "L", meta: { name: "S", material: "" } }])).toEqual([]);
  });
  it("nový list převezme šablonu, logo, zákazníka i nepředepsané tolerance", async () => {
    attachedFiles.add({ name: "firma.png", mime: "image/png", dataUrl: await logoUrl(), bytes: 300 });
    const { doc } = await run(plateDoc(), 'výkres razítko šablona=kompaktní logo="firma.png" zákazník="ACME" schválil="S"\nvýkres nepředepsané desetinná\nvýkres list nový "Detail"');
    expect(meta(doc, 1)).toMatchObject({ template: "compact", customer: "ACME", approvedBy: "S", tolTable: ["±0,1", "±0,1", "±0,01", "±0,005"] });
    expect(meta(doc, 1).logo?.name).toBe("firma.png");
  });
});
