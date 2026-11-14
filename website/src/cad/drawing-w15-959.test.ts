/**
 * Vlna 15 – skutečná data testu 959 (střihadlo): výkresy dílů z dokumentu agenta. Soubor je důvěrný a v repozitáři NENÍ –
 * test se bez něj přeskočí (cesta v MN_959_DOC, nebo website/.local/fixtures/959-dokument.json hlavního checkoutu).
 * Ověřuje: Chytré kóty dílů s mnoha dírami bez „vynecháno“ u poloh děr (B12), funkční rozměr rotačního dílu není pomocná
 * kóta (B8) a starší řez sestavy (bez příznaku `normal`) se čte v původní souřadnici (B5). Žádná data dokumentu v testu.
 */
import fs from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { computeDrawing } from "./drawing-dims-harness";
import { parseAgentText } from "./agent";
import { applyDrawingCmd, drawingStatus } from "./drawing-agent";
import { sectionCoord } from "./drawing-section";
import type { SmartResult } from "./drawing-agent";
import type { DrawingOptions } from "./drawing";
import type { CadDoc, DrawingAnnotation } from "./types";
import "./ext/index";
import "./feat/index";

// hlavní checkout: website/.local/fixtures; pracovní strom (.claude/worktrees/<wt>/website): totéž v hlavním checkoutu
const src = [process.env.MN_959_DOC, path.resolve(__dirname, "../../.local/fixtures/959-dokument.json"), path.resolve(__dirname, "../../../../../../website/.local/fixtures/959-dokument.json")].find((f) => !!f && fs.existsSync(f));

/** délka lineární kóty (mm modelu) */
const span = (a: DrawingAnnotation) => (a.type === "dim" && (a.kind === "horizontal" || a.kind === "vertical") ? Math.abs(a.kind === "horizontal" ? a.b[0] - a.a[0] : a.b[1] - a.a[1]) : NaN);
/** počet poloh děr v dílu (body prvků Díra) */
const holePositions = (d: CadDoc) => d.features.filter((f) => f.type === "hole" && !f.suppressed).reduce((n, f) => n + Math.max(1, (f as { points?: unknown[] }).points?.length ?? 0), 0);

