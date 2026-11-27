import { afterEach, describe, expect, it } from "vitest";
import { AGENT_COMMANDS, parseAgentText } from "./agent";
import { checkFailed, exportCheck, fmtBytes, OUT_COMMANDS, outFileName, parseOutLine, type OutCmd } from "./agent-out";
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
    const outRows = new Set(["uložit", "export", "výkres export", "skica export", "sdílet", "odkaz"].flatMap((w) => AGENT_COMMANDS.filter((c) => c.cmd.startsWith(w)).map((c) => c.cmd)));
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
  // vlna 22, 22a fáze 2: „věrná kopie“ jen po přesné kontrole platnosti souboru – míry souboru proto nesou validExact: true
  it("stejný model a soubor prošel přesnou kontrolou → ✓ věrná kopie (numerický šum se toleruje)", () => {
    const c = exportCheck(model, { solids: 1, volume: 120_000.0004, bbox: [[0, 0, -1e-7], [100, 60, 20.000001]], valid: true, validExact: true, faces: 6 }, "STEP");
    expect(c.validCheck).toBe("exact");
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
    // vlna 22, 22c kolo 7 (test vědomě upraven): platnost souboru se nekontrolovala vůbec → ℹ, ne ✓ (dřív ✓ s „nezkontrolována“)
    expect(c.line).toMatch(/^ℹ kontrola BREP: soubor znovu načten jádrem – objem 10,00 mm³/);
    expect(c.level).toBe("note");
    // platnost souboru se nekontrolovala vůbec → řečeno, žádná „věrná kopie“ (22a)
    expect(c.line).toMatch(/→ odpovídá modelu; platnost souboru nezkontrolována$/);
    expect(c.validCheck).toBe("none");
  });
  it("22a: soubor po zpětném načtení přesnou kontrolou neprojde (model ano) → ⚠ out.reload-invalid s počtem vadných ploch, nikdy „věrná kopie“", () => {
    const m = { ...model, valid: true, validExact: true, faces: 19 };
    const c = exportCheck(m, { solids: 1, volume: 120_000, bbox: box(100, 60, 20), valid: true, validExact: false, badFaces: 14, faces: 19 }, "STEP");
    expect(c.ok).toBe(false);
    expect(c.level).toBe("warn");
    expect(c.code).toBe("out.reload-invalid");
    expect(c.validCheck).toBe("exact");
    expect(c.line).toMatch(/^⚠ kontrola STEP: soubor znovu načten jádrem – těles: 1, objem 120\s000 mm³ \(rozdíl 0,0000 %\), obálka 100,00 × 60,00 × 20,00 mm \(odchylka 0,0000 mm\) – shoda s modelem, ale soubor po načtení NEPROJDE přesnou kontrolou platnosti \(BRepCheck přesnou metodou\): vadných ploch 14 z 19 \(rychlá kontrola: platné; model přesně platný\)/);
    expect(c.line).not.toMatch(/věrná kopie modelu/);
    // model je přesně neplatný už sám (⚠ geom.exact-invalid před exportem) → soubor ho kopíruje i s vadou: také ⚠, ne ✓
    const both = exportCheck({ ...m, validExact: false }, { solids: 1, volume: 120_000, bbox: box(100, 60, 20), valid: true, validExact: false, badFaces: 3, faces: 19 }, "STEP");
    expect(both.code).toBe("out.reload-invalid");
    expect(both.line).toMatch(/vadných ploch 3 z 19 \(rychlá kontrola: platné; model je přesnou kontrolou neplatný také\)/);
    expect(both.line).not.toMatch(/věrná kopie modelu|model přesně platný/);
    // příčina se bez rozboru nepíše (kolo 4: dřív „čtečka nastaví tolerance …“ vždy, i bez ověření)
    expect(c.line).not.toMatch(/čtečka STEP nastaví|přepočtu tolerancí/);
  });
  it("22a kolo 4: příčinu ⚠ out.reload-invalid doloží přepočet tolerancí načteného souboru – „geometrie souboru odpovídá“ jen s tolerancí po přepočtu do meze (číslo v řádku); ✓ nikdy", () => {
    const m = { ...model, valid: true, validExact: true, faces: 8, maxTol: 6.3e-5 };
    const f = { solids: 1, volume: 120_000, bbox: box(100, 60, 20), valid: true, validExact: false, badFaces: 2, faces: 8 };
    // tolerance po přepočtu 6e-7 mm ≤ mez 6,3e-5 mm (největší tolerance modelu) → jen tolerance ze čtečky, geometrie odpovídá
    const tol = exportCheck(m, { ...f, retolValid: true, retolMaxTol: 6e-7 }, "STEP");
    expect(tol).toMatchObject({ ok: false, level: "warn", code: "out.reload-invalid" });
    expect(tol.line).toMatch(/vadných ploch 2 z 8 \(rychlá kontrola: platné; model přesně platný\); čtečka STEP nastaví tolerance hran menší než odchylka křivek od ploch – po přepočtu tolerancí hran a vrcholů soubor přesnou kontrolou projde s tolerancí nejvýše 6,0e-7 mm \(mez 6,3e-5 mm = největší tolerance modelu\) → geometrie souboru odpovídá – soubor nepotvrzen jako kopie modelu/);
    expect(tol.line).not.toMatch(/věrná kopie modelu/);
    // oponent kolo 4: křivky hran 0,01–0,5 mm od ploch – přepočet tolerance zvětší (0,5 mm) a soubor projde; to NENÍ shoda geometrie
    const wide = exportCheck(m, { ...f, retolValid: true, retolMaxTol: 0.5 }, "STEP");
    expect(wide).toMatchObject({ ok: false, level: "warn", code: "out.reload-invalid" });
    expect(wide.line).toMatch(/; po přepočtu tolerancí hran a vrcholů soubor přesnou kontrolou projde, ale s tolerancí 0,5000 mm \(mez 6,3e-5 mm = největší tolerance modelu\) – shoda geometrie souboru s modelem nepotvrzena/);
    expect(wide.line).not.toMatch(/geometrie souboru odpovídá|čtečka STEP nastaví|věrná kopie/);
    // nad mez i o málo (tolerance modelu 6,3e-5, po přepočtu 1e-4) → nepotvrzeno
    expect(exportCheck(m, { ...f, retolValid: true, retolMaxTol: 1e-4 }, "STEP").line).toMatch(/s tolerancí 1,0e-4 mm \(mez 6,3e-5 mm = největší tolerance modelu\) – shoda geometrie souboru s modelem nepotvrzena/);
    // tolerance po přepočtu nezměřena → nepotvrzeno; bez míry modelu mez 0,001 mm
    expect(exportCheck(m, { ...f, retolValid: true }, "STEP").line).toMatch(/projde, ale s tolerancí nezjištěnou \(mez 6,3e-5 mm = největší tolerance modelu\) – shoda geometrie souboru s modelem nepotvrzena/);
    expect(exportCheck({ ...m, maxTol: undefined }, { ...f, retolValid: true, retolMaxTol: 4e-4 }, "STEP").line).toMatch(/s tolerancí nejvýše 4,0e-4 mm \(mez 0,0010 mm\) → geometrie souboru odpovídá/);
    expect(exportCheck({ ...m, maxTol: undefined }, { ...f, retolValid: true, retolMaxTol: 2e-3 }, "STEP").line).toMatch(/s tolerancí 0,0020 mm \(mez 0,0010 mm\) – shoda geometrie souboru s modelem nepotvrzena/);
    // tolerance modelu nad 0,001 mm: mez zůstane 0,001 mm (shoda geometrie se netvrdí s tolerancí 0,05 mm jen proto, že model ji má)
    expect(exportCheck({ ...m, maxTol: 0.05 }, { ...f, retolValid: true, retolMaxTol: 0.04 }, "STEP").line).toMatch(/s tolerancí 0,0400 mm \(mez 0,0010 mm = největší tolerance modelu\) – shoda geometrie souboru s modelem nepotvrzena/);
  });
  it("22a kolo 4: soubor neprojde ani po přepočtu – příčina jen z naměřené odchylky křivek hran od ploch (soubor × model, týž počet vzorků); bez měření „příčina nezjištěna“", () => {
    const m = { ...model, valid: true, validExact: true, faces: 19, maxTol: 9.7e-5, devMax: 6.05e-5, devSamples: 1000 };
    const f = { solids: 1, volume: 120_000, bbox: box(100, 60, 20), valid: true, validExact: false, badFaces: 15, faces: 19, retolValid: false, retolBadFaces: 2, retolMaxTol: 8.2e-5, devSamples: 1000 };
    // stejná odchylka jako model a na vadných plochách nad tolerancí hran → tolerance podhodnocené, zápis odchylku nezvětšil
    const same = exportCheck(m, { ...f, devMax: 6.05e-5, devOver: 3 }, "STEP");
    expect(same).toMatchObject({ ok: false, level: "warn", code: "out.reload-invalid" });
    expect(same.line).toMatch(/model přesně platný\); ani po přepočtu tolerancí hran a vrcholů soubor přesnou kontrolou neprojde \(vadných ploch 2\): odchylka křivek hran od ploch v souboru nejvýše 6,1e-5 mm, v modelu 6,1e-5 mm \(vzorkováno 1000 bodů na hranu\); na vadných plochách přesahuje odchylka toleranci hrany i po přepočtu \(hran: 3; přepočet vzorkuje\) – zápis odchylku nezvětšil, čtečka STEP a přepočet tolerance hran podhodnotí – soubor nepotvrzen/);
    expect(same.line).not.toMatch(/geometrie souboru odpovídá|věrná kopie/);
    // v souboru větší odchylka než v modelu → vadu přinesl zápis / čtení (export, ne tolerance)
    const worse = exportCheck(m, { ...f, devMax: 0.02, devOver: 5 }, "STEP");
    expect(worse.line).toMatch(/neprojde \(vadných ploch 2\): odchylka křivek hran od ploch v souboru nejvýše 0,0200 mm, v modelu 6,1e-5 mm \(vzorkováno 1000 bodů na hranu\) – v souboru větší než v modelu, vadu přinesl zápis nebo čtení souboru/);
    expect(worse.line).not.toMatch(/zápis odchylku nezvětšil|geometrie souboru odpovídá/);
    // stejná odchylka, ale žádná hrana nad tolerancí → vadné plochy nevysvětluje → příčina nezjištěna (s čísly)
    expect(exportCheck(m, { ...f, devMax: 6.05e-5, devOver: 0 }, "STEP").line).toMatch(/neprojde \(vadných ploch 2\) – příčina nezjištěna \(odchylka křivek hran od ploch v souboru nejvýše 6,1e-5 mm, v modelu 6,1e-5 mm \(vzorkováno 1000 bodů na hranu\)\)/);
    // bez měření odchylky → příčina nezjištěna (dřív nedoložené „příčina není jen v tolerancích po načtení“)
    const none = exportCheck(m, { ...f }, "STEP");
    expect(none.line).toMatch(/neprojde \(vadných ploch 2\) – příčina nezjištěna – soubor nepotvrzen/);
    expect(none.line).not.toMatch(/čtečka STEP nastaví|příčina není jen|zápis odchylku/);
  });
  it("22a: přesná kontrola souboru neproběhla (ploch nad mez) → ✓ jen „odpovídá modelu; platnost souboru jen rychlou kontrolou …“, ne „věrná kopie“", () => {
    const c = exportCheck({ ...model, valid: true }, { solids: 1, volume: 120_000, bbox: box(100, 60, 20), valid: true, validExact: null, faces: 812 }, "STEP");
    expect(c.ok).toBe(true);
    expect(c.validCheck).toBe("fast");
    expect(c.line).toMatch(/→ odpovídá modelu; platnost souboru jen rychlou kontrolou – přesná neproběhla \(812 ploch > 400\)$/);
    expect(c.line).not.toMatch(/věrná kopie/);
  });
  it("počet těles neznámý není „0 těles“; bez objemu nebo s plochami mimo tělesa ale nikdy „věrná kopie“ (vlna 22, 22c)", () => {
    const zero = exportCheck({ volume: 0, bbox: box(1, 2, 5) }, { volume: 0, bbox: box(1, 2, 5) }, "BREP");
    expect(zero.ok).toBe(false);
    expect(zero.code).toBe("out.check-failed");
    expect(zero.line).toBe("⚠ kontrola BREP: počet těles v souboru nezjištěn a objem 0 mm³ – objemový model nepotvrzen; export zkontrolujte (stav)");
    const free = exportCheck({ volume: 10, bbox: box(1, 2, 5), free: 2 }, { volume: 10, bbox: box(1, 2, 5), free: 2 });
    expect(free.ok).toBe(false);
    expect(free.line).toMatch(/^⚠ kontrola STEP: počet těles v souboru nezjištěn a ploch mimo tělesa 2 – /);
    expect(free.line).not.toMatch(/věrná kopie|těles 0/);
  });
  it("prázdný soubor / soubor bez tělesa", () => {
    const e = exportCheck(model, { solids: 0, volume: 0, bbox: box(0, 0, 0) });
    expect(e.ok).toBe(false);
    expect(e.volumeDiffPct).toBe(100);
    expect(checkFailed("BREP", "Soubor nevypadá jako BREP OpenCascade.").line).toBe("✗ kontrola BREP: soubor se nepodařilo znovu načíst – Soubor nevypadá jako BREP OpenCascade.");
  });
});

