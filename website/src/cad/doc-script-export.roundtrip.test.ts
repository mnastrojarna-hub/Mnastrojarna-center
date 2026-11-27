/**
 * Kontrola tam a zpět převodníku dokument → skript pro vše, co agent umí napsat textem (vlna E, balík export): dokument
 * se postaví textem v enginu (stejná smyčka operací jako konzole prohlížeče i `mncad run`, skutečné jádro v procesu),
 * převede se `scriptOfDocWith` (jádro hostitele – jako `export skript` a `window.mncad.script()`), skript se spustí v novém
 * pracovním prostoru a dokumenty se porovnají: volby a údaje listů (razítko, revize, funkční kóty, díry, pohledy navíc,
 * detaily, řezy, přerušení, uložení, upravené vygenerované kóty), komponenty s přezdívkami, pružiny, vazby, pohyb.
 * Co skript nepřenese, musí říct poznámka (ℹ v protokolu `export skript`) i komentář ve skriptu.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setHostAssets } from "./host-assets";
import { makeKernelClient } from "./kernel-client";
import { memoryFileSink, memoryFileSource, type EngineHost } from "./engine/host";
import { MemoryWorkspace } from "./engine/memory-workspace";
import { formatConsole, formatShort } from "./engine/protocol";
import { runScript } from "./engine/run";
import { docToScript, type ScriptLang } from "./doc-script";
import { scriptOfDocWith } from "./doc-script-fresh";
import { SCRIPT_DEFAULT_VIEWS, SCRIPT_INHERITED_TITLE, SCRIPT_SHEETS } from "./doc-script-sheet";
import { SCRIPT_DEFAULT_DT } from "./doc-script-asm";
import { sheetMeta, sheetOptions } from "./drawing-agent";
import { drawExtras } from "./engine/asm-status";
import { encodePng, toDataUrl } from "./title-logo";
import { getLang, setLang } from "./i18n";
import type { CadDoc } from "./types";

const WASM = path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm");
const FONTS = path.resolve(__dirname, "../../public/fonts");
type Rec = Record<string, unknown>;

/** čísla na 1e-6 (umístění na listu se převádí přes výšku listu), −0 = 0 */
const round = (v: unknown): unknown => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "number" ? Math.round(x * 1e6) / 1e6 + 0 : x))));
/** list v porovnatelném tvaru: volby bez vnitřních (otisk Chytrých kót, místo pro kóty po pohledech), bez id položek, model jako pořadí komponenty */
function sheetCanon(d: CadDoc, i = 0): Rec {
  const s = d.drawings![i];
  const o = { ...(s.options as Rec) };
  for (const k of ["smartGen", "dimPads", "breakScale"]) delete o[k];
  // `kótovat chytře` při přečtení zapíše prázdný seznam smazaných kót – stejné jako žádný
  if (Array.isArray(o.smartOff) && !o.smartOff.length) delete o.smartOff;
  for (const k of ["aux", "cuts", "details", "brokenOut", "breaks", "models"])
    if (Array.isArray(o[k]))
      o[k] = (o[k] as Rec[]).map((x) => {
        const { id: _id, ...rest } = x;
        void _id;
        const src = rest.source as { kind?: string; compId?: string } | undefined;
        if (src?.kind === "component") rest.source = { kind: "component", comp: (d.components ?? []).findIndex((c) => c.id === src.compId) };
        return rest;
      });
  const m = { ...(s.meta as Rec) };
  // prázdné pole razítka = pole bez hodnoty (vyprázdněné `zákazník=""` × nikdy nezadané)
  for (const k of Object.keys(m)) if (m[k] === "") delete m[k];
  // razítko původu (vlna 23 – agent × člověk) není obsah listu; skript ho nenese, textová cesta ho dá znovu
  delete m.by;
  delete m.noteBy;
  if (Array.isArray(m.revisions)) m.revisions = (m.revisions as Rec[]).map(({ by: _b, ...r }) => (void _b, r));
  const logo = m.logo as Rec | undefined;
  if (logo) m.logo = { w: logo.w, h: logo.h, name: logo.name, trace: logo.trace };
  return round({ name: s.name, options: o, meta: m }) as Rec;
}
/** vygenerované kóty listu (klíč popisu díry nese id prvku – po přečtení má prvek nové id) */
const autoAnns = (d: CadDoc, i = 0) => (d.drawings?.[i]?.annotations ?? []).filter((a) => a.auto).map((a) => `${a.type}:${a.auto!.replace(/^hole:.*/, "hole")}`);
const docNamed = (ws: MemoryWorkspace, name: string) => ws.listDocs().find((x) => x.title === name)?.doc;
/** popisové údaje dokumentu (prázdný = nezadaný) */
const propsCanon = (d: CadDoc) => Object.fromEntries(Object.entries(d.props ?? {}).filter(([, v]) => v));

