#!/usr/bin/env node
/**
 * Generátor realistické sestavy STEP AP214 pro zátěžové testy importu (chyba „sestava 46 MB se otevře, ale nic není vidět“).
 *
 * Vytvoří strojní sestavu se strukturou výrobku (XCAF: NEXT_ASSEMBLY_USAGE_OCCURRENCE): rám 3 m daleko od počátku, desky s dírami a
 * zaobleními, tvarové díly z šablonování a tažení po splinech (plochy B-spline), zkroucené profily, šrouby, několik dílů s modelovaným
 * závitem; část dílů je v sestavě vložena vícekrát (instance jednoho výrobku). Velikost souboru se řídí počtem a složitostí dílů.
 *
 *   node scripts/gen-big-step.mjs --mb 46 --out /tmp/mn-big-46.step            (≈ 46 MB, výchozí)
 *   node scripts/gen-big-step.mjs --mb 10 --out /tmp/mn-big-10.step
 *   node scripts/gen-big-step.mjs --mb 10 --unit m --out /tmp/mn-big-10-m.step (soubor v metrech)
 *
 * Velké soubory se do repozitáře neukládají – testy si je vygenerují do dočasné složky (viz `ensureBigStep`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

let ocP = null;
async function loadOC() {
  if (!ocP) {
    ocP = (async () => {
      const r = await import("replicad");
      const wasm = require.resolve("replicad-opencascadejs/wasm", { paths: [path.join(here, "..")] });
      const factory = (await import("replicad-opencascadejs")).default;
      const oc = await factory({ locateFile: () => wasm, print: () => undefined, printErr: () => undefined });
      r.setOC(oc);
      return { r, oc };
    })();
  }
  return ocP;
}

/** deterministický generátor náhodných čísel (stejný soubor při stejném zadání) */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** tvarové díly – každý vrací těleso replicad (mm, kolem počátku) */
function makers(r, rand) {
  const between = (a, b) => a + (b - a) * rand();
  const circleAt = (rad, z, sx = 1) => r.drawEllipse(rad * sx, rad).sketchOnPlane("XY", z);
  return {
    /** šablonování přes 5–8 eliptických / zaoblených průřezů (plochy B-spline) + díry */
    loft(k) {
      const n = 5 + (k % 4);
      const h = between(60, 160);
      const secs = [];
      for (let i = 0; i < n; i++) {
        const z = (h * i) / (n - 1);
        const rad = between(18, 40) * (1 + 0.25 * Math.sin(i + k));
        secs.push(i % 2 ? r.drawRoundedRectangle(rad * 2.1, rad * 1.6, rad * 0.45).rotate(i * 11, [0, 0]).sketchOnPlane("XY", z) : circleAt(rad, z, between(0.8, 1.3)));
      }
      let s = secs[0].loftWith(secs.slice(1), { ruled: false });
      const hole = r.makeCylinder(between(4, 8), h * 3, [0, 0, -h], [0, 0, 1]);
      s = s.cut(hole);
      return s;
    },
    /** tažení kruhového / obdélníkového profilu po prostorové spline (trubka, madlo) */
    sweep(k) {
      const pts = [];
      const m = 8 + (k % 7);
      for (let i = 0; i < m; i++) pts.push([i * 25, Math.sin(i * 0.9 + k) * 25, Math.cos(i * 0.7) * 20]);
      const curve = r.makeBSplineApproximation(pts, { tolerance: 0.5, degMax: 3, degMin: 3 });
      const spine = r.assembleWire([curve]);
      const start = pts[0];
      const t = curve.tangentAt(0);
      const plane = new r.Plane(start, undefined, [t.x, t.y, t.z]);
      const prof = k % 2 ? r.drawCircle(between(5, 9)).sketchOnPlane(plane) : r.drawRoundedRectangle(between(10, 16), between(7, 11), 2).sketchOnPlane(plane);
      return r.genericSweep(prof.wire, spine, { frenet: true, transitionMode: "round" });
    },
    /** frézovaná deska: kapsa, díry, zaoblení svislých hran */
    plate(k) {
      const L = between(120, 260);
      const W = between(80, 160);
      const T = between(12, 30);
      let s = r.makeBaseBox(L, W, T);
      try {
        s = s.fillet(between(4, 10), (e) => e.inDirection("Z"));
      } catch {
        /* bez zaoblení */
      }
      const pocket = r.drawRoundedRectangle(L * 0.5, W * 0.45, 8).sketchOnPlane("XY", T * 0.45).extrude(T);
      s = s.cut(pocket);
      const holes = [];
      const nx = 4 + (k % 6);
      for (let i = 0; i < nx; i++)
        for (const y of [-W * 0.35, W * 0.35]) holes.push(r.makeCylinder(between(3, 7), T * 3, [-L * 0.4 + (i * L * 0.8) / (nx - 1), y, -T], [0, 0, 1]));
      for (const h of holes) s = s.cut(h);
      return s;
    },
    /** zkroucený profil (plochy B-spline z twistExtrude) */
    twist(k) {
      const prof = r.drawPolysides(between(20, 35), 5 + (k % 4)).sketchOnPlane("XY");
      return r.twistExtrude(prof.wire, between(40, 140), [0, 0, 0], [0, 0, between(80, 180)]);
    },
    /** šroub s modelovaným závitem (šroubovice – velké plochy B-spline) */
    threaded(k) {
      const d = [8, 10, 12, 16][k % 4];
      const p = [1.25, 1.5, 1.75, 2][k % 4];
      const len = between(30, 60);
      const core = r.makeCylinder(d / 2 - p * 0.6, len, [0, 0, 0], [0, 0, 1]);
      const head = r.drawPolysides(d * 0.9, 6).sketchOnPlane("XY", -d * 0.7).extrude(d * 0.7);
      const helix = r.makeHelix(p, len - p, d / 2 - p * 0.6, [0, 0, 0], [0, 0, 1]);
      // profil závitu (trojúhelník) v rovině XZ na poloměru jádra (náčrt replicadu nejde posunout – kreslí se rovnou na místě)
      const x0 = d / 2 - p * 0.62;
      const tri = r.draw([x0, 0]).lineTo([x0 + p * 0.55, p * 0.45]).lineTo([x0, p * 0.9]).close().sketchOnPlane("XZ", 0);
      let thread;
      try {
        thread = r.genericSweep(tri.wire, helix, { frenet: true }, false);
      } catch {
        thread = null;
      }
      let s = core.fuse(head);
      if (thread) {
        try {
          s = s.fuse(thread);
        } catch {
          /* závit se nesloučil */
        }
      }
      return s;
    },
    /** profil rámu (dutý jekl se zaoblením) dlouhý až 3 m */
    beam(k, len) {
      const a = 80 + (k % 3) * 20;
      const outer = r.drawRoundedRectangle(a, a, 8);
      const inner = r.drawRoundedRectangle(a - 10, a - 10, 3);
      return outer.cut(inner).sketchOnPlane("YZ").extrude(len);
    },
    /** jednoduchý šroub bez závitu (vkládá se mnohokrát) */
    bolt(k) {
      const d = [6, 8, 10][k % 3];
      const shank = r.makeCylinder(d / 2, d * 4, [0, 0, 0], [0, 0, 1]);
      const head = r.makeCylinder(d * 0.8, d * 0.7, [0, 0, -d * 0.7], [0, 0, 1]);
      let s = shank.fuse(head);
      const hex = r.drawPolysides(d * 0.4, 6).sketchOnPlane("XY", -d * 0.7).extrude(d * 0.45);
      s = s.cut(hex);
      try {
        s = s.chamfer(d * 0.08, (e) => e.inPlane("XY", d * 4));
      } catch {
        /* bez sražení */
      }
      return s;
    },
  };
}

