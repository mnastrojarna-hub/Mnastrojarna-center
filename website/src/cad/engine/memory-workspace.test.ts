/**
 * MemoryWorkspace (CAD-HEADLESS-NAVRH.md 2.3, 2.5): záložky (úvodní prázdný díl, dokumenty běhu se nepřepisují – 5.2 č. 14),
 * zpět/znovu s historií 80, normalizace při otevření (internBlobs, normalizeDraftDoc), relace save/load s importovanými daty.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyAssembly } from "../assembly";
import { BLOB_PREFIX, blobOf, hasBlob } from "../blobs";
import { setLang } from "../i18n";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import { MemoryWorkspace, loadWorkspace } from "./memory-workspace";
import { HISTORY_MAX, newAsmCaches, syncKernelGeneration } from "./workspace";

afterEach(() => setLang("cs"));

const box = (id: string): Feature => ({ id, name: id, type: "box", size: [10, 20, 30], at: [0, 0, 0] }) as unknown as Feature;
const part = (name: string, n = 1): CadDoc => ({ ...emptyDoc(name), features: Array.from({ length: n }, (_, i) => box(`f${i}`)) });
/** náhodná data importu ≥ 4 kB (internBlobs je převede na odkaz) */
function importDoc(name: string, seed: number, size = 6000): { doc: CadDoc; bytes: Uint8Array } {
  const bytes = new Uint8Array(size);
  let s = seed;
  for (let i = 0; i < size; i++) bytes[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) & 0xff;
  const f = { id: "imp", name: "Import", type: "import", fileName: `${name}.step`, format: "step", data: Buffer.from(bytes).toString("base64") } as unknown as Feature;
  return { doc: { ...emptyDoc(name), features: [f] }, bytes };
}

describe("MemoryWorkspace – záložky", () => {
  it("start = jedna záložka „Nový díl“; první dokument ji znovu použije jedním krokem historie", async () => {
    const ws = new MemoryWorkspace();
    expect(ws.tabs()).toEqual([{ id: expect.any(String), title: "Nový díl", kind: "part", active: true }]);
    const r = await ws.openInTab(part("Deska"));
    expect(r.reused).toBe(true);
    expect(ws.tabs().map((t) => t.title)).toEqual(["Deska"]);
    expect(ws.undo(1)).toEqual({ moved: 1 });
    expect(ws.present().name).toBe("Nový díl");
    expect(ws.redo(5)).toEqual({ moved: 1 });
  });
  it("prázdná sestava vytvořená během se díly NEpřepíše (5.2 č. 14) – každý dokument má vlastní záložku", async () => {
    const ws = new MemoryWorkspace();
    const a = await ws.openInTab(emptyAssembly("Nástroj")); // do úvodního prázdného dílu
    const b = await ws.openInTab(part("Deska", 0)); // prázdný díl běhu
    const c = await ws.openInTab(part("Kolík")); // aktivní je prázdný díl běhu – přesto nová záložka
    expect([a.reused, b.reused, c.reused]).toEqual([true, false, false]);
    expect(ws.tabs().map((t) => [t.title, t.kind, t.active])).toEqual([
      ["Nástroj", "assembly", false],
      ["Deska", "part", false],
      ["Kolík", "part", true],
    ]);
  });
  it("reuseEmpty: false = vždy nová záložka; úvodní díl po úpravě už znovu použit není", async () => {
    const ws = new MemoryWorkspace();
    expect((await ws.openInTab(part("A"), { reuseEmpty: false })).reused).toBe(false);
    expect(ws.tabs().length).toBe(2);
    const ws2 = new MemoryWorkspace();
    ws2.commit(emptyDoc("Upravený prázdný"));
    expect((await ws2.openInTab(part("B"))).reused).toBe(false);
  });
  it("activate / close: zavření aktivní → předchozí; zavření poslední → nový prázdný díl; neznámé id = chyba se seznamem", async () => {
    const ws = new MemoryWorkspace();
    const a = await ws.openInTab(part("A"));
    const b = await ws.openInTab(part("B"));
    const c = await ws.openInTab(part("C"));
    expect((await ws.activate(b.id)).name).toBe("B");
    expect((await ws.close(b.id)).name).toBe("A");
    expect(ws.tabs().map((t) => t.title)).toEqual(["A", "C"]);
    await ws.activate(c.id);
    expect((await ws.close(a.id)).name).toBe("C"); // zavření neaktivní záložky nemění aktivní
    expect((await ws.close(c.id)).name).toBe("Nový díl");
    expect(ws.tabs().length).toBe(1);
    expect((await ws.openInTab(part("D"))).reused).toBe(true); // nový prázdný díl po zavření všeho je zase „úvodní“
    await expect(ws.activate("nic")).rejects.toThrow("záložka „nic“ neexistuje – otevřené: D");
    setLang("en");
    await expect(ws.close("nic")).rejects.toThrow("tab “nic” does not exist – open: D");
  });
  it("findPart: bez ohledu na velikost písmen; jen díly; dokumenty běhu (nejnovější) před staršími záložkami", async () => {
    const ws = new MemoryWorkspace();
    await ws.openInTab(part("Deska", 1));
    await ws.openInTab(emptyAssembly("Sestava"));
    expect(ws.findPart("DESKA ")?.features.length).toBe(1);
    expect(ws.findPart("Sestava")).toBeNull();
    expect(ws.findPart("nic")).toBeNull();
    ws.beginRun();
    await ws.openInTab(part("deska", 2));
    await ws.openInTab(part("Deska", 3));
    expect(ws.findPart("Deska")?.features.length).toBe(3);
    ws.beginRun(); // další běh: dokumenty minulého běhu jsou už jen záložky → první shoda v pořadí záložek
    expect(ws.findPart("Deska")?.features.length).toBe(1);
  });
  it("freshName: „Nový díl“, „Nový díl 2“, …", async () => {
    const ws = new MemoryWorkspace();
    expect(ws.freshName("Nový díl")).toBe("Nový díl 2");
    expect(ws.freshName("Nová sestava")).toBe("Nová sestava");
    await ws.openInTab(emptyDoc("Nový díl 2"), { reuseEmpty: false });
    expect(ws.freshName("Nový díl")).toBe("Nový díl 3");
  });
});

