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
import { SCRIPT_SHEETS } from "./doc-script-sheet";
import { SCRIPT_DEFAULT_DT } from "./doc-script-asm";
import { sheetMeta, sheetOptions } from "./drawing-agent";
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
  const logo = m.logo as Rec | undefined;
  if (logo) m.logo = { w: logo.w, h: logo.h, name: logo.name, trace: logo.trace };
  return round({ name: s.name, options: o, meta: m }) as Rec;
}
/** vygenerované kóty listu (klíč popisu díry nese id prvku – po přečtení má prvek nové id) */
const autoAnns = (d: CadDoc, i = 0) => (d.drawings?.[i]?.annotations ?? []).filter((a) => a.auto).map((a) => `${a.type}:${a.auto!.replace(/^hole:.*/, "hole")}`);
const docNamed = (ws: MemoryWorkspace, name: string) => ws.listDocs().find((x) => x.title === name)?.doc;

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
  const K = { pickSigs: (b: CadDoc, f: CadDoc["features"][number]) => kernel.pickSigs(b, f), drawing: (doc: CadDoc, meta: Parameters<typeof kernel.drawing>[1], o: Parameters<typeof kernel.drawing>[2]) => kernel.drawing(doc, meta, o) };
  /** postaví dokument textem, převede na skript (jazyk `lang`) a skript spustí znovu */
  async function roundTrip(text: string, name: string, lang: ScriptLang = "cs") {
    const a = await run(text);
    expect(a.errors, "stavba bez ✗").toEqual([]);
    const orig = JSON.parse(JSON.stringify(docNamed(a.ws, name))) as CadDoc;
    expect(orig, name).toBeTruthy();
    const script = await scriptOfDocWith(K, orig, { lang });
    const b = await run(script.text, lang);
    expect(b.errors, `přečtení skriptu bez ✗\n${script.text}`).toEqual([]);
    const rt = docNamed(b.ws, name)!;
    expect(rt, name).toBeTruthy();
    return { orig, rt, script, built: a, replay: b };
  }

  const PART = `nový díl "Deska"
kvádr 120 80 20
díra 8 skrz v 20 20 20
díra 8 skrz v 100 60 20`;

  it("razítko: šablona, všechna pole, nepředepsané tolerance podle desetinných míst, tabulka revizí a skryté trojúhelníky", async () => {
    const { orig, rt, script } = await roundTrip(
      `${PART}
výkres A3 pohledy přední,horní
výkres razítko šablona=nástrojářská číslo="NS-100" kreslil="JN" kontroloval="KP" schválil="MV" zákazník="Zákazník A" projekt="P-1" firma="Firma s.r.o." polotovar="Plech 20" počet="4 ks" tepelné="kalit 58 HRC" povrch="černit" úhly="±0,5°" sražení="±0,2" hrany="ISO 13715 -0,3" poznámka="Odjehlit"
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

  it("automatický formát listu: umístění převede výška listu spočítaná jádrem; bez jádra poznámka", async () => {
    const { orig, rt, script } = await roundTrip(`${PART}\nvýkres pohledy přední,horní\nvýkres detail přední v 20 10 poloměr 8 měřítko 2:1 umístit 40 40`, "Deska");
    expect((orig.drawings![0].options as Rec).sheet ?? "auto").toBe("auto");
    expect(script.text).toMatch(/^výkres detail přední v 20 10 poloměr 8 měřítko 2:1 umístit 40 40$/m);
    expect(sheetCanon(rt)).toEqual(sheetCanon(orig));
    const pure = docToScript(orig);
    expect(pure.text).toMatch(/^výkres detail přední v 20 10 poloměr 8 měřítko 2:1$/m);
    expect(pure.notes.join(" ")).toContain("umístění 1 pohledů / detailů listu „List 1“ s automatickým formátem se bez jádra nezapíše");
    expect(pure.text).toContain("# ℹ umístění 1 pohledů / detailů");
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
    expect(kin.orig.motion!.mode).toBeUndefined();
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
    const { SHEETS } = await import("./drawing");
    expect(SCRIPT_SHEETS).toEqual(SHEETS);
    const a = await run(`${PART}\nvýkres A2 na výšku pohledy přední`);
    const d = docNamed(a.ws, "Deska")!;
    const res = await kernel.drawing(d, sheetMeta(d, d.drawings![0], 0), sheetOptions(d.drawings![0]));
    expect(res.sheet.h).toBe(594);
  }, 300_000);
});
