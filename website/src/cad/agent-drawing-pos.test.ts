/**
 * Vlna 22, body 17 a 22j – textové příkazy (čistý rozbor, CS / EN / DE) a pojmenované šablony hlavičky bez jádra:
 * - `výkres pozice …` (přehled, přiřazení pohledu, zámek), `výkres vygenerované zamknout pos:7 [x y odshora]`,
 *   `výkres kusovník nad|sloupce|auto|list`; `výkres pozice ano|ne` zůstává volbou listu;
 * - `výkres hlavička uložit|použít|smazat`, `výkres razítko šablona="Název"` (pojmenovaná šablona má přednost), výchozí
 *   šablona z Nastavení na novém listu, kopie šablony v dokumentu (jde do .mncad, sdílení a skriptu).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { parseAgentText } from "./agent";
import { applyDrawingCmd, type DrawingCompute } from "./drawing-agent";
import { setLang } from "./i18n";
import { loadSettings, saveSettings } from "./settings";
import { applyTemplate, findTemplate, templateFromMeta, type TitleTemplateRec } from "./title-templates";
import type { CadDoc } from "./types";

const cmdOf = (line: string) => {
  const pr = parseAgentText(line);
  expect(pr.errors, line).toEqual([]);
  return (pr.ops[0] as { k: string; cmd: Record<string, unknown> }).cmd;
};
const errOf = (line: string) => parseAgentText(line).errors.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join(" ");
const noCompute: DrawingCompute = async () => {
  throw new Error("výpočet listu tu není potřeba");
};
const part = (): CadDoc => ({ id: "d", name: "Deska A", kind: "part", features: [], material: "ocel" }) as unknown as CadDoc;
const LOGO = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("výkres pozice / kusovník / vygenerované zamknout (bod 17) – rozbor", () => {
  beforeEach(() => setLang("cs"));
  it("CS", () => {
    expect(cmdOf("výkres pozice")).toEqual({ k: "views", cmd: { op: "pos", act: "list" } });
    expect(cmdOf("výkres pozice pohled horní 1-12,15")).toEqual({ k: "views", cmd: { op: "pos", act: "view", view: "top", positions: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15] } });
    expect(cmdOf("výkres pozice pohled auto")).toEqual({ k: "views", cmd: { op: "pos", act: "view", view: "auto", positions: "all" } });
    expect(cmdOf("výkres pozice zamknout 7 8")).toEqual({ k: "views", cmd: { op: "pos", act: "lock", positions: [7, 8] } });
    expect(cmdOf("výkres pozice odemknout vše")).toEqual({ k: "views", cmd: { op: "pos", act: "unlock", positions: "all" } });
    expect(cmdOf("výkres kusovník list")).toEqual({ k: "views", cmd: { op: "bomsheet" } });
    expect(cmdOf("výkres vygenerované zamknout pos:7")).toEqual({ k: "views", cmd: { op: "gen", act: "lock", keys: ["pos:7"] } });
    expect(cmdOf("výkres vygenerované zamknout pos:7 120 85 odshora")).toEqual({ k: "views", cmd: { op: "gen", act: "lock", keys: ["pos:7"], at: [120, 85] } });
    // volba listu zůstává
    expect(cmdOf("výkres pozice ne")).toMatchObject({ k: "set", opts: { balloons: false } });
    expect(cmdOf("výkres kusovník sloupce")).toMatchObject({ k: "set", opts: { bomTable: true, bomPlace: "columns" } });
    expect(cmdOf("výkres kusovník nad")).toMatchObject({ k: "set", opts: { bomPlace: "above" } });
    expect(errOf("výkres pozice pohled vlevonahoře 1")).toMatch(/není pohled/);
    expect(errOf("výkres vygenerované zamknout dim:front:t")).toMatch(/jen pozice/);
  });
  it("EN / DE", () => {
    setLang("en");
    expect(cmdOf("drawing balloons view top 1-3")).toEqual({ k: "views", cmd: { op: "pos", act: "view", view: "top", positions: [1, 2, 3] } });
    expect(cmdOf("drawing positions lock 4")).toEqual({ k: "views", cmd: { op: "pos", act: "lock", positions: [4] } });
    expect(cmdOf("drawing bom sheet")).toEqual({ k: "views", cmd: { op: "bomsheet" } });
    expect(cmdOf("drawing bom columns")).toMatchObject({ k: "set", opts: { bomPlace: "columns" } });
    setLang("de");
    expect(cmdOf("zeichnung positionen ansicht oben 5")).toEqual({ k: "views", cmd: { op: "pos", act: "view", view: "top", positions: [5] } });
    expect(cmdOf("zeichnung positionen sperren 5")).toEqual({ k: "views", cmd: { op: "pos", act: "lock", positions: [5] } });
    expect(cmdOf("zeichnung stückliste blatt")).toEqual({ k: "views", cmd: { op: "bomsheet" } });
  });
});

describe("šablony hlavičky s logem (bod 22j)", () => {
  beforeEach(() => {
    setLang("cs");
    saveSettings({ ...loadSettings(), titleTemplates: [], titleTemplateDefault: undefined });
  });

  it("rozbor: uložit / použít / smazat / přehled (CS, EN, DE)", () => {
    expect(cmdOf('výkres hlavička uložit "Firma" výchozí šablona=nástrojářská firma="Firma s.r.o."')).toEqual({ k: "views", cmd: { op: "tpl", act: "save", name: "Firma", setDefault: true, fields: { template: "nástrojářská", company: "Firma s.r.o." } } });
    expect(cmdOf('výkres hlavička použít "Firma"')).toEqual({ k: "views", cmd: { op: "tpl", act: "use", name: "Firma" } });
    expect(cmdOf("výkres hlavička")).toEqual({ k: "views", cmd: { op: "tpl", act: "list" } });
    setLang("en");
    expect(cmdOf('drawing title-template save "Firma" company="X"')).toMatchObject({ cmd: { op: "tpl", act: "save", name: "Firma" } });
    setLang("de");
    expect(cmdOf('zeichnung kopfvorlage löschen "Firma"')).toEqual({ k: "views", cmd: { op: "tpl", act: "delete", name: "Firma" } });
  });

  it("model: z údajů listu a zpět; logo a druh razítka; titleTpl", () => {
    const rec = templateFromMeta("Firma", { name: "Deska", material: "", company: "Firma s.r.o.", template: "toolmaker", logo: { src: LOGO, w: 1, h: 1, svg: "data:image/svg+xml;base64,PHN2Zy8+" }, number: "DA-1" });
    expect(rec).toEqual({ name: "Firma", template: "toolmaker", logo: { src: LOGO, w: 1, h: 1, svg: "data:image/svg+xml;base64,PHN2Zy8+" }, fields: { company: "Firma s.r.o." } });
    const m: Record<string, unknown> = { number: "X-1", logo: { src: "data:old" }, company: "jiná" };
    applyTemplate(m, rec);
    expect(m).toMatchObject({ number: "X-1", template: "toolmaker", company: "Firma s.r.o.", titleTpl: "Firma" });
    expect((m.logo as { svg?: string }).svg).toBeTruthy();
  });

  it("výkres hlavička uložit → dokument i Nastavení; výchozí → nový list ji převezme; použít / razítko šablona=", async () => {
    let doc = part();
    let r = await applyDrawingCmd(doc, cmdOf(`výkres razítko firma="Firma s.r.o." logo="${LOGO}" šablona=nástrojářská`) as never, noCompute);
    doc = r.doc;
    r = await applyDrawingCmd(doc, cmdOf('výkres hlavička uložit "Firma" výchozí') as never, noCompute);
    expect(r.log.join("\n")).toMatch(/✓ šablona hlavičky „Firma“/);
    doc = r.doc;
    expect(doc.titleTemplates?.map((t) => t.name)).toEqual(["Firma"]);
    expect(loadSettings().titleTemplates?.map((t) => t.name)).toEqual(["Firma"]);
    expect(loadSettings().titleTemplateDefault).toBe("Firma");
    // nový dokument: první list vezme výchozí šablonu z Nastavení a kopie šablony přejde do dokumentu
    const r2 = await applyDrawingCmd(part(), cmdOf("výkres razítko") as never, noCompute);
    const m2 = r2.doc.drawings![0].meta as Record<string, unknown>;
    expect(m2).toMatchObject({ template: "toolmaker", company: "Firma s.r.o.", titleTpl: "Firma" });
    expect((m2.logo as { src: string }).src).toBe(LOGO);
    expect(r2.doc.titleTemplates?.[0].name).toBe("Firma");
    // jiný dokument bez šablony v Nastavení: šablona jen v dokumentu (např. otevřený .mncad / sdílený odkaz)
    saveSettings({ ...loadSettings(), titleTemplates: [], titleTemplateDefault: undefined });
    let d3 = { ...part(), titleTemplates: doc.titleTemplates } as CadDoc;
    const r3 = await applyDrawingCmd(d3, cmdOf('výkres razítko šablona="Firma" číslo="DA-2"') as never, noCompute);
    d3 = r3.doc;
    expect(r3.log.join("\n")).toMatch(/šablona hlavičky „Firma“/);
    expect(d3.drawings![0].meta).toMatchObject({ template: "toolmaker", company: "Firma s.r.o.", number: "DA-2", titleTpl: "Firma" });
    expect(findTemplate(d3, "firma")?.from).toBe("doc");
    // druh razítka slovem zůstává druhem (ne pojmenovaná šablona)
    const r4 = await applyDrawingCmd(d3, cmdOf("výkres razítko šablona=kompaktní") as never, noCompute);
    expect(r4.doc.drawings![0].meta).toMatchObject({ template: "compact" });
    expect((r4.doc.drawings![0].meta as Record<string, unknown>).titleTpl).toBeUndefined();
    // smazat
    const r5 = await applyDrawingCmd(r4.doc, cmdOf('výkres hlavička smazat "Firma"') as never, noCompute);
    expect(r5.doc.titleTemplates).toBeUndefined();
    await expect(applyDrawingCmd(r5.doc, cmdOf('výkres hlavička použít "Firma"') as never, noCompute)).rejects.toThrow(/neexistuje/);
  });

  it("logo názvem souboru ze vstupů hostitele (CLI --files) bez připojeného souboru", async () => {
    const png = Uint8Array.from(atob(LOGO.split(",")[1]), (c) => c.charCodeAt(0));
    const input = async (n: string) => (n === "logo.png" ? { name: "logo.png", bytes: png } : null);
    const r = await applyDrawingCmd(part(), cmdOf('výkres razítko logo="logo.png"') as never, noCompute, { input });
    expect(r.log.join("\n")).toMatch(/logo „logo\.png“/);
    expect(((r.doc.drawings![0].meta as Record<string, unknown>).logo as { name: string }).name).toBe("logo.png");
    await expect(applyDrawingCmd(part(), cmdOf('výkres razítko logo="chybí.png"') as never, noCompute, { input })).rejects.toThrow(/není připojený/);
  });

  it("šablona z polí (bez listu) – logo SVG se uloží jako vektor", async () => {
    const svg = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="40" height="40" fill="#e03930"/></svg>');
    const r = await applyDrawingCmd(part(), cmdOf(`výkres hlavička uložit "Vektor" logo="${svg}" firma="F"`) as never, noCompute);
    const rec = r.doc.titleTemplates![0] as TitleTemplateRec;
    expect(rec.logo?.svg).toMatch(/^data:image\/svg\+xml/);
    expect(rec.logo?.trace?.rects.length).toBeGreaterThan(0);
    expect(rec.fields).toEqual({ company: "F" });
  });
});