describe("MemoryWorkspace – historie", () => {
  it(`commit drží nejvýš ${HISTORY_MAX} kroků zpět; zpět/znovu vrací počet skutečných kroků`, async () => {
    const ws = new MemoryWorkspace();
    for (let i = 1; i <= 100; i++) ws.commit(part(`c${i}`));
    expect(ws.historyDepth()).toEqual({ undo: 80, redo: 0 });
    expect(ws.undo(1000)).toEqual({ moved: 80 });
    expect(ws.present().name).toBe("c20");
    expect(ws.redo(30)).toEqual({ moved: 30 });
    expect(ws.present().name).toBe("c50");
    ws.commit(part("nový"));
    expect(ws.historyDepth()).toEqual({ undo: 31, redo: 0 }); // c20…c50 + nový; commit po zpět zahodí „znovu“
    expect([ws.undo(0), ws.undo(-3), ws.undo(NaN), ws.redo(1)]).toEqual([{ moved: 0 }, { moved: 0 }, { moved: 0 }, { moved: 0 }]);
  });
  it("historie je na záložku", async () => {
    const ws = new MemoryWorkspace();
    const a = await ws.openInTab(part("A"));
    ws.commit(part("A2"));
    const b = await ws.openInTab(part("B"));
    expect(ws.undo(5)).toEqual({ moved: 0 });
    await ws.activate(a.id);
    expect(ws.undo(5)).toEqual({ moved: 2 }); // A2 → A → úvodní prázdný díl
    await ws.activate(b.id);
    expect(ws.present().name).toBe("B");
  });
});

describe("MemoryWorkspace – normalizace při otevření", () => {
  it("internBlobs: data importu (base64 ≥ 4 kB) → odkaz mnblob: v úložišti", async () => {
    const { doc, bytes } = importDoc("Import A", 1);
    const ws = new MemoryWorkspace();
    await ws.openInTab(doc);
    const f = ws.present().features[0] as unknown as { data: string };
    expect(f.data.startsWith(BLOB_PREFIX)).toBe(true);
    expect(blobOf(f.data)).toEqual(bytes);
  });
  it("normalizeDraftDoc: ručně psaný 2D výkres dostane hladinu 0, typy čar a id entit", async () => {
    const ws = new MemoryWorkspace();
    const raw = { app: "mnastrojarna-cad", version: 2, name: "Skica 2D", material: "ocel", features: [], kind: "draft", draft: { entities: [{ type: "line", a: [0, 0], b: [10, 0] }] } } as unknown as CadDoc;
    await ws.openInTab(raw);
    const d = ws.present();
    expect(d.kind).toBe("draft");
    expect(d.draft!.layers.some((l) => l.name === "0")).toBe(true);
    expect(d.draft!.linetypes.length).toBeGreaterThan(1);
    expect(d.draft!.entities[0]).toMatchObject({ id: "e1", layer: "0" });
    expect(ws.tabs()[0].kind).toBe("draft");
  });
});