describe("export skript: vše, co agent píše textem, tam a zpět (vlna E)", async () => {
  const lang0 = getLang();
  setHostAssets({ font: async (name) => new Uint8Array(fs.readFileSync(path.join(FONTS, name))).buffer });
  const { inProcessTransport } = await import("./kernel-inprocess");
  const kernel = makeKernelClient(inProcessTransport({ locateFile: (file) => (file.endsWith(".wasm") ? WASM : file) }));
  await kernel.init();
  const host = () => ({ kernel, files: memoryFileSink(), inputs: memoryFileSource({}), now: () => Date.now() }) satisfies EngineHost;
  const run = async (text: string, lang: ScriptLang = "cs", ws = new MemoryWorkspace()) => {
    setLang(lang);
    try {
      const h = host();
      const r = await runScript(ws, text, h, { lang });
      const con = formatConsole(r);
      return { ws, r, con, h, errors: con.split("\n").filter((l) => /^\s*✗/.test(l)) };
    } finally {
      setLang(lang0);
    }
  };
  /** jádro pro převod jako u `export skript` (engine/ops/out.ts): doplňky razítka (kusovník a pozice sestavy) z postavených dílů prostoru */
  const kOf = (ws: MemoryWorkspace) => ({
    pickSigs: (b: CadDoc, f: CadDoc["features"][number]) => kernel.pickSigs(b, f),
    drawing: (doc: CadDoc, meta: Parameters<typeof kernel.drawing>[1], o: Parameters<typeof kernel.drawing>[2]) => kernel.drawing(doc, meta, o),
    extras: (doc: CadDoc) => drawExtras(ws, kernel, doc),
  });
  /** skript bez poznámek „# ℹ“ (co první export vynechal, druhý už nemá) */
  const body = (t: string) => t.replace(/^# ℹ.*\n/gm, "");
  /** postaví dokument textem, převede na skript (jazyk `lang`) a skript spustí znovu */
  async function roundTrip(text: string, name: string, lang: ScriptLang = "cs") {
    const a = await run(text);
    expect(a.errors, "stavba bez ✗").toEqual([]);
    const orig = JSON.parse(JSON.stringify(docNamed(a.ws, name))) as CadDoc;
    expect(orig, name).toBeTruthy();
    const script = await scriptOfDocWith(kOf(a.ws), orig, { lang });
    const b = await run(script.text, lang);
    expect(b.errors, `přečtení skriptu bez ✗\n${script.text}`).toEqual([]);
    const rt = docNamed(b.ws, name)!;
    expect(rt, name).toBeTruthy();
    /** druhý export (dokument po přečtení skriptu) dá stejný skript */
    const sameAgain = async () => expect(body((await scriptOfDocWith(kOf(b.ws), JSON.parse(JSON.stringify(rt)) as CadDoc, { lang })).text)).toBe(body(script.text));
    return { orig, rt, script, built: a, replay: b, sameAgain };
  }

  const PART = `nový díl "Deska"
kvádr 120 80 20
díra 8 skrz v 20 20 20
díra 8 skrz v 100 60 20`;

  it("razítko: šablona, všechna pole, nepředepsané tolerance podle desetinných míst, tabulka revizí a skryté trojúhelníky", async () => {
    const { orig, rt, script } = await roundTrip(
      `${PART}
výkres A3 pohledy přední,horní
výkres razítko šablona=nástrojářská číslo="NS-100" kreslil="JN" kontroloval="KP" schválil="MV" zákazník="Zákazník A" projekt="P-1" firma="Firma s.r.o." polotovar="Plech 20" počet="4 ks" tepelné="kalit 58 HRC" povrch="černit" úhly="±0,5°" sražení="±0,2" hrany="ISO 13715 -0,3" poznámka="Viz model"
výkres nepředepsané desetinná ±0,2 ±0,1 ±0,02 ±0,01
výkres revize A "první vydání" datum 1.11.2026 kreslil "JN"
výkres revize B "díra 8" datum 5.11.2026
výkres revize A značky ne`,
      "Deska",
    );
    expect(script.text).toMatch(/^výkres razítko šablona=nástrojářská .*zákazník="Zákazník A"/m);
    expect(script.text).toMatch(/^výkres revize A "první vydání" datum="1.11.2026" kreslil="JN"$/m);
    expect(script.text).toMatch(/^výkres revize A značky ne$/m);
    const m = orig.drawings![0].meta as Rec;
    expect(m.template).toBe("toolmaker");
    expect(m.tolTable).toEqual(["±0,2", "±0,1", "±0,02", "±0,01"]);
    expect(sheetCanon(rt)).toEqual(sheetCanon(orig));
    expect(script.notes.filter((n) => !/vygenerované kóty výkresů/.test(n))).toEqual([]);
  }, 300_000);

  it("logo razítka: data URL PNG (zmenšení a obrys pro DXF / DWG spočítá aplikace znovu – stejný obrázek)", async () => {
    const w = 48;
    const h = 16;
    const rgba = new Uint8Array(w * h * 4).fill(255);
    for (let y = 4; y < 12; y++) for (let x = 6; x < 42; x++) rgba.set([224, 57, 48, 255], (y * w + x) * 4);
    const src = toDataUrl("image/png", await encodePng({ w, h, rgba }));
    const { orig, rt, script } = await roundTrip(`${PART}\nvýkres A3 pohledy přední\nvýkres razítko logo="${src}"`, "Deska");
    expect((orig.drawings![0].meta as { logo?: { w: number } }).logo?.w).toBe(48);
    expect(script.text).toContain('výkres razítko logo="data:image/png;base64,');
    expect(sheetCanon(rt)).toEqual(sheetCanon(orig));
  }, 300_000);

  it("Chytré kóty: funkční rozměry a polohy děr (souřadnicově / tabulkou), pružiny na výkrese plně", async () => {
    for (const holes of ["souřadnicově", "tabulka"]) {
      const { orig, rt, script } = await roundTrip(`${PART}\nvýkres A3 pohledy přední,horní pružiny plně\nkótovat chytře funkční 80 120 díry ${holes}`, "Deska");
      const o = orig.drawings![0].options as Rec;
      expect(o.dimFunctional).toEqual([80, 120]);
      expect(o.springs).toBe("full");
      expect(script.text).toMatch(new RegExp(`^kótovat chytře funkční 80 120 díry ${holes}$`, "m"));
      expect(sheetCanon(rt)).toEqual(sheetCanon(orig));
      expect(autoAnns(rt)).toEqual(autoAnns(orig));
    }
  }, 300_000);

  it("pomocné pohledy, řezy lomenou čarou a detaily: stejná písmena, umístění na pevném listu (i na výšku)", async () => {
    for (const fmt of ["A2", "A2 na výšku"]) {
      const head = `${PART}
výkres ${fmt} pohledy přední,horní,levý
výkres detail přední v 20 10 poloměr 8 měřítko 2:1 umístit 60 60
výkres pohled pomocný přední hrana 0 0 120 20 podél otočit umístit 300 90
výkres řez zalomený horní body 0 -20 60 -20 60 -60 120 -60 umístit 300 250
výkres pohled pomocný směr 1 1 0
výkres řez natočený horní body 0 -40 60 -40 100 -70`;
      // středy detailů v pomocném pohledu D a v řezu E: středy pohledů na listu (souřadnice pohledu y nahoru)
      const pre = await run(head);
      expect(pre.errors).toEqual([]);
      const d0 = docNamed(pre.ws, "Deska")!;
      const res = await kernel.drawing(d0, sheetMeta(d0, d0.drawings![0], 0), sheetOptions(d0.drawings![0]));
      const mid = (key: string) => {
        const v = res.views.find((x) => x.key === key)!;
        return `${Math.round(v.x0 + v.w / 2)} ${-Math.round(v.y0 + v.h / 2) || 0}`;
      };
      const { orig, rt, script } = await roundTrip(`${head}
výkres detail pomocný D v ${mid("aux:D")} poloměr 6 měřítko 1:1
výkres detail řez E v ${mid("cut:E")} poloměr 6 měřítko 2:1`, "Deska");
      const o = orig.drawings![0].options as { aux: { label: string }[]; cuts: { label: string }[]; details: { label: string }[] };
      expect([o.aux.map((x) => x.label), o.cuts.map((x) => x.label), o.details.map((x) => x.label)]).toEqual([["B", "D"], ["C", "E"], ["A", "B", "C"]]); // detaily mají vlastní řadu písmen (drawing-agent.ts)
      expect(script.text).toMatch(/^výkres detail pomocný D v -?[\d.]+ -?[\d.]+ poloměr 6 měřítko 1:1$/m);
      expect(script.text).toMatch(/^výkres detail řez E v -?[\d.]+ -?[\d.]+ poloměr 6 měřítko 2:1$/m);
      expect(sheetCanon(rt)).toEqual(sheetCanon(orig));
      expect(script.notes.filter((n) => /písmena|umístění/.test(n))).toEqual([]);
    }
  }, 600_000);

  it("automatický formát listu: umístění od levého horního rohu (umístit x y odshora) – stejně s jádrem i bez něj", async () => {
    const { orig, rt, script } = await roundTrip(`${PART}\nvýkres pohledy přední,horní\nvýkres detail přední v 20 10 poloměr 8 měřítko 2:1 umístit 40 40`, "Deska");
    expect((orig.drawings![0].options as Rec).sheet ?? "auto").toBe("auto");
    // list A4 na šířku (210): střed 40 mm od dolního okraje = 170 mm od horního
    expect(script.text).toMatch(/^výkres detail přední v 20 10 poloměr 8 měřítko 2:1 umístit 40 170 odshora$/m);
    expect(sheetCanon(rt)).toEqual(sheetCanon(orig));
    const pure = docToScript(orig);
    expect(pure.text).toMatch(/^výkres detail přední v 20 10 poloměr 8 měřítko 2:1 umístit 40 170 odshora$/m);
    expect(pure.notes.filter((n) => /umístění/.test(n))).toEqual([]);
  }, 300_000);

  /* ───────────── kontrola balíku (nálezy 1–10): každý test bez opravy selže ───────────── */
  /** skripty zapsané příkazem `export skript` (engine – jádro hostitele, kusovník a pozice sestavy z postavených dílů) */
  const scriptFiles = (h: ReturnType<typeof host>) => [...h.files.files.values()].filter((f) => f.file.format === "script").map((f) => new TextDecoder().decode(f.data));

  it("kontrola 1: razítko dalšího listu zůstane vlastní – nepřevezme šablonu, číslo, revizi, zákazníka, polotovar, tolerance ani logo listu 1", async () => {
    const rgba = new Uint8Array(8 * 8 * 4).fill(255);
    for (let i = 0; i < 8 * 8; i += 3) rgba.set([224, 57, 48, 255], i * 4);
    const logo = toDataUrl("image/png", await encodePng({ w: 8, h: 8, rgba }));
    const { orig, rt, script, sameAgain } = await roundTrip(
      `nový díl "Dva listy"
kvádr 80 60 10
výkres A3 pohledy přední,horní
výkres list nový "Detaily"
výkres A4 pohledy iso
výkres list 1
výkres razítko šablona=nástrojářská číslo="D-7" zákazník="Zákazník G" polotovar="P 10×80×60" logo="${logo}"
výkres nepředepsané desetinná ±0,2 ±0,1 ±0,02 ±0,01
výkres revize A "první vydání" datum 3.3.2026`,
      "Dva listy",
    );
    const m2 = rt.drawings![1].meta as Rec;
    expect([m2.template, m2.number, m2.revision, m2.customer, m2.stock, m2.tolerance, m2.tolTable, m2.logo].map((v) => v || undefined)).toEqual(Array(8).fill(undefined));
    expect(sheetCanon(rt, 0)).toEqual(sheetCanon(orig, 0));
    expect(sheetCanon(rt, 1)).toEqual(sheetCanon(orig, 1));
    expect(propsCanon(rt)).toEqual({ number: "D-7" });
    expect(propsCanon(rt)).toEqual(propsCanon(orig));
    expect(script.text).toMatch(/^výkres razítko šablona=iso7200 číslo="" revize="" zákazník="" polotovar="" nepředepsané=""\nvýkres razítko logo=ne$/m);
    await sameAgain();
    // list, který razítko listu 1 převzal (vznikl až po něm), ho nese dál a skript ho nepíše dvakrát
    const inherit = await roundTrip(`nový díl "Dva listy"\nkvádr 80 60 10\nvýkres A3 pohledy přední\nvýkres razítko šablona=kompaktní číslo="D-8" zákazník="Z"\nvýkres list nový "Detaily"\nvýkres A4 pohledy iso\nvýkres razítko projekt="P2"`, "Dva listy");
    expect(inherit.script.text.split("\n").filter((l) => l.startsWith("výkres razítko"))).toEqual(['výkres razítko šablona=kompaktní číslo="D-8" zákazník="Z"', 'výkres razítko projekt="P2"']);
    expect(sheetCanon(inherit.rt, 1)).toEqual(sheetCanon(inherit.orig, 1));
  }, 600_000);

  it("kontrola 2 a 7: automatický formát, který při čtení roste – umístěný řez / detail zůstane na místě (díl i list sestavy), druhý export stejný", async () => {
    const { orig, rt, script, sameAgain } = await roundTrip(`nový díl "P2"\nkvádr 300 40 30\nválec 60 80 v 150 20 0\nvýkres pohledy přední,horní\nvýkres řez zalomený horní body -10 20 150 20 150 60 310 60 umístit 150 30\nvýkres pohled pomocný přední směr 0,5 0 0,87`, "P2");
    const at = (d: CadDoc) => (d.drawings![0].options as unknown as { cuts: { at: number[] }[] }).cuts[0].at;
    expect(at(orig)).toEqual([150, 180]); // A4: 210 − 30; po pomocném pohledu je list A3 (297)
    expect(script.text).toMatch(/^výkres řez zalomený horní body -10 20 150 20 150 60 310 60 umístit 150 180 odshora$/m);
    expect(at(rt)).toEqual([150, 180]);
    expect(sheetCanon(rt)).toEqual(sheetCanon(orig));
    await sameAgain();
    const asm = await roundTrip(`nový díl "Kus"\nkvádr 100 40 30\nnová sestava "Asm"\nvložit "Kus" ukotvit\nvložit "Kus" v 0 60 0\nvýkres pohledy přední,horní\nvýkres detail přední v 50 15 poloměr 10 měřítko 2:1 umístit 230 60`, "Asm");
    expect(asm.script.text).toMatch(/^výkres detail přední v 50 15 poloměr 10 měřítko 2:1 umístit 230 150 odshora$/m);
    expect(asm.script.notes.filter((n) => /umístění|jádr/.test(n))).toEqual([]);
    expect(sheetCanon(asm.rt)).toEqual(sheetCanon(asm.orig));
    await asm.sameAgain();
  }, 600_000);

  it("kontrola 3: úprava vygenerované kóty / pozice, která už na listu není, se do skriptu nedostane (žádné ✗) a platná zůstane", async () => {
    const box = `kvádr 100 60 40\nvýkres A3 pohledy přední,horní,levý\nkótovat celkově`;
    // pohled vypnutý po skrytí jeho kóty
    const a = await roundTrip(`nový díl "Stale"\n${box}\nvýkres vygenerované skrýt dim:front:t dim:left:t\nvýkres A3 pohledy přední,horní`, "Stale");
    expect(a.script.text).toMatch(/^výkres vygenerované skrýt dim:front:t$/m);
    expect(a.script.notes).toContain("úpravy vygenerovaných kót a pozic listu „List 1“, které už na listu nejsou (dim:left:t), skript vynechá");
    expect((a.rt.drawings![0].options as Rec).genEdit).toEqual({ off: ["dim:front:t"] });
    await a.sameAgain();
    // kótovat celkově → skrýt / posun → kótovat chytře: kóty celkových rozměrů na listu nejsou
    const b = await roundTrip(`nový díl "Stale2"\n${box}\nvýkres vygenerované skrýt dim:front:t\nvýkres vygenerované posun dim:front:l -6 0\nkótovat chytře`, "Stale2");
    expect(b.script.text).not.toContain("výkres vygenerované");
    expect(b.script.notes.join(" ")).toContain("které už na listu nejsou (dim:front:t, dim:front:l), skript vynechá");
    // sestava přes `export skript` (kusovník a pozice z postavených dílů): komponenta odebrána, pak balónky vypnuty
    const built = await run(`nový díl "A1"\nkvádr 40 40 10\nnový díl "A2"\nválec 10 30\nnový díl "A3"\nkoule 20\nnová sestava "Stale3"\nvložit "A1" ukotvit\nvložit "A2" v 20 20 10\nvložit "A3" v 80 20 10\nvýkres A3 pohledy přední,horní kusovník ano\nkótovat celkově\nvýkres vygenerované skrýt pos:3 pos:1\nvýkres vygenerované posun pos:2 4 4\nsestava odebrat "A3"\nexport skript "g4"\nvýkres balónky ne\nexport skript "g4b"`);
    expect(built.errors).toEqual([]);
    const [g4, g4b] = scriptFiles(built.h);
    expect(g4.split("\n").filter((l) => l.startsWith("výkres vygenerované"))).toEqual(["výkres vygenerované skrýt pos:1", "výkres vygenerované posun pos:2 4 4"]);
    expect(g4).toMatch(/^# ℹ úpravy vygenerovaných kót a pozic listu „List 1“, které už na listu nejsou \(pos:3\), skript vynechá$/m);
    expect(g4b).not.toMatch(/^výkres vygenerované/m);
    for (const [text, edit] of [[g4, { off: ["pos:1"], move: { "pos:2": [4, -4] } }], [g4b, undefined]] as const) {
      const rep = await run(text);
      expect(rep.errors, text).toEqual([]);
      expect((docNamed(rep.ws, "Stale3")!.drawings![0].options as Rec).genEdit).toEqual(edit);
    }
    // jádro bez doplňků razítka (bez kusovníku nejsou na listu sestavy pozice): pozice se neberou jako zastaralé – zapíší se
    // podle voleb listu a poznámka řekne, že ověřené nejsou
    const asmDoc = JSON.parse(JSON.stringify(docNamed((await run(`nový díl "A1"\nkvádr 40 40 10\nnová sestava "S"\nvložit "A1" ukotvit\nvložit "A1" v 60 0 0\nvýkres A3 pohledy přední,horní\nkótovat celkově\nvýkres vygenerované skrýt pos:1`)).ws, "S"))) as CadDoc;
    const bare = await scriptOfDocWith({ pickSigs: (bf, f) => kernel.pickSigs(bf, f), drawing: (doc, meta, o) => kernel.drawing(doc, meta, o) }, asmDoc, {});
    expect(bare.text).toMatch(/^výkres vygenerované skrýt pos:1$/m);
    expect(bare.notes.join(" ")).toContain("nejsou ověřené jádrem");
  }, 900_000);

  it("kontrola 4: pomocný pohled / detail z řezu se zapíše až po řezu a s písmenem, které řez při čtení dostane (žádné ✗)", async () => {
    const head = `nový díl "Pořadí"\nkvádr 120 80 40\nválec 30 60 v 60 40 0 odebrat\nvýkres A1 měřítko 1:1 pohledy přední,horní\nvýkres pohled pomocný přední hrana 0 0 120 40\nvýkres řez zalomený horní body -10 20 60 20 60 60 130 60`;
    type O = { aux?: { label: string; parent?: string }[]; cuts?: { label: string }[]; details?: { label: string; view: string }[] };
    const a = await roundTrip(`${head}\nvýkres pohled pomocný smazat B\nvýkres pohled pomocný řez C směr 0,5 0 0,87`, "Pořadí");
    const oa = a.rt.drawings![0].options as O;
    expect([(oa.cuts ?? []).map((c) => c.label), (oa.aux ?? []).map((x) => [x.label, x.parent])]).toEqual([["B"], [["C", "cut:B"]]]);
    expect(a.script.notes.join(" ")).toMatch(/se mohou lišit: C → B, B → C/);
    await a.sameAgain();
    const b = await roundTrip(`${head}\nvýkres detail řez C v 60 20 poloměr 12 měřítko 2:1\nvýkres pohled pomocný smazat B`, "Pořadí");
    const ob = b.rt.drawings![0].options as O;
    expect([(ob.cuts ?? []).map((c) => c.label), (ob.details ?? []).map((d) => [d.label, d.view])]).toEqual([["B"], [["A", "cut:B"]]]);
    // smazané detaily i pomocné pohledy (písmena se po přečtení posunou): druhý export dokumentu po přečtení zapíše stejné
    // řádky ve stejném pořadí (pořadí zápisu podle písmen, která pohledy při čtení dostanou)
    const c = await roundTrip(
      `nový díl "Pořadí"\nkvádr 120 80 40\nválec 30 60 v 60 40 0 odebrat\nvýkres A1 měřítko 1:1 pohledy přední,horní
výkres detail přední v 20 10 poloměr 8 měřítko 2:1\nvýkres detail přední v 100 10 poloměr 8 měřítko 2:1\nvýkres detail horní v 60 40 poloměr 6 měřítko 2:1\nvýkres detail smazat B
výkres pohled pomocný přední směr 0,5 0 0,87\nvýkres pohled pomocný přední hrana 0 0 120 40\nvýkres pohled pomocný směr 1 1 0\nvýkres pohled pomocný smazat B
výkres řez zalomený horní body -10 20 60 20 60 60 130 60`,
      "Pořadí",
    );
    const oc = (d: CadDoc) => d.drawings![0].options as O;
    expect([oc(c.orig).aux!.map((x) => x.label), oc(c.orig).cuts!.map((x) => x.label), oc(c.orig).details!.map((x) => x.label)]).toEqual([["D", "E"], ["B"], ["A", "C"]]);
    expect([oc(c.rt).aux!.map((x) => x.label), oc(c.rt).cuts!.map((x) => x.label), oc(c.rt).details!.map((x) => x.label)]).toEqual([["C", "D"], ["B"], ["A", "B"]]);
    expect(c.script.notes.join(" ")).toMatch(/se mohou lišit: .*D → C/);
    await c.sameAgain();
  }, 600_000);

  it("kontrola 5: pohledy, řezy, detaily a přerušení na vypnutém základním pohledu se vynechají s poznámkou (žádné ✗)", async () => {
    const a = await roundTrip(
      `nový díl "Zastaralé pohledy"
kvádr 200 60 40
válec 20 60 v 100 30 0 odebrat
výkres A2 měřítko 1:1 pohledy přední,horní,levý
výkres přerušení levý y od 10 do 30 mezera 4
výkres řez částečný levý body 10 5 30 5 30 35 10 35 hloubka 20
výkres detail levý v 30 20 poloměr 8 měřítko 2:1
výkres pohled pomocný levý směr 0,5 0 0,87
výkres řez zalomený horní body -10 20 100 20 100 50 210 50
výkres A2 měřítko 1:1 pohledy přední`,
      "Zastaralé pohledy",
    );
    const o = a.rt.drawings![0].options as Rec;
    expect(["aux", "cuts", "details", "brokenOut", "breaks"].map((k) => ((o[k] as unknown[] | undefined) ?? []).length)).toEqual([0, 0, 0, 0, 0]);
    expect(a.script.notes.filter((n) => n.includes("visí na pohledu, který na listu není"))).toHaveLength(5);
    expect(a.script.text).toMatch(/^# ℹ pomocný pohled B listu „List 1“ visí na pohledu, který na listu není \(levý\)/m);
  }, 300_000);

  it("kontrola 6: přezdívky a názvy dílů, které rozbor voleb četl jako klíčová slova (D, H, R, V, na, jako, ukotvit …)", async () => {
    const names = ["D", "H", "L", "N", "R", "V", "na", "jako", "ukotvit", "otočení", "as", "als"];
    const lines = names.map((a, i) => (i % 2 ? `vložit "Q" v ${20 * i} 0 0 jako "${a}"` : `vložit "Q" v ${20 * i} 0 0\nsestava komponenta #${i + 1} přezdívka "${a}"`));
    const { rt, script } = await roundTrip(`nový díl "Q"\nkvádr 10 10 10\nnový díl "H"\nkvádr 5 5 5\nnová sestava "AL"\n${lines.join("\n")}\nvložit "H" v 0 50 0 jako "X1"`, "AL");
    expect(rt.components!.map((c) => c.alias)).toEqual([...names, "X1"]);
    expect(rt.components!.map((c) => c.name)).toEqual([...names.map(() => "Q"), "H"]);
    for (const a of names) expect(script.text).toMatch(new RegExp(`^vložit "Q"( v \\d+ 0 0)? jako "${a}"$`, "m"));
    expect(script.text).toMatch(/^vložit "H" v 0 50 0 jako "X1"$/m);
    expect(script.notes.filter((n) => /přezdívk/.test(n))).toEqual([]);
  }, 300_000);

  it("kontrola 8 a 9: výkres vygenerované obnovit ověří klíč; stav pružiny píše vedená / nevedená a nápověda volbu vedená", async () => {
    const a = await run(`${PART}\nvýkres A3 pohledy přední,horní\nkótovat celkově\nvýkres vygenerované obnovit pos:99`);
    expect(a.errors.join("\n")).toMatch(/„pos:99“ na listu není – vygenerované objekty listu: dim:front:t/);
    expect(a.con).not.toMatch(/vygenerované obnoveno: pos:99/);
    // zastaralou úpravu (pohled mezitím vypnutý) obnovit jde – klíč je mezi úpravami listu
    const b = await run(`${PART}\nvýkres A3 pohledy přední,horní,levý\nkótovat celkově\nvýkres vygenerované skrýt dim:left:t dim:front:t\nvýkres A3 pohledy přední,horní\nvýkres vygenerované obnovit dim:left:t`);
    expect(b.errors).toEqual([]);
    expect((docNamed(b.ws, "Deska")!.drawings![0].options as Rec).genEdit).toEqual({ off: ["dim:front:t"] });
    const c = await run(`${SPRINGS}\nsestava pružina nová n 6 mezi "Horní deska" Ø21 "Stírací deska" horní do děr vzoru\nsestava pružina #5 vedená ne\nsestava pružiny\nsestava pružina #5 vedená možná`);
    const sp = c.con.split("\n").filter((l) => /pružina „/.test(l) && /délka/.test(l));
    expect(sp.filter((l) => / · nevedená( –|$)/.test(l)).length).toBeGreaterThanOrEqual(2); // řádek příkazu vedená ne a řádek #5 ve stavu pružin
    expect(sp.some((l) => / · vedená( –|$)/.test(l))).toBe(true);
    expect(c.errors.join("\n")).toMatch(/neznámá volba „možná“.*\[tuhost c\] \[vedená ano\|ne\]/);
  }, 600_000);

  it("kontrola 10: popisové údaje dokumentu (číslo, kreslil, revize) i s tabulkou revizí", async () => {
    const { orig, rt, script } = await roundTrip(`${PART}\nvýkres A3 pohledy přední\nvýkres razítko číslo="MN-1" kreslil="AI" revize="C"\nvýkres revize A "doplněna díra 8" datum 1.10.2026\nvýkres revize C "Ø8 → Ø10" datum 19.11.2026`, "Deska");
    expect(orig.props).toEqual({ number: "MN-1", author: "AI", revision: "C" });
    expect(rt.props).toEqual(orig.props);
    expect(script.text).toMatch(/^výkres razítko číslo="MN-1" kreslil="AI" revize="C"$/m);
    expect(sheetCanon(rt)).toEqual(sheetCanon(orig));
  }, 300_000);

  it("částečné řezy, přerušení, zobrazení úchylek uložení a Tabulka uložení", async () => {
    const { orig, rt } = await roundTrip(
      `${PART}
výkres A3 pohledy přední,horní řez XZ odsazení 40
výkres řez částečný přední body 10 2 40 2 40 18 10 18 hloubka 10
výkres řez částečný horní body 60 -10 90 -10 90 -30 hloubka 5 křivka
výkres přerušení přední x od 30 do 90 mezera 6 vlnovka
výkres přerušení řez x od 40 do 80 cikcak
výkres uložení zobrazení mezní
výkres uložení tabulka ano`,
      "Deska",
    );
    const o = orig.drawings![0].options as Rec;
    expect([(o.brokenOut as unknown[]).length, (o.breaks as unknown[]).length, o.fitShow, o.fitTable]).toEqual([2, 2, "limits", true]);
    expect(sheetCanon(rt)).toEqual(sheetCanon(orig));
  }, 300_000);

  const ASM = `nový díl Základ
kvádr 60 40 10
nový díl Sloupek
válec 10 40
nová sestava Stojan
vložit "Základ" ukotvit jako "Z1"
vložit "Sloupek" v 30 20 10 jako "S1"`;

  it("výkres sestavy: další model, vygenerované kóty celkových rozměrů a pozice skryté a posunuté (výkres vygenerované)", async () => {
    const built = await run(`${ASM}\nvýkres A3 pohledy přední,horní\nkótovat celkově\nvýkres vygenerované`);
    expect(built.errors).toEqual([]);
    const keys = /Vygenerované objekty listu: (.*)$/m.exec(built.con)?.[1] ?? "";
    expect(keys).toMatch(/dim:front:t .*pos:1 /);
    const { orig, rt, script } = await roundTrip(
      `${ASM}
výkres A3 pohledy přední,horní
výkres model "Sloupek" pohled horní měřítko 1:2
kótovat celkově
výkres vygenerované skrýt dim:front:t
výkres vygenerované posun pos:1 5 -3
výkres vygenerované posun dim:top:l -4 7`,
      "Stojan",
    );
    expect((orig.drawings![0].options as Rec).genEdit).toEqual({ off: ["dim:front:t"], move: { "pos:1": [5, 3], "dim:top:l": [-4, 0] } });
    expect(script.text).toMatch(/^výkres vygenerované skrýt dim:front:t$/m);
    expect(script.text).toMatch(/^výkres vygenerované posun pos:1 5 -3$/m);
    expect(script.text).toMatch(/^výkres model "Sloupek" pohled horní měřítko 1:2$/m);
    expect(sheetCanon(rt)).toEqual(sheetCanon(orig));
    // obnovit vrátí vše na výchozí místo
    const back = await run(`${ASM}\nvýkres A3\nkótovat celkově\nvýkres vygenerované skrýt dim:front:t\nvýkres vygenerované obnovit`);
    expect(back.errors).toEqual([]);
    expect((docNamed(back.ws, "Stojan")!.drawings![0].options as Rec).genEdit).toBeUndefined();
  }, 300_000);

  it("přezdívky komponent (vložit … jako, sestava komponenta … přezdívka)", async () => {
    const { orig, rt, script } = await roundTrip(`${ASM}\nvložit "Sloupek" v 10 10 10\nsestava komponenta #3 přezdívka "S2"`, "Stojan");
    expect(orig.components!.map((c) => c.alias ?? "")).toEqual(["Z1", "S1", "S2"]);
    expect(script.text).toMatch(/^vložit "Sloupek" v 10 10 10 jako "S2"$/m);
    expect(rt.components!.map((c) => c.alias ?? "")).toEqual(["Z1", "S1", "S2"]);
  }, 300_000);

  const SPRINGS = `nový díl Spodní deska
kvádr 200 120 30
nový díl Horní deska
kvádr 200 120 30
válec 21 10 v 40 30 0 odebrat
válec 21 10 v 160 30 0 odebrat
nový díl Stírací deska
kvádr 200 120 15
nová sestava Střižník
vložit "Spodní deska" ukotvit
vložit "Stírací deska" v 0 0 45
vložit "Horní deska" v 0 0 85
sestava vazba vzdálenost "Horní deska" spodní "Spodní deska" horní hodnota 55 název "LIS"
sestava vazba mez-vzdálenosti "Stírací deska" horní "Horní deska" spodní min 5 max 25 název "Doraz stírače"
sestava vazba mez-vzdálenosti "Stírací deska" spodní "Spodní deska" horní min 0 max 500 název "Matrice"`;
  const springs = (d: CadDoc) =>
    (d.components ?? []).flatMap((c, i) => {
      const sp = c.spring;
      if (!sp) return [];
      const at = (id: string) => (d.components ?? []).findIndex((x) => x.id === id);
      return [round({ i, a: [at(sp.a.compId), sp.a.face], b: [at(sp.b.compId), sp.b.face], free: sp.free, solid: sp.solid, rate: sp.rate, guided: sp.guided, length: sp.length, seat: sp.seat })];
    });

  it("pružiny sestavy: Pružina mezi díly do děr vzoru (vedené), změna textem (vedená ne, L0, Ln, tuhost)", async () => {
    const { orig, rt, script } = await roundTrip(`${SPRINGS}\nsestava pružina nová n 6 mezi "Horní deska" Ø21 "Stírací deska" horní do děr vzoru\nsestava pružina #5 volná 42 blok 15 tuhost 4,5 vedená ne`, "Střižník");
    const sp = springs(orig);
    expect(sp).toHaveLength(2);
    expect((sp[0] as Rec).guided).toBe(true);
    expect((sp[1] as Rec).guided).toBe(false);
    expect(script.text).toMatch(/^sestava pružina #4 mezi #3 F\d+ #2 F\d+ volná 41 blok 16 tuhost [\d.]+ vedená ano$/m);
    expect(script.text).toMatch(/^sestava pružina #5 mezi #3 F\d+ #2 F\d+ volná 42 blok 15 tuhost 4.5 vedená ne$/m);
    expect(springs(rt)).toEqual(sp);
    expect(rt.mates!.map((m) => m.type)).toEqual(orig.mates!.map((m) => m.type));
  }, 600_000);

  const motion = (d: CadDoc) => {
    const mo = d.motion!;
    const comp = (id: string) => (d.components ?? []).findIndex((c) => c.id === id);
    const mate = (id: string) => (d.mates ?? []).findIndex((m) => m.id === id);
    return round({
      motors: mo.motors.map((m) => ({ ...m, id: undefined, mate: mate(m.mate) })),
      duration: mo.duration,
      steps: mo.steps,
      mode: mo.mode ?? "kinematic",
      dyn: mo.dyn && { ...mo.dyn, masses: Object.fromEntries(Object.entries(mo.dyn.masses ?? {}).map(([k, v]) => [comp(k), v])), loads: (mo.dyn.loads ?? []).map((l) => ({ ...l, mate: mate(l.mate) })) },
    });
  };
  it("dynamika pohybové studie: nastavení dynamické studie i uložené u kinematické, gravitace šikmo, hmotnosti a síly", async () => {
    const dynamic = await roundTrip(`${SPRINGS}\nsestava pružina nová n 6 mezi "Horní deska" Ø21 "Stírací deska" horní do děr vzoru\npohyb hmotnost "Stírací deska" 2,4\npohyb síla vazba 2 120\npohyb motor lineární vazba "LIS" 55..50 tam a zpět\npohyb dynamika čas 0,02 krok 0,0004 gravitace 0 -0,6 -0,8 tlumení 0,05 odraz 0,2 snímky 40`, "Střižník");
    expect(dynamic.script.text).toMatch(/^pohyb dynamika čas 0.02 krok 0.0004 gravitace 0 -0.6 -0.8 tlumení 0.05 odraz 0.2 snímky 40$/m);
    expect(motion(dynamic.rt)).toEqual(motion(dynamic.orig));
    const kin = await roundTrip(`${SPRINGS}\npohyb motor lineární vazba "LIS" 55..50 kroky 4\npohyb dynamika čas 0,02 gravitace +X odraz 0,5\npohyb kinematika`, "Střižník");
    // vlna 22 (M2): `pohyb kinematika` je výslovný režim (bez volby = automaticky – kvazistatika při pružině na pohyblivém dílu)
    expect(kin.orig.motion!.mode).toBe("kinematic");
    expect(kin.rt.motion!.mode).toBe("kinematic");
    expect(kin.script.text).toMatch(/^pohyb dynamika čas 0.02 krok 0.0005 gravitace \+X odraz 0.5\npohyb kinematika$/m);
    expect(motion(kin.rt)).toEqual(motion(kin.orig));
    expect(SCRIPT_DEFAULT_DT).toBe((await import("./motion-dynamic")).defaultDyn().dt);
  }, 600_000);

  it("anglický a německý skript dají stejný výkres i sestavu", async () => {
    for (const lang of ["en", "de"] as const) {
      const part = await roundTrip(
        `${PART}
výkres A3 pohledy přední,horní,levý pružiny plně
výkres razítko šablona=kompaktní zákazník="Z" počet="2" tepelné="kalit" povrch="zinek" úhly="±1°" sražení="±0,3" firma="F"
výkres nepředepsané desetinná ±0,2 ±0,1 ±0,02 ±0,01
výkres revize A "vydání" datum 1.11.2026 kreslil "JN"
výkres detail přední v 20 10 poloměr 8 měřítko 2:1 umístit 60 60
výkres pohled pomocný přední hrana 0 0 120 20 umístit 300 90
výkres řez zalomený horní body 0 -20 60 -20 60 -60 120 -60
výkres řez částečný přední body 10 2 40 2 40 18 10 18 hloubka 10 křivka
výkres přerušení přední x od 30 do 90 vlnovka
výkres uložení zobrazení značka
výkres uložení tabulka ano
kótovat chytře funkční 80 díry řetězově`,
        "Deska",
        lang,
      );
      expect(sheetCanon(part.rt), lang).toEqual(sheetCanon(part.orig));
      const asm = await roundTrip(`${ASM}\nvýkres A3\nkótovat celkově\nvýkres vygenerované skrýt dim:front:t\nvýkres vygenerované posun pos:1 5 -3`, "Stojan", lang);
      expect(sheetCanon(asm.rt), lang).toEqual(sheetCanon(asm.orig));
      expect(asm.rt.components!.map((c) => c.alias)).toEqual(["Z1", "S1"]);
      const sp = await roundTrip(`${SPRINGS}\nsestava pružina nová n 6 mezi "Horní deska" Ø21 "Stírací deska" horní do děr vzoru\npohyb motor lineární vazba "LIS" 55..50 kroky 4\npohyb dynamika čas 0,02 gravitace -Z odraz 0,5\npohyb kinematika`, "Střižník", lang);
      expect(springs(sp.rt), lang).toEqual(springs(sp.orig));
      expect(motion(sp.rt), lang).toEqual(motion(sp.orig));
    }
  }, 900_000);

  it("co skript nepřenese (volby jen z JSON, model ze záložky): ℹ v protokolu export skript i komentář ve skriptu", async () => {
    const a = await run(`${PART}\nvýkres A3 pohledy přední`);
    const d = JSON.parse(JSON.stringify(docNamed(a.ws, "Deska"))) as CadDoc;
    const s = d.drawings![0];
    s.options = { ...s.options, dimRoom: 12, weldSymbols: false, models: [{ id: "m1", name: "Cizí díl", source: { kind: "doc", doc: { ...d, drawings: undefined } }, view: "front", scale: "auto" }] };
    const r = docToScript(d);
    expect(r.notes.join(" | ")).toContain("volby listu bez textového příkazu (dimRoom, weldSymbols)");
    expect(r.notes.join(" | ")).toContain("model „Cizí díl“ na listu „List 1“ je ze záložky");
    expect(r.text).toMatch(/^# ℹ co skript nepřenese \(\d+\):$/m);
    expect(r.text).toMatch(/^# ℹ volby listu bez textového příkazu \(dimRoom, weldSymbols\)/m);
    // `export skript` v enginu (CLI i konzole prohlížeče): poznámky jsou řádky ℹ protokolu, soubor nese komentáře
    const ws = new MemoryWorkspace();
    await run(JSON.stringify(d), "cs", ws);
    const rep = await run("export skript", "cs", ws);
    const short = formatShort(rep.r, { budget: Infinity, notes: true });
    expect(short).toMatch(/^ℹ L1 .*volby listu bez textového příkazu \(dimRoom, weldSymbols\)/m);
    const file = [...rep.h.files.files.values()].find((f) => f.file.format === "script")!;
    expect(new TextDecoder().decode(file.data)).toMatch(/^# ℹ model „Cizí díl“/m);
  }, 300_000);

  it("formáty listu převodníku odpovídají výpočtu výkresu (drawing.ts SHEETS)", async () => {
    const { SHEETS, defaultDrawingOptions } = await import("./drawing");
    expect(SCRIPT_SHEETS).toEqual(SHEETS);
    // výchozí pohledy listu a pole razítka, která nový list převezme z aktivního (převodník je drží jako konstanty bez jádra)
    expect(SCRIPT_DEFAULT_VIEWS).toEqual(defaultDrawingOptions.views);
    expect(SCRIPT_INHERITED_TITLE).toEqual((await import("./title-block")).INHERITED_TITLE);
    const a = await run(`${PART}\nvýkres A2 na výšku pohledy přední`);
    const d = docNamed(a.ws, "Deska")!;
    const res = await kernel.drawing(d, sheetMeta(d, d.drawings![0], 0), sheetOptions(d.drawings![0]));
    expect(res.sheet.h).toBe(594);
  }, 300_000);
});