describe.skipIf(!src)("test 959 – skutečný dokument (důvěrná data, bez souboru se přeskočí)", () => {
  let asm: CadDoc;
  const parts: CadDoc[] = [];
  beforeAll(async () => {
    const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
      locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
      print: () => undefined,
      printErr: () => undefined,
    });
    r.setOC(oc as never);
    asm = JSON.parse(fs.readFileSync(src!, "utf8")) as CadDoc;
    const seen = new Set<string>();
    for (const c of asm.components ?? []) {
      const d = (c.source as { doc?: CadDoc } | undefined)?.doc;
      if (d && d.drawings?.length && !seen.has(d.name)) {
        seen.add(d.name);
        parts.push(d);
      }
    }
  }, 60_000);

  const plan = async (d: CadDoc, extra: Partial<DrawingOptions> = {}) => {
    const s = d.drawings![0];
    return (await computeDrawing(d, { name: d.name, material: "" }, { ...(s.options as Partial<DrawingOptions>), dimensions: "smart", ...extra })) as SmartResult;
  };

  it("díly s ≥ 6 polohami děr: žádné „vynecháno“ u poloh děr (B12) – automatika vs. kótování od hran", async () => {
    const rows: string[] = [];
    let before = 0;
    let after = 0;
    const plates = parts.filter((d) => holePositions(d) >= 6);
    for (const d of plates) {
      const classic = await plan(d, { dimHoles: "chain" });
      const now = await plan(d);
      const pos = (x: SmartResult) => x.smart!.report.skipped.filter((t) => t.startsWith("poloha díry")).length;
      before += pos(classic);
      after += pos(now);
      rows.push(`${d.name}: od hran ${pos(classic)} vynecháno · auto ${pos(now)} (${JSON.stringify(now.smart!.report.holeMode ?? {})})`);
    }
    console.log(`959 díly s dírami:\n${rows.join("\n")}\nΣ poloha díry vynecháno: od hran ${before} → auto ${after}`);
    expect(plates.length).toBeGreaterThan(0);
    expect(after).toBe(0);
  }, 900_000);

  it("desky 01–07: Kontrola kót – žádná díra bez kóty polohy, chybějící rozměr vždy vysvětlený řádkem „vynecháno“ (2. kontrola)", async () => {
    const plates = parts.filter((d) => /^0[1-7]\b/.test(d.name));
    const rows: string[] = [];
    let missing = 0;
    let unexplained = 0;
    for (const d0 of plates) {
      let d = JSON.parse(JSON.stringify(d0)) as CadDoc;
      for (const t of ["výkres tabulka děr ne", "kótovat"]) {
        const p = parseAgentText(t);
        const op = p.ops[0];
        if (op.k !== "drawingCmd") throw new Error(t);
        d = (await applyDrawingCmd(d, op.cmd, computeDrawing)).doc;
      }
      const st = (await drawingStatus(d, computeDrawing)).text.split("\n");
      const skipped = (st.find((l) => l.startsWith("Vynecháno")) ?? "").replace(/^[^:]*: /, "").split("; ").filter(Boolean);
      expect(skipped.filter((t) => t.startsWith("poloha díry"))).toEqual([]);
      const chk = st.find((l) => l.startsWith("Kontrola kót:"))!;
      const m = /^Kontrola kót: chybí (\d+) z (\d+): (.*)$/.exec(chk);
      const total = m ? Number(m[2]) : Number(/všech (\d+)/.exec(chk)?.[1] ?? 0);
      const miss = m ? m[3].split("; ").map((x) => ({ label: x.replace(/ \(([^()]*)\)$/, ""), source: /\(([^()]*)\)$/.exec(x)?.[1] ?? "" })) : [];
      // zdroj chybějícího rozměru (prvek / jeho skica) musí být jmenován v „vynecháno“
      const owner = (src: string) => {
        const sk = d.features.find((f) => f.name === src && f.type === "sketch");
        const ex = sk ? d.features.find((f) => "sketchId" in f && (f as { sketchId?: string }).sketchId === sk.id) : null;
        return [src, ex?.name].filter(Boolean) as string[];
      };
      const silent = miss.filter((x) => !owner(x.source).some((n) => skipped.some((t) => t.startsWith(`${n}:`))) && !(x.label.includes("×45°") && skipped.some((t) => t.includes("×45°"))));
      missing += miss.length;
      unexplained += silent.length;
      rows.push(`${d.name}: chybí ${miss.length} z ${total}${silent.length ? ` (bez vysvětlení: ${silent.map((x) => `${x.label} (${x.source})`).join("; ")})` : ""}`);
    }
    console.log(`959 desky – Kontrola kót:\n${rows.join("\n")}\nΣ chybí ${missing}, bez vysvětlení ${unexplained}`);
    expect(plates.length).toBe(7);
    expect(unexplained).toBe(0);
  }, 1_200_000);

  it("rotační díl s pomocnou kótou: jako funkční rozměr už v závorce není (B8); starší řez sestavy = souřadnice (B5)", async () => {
    let checked = 0;
    for (const d of parts) {
      const base = await plan(d);
      if (base.smart!.report.kind !== "turned") continue;
      const ref = base.smart!.annotations.filter((a) => a.type === "dim" && a.prefix === "(").map(span).filter((x) => Number.isFinite(x));
      if (!ref.length) continue;
      const fun = await plan(d, { dimFunctional: [ref[0]] });
      const still = fun.smart!.annotations.filter((a) => a.type === "dim" && a.prefix === "(" && Math.abs(span(a) - ref[0]) < 1e-6);
      expect(still).toEqual([]);
      checked++;
    }
    console.log(`959: rotačních dílů s pomocnou kótou ověřeno ${checked}`);
    expect(checked).toBeGreaterThan(0);
    const sec = (asm.drawings?.[0]?.options as Partial<DrawingOptions> | undefined)?.section;
    if (sec) {
      expect(sec.normal).toBeUndefined();
      expect(sectionCoord(sec)).toBe(sec.offset);
    }
  }, 600_000);
});