describe("MemoryWorkspace – relace", () => {
  it("save → load: záložky, názvy, druhy, aktivní záložka, id; historie se nepřenáší", async () => {
    const ws = new MemoryWorkspace();
    await ws.openInTab(part("A", 2));
    ws.commit(part("A", 3));
    const s = await ws.openInTab(emptyAssembly("S"));
    await ws.openInTab(part("B"));
    await ws.activate(s.id);
    const ws2 = loadWorkspace(ws.save());
    expect(ws2.tabs()).toEqual(ws.tabs());
    expect(ws2.present().name).toBe("S");
    expect(ws2.historyDepth()).toEqual({ undo: 0, redo: 0 });
    expect(ws2.findPart("A")?.features.length).toBe(3);
    // úvodní prázdný díl zůstává znovupoužitelný i po obnově relace
    const ws3 = loadWorkspace(new MemoryWorkspace().save());
    expect((await ws3.openInTab(part("X"))).reused).toBe(true);
  });
  it("data importů jsou v relaci jednou (společná mapa blobs) a obnoví se v čistém procesu", async () => {
    const one = importDoc("Import B", 7, 9000);
    const ws = new MemoryWorkspace();
    await ws.openInTab(one.doc);
    await ws.openInTab({ ...one.doc, name: "Kopie" }); // stejná data ve dvou záložkách
    const bytes = ws.save();
    const json = JSON.parse(new TextDecoder().decode(bytes));
    const ref = (ws.present().features[0] as unknown as { data: string }).data;
    expect(Object.keys(json.blobs)).toEqual([ref.slice(BLOB_PREFIX.length)]);
    expect(json.tabs.every((t: { blobs?: unknown }) => t.blobs === undefined)).toBe(true);
    expect(bytes.length).toBeLessThan(one.bytes.length * 1.4 + 4000); // base64 jednou, ne dvakrát
    // čistý proces: nové instance modulů → prázdné úložiště blobů
    vi.resetModules();
    const fresh = await import("./memory-workspace");
    const freshBlobs = await import("../blobs");
    expect(freshBlobs.hasBlob(ref)).toBe(false);
    const ws2 = fresh.loadWorkspace(bytes);
    expect(freshBlobs.blobOf(ref)).toEqual(one.bytes);
    expect((ws2.present().features[0] as unknown as { data: string }).data).toBe(ref);
    expect(ws2.tabs().map((t) => t.title)).toEqual(["Import B", "Kopie"]);
    expect(hasBlob(ref)).toBe(true); // původní instance nedotčena
  });
  it("starší tvar (blobs v dokumentu, base64 přímo v prvku) se načte a převede na odkazy", async () => {
    const legacy = importDoc("Starý", 3, 5000);
    const file = { v: 1, tabs: [legacy.doc], active: 0 };
    const ws = loadWorkspace(new TextEncoder().encode(JSON.stringify(file)));
    const data = (ws.present().features[0] as unknown as { data: string }).data;
    expect(data.startsWith(BLOB_PREFIX)).toBe(true);
    expect(blobOf(data)).toEqual(legacy.bytes);
  });
  it("neplatná relace = srozumitelná chyba (lokalizovaná)", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(() => loadWorkspace(enc("{nejson"))).toThrow("soubor relace není platný JSON");
    expect(() => loadWorkspace(enc(JSON.stringify({ v: 2, tabs: [] })))).toThrow("neznámý formát relace");
    expect(() => loadWorkspace(enc(JSON.stringify({ v: 1, tabs: [5], active: 0 })))).toThrow("záložka 1 v relaci není dokument");
    setLang("de");
    expect(() => loadWorkspace(enc("{"))).toThrow("die Sitzungsdatei ist kein gültiges JSON");
    expect(loadWorkspace(enc(JSON.stringify({ v: 1, tabs: [], active: 7 }))).tabs().length).toBe(1);
  });
  it("strukturálně neplatné záložky a data importů = lokalizovaná chyba při načtení, nikdy pozdější TypeError / DOMException", () => {
    const enc = (o: unknown) => new TextEncoder().encode(JSON.stringify(o));
    const tab = { name: "A", features: [] };
    const cases: [unknown, string, string][] = [
      [{ v: 1, tabs: [{}], active: 0 }, "záložka 1 v relaci nemá název dokumentu (text)", "Registerkarte 1 der Sitzung hat keinen Dokumentnamen (Text)"],
      [{ v: 1, tabs: [tab, { name: 5, features: [] }], active: 0 }, "záložka 2 v relaci nemá název dokumentu (text)", "Registerkarte 2 der Sitzung hat keinen Dokumentnamen (Text)"],
      [{ v: 1, tabs: [[]], active: 0 }, "záložka 1 v relaci není dokument", "Registerkarte 1 der Sitzung ist kein Dokument"],
      [{ v: 1, tabs: [{ name: "A", features: "x" }], active: 0 }, "záložka 1 v relaci má neplatný seznam „features“", "Registerkarte 1 der Sitzung hat eine ungültige Liste „features“"],
      [{ v: 1, tabs: [{ name: "S", kind: "assembly", features: [], components: {} }], active: 0 }, "záložka 1 v relaci má neplatný seznam „components“", "Registerkarte 1 der Sitzung hat eine ungültige Liste „components“"],
      [{ v: 1, tabs: [tab], active: 0, blobs: { x: "@@@" } }, "data importu „x“ v relaci nejsou platné base64", "die Importdaten „x“ der Sitzung sind kein gültiges Base64"],
      [{ v: 1, tabs: [tab], active: 0, blobs: { y: "QUJD=" } }, "data importu „y“ v relaci nejsou platné base64", "die Importdaten „y“ der Sitzung sind kein gültiges Base64"],
      [{ v: 1, tabs: [tab], active: 0, blobs: { z: 5 } }, "data importu „z“ v relaci nejsou platné base64", "die Importdaten „z“ der Sitzung sind kein gültiges Base64"],
      [{ v: 1, tabs: [tab], active: 0, blobs: ["QUJD"] }, "data importů v relaci nejsou mapa id → base64", "die Importdaten der Sitzung sind keine Zuordnung ID → Base64"],
    ];
    for (const [file, cs, de] of cases) {
      const err = (() => {
        try {
          loadWorkspace(enc(file));
          return null;
        } catch (e) {
          return e as Error;
        }
      })();
      expect(err?.constructor, JSON.stringify(file)).toBe(Error);
      expect(err?.message).toBe(cs);
      setLang("de");
      expect(() => loadWorkspace(enc(file))).toThrow(de);
      setLang("cs");
    }
    // neplatná záložka za platnými daty importu: úložiště blobů se nezmění (kontrola proběhne před zápisem)
    const id = "b".repeat(16);
    expect(() => loadWorkspace(enc({ v: 1, tabs: [{}], active: 0, blobs: { [id]: "QUJD" } }))).toThrow();
    expect(hasBlob(BLOB_PREFIX + id)).toBe(false);
    // platná data bez prvků (výkres bez dat) se načtou a fungují
    const ws = loadWorkspace(enc({ v: 1, tabs: [{ name: "V", kind: "draft" }], active: 0, blobs: { [id]: "QUJD" } }));
    expect(ws.findPart("x")).toBeNull();
    expect(blobOf(BLOB_PREFIX + id)).toEqual(new TextEncoder().encode("ABC"));
    expect(loadWorkspace(ws.save()).tabs().map((t) => t.kind)).toEqual(["draft"]);
  });
});

describe("mezipaměti sestavy a generace jádra (2.5)", () => {
  it("syncKernelGeneration vyprázdní stavbu a plochy jen při změně generace", () => {
    const asm = newAsmCaches(1);
    asm.cache.set("k", { status: [] } as never);
    asm.geo.set("k:1", {} as never);
    asm.faceLists.set("k", { faces: [], truncated: false });
    asm.mateStatus.set("d", { m1: "ok" });
    expect(syncKernelGeneration(asm, 1)).toBe(false);
    expect(asm.cache.size).toBe(1);
    expect(syncKernelGeneration(asm, 2)).toBe(true);
    expect([asm.cache.size, asm.geo.size, asm.faceLists.size, asm.mateStatus.size, asm.generation]).toEqual([0, 0, 0, 1, 2]);
    expect(new MemoryWorkspace().asm.generation).toBe(0);
  });
});
