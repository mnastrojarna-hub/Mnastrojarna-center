import { afterEach, describe, expect, it } from "vitest";
import { AGENT_COMMANDS, parseAgentText } from "./agent";
import { checkFailed, exportCheck, fmtBytes, outFileName, parseOutLine, type OutCmd } from "./agent-out";
import { setLang } from "./i18n";
import type { Vec3 } from "./types";

afterEach(() => setLang("cs"));

/** příkaz z jednoho řádku přes celý parser konzole */
const cmdOf = (text: string): OutCmd => {
  const p = parseAgentText(text);
  expect(p.errors).toEqual([]);
  expect(p.ops).toHaveLength(1);
  const op = p.ops[0];
  if (op.k !== "out") throw new Error(`není výstup: ${op.k}`);
  return op.cmd;
};
const errOf = (text: string) => {
  const p = parseAgentText(text);
  expect(p.ops).toHaveLength(0);
  return p.errors[0]?.message ?? "";
};

describe("výstupy z konzole – čtení zápisu", () => {
  it("česky: uložit, export, výkres export, skica export, sdílet, odkaz", () => {
    expect(cmdOf("uložit")).toEqual({ kind: "save" });
    expect(cmdOf('uložit "Příruba DN50"')).toEqual({ kind: "save", name: "Příruba DN50" });
    expect(cmdOf("ulozit jako deska.mncad")).toEqual({ kind: "save", name: "deska.mncad" });
    expect(cmdOf("export step")).toEqual({ kind: "export", format: "step" });
    expect(cmdOf('export STP "Díl A"')).toEqual({ kind: "export", format: "step", name: "Díl A" });
    expect(cmdOf("exportovat stl tisk")).toEqual({ kind: "export", format: "stl", name: "tisk" });
    expect(cmdOf("export projekt")).toEqual({ kind: "export", format: "mncad" });
    expect(cmdOf("export vrml")).toEqual({ kind: "export", format: "wrl" });
    expect(cmdOf("výkres export pdf")).toEqual({ kind: "drawing", format: "pdf" });
    expect(cmdOf('výkres export pdf list 2 "Příruba výkres"')).toEqual({ kind: "drawing", format: "pdf", sheet: 2, name: "Příruba výkres" });
    expect(cmdOf("vykres export dxf vše")).toEqual({ kind: "drawing", format: "dxf", sheet: "all" });
    expect(cmdOf('výkres export png list "Detail"')).toEqual({ kind: "drawing", format: "png", sheet: "Detail" });
    expect(cmdOf("skica export dxf")).toEqual({ kind: "sketch" });
    expect(cmdOf('skica export dxf "Skica 2" jako obrys')).toEqual({ kind: "sketch", sketch: "Skica 2", name: "obrys" });
    expect(cmdOf("sdílet")).toEqual({ kind: "share" });
    expect(cmdOf('sdílet výkres dní 30 heslo tajne od "Jan Novák"')).toEqual({ kind: "share", view: "drawing", days: 30, password: "tajne", from: "Jan Novák" });
    expect(cmdOf("sdilet model bez omezení")).toEqual({ kind: "share", view: "model", days: null });
    expect(cmdOf("sdílet 7 dní")).toEqual({ kind: "share", days: 7 });
    expect(cmdOf("sdílet neomezeně úložiště")).toEqual({ kind: "share", days: null, mode: "store" });
    expect(cmdOf("odkaz")).toEqual({ kind: "link" });
  });

  it("anglicky a německy", () => {
    expect(cmdOf("save")).toEqual({ kind: "save" });
    expect(cmdOf("export glb viewer")).toEqual({ kind: "export", format: "glb", name: "viewer" });
    expect(cmdOf("drawing export pdf sheet 2")).toEqual({ kind: "drawing", format: "pdf", sheet: 2 });
    expect(cmdOf("drawing export svg all")).toEqual({ kind: "drawing", format: "svg", sheet: "all" });
    expect(cmdOf("sketch export dxf as outline")).toEqual({ kind: "sketch", name: "outline" });
    expect(cmdOf('share drawing days 30 password secret from "Jane"')).toEqual({ kind: "share", view: "drawing", days: 30, password: "secret", from: "Jane" });
    expect(cmdOf("share unlimited")).toEqual({ kind: "share", days: null });
    expect(cmdOf("link")).toEqual({ kind: "link" });
    expect(cmdOf("speichern Halter")).toEqual({ kind: "save", name: "Halter" });
    expect(cmdOf("exportieren step")).toEqual({ kind: "export", format: "step" });
    expect(cmdOf("zeichnung exportieren pdf blatt 2")).toEqual({ kind: "drawing", format: "pdf", sheet: 2 });
    expect(cmdOf("skizze export dxf")).toEqual({ kind: "sketch" });
    expect(cmdOf("freigeben zeichnung 30 tage passwort geheim von Hans")).toEqual({ kind: "share", view: "drawing", days: 30, password: "geheim", from: "Hans" });
    expect(cmdOf("freigeben unbegrenzt")).toEqual({ kind: "share", days: null });
  });

  it("revize: německé „teilen“ zůstává rozdělení těles (ne sdílení)", () => {
    expect(parseOutLine(["teilen"])).toBeNull();
    expect(parseOutLine(["teilen", "XY"])).toBeNull();
    for (const t of ["nový díl A\nkvádr 10 10 10\nteilen XY", "nový díl A\nkvádr 10 10 10\nrozdělit XY", "nový díl A\nkvádr 10 10 10\naufteilen XY"]) {
      const p = parseAgentText(t);
      expect(p.errors, t).toEqual([]);
      expect(p.ops.some((o) => o.k === "out"), t).toBe(false);
      expect(p.ops.some((o) => o.k === "feature" && o.feature.type === "splitBodies"), t).toBe(true);
    }
    // holé „teilen“ = chyba rozdělení (chybí rovina), ne tiše vytvořený sdílený odkaz
    const bare = parseAgentText("nový díl A\nkvádr 10 10 10\nteilen");
    expect(bare.ops.some((o) => o.k === "out")).toBe(false);
    // tabulka příkazů: německé slovo pro sdílení není zároveň slovem jiného příkazu
    const share = AGENT_COMMANDS.find((c) => c.cmd.startsWith("sdílet"))!;
    expect(share.de).toMatch(/freigeben/);
    expect(share.de).not.toMatch(/teilen/);
  });

  it("revize: slova z tabulky jiných příkazů výstupní parser nepřebírá", () => {
    const outRows = new Set(["uložit", "export", "výkres export", "skica export", "sdílet"].flatMap((w) => AGENT_COMMANDS.filter((c) => c.cmd.startsWith(w)).map((c) => c.cmd)));
    const stolen: string[] = [];
    for (const row of AGENT_COMMANDS) {
      if (outRows.has(row.cmd)) continue;
      for (const col of [row.en, row.de])
        for (const phrase of col.split(/\s*[,·]\s*/)) {
          const words = phrase.trim().split(/\s+/).filter(Boolean);
          if (!words.length || /[{[(]/.test(words[0])) continue;
          let hit: unknown = null;
          try {
            hit = parseOutLine([...words, "XY"]);
          } catch {
            hit = "chyba";
          }
          if (hit) stolen.push(`${row.cmd.slice(0, 30)} → „${phrase}“`);
        }
    }
    expect(stolen).toEqual([]);
  });

  it("chybný zápis → chyba se správným zápisem (ne „neznámý příkaz“)", () => {
    expect(errOf("export")).toMatch(/export potřebuje formát: export step\|stl/);
    expect(errOf("export pdf")).toMatch(/výkres se exportuje příkazem „výkres export pdf“/);
    expect(errOf("export dxf")).toMatch(/výkres → „výkres export dxf“, skica → „skica export dxf“/);
    expect(errOf("export iges")).toMatch(/neznámý formát „iges“/);
    expect(errOf("výkres export")).toMatch(/výkres export potřebuje formát/);
    expect(errOf("výkres export step")).toMatch(/výkres export: neznámý formát „step“/);
    expect(errOf("výkres export pdf list")).toMatch(/chybí číslo nebo název listu/);
    expect(errOf("výkres export pdf list 0")).toMatch(/listy se číslují celými čísly od 1/);
    expect(errOf("skica export pdf")).toMatch(/skica se exportuje jen do DXF/);
    expect(errOf("sdílet heslo")).toMatch(/chybí heslo/);
    expect(errOf("sdílet nesmysl")).toMatch(/sdílet: neznámé slovo „nesmysl“/);
    expect(errOf("sdílet dní 0")).toMatch(/platnost je 1 až 3650 dní/);
    expect(errOf("odkaz nový")).toMatch(/odkaz nemá další volby/);
    for (const t of ["export", "export pdf", "sdílet nesmysl"]) expect(errOf(t)).not.toMatch(/neznámý příkaz/);
  });

  it("revize: číslo listu – holé číslo je list, necelé číslo je chyba (ne tiché zaokrouhlení / název „2.pdf“)", () => {
    expect(cmdOf("výkres export pdf 2")).toEqual({ kind: "drawing", format: "pdf", sheet: 2 });
    expect(cmdOf("výkres export pdf 2 Deska")).toEqual({ kind: "drawing", format: "pdf", sheet: 2, name: "Deska" });
    expect(cmdOf("drawing export dxf 3")).toEqual({ kind: "drawing", format: "dxf", sheet: 3 });
    expect(cmdOf("výkres export pdf jako 2")).toEqual({ kind: "drawing", format: "pdf", name: "2" });
    expect(cmdOf("výkres export pdf list 2 3")).toEqual({ kind: "drawing", format: "pdf", sheet: 2, name: "3" });
    expect(errOf("výkres export pdf list 1,5")).toMatch(/výkres export: listy se číslují celými čísly od 1 – „1,5“/);
    expect(errOf("výkres export pdf 1.5")).toMatch(/celými čísly od 1 – „1.5“/);
    expect(errOf("výkres export pdf 0")).toMatch(/celými čísly od 1/);
  });

  it("revize: export bez kontroly (CS / EN / DE), jen na začátku nebo na konci", () => {
    expect(cmdOf("export step bez kontroly")).toEqual({ kind: "export", format: "step", check: false });
    expect(cmdOf("export step Deska bez kontroly")).toEqual({ kind: "export", format: "step", name: "Deska", check: false });
    expect(cmdOf("export brep bez kontroly jako Deska")).toEqual({ kind: "export", format: "brep", name: "Deska", check: false });
    expect(cmdOf("export step no check")).toEqual({ kind: "export", format: "step", check: false });
    expect(cmdOf("export step without check part")).toEqual({ kind: "export", format: "step", name: "part", check: false });
    expect(cmdOf("export step nocheck")).toEqual({ kind: "export", format: "step", check: false });
    expect(cmdOf("exportieren step ohne prüfung")).toEqual({ kind: "export", format: "step", check: false });
    expect(cmdOf("export step Deska")).toEqual({ kind: "export", format: "step", name: "Deska" });
    // uprostřed názvu zůstává název
    expect(cmdOf('export step "Díl bez kontroly A"')).toEqual({ kind: "export", format: "step", name: "Díl bez kontroly A" });
  });

  it("jiné příkazy zůstávají svým modulům", () => {
    expect(parseOutLine(["výkres", "A3"])).toBeNull();
    expect(parseOutLine(["skica", "XY:", "kružnice", "10"])).toBeNull();
    expect(parseOutLine(["skica", "Skica", "1"])).toBeNull();
    expect(parseOutLine(["pohyb", "export", "csv"])).toBeNull();
    expect(parseOutLine(["kvádr", "10", "10", "10"])).toBeNull();
    const p = parseAgentText("výkres A3 na šířku\nkótovat\nvýkres export pdf\npohyb export csv");
    expect(p.ops.map((o) => o.k)).toEqual(["drawingCmd", "drawingCmd", "out", "asm"]);
  });

  it("polní hlášení: „skica export dxf“ už nezakládá novou skicu; výstup ukončí blok skici", () => {
    const p = parseAgentText("skica XY: obdélník 40 20\nvysunout 5\nskica export dxf\nexport step\nuložit Deska");
    expect(p.errors).toEqual([]);
    expect(p.ops.filter((o) => o.k === "feature" && o.feature.type === "sketch")).toHaveLength(1);
    expect(p.ops.slice(-3).map((o) => (o.k === "out" ? o.cmd.kind : o.k))).toEqual(["sketch", "export", "save"]);
    expect(p.ops.slice(-3).map((o) => o.line)).toEqual([3, 4, 5]);
  });

  it("tabulka příkazů: řádky s CS / EN / DE", () => {
    for (const w of ["uložit", "export step", "výkres export", "skica export dxf", "sdílet"]) {
      const row = AGENT_COMMANDS.find((c) => c.cmd.startsWith(w));
      expect(row, w).toBeTruthy();
      expect(row!.en.length && row!.de.length).toBeTruthy();
    }
    expect(AGENT_COMMANDS.some((c) => /odkaz/.test(c.cmd) && /link/.test(c.en))).toBe(true);
  });
});

describe("názvy souborů a velikosti", () => {
  it("výchozí název, zadaný název, přípona, nepovolené znaky", () => {
    expect(outFileName(undefined, "Kvadr", ["step", "stp"])).toBe("Kvadr.step");
    expect(outFileName("Díl A", "Kvadr", ["step", "stp"])).toBe("Díl A.step");
    expect(outFileName("dil.stp", "Kvadr", ["step", "stp"])).toBe("dil.stp");
    expect(outFileName("dil.step.txt", "Kvadr", ["step", "stp"])).toBe("dil.step.txt.step");
    expect(outFileName('a/b\\c:d*e?"f"<g>|h', "x", ["mncad"])).toBe("a_b_c_d_e_f_g_h.mncad");
    expect(outFileName("  ..  ", "Kvadr", ["pdf"])).toBe("Kvadr.pdf");
    expect(outFileName("x".repeat(300), "Kvadr", ["dxf"]).length).toBe(124);
  });
  it("velikost: B, kB, MB", () => {
    expect(fmtBytes(812)).toBe("812 B");
    expect(fmtBytes(12_595)).toBe("12 kB");
    expect(fmtBytes(2_150)).toBe("2,1 kB");
    expect(fmtBytes(1_468_006)).toBe("1,4 MB");
  });
});

describe("kontrola exportu STEP / BREP", () => {
  const box = (x: number, y: number, z: number): [Vec3, Vec3] => [[0, 0, 0], [x, y, z]];
  const model = { solids: 1, volume: 120_000, bbox: box(100, 60, 20) };
  it("stejný model → ✓ věrná kopie (numerický šum se toleruje)", () => {
    const c = exportCheck(model, { solids: 1, volume: 120_000.0004, bbox: [[0, 0, -1e-7], [100, 60, 20.000001]] }, "STEP");
    expect(c.ok).toBe(true);
    expect(c.line).toMatch(/^✓ kontrola STEP: soubor znovu načten jádrem – těles: 1, objem 120\s000 mm³ \(rozdíl 0,0000 %\), obálka 100,00 × 60,00 × 20,00 mm/);
    expect(c.line).toMatch(/věrná kopie modelu$/);
  });
  it("jiný objem, obálka nebo počet těles → ⚠ s tím, co se liší", () => {
    const v = exportCheck(model, { solids: 1, volume: 118_800, bbox: box(100, 60, 20) });
    expect(v.ok).toBe(false);
    expect(v.line).toMatch(/^⚠ kontrola STEP: soubor se od modelu liší – objem 118\s800 mm³ \(model 120\s000 mm³, rozdíl 1,000 %\)/);
    const b = exportCheck(model, { solids: 1, volume: 120_000, bbox: box(100, 60, 20.5) });
    expect(b.ok).toBe(false);
    expect(b.line).toMatch(/obálka 100,00 × 60,00 × 20,50 mm \(model 100,00 × 60,00 × 20,00 mm, odchylka 0,500 mm\)/);
    const s = exportCheck(model, { solids: 2, volume: 120_000, bbox: box(100, 60, 20) });
    expect(s.ok).toBe(false);
    expect(s.solidsOk).toBe(false);
    expect(s.line).toMatch(/těles 2 \(model 1\)/);
  });
  it("počet těles neznámý (velký model bez kontroly) → věta bez počtu", () => {
    const c = exportCheck({ volume: 10, bbox: box(1, 2, 5) }, { volume: 10, bbox: box(1, 2, 5) }, "BREP");
    expect(c.ok).toBe(true);
    expect(c.line).toMatch(/^✓ kontrola BREP: soubor znovu načten jádrem – objem 10,00 mm³/);
  });
  it("prázdný soubor / soubor bez tělesa", () => {
    const e = exportCheck(model, { solids: 0, volume: 0, bbox: box(0, 0, 0) });
    expect(e.ok).toBe(false);
    expect(e.volumeDiffPct).toBe(100);
    expect(checkFailed("BREP", "Soubor nevypadá jako BREP OpenCascade.").line).toBe("✗ kontrola BREP: soubor se nepodařilo znovu načíst – Soubor nevypadá jako BREP OpenCascade.");
  });
});