const KIND_ORDER = ["loft", "sweep", "plate", "twist", "loft", "sweep", "plate", "bolt"];

/**
 * Vytvoří soubor STEP. `mb` = cílová velikost (díly se přidávají, dokud odhad velikosti nedosáhne cíle), `unit` = "mm" | "m".
 * Vrací statistiky (počet výrobků, instancí, velikost, doba).
 */
export async function generateBigStep({ mb = 46, out, unit = "mm", seed = 7, log = () => undefined } = {}) {
  const t0 = Date.now();
  const { r, oc } = await loadOC();
  const rand = rng(seed);
  const mk = makers(r, rand);
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString("XmlOcaf", true));
  oc.XCAFDoc_ShapeTool.SetAutoNaming(false);
  const main = doc.Main();
  const tool = oc.XCAFDoc_DocumentTool.ShapeTool(main);
  const ctool = oc.XCAFDoc_DocumentTool.ColorTool(main);
  const name = (label, s) => oc.TDataStd_Name.Set(label, new oc.TCollection_ExtendedString(s, true));
  const color = (label, rgb) => ctool.SetColor(label, new oc.Quantity_ColorRGBA(rgb[0], rgb[1], rgb[2], 1), oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);
  const root = tool.NewShape();
  name(root, "Stroj_MN-4500");
  const subFrame = tool.NewShape();
  name(subFrame, "Ram_svarenec");
  /** umístění výskytu: otočení kolem Z (a případně kolem Y), pak posun */
  const loc = (pos, rotZ = 0, rotY = 0) => {
    const t = new oc.gp_Trsf();
    const t2 = new oc.gp_Trsf();
    t.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 0, 1)), (rotZ * Math.PI) / 180);
    t2.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), new oc.gp_Dir(0, 1, 0)), (rotY * Math.PI) / 180);
    const t3 = new oc.gp_Trsf();
    t3.SetTranslation(new oc.gp_Vec(pos[0], pos[1], pos[2]));
    const m = t3.Multiplied(t.Multiplied(t2));
    return new oc.TopLoc_Location(m);
  };
  // strojní rám daleko od počátku (X ≈ 2–5 m): podélníky 3 m, příčníky, sloupky
  const OFF = [2000, 1500, 0];
  const beamL = mk.beam(0, 3000);
  const beamC = mk.beam(1, 900);
  const beamP = mk.beam(2, 1200);
  const lb = tool.AddShape(beamL.wrapped, false, false);
  name(lb, "Podelnik_3000");
  color(lb, [0.35, 0.38, 0.42]);
  const cb = tool.AddShape(beamC.wrapped, false, false);
  name(cb, "Pricnik_900");
  color(cb, [0.35, 0.38, 0.42]);
  const pb = tool.AddShape(beamP.wrapped, false, false);
  name(pb, "Sloupek_1200");
  color(pb, [0.35, 0.38, 0.42]);
  for (const y of [0, 900]) for (const z of [0, 1200]) tool.AddComponent(subFrame, lb, loc([OFF[0], OFF[1] + y, OFF[2] + z]));
  for (const x of [0, 1000, 2000, 3000]) for (const z of [0, 1200]) tool.AddComponent(subFrame, cb, loc([OFF[0] + x, OFF[1], OFF[2] + z], 90));
  for (const x of [0, 3000]) for (const y of [0, 900]) tool.AddComponent(subFrame, pb, loc([OFF[0] + x, OFF[1] + y, OFF[2]], 0, -90));
  tool.AddComponent(root, subFrame, loc([0, 0, 0]));
  let products = 4;
  let instances = 17;
  let faces = 0;
  // odhad velikosti: zapisuje se průběžně po dávkách; přesná velikost až po zápisu
  const targetBytes = mb * 1024 * 1024;
  const writer = () => {
    const session = new oc.XSControl_WorkSession();
    const w = new oc.STEPCAFControl_Writer(session, false);
    w.SetColorMode(true);
    w.SetNameMode(true);
    w.SetLayerMode(true);
    oc.Interface_Static.SetIVal("write.surfacecurve.mode", 1);
    oc.Interface_Static.SetIVal("write.precision.mode", 0);
    oc.Interface_Static.SetIVal("write.step.assembly", 1);
    oc.Interface_Static.SetIVal("write.step.schema", 3); // AP214 IS
    oc.Interface_Static.SetCVal("write.step.product.name", "MN-4500");
    oc.Interface_Static.SetCVal("xstep.cascade.unit", "MM");
    oc.Interface_Static.SetCVal("write.step.unit", unit === "m" ? "M" : "MM");
    return { session, w };
  };
  const bytesOfShape = (s) => {
    // velikost samotného dílu v STEP (pro odhad celkové velikosti bez opakovaného zápisu celé sestavy)
    const { session, w } = writer();
    const d2 = new oc.TDocStd_Document(new oc.TCollection_ExtendedString("XmlOcaf", true));
    const t2 = oc.XCAFDoc_DocumentTool.ShapeTool(d2.Main());
    t2.AddShape(s.wrapped, false, false);
    const f = `/est_${Math.random().toString(36).slice(2)}.step`;
    const ok = w.Perform(d2, f, new oc.Message_ProgressRange());
    let n = 0;
    if (ok) {
      n = oc.FS.stat(f).size;
      oc.FS.unlink(f);
    }
    w.delete();
    session.delete();
    d2.delete();
    return n;
  };
  let est = 0;
  for (const s of [beamL, beamC, beamP]) est += bytesOfShape(s);
  // podsestavy stanic: na každé desce několik tvarových dílů a šroubů; stanice se opakují podél rámu
  let k = 0;
  let station = 0;
  const kinds = [];
  while (est < targetBytes * 0.97 && products < 600) {
    const st = tool.NewShape();
    name(st, `Stanice_${String(station + 1).padStart(2, "0")}`);
    const plate = mk.plate(k++);
    const pl = tool.AddShape(plate.wrapped, false, false);
    name(pl, `Deska_${station + 1}`);
    color(pl, [0.75, 0.77, 0.8]);
    tool.AddComponent(st, pl, loc([0, 0, 0]));
    const pbytes = bytesOfShape(plate);
    est += pbytes;
    faces += plate.faces.length;
    log(`    plate: ${(pbytes / 1024).toFixed(0)} kB, ${plate.faces.length} ploch`);
    products++;
    instances++;
    const nParts = 4 + (station % 3);
    for (let j = 0; j < nParts && est < targetBytes * 0.97; j++) {
      const kind = KIND_ORDER[kinds.length % KIND_ORDER.length];
      const useThread = station % 9 === 4 && j === 0;
      let s;
      try {
        s = useThread ? mk.threaded(k) : mk[kind](k);
      } catch (e) {
        log(`  díl ${kind} ${k} selhal: ${e.message}`);
        k++;
        continue;
      }
      k++;
      kinds.push(useThread ? "threaded" : kind);
      const lab = tool.AddShape(s.wrapped, false, false);
      name(lab, `${useThread ? "Sroub_zavit" : kind === "bolt" ? "Sroub" : kind[0].toUpperCase() + kind.slice(1)}_${String(k).padStart(3, "0")}`);
      color(lab, [0.4 + 0.5 * rand(), 0.4 + 0.4 * rand(), 0.3 + 0.5 * rand()]);
      const copies = kind === "bolt" ? 6 : j % 3 === 2 ? 2 : 1;
      for (let c = 0; c < copies; c++) tool.AddComponent(st, lab, loc([-60 + c * 25 + j * 20, -30 + (c % 2) * 50, 30 + (kind === "bolt" ? 0 : 10)], c * 30 + j * 45));
      const nb = bytesOfShape(s);
      est += nb;
      faces += s.faces.length;
      log(`    ${useThread ? "threaded" : kind}: ${(nb / 1024).toFixed(0)} kB, ${s.faces.length} ploch`);
      products++;
      instances += copies;
    }
    // stanice se vkládá jednou nebo dvakrát (instance podsestavy) na horní podélníky rámu
    const copies = station % 4 === 1 ? 2 : 1;
    for (let c = 0; c < copies; c++) tool.AddComponent(root, st, loc([OFF[0] + 250 + ((station * 2 + c) % 12) * 230, OFF[1] + 200 + c * 450, OFF[2] + 1300 + Math.floor(station / 6) * 200], 0));
    products++;
    instances += copies;
    station++;
    log(`  stanice ${station}: ${products} výrobků, odhad ${(est / 1048576).toFixed(1)} MB`);
  }
  tool.UpdateAssemblies();
  const { session, w } = writer();
  const tmp = `/big_${Date.now()}.step`;
  if (!w.Perform(doc, tmp, new oc.Message_ProgressRange())) throw new Error("STEP se nepodařilo zapsat");
  const data = oc.FS.readFile(tmp);
  oc.FS.unlink(tmp);
  w.delete();
  session.delete();
  doc.delete();
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, data);
  }
  return { bytes: data.length, products, instances, stations: station, faces, kinds, ms: Date.now() - t0, data: out ? undefined : data };
}

/** Vrátí cestu k vygenerovanému souboru v dočasné složce (vytvoří ho jen jednou). */
export async function ensureBigStep({ mb = 46, unit = "mm", dir = os.tmpdir(), log } = {}) {
  const file = path.join(dir, `mn-big-${mb}${unit === "m" ? "-m" : ""}.step`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) return file;
  await generateBigStep({ mb, unit, out: file, log });
  return file;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (n, d) => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 ? process.argv[i + 1] : d;
  };
  const mb = Number(arg("mb", "46"));
  const unit = arg("unit", "mm");
  const out = arg("out", path.join(os.tmpdir(), `mn-big-${mb}${unit === "m" ? "-m" : ""}.step`));
  const res = await generateBigStep({ mb, unit, out, log: (s) => console.log(s) });
  console.log(`${out}: ${(res.bytes / 1048576).toFixed(1)} MB, ${res.products} výrobků, ${res.instances} instancí, ${res.stations} stanic, ${res.faces} ploch, ${(res.ms / 1000).toFixed(0)} s`);
  process.exit(0);
}
