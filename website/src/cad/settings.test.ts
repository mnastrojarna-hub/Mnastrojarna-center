import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hasTranslation } from "./i18n";
import { DEFAULT_SETTINGS, DEFAULT_SHORTCUTS, DEFAULT_SKETCH_SHORTCUTS, SHORTCUT_GROUPS, defaultShortcut, exportSettings, importSettings, keyCombo, shortcutOf, sketchShortcutAction, withDefaultShortcuts, type Settings } from "./settings";
import fs from "node:fs";
import path from "node:path";

/**
 * Mapa `"id": "text"` ze zdrojového souboru komponenty (soubory .tsx tento běh testů neumí načíst jako modul,
 * proto se čte text deklarace `export const <název> … = { … };`).
 */
function sourceMap(file: string, name: string): Record<string, string> {
  const src = fs.readFileSync(path.resolve(__dirname, "../components/cad", file), "utf8");
  const start = src.indexOf(`export const ${name}`);
  if (start < 0) throw new Error(`${name} v ${file} nenalezeno`);
  const block = src.slice(start, src.indexOf("\n};", start));
  return Object.fromEntries([...block.matchAll(/^\s*"?([\w.]+)"?: "([^"]+)",?$/gm)].map((m) => [m[1], m[2]]));
}
/** popisky příkazů v Nastavení → Klávesové zkratky */
const SHORTCUT_LABELS = sourceMap("settings-dialog.tsx", "SHORTCUT_LABELS");
/** příkaz skici → nástroj skicáře */
const SKETCH_SHORTCUT_TOOLS = sourceMap("sketcher.tsx", "SKETCH_SHORTCUT_TOOLS");

/** jednoduché úložiště místo prohlížeče */
function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const g = globalThis as unknown as { localStorage?: ReturnType<typeof memStorage> };
const KEY = "mn-cad-settings-v2";
/** čerstvý modul nastavení (zapomene nastavení držené v paměti karty) */
const fresh = async () => {
  vi.resetModules();
  return import("./settings");
};
const key = (k: string, mods: Partial<KeyboardEvent> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

describe("zkratky skici – výchozí hodnoty a skupiny", () => {
  it("odpovídají dřívějším pevným klávesám nástrojů skici", () => {
    const tools: Record<string, string> = { select: "V", line: "L", polyline: "K", centerline: "X", rect: "R", circle: "C", arc: "A", ellipse: "E", spline: "N", point: "B", polygon: "P", slot: "S", trim: "T", offset: "O", dimension: "D", measure: "M" };
    for (const [tool, k] of Object.entries(tools)) expect(DEFAULT_SKETCH_SHORTCUTS[`sketch.${tool}`], tool).toBe(k);
    expect(DEFAULT_SKETCH_SHORTCUTS["sketch.fit"]).toBe("F");
    expect(DEFAULT_SKETCH_SHORTCUTS["sketch.grid"]).toBe("G");
    expect(DEFAULT_SKETCH_SHORTCUTS["sketch.horizontal"]).toBe("H");
  });
  it("příkazy skici se nepřekrývají s příkazy 3D a výchozí klávesy jsou ve skice jedinečné", () => {
    for (const id of Object.keys(DEFAULT_SKETCH_SHORTCUTS)) expect(id in DEFAULT_SHORTCUTS, id).toBe(false);
    const keys = Object.values(DEFAULT_SKETCH_SHORTCUTS);
    expect(new Set(keys).size).toBe(keys.length);
    // „Nová skica“ je příkaz 3D (klávesa S), i když začíná na sketch.
    expect(DEFAULT_SHORTCUTS["sketch.new"]).toBe("S");
    expect("sketch.new" in DEFAULT_SKETCH_SHORTCUTS).toBe(false);
  });
  it("Nastavení má dvě skupiny: 3D a Skica", () => {
    expect(SHORTCUT_GROUPS.map((x) => x.id)).toEqual(["model", "sketch"]);
    expect(SHORTCUT_GROUPS[0].defaults).toBe(DEFAULT_SHORTCUTS);
    expect(SHORTCUT_GROUPS[1].defaults).toBe(DEFAULT_SKETCH_SHORTCUTS);
  });
  it("každý příkaz obou skupin má popisek přeložený do angličtiny i němčiny", () => {
    for (const grp of SHORTCUT_GROUPS)
      for (const id of Object.keys(grp.defaults)) {
        const label = SHORTCUT_LABELS[id];
        expect(label, id).toBeTruthy();
        expect(hasTranslation("en", label), `en: ${label}`).toBe(true);
        expect(hasTranslation("de", label), `de: ${label}`).toBe(true);
      }
  });
  it("skicář obslouží každý příkaz skici: nástroj, nebo zvláštní akce (vodorovně, zobrazit vše, mřížka)", () => {
    const special = ["sketch.horizontal", "sketch.fit", "sketch.grid"];
    for (const id of Object.keys(DEFAULT_SKETCH_SHORTCUTS)) expect(id in SKETCH_SHORTCUT_TOOLS || special.includes(id), id).toBe(true);
    for (const [id, tool] of Object.entries(SKETCH_SHORTCUT_TOOLS)) {
      expect(id in DEFAULT_SKETCH_SHORTCUTS, id).toBe(true);
      expect(id).toBe(`sketch.${tool}`);
    }
  });
  it("defaultShortcut a shortcutOf: uložená zkratka, jinak výchozí (3D i skica)", () => {
    expect(defaultShortcut("sketch.line")).toBe("L");
    expect(defaultShortcut("view.fit")).toBe("F");
    expect(defaultShortcut("neexistuje")).toBe("");
    expect(shortcutOf({ "sketch.line": "Q" }, "sketch.line")).toBe("Q");
    expect(shortcutOf({}, "sketch.line")).toBe("L");
    expect(shortcutOf(undefined, "sketch.rect")).toBe("R");
  });
});

describe("zkratky skici – vyhodnocení stisku (sketchShortcutAction)", () => {
  const all = withDefaultShortcuts();
  it("výchozí klávesy vyberou příkaz skici, bez ohledu na velikost písmen", () => {
    expect(sketchShortcutAction(all, "L")).toBe("sketch.line");
    expect(sketchShortcutAction(all, "l")).toBe("sketch.line");
    expect(sketchShortcutAction(all, "D")).toBe("sketch.dimension");
    expect(sketchShortcutAction(all, "F")).toBe("sketch.fit");
    expect(sketchShortcutAction(all, "G")).toBe("sketch.grid");
    expect(sketchShortcutAction(all, "H")).toBe("sketch.horizontal");
  });
  it("neobsazená klávesa a prázdný vstup nic nevyberou", () => {
    expect(sketchShortcutAction(all, "Q")).toBeNull();
    expect(sketchShortcutAction(all, "")).toBeNull();
    expect(sketchShortcutAction(all, "Ctrl+L")).toBeNull();
  });
  it("stejná klávesa smí být ve 3D i ve skice – ve skice rozhoduje jen skupina Skica", () => {
    // E = Vysunutí (3D) i Elipsa (skica); S = Nová skica (3D) i Drážka; M = Měření (3D) i Měřit; X = Řez (3D) i Osa
    expect(DEFAULT_SHORTCUTS["feature.extrude"]).toBe("E");
    expect(sketchShortcutAction(all, "E")).toBe("sketch.ellipse");
    expect(sketchShortcutAction(all, "S")).toBe("sketch.slot");
    expect(sketchShortcutAction(all, "M")).toBe("sketch.measure");
    expect(sketchShortcutAction(all, "X")).toBe("sketch.centerline");
    // zkratky, které existují jen ve 3D, ve skice nic nespustí
    expect(sketchShortcutAction(all, "0")).toBeNull();
    expect(sketchShortcutAction(all, "Ctrl+K")).toBeNull();
    // přemapování 3D příkazu na klávesu skici skicu neovlivní
    expect(sketchShortcutAction({ ...all, "feature.hole": "L" }, "L")).toBe("sketch.line");
  });
  it("vlastní zkratka nahradí výchozí; kombinace s Ctrl / Alt fungují", () => {
    const sc = { ...all, "sketch.line": "Q", "sketch.rect": "Alt+R", "sketch.circle": "Ctrl+Shift+F2" };
    expect(sketchShortcutAction(sc, "Q")).toBe("sketch.line");
    expect(sketchShortcutAction(sc, "L")).toBeNull();
    expect(sketchShortcutAction(sc, "Alt+R")).toBe("sketch.rect");
    expect(sketchShortcutAction(sc, "R")).toBeNull();
    expect(sketchShortcutAction(sc, "ctrl+shift+f2")).toBe("sketch.circle");
  });
  it("nastavení uložená před přidáním příkazů skici (bez nových id) používají výchozí klávesy", () => {
    const old = { "view.iso": "0", "feature.extrude": "E", "sketch.new": "S" };
    expect(sketchShortcutAction(old, "L")).toBe("sketch.line");
    expect(sketchShortcutAction(old, "S")).toBe("sketch.slot");
    expect(sketchShortcutAction(undefined, "R")).toBe("sketch.rect");
    expect(sketchShortcutAction(null, "T")).toBe("sketch.trim");
  });
  it("duplicita ve skupině Skica: vyhrává příkaz dřív v seznamu (duplicity se nezakazují, stejně jako u 3D)", () => {
    // Kružnice přemapovaná na L koliduje s Úsečkou – Úsečka je v seznamu dřív
    expect(sketchShortcutAction({ ...all, "sketch.circle": "L" }, "L")).toBe("sketch.line");
    // nástroj přemapovaný na F (výchozí „Zobrazit vše“) má přednost před pozdějším sketch.fit
    expect(sketchShortcutAction({ ...all, "sketch.trim": "F" }, "F")).toBe("sketch.trim");
    // uvolněná klávesa po přemapování už nic nedělá
    expect(sketchShortcutAction({ ...all, "sketch.circle": "L" }, "C")).toBeNull();
  });
  it("keyCombo z události klávesnice dává tvar, který sketchShortcutAction očekává", () => {
    expect(keyCombo(key("l"))).toBe("L");
    expect(keyCombo(key("L", { shiftKey: true }))).toBe("L"); // Shift u písmen se nepočítá
    expect(sketchShortcutAction(all, keyCombo(key("l")))).toBe("sketch.line");
    expect(keyCombo(key("r", { altKey: true }))).toBe("Alt+R");
    expect(sketchShortcutAction({ ...all, "sketch.rect": "Alt+R" }, keyCombo(key("r", { altKey: true })))).toBe("sketch.rect");
    expect(sketchShortcutAction(all, keyCombo(key("l", { ctrlKey: true })))).toBeNull(); // Ctrl+L není zkratka skici
  });
});

describe("nastavení – doplnění výchozích zkratek a živé čtení", () => {
  beforeEach(() => {
    g.localStorage = memStorage();
  });
  afterEach(() => {
    delete g.localStorage;
  });

  it("výchozí nastavení obsahuje zkratky 3D i skici", () => {
    expect(DEFAULT_SETTINGS.shortcuts["view.fit"]).toBe("F");
    expect(DEFAULT_SETTINGS.shortcuts["sketch.line"]).toBe("L");
    expect(Object.keys(DEFAULT_SETTINGS.shortcuts).length).toBe(Object.keys(DEFAULT_SHORTCUTS).length + Object.keys(DEFAULT_SKETCH_SHORTCUTS).length);
  });
  it("uložené nastavení bez nových id se načte, vlastní 3D zkratky zůstanou a zkratky skici se doplní", async () => {
    g.localStorage!.setItem(KEY, JSON.stringify({ rev: 3, units: "inch", shortcuts: { "view.fit": "Z", "feature.extrude": "E" } }));
    const s = await fresh();
    const loaded = s.loadSettings();
    expect(loaded.units).toBe("inch");
    expect(loaded.shortcuts["view.fit"]).toBe("Z");
    expect(loaded.shortcuts["view.iso"]).toBe("0");
    expect(loaded.shortcuts["sketch.line"]).toBe("L");
    expect(loaded.shortcuts["sketch.grid"]).toBe("G");
    expect(s.sketchShortcutAction(s.currentShortcuts(), "L")).toBe("sketch.line");
  });
  it("uložené nastavení úplně bez zkratek i prázdné úložiště dají výchozí zkratky", async () => {
    g.localStorage!.setItem(KEY, JSON.stringify({ rev: 3 }));
    let s = await fresh();
    expect(s.loadSettings().shortcuts).toEqual(withDefaultShortcuts());
    g.localStorage = memStorage();
    s = await fresh();
    expect(s.loadSettings().shortcuts).toEqual(withDefaultShortcuts());
    expect(s.currentShortcuts()["sketch.rect"]).toBe("R");
  });
  it("vlastní zkratka skici se uloží a po novém načtení platí", async () => {
    let s = await fresh();
    const next: Settings = { ...s.loadSettings(), shortcuts: { ...s.loadSettings().shortcuts, "sketch.line": "Q" } };
    s.saveSettings(next);
    s = await fresh(); // „nové načtení stránky“
    expect(s.loadSettings().shortcuts["sketch.line"]).toBe("Q");
    expect(s.sketchShortcutAction(s.currentShortcuts(), "Q")).toBe("sketch.line");
    expect(s.sketchShortcutAction(s.currentShortcuts(), "L")).toBeNull();
  });
  it("změna platí hned bez znovunačtení: currentShortcuts() vrací naposledy uložené nastavení", async () => {
    const s = await fresh();
    expect(s.sketchShortcutAction(s.currentShortcuts(), "L")).toBe("sketch.line");
    s.saveSettings({ ...s.loadSettings(), shortcuts: { ...s.loadSettings().shortcuts, "sketch.line": "W" } });
    expect(s.currentShortcuts()["sketch.line"]).toBe("W");
    expect(s.sketchShortcutAction(s.currentShortcuts(), "W")).toBe("sketch.line");
    expect(s.loadSettings().shortcuts["sketch.line"]).toBe("W");
  });
  it("drží nastavení v paměti karty, i když prohlížeč zápis do úložiště odmítne", async () => {
    g.localStorage!.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    const s = await fresh();
    s.saveSettings({ ...s.loadSettings(), shortcuts: { ...s.loadSettings().shortcuts, "sketch.circle": "U" } });
    expect(s.currentShortcuts()["sketch.circle"]).toBe("U");
    expect(s.loadSettings().shortcuts["sketch.circle"]).toBe("U");
  });
  it("poškozená data v úložišti = výchozí nastavení", async () => {
    g.localStorage!.setItem(KEY, "{nejsem json");
    const s = await fresh();
    expect(s.loadSettings().shortcuts["sketch.line"]).toBe("L");
    expect(s.loadSettings().units).toBe("mm");
  });
  it("import nastavení bez zkratek skici doplní výchozí; export → import zachová vlastní", () => {
    const old = JSON.stringify({ app: "mnastrojarna-cad-settings", version: 2, settings: { units: "inch", shortcuts: { "view.fit": "Z" } } });
    const s = importSettings(old);
    expect(s.shortcuts["view.fit"]).toBe("Z");
    expect(s.shortcuts["sketch.line"]).toBe("L");
    const custom: Settings = { ...DEFAULT_SETTINGS, shortcuts: { ...DEFAULT_SETTINGS.shortcuts, "sketch.polygon": "Y" } };
    expect(importSettings(exportSettings(custom)).shortcuts["sketch.polygon"]).toBe("Y");
    expect(() => importSettings(JSON.stringify({ app: "neco-jineho" }))).toThrow();
  });
});