describe("export skript – dokument jako textové příkazy (cad/doc-script.ts)", () => {
  it("česky, anglicky a německy; jazyk klíčových slov a název souboru", () => {
    const P = (s: string) => parseOutLine(s.split(/\s+/));
    expect(P("export skript")).toEqual({ kind: "script" });
    expect(P("export script")).toEqual({ kind: "script" });
    expect(P("exportieren skript")).toEqual({ kind: "script" });
    expect(P("export skript en")).toEqual({ kind: "script", lang: "en" });
    expect(P("export skript DE forma-v2")).toEqual({ kind: "script", lang: "de", name: "forma-v2" });
    expect(P("export skript jako nastroj 959")).toEqual({ kind: "script", name: "nastroj 959" });
    // přes celý rozbor konzole: jeden výstupní příkaz, žádná chyba
    const prog = parseAgentText('export skript cs "Deska 1"');
    expect(prog.errors).toEqual([]);
    expect(prog.ops).toEqual([{ k: "out", cmd: { kind: "script", lang: "cs", name: "Deska 1" }, line: 1 }]);
  });
  it("název souboru .mncad.txt; zadaná přípona .txt zůstane", () => {
    expect(outFileName(undefined, "Deska", ["mncad.txt", "txt"])).toBe("Deska.mncad.txt");
    expect(outFileName("forma-v2", "Deska", ["mncad.txt", "txt"])).toBe("forma-v2.mncad.txt");
    expect(outFileName("forma.txt", "Deska", ["mncad.txt", "txt"])).toBe("forma.txt");
    expect(outFileName("forma.mncad.txt", "Deska", ["mncad.txt", "txt"])).toBe("forma.mncad.txt");
  });
  it("příkaz je v tabulce příkazů (nápověda konzole, window.mncad.commands)", () => {
    const row = OUT_COMMANDS.find((c) => c.cmd.startsWith("export skript"));
    expect(row).toMatchObject({ en: "export script", de: "export skript" });
    expect(AGENT_COMMANDS.some((c) => c.cmd.startsWith("export skript"))).toBe(true);
  });
});
