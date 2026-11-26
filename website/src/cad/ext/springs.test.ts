/**
 * Pružiny z tabulky v jádře: platné těleso, L0 a De změřené na tělese, broušené konce = rovinné plochy v z = 0 a z = L0,
 * objem = objem drátu (průřez × délka střednice, u broušených konců numericky jen část drátu mezi rovinami) do 1 %,
 * doba stavby (n ≤ 20 pod 2 s), stlačený tvar, natočení do osy, tažná / zkrutná / talířová, starý prvek Pružina beze změny.
 */
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { docStatusText } from "../agent";
import { buildDoc, buildShape } from "../build";
import { isValidShape } from "../check";
import { compressionPath, compressionSpec, extensionPieces, pathLength, piecesPath, type SpringPath } from "../springs";
import { emptyDoc, type CadDoc, type Feature } from "../types";
import { allExt, getExt, visibleExt } from "./index";
import { compressionPieces, sweepWire } from "./springs-kernel";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({ locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"), print: () => undefined, printErr: () => undefined });
  r.setOC(oc as never);
}, 60_000);

const spring = (ext: string, data: Record<string, unknown>, id = "s"): Feature => ({ id, name: "Pružina", type: "ext", ext, data: { at: [0, 0, 0], axis: "Z", mode: "new", ...data } }) as unknown as Feature;
const doc = (...features: Feature[]): CadDoc => ({ ...emptyDoc("Pružina"), features });

/** objem drátu mezi rovinami z = clip[0] a clip[1]: součet (plocha průřezu uvnitř desky) · ds po střednici */
function wireVolume(p: SpringPath): number {
  const rr = p.d / 2;
  let vol = 0;
  const N = 28;
  for (let i = 1; i < p.pts.length; i++) {
    const a = p.pts[i - 1];
    const b = p.pts[i];
    const ds = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]].map((x) => x / ds);
    if (!p.clip) {
      vol += Math.PI * rr * rr * ds;
      continue;
    }
    // u, v ⟂ t
    const h = Math.abs(t[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    let u = [t[1] * h[2] - t[2] * h[1], t[2] * h[0] - t[0] * h[2], t[0] * h[1] - t[1] * h[0]];
    const ul = Math.hypot(u[0], u[1], u[2]);
    u = u.map((x) => x / ul);
    const v = [t[1] * u[2] - t[2] * u[1], t[2] * u[0] - t[0] * u[2], t[0] * u[1] - t[1] * u[0]];
    let inside = 0;
    let total = 0;
    for (let ir = 0; ir < N; ir++) {
      const rho = ((ir + 0.5) / N) * rr;
      for (let ip = 0; ip < 2 * N; ip++) {
        const f = ((ip + 0.5) / (2 * N)) * 2 * Math.PI;
        const z = m[2] + rho * (Math.cos(f) * u[2] + Math.sin(f) * v[2]);
        total += rho;
        if (z >= p.clip[0] && z <= p.clip[1]) inside += rho;
      }
    }
    vol += Math.PI * rr * rr * (inside / total) * ds;
  }
  return vol;
}

/**
 * objem ze sítě (součet čtyřstěnů) – nezávislý na integraci BRepGProp. Používá se jen v poměru broušená / neoříznutá
 * pružina se stejnou sítí, takže chyba teselace se vykrátí. Síť 0,05 mm / 0,2 rad (dřív 0,01 / 0,1): teselace té jemné
 * sítě (270–360 tis. trojúhelníků) trvala 8–23 s na těleso, celý případ 64–68 s a překračoval limit 60 s, i když prvek
 * sám se staví pod 1,1 s (profil vlna 22, fáze 2, kolo 4). Hrubší síť: případ 16,5 s místo 66 s, odchylka poměru od drátu
 * 4·10⁻⁵ (n 8) a 3·10⁻⁵ (n 20) proti 1,4·10⁻⁴ a 2·10⁻⁵ u jemné – limit 0,001 zůstává beze změny.
 */
function meshVol(sh: r.Shape3D): number {
  const m = sh.mesh({ tolerance: 0.05, angularTolerance: 0.2 });
  const v = m.vertices;
  const t = m.triangles;
  let vol = 0;
  for (let i = 0; i < t.length; i += 3) {
    const a = t[i] * 3;
    const b = t[i + 1] * 3;
    const c = t[i + 2] * 3;
    vol += (v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) - v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) + v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])) / 6;
  }
  return vol;
}

const planeFacesAt = (body: r.Shape3D, z: number) => body.faces.filter((f) => f.geomType === "PLANE" && Math.abs(f.center.z - z) < 1e-6);

describe("tlačná pružina – tvar, který měří jako skutečná", () => {
  it("broušené konce: platné těleso, délka = L0, Ø = De, rovinné dosedací plochy v 0 a L0, objem = drát do 1 %, n = 8 / 20 pod 2 s", async () => {
    for (const n of [8, 20]) {
      const L0 = 50 + (n - 8) * 4;
      const t0 = Date.now();
      const { body, status } = await buildShape(doc(spring("spring.compression", { d: 2, De: 20, L0, n, ends: "ground", material: "SH" })));
      const ms = Date.now() - t0;
      // doba prvku (tažení + broušení + kontrola platnosti) – bez sítě pro zobrazení
      // sdílený stroj: při zátěži nad počet jader se limit 2 s úměrně zvětší (čísla jdou do protokolu testu)
      const load = Math.max(1, os.loadavg()[0] / os.cpus().length);
      console.log(`tlačná n ${n}, L0 ${L0}: prvek ${status[0].ms} ms, buildShape celkem ${ms} ms, zátěž ×${load.toFixed(2)}`);
      expect(status[0].ms).toBeLessThan(2000 * load);
      expect(body).toBeTruthy();
      expect(isValidShape(body!)).toBe(true);
      const [[x0, y0, z0], [x1, y1, z1]] = body!.boundingBox.bounds;
      expect(z0).toBeCloseTo(0, 6);
      expect(z1).toBeCloseTo(L0, 6);
      expect(x1 - x0).toBeCloseTo(20, 2);
      expect(y1 - y0).toBeCloseTo(20, 2);
      // broušené plochy: rovina kolmá na osu přesně v z = 0 a z = L0
      for (const z of [0, L0]) {
        const fs = planeFacesAt(body!, z);
        expect(fs.length, `rovinná plocha v z = ${z}`).toBeGreaterThan(0);
        for (const f of fs) expect(Math.abs(f.normalAt().z)).toBeCloseTo(1, 9);
      }
      const spec = compressionSpec({ d: 2, D: 18, n, L0, ends: "ground" });
      const path96 = compressionPath(spec, 96);
      const want = wireVolume(path96);
      const vol = r.measureVolume(body!);
      // přesně: poměr objemů broušené / neoříznuté pružiny ze sítě (chyba teselace se vykrátí) proti poměru drátu
      const full = sweepWire(compressionPieces(spec), 2, spec);
      const ratioMesh = meshVol(body!) / meshVol(full);
      const ratioWire = want / (Math.PI * pathLength(path96));
      console.log(`tlačná n ${n}: objem tělesa ${vol.toFixed(2)} mm³ (BRepGProp), drát mezi rovinami ${want.toFixed(2)} mm³ (${(((vol - want) / want) * 100).toFixed(2)} %); poměr broušená/neoříznutá síť ${ratioMesh.toFixed(5)} vs drát ${ratioWire.toFixed(5)}`);
      expect(Math.abs(vol - want) / want, `objem ${vol} vs drát ${want}`).toBeLessThan(0.01);
      expect(Math.abs(ratioMesh - ratioWire), "poměr objemů").toBeLessThan(0.001);
    }
  }, 60_000);
  it("obálka broušené pružiny d ≥ 5 = 0…L0 a De (dřív kvádr jádra −0,75·d pod dosedací rovinou – nález 2)", async () => {
    // d 5 De 30 a d 6 De 40: BRepBndLib.AddOptimal počítal ořezanou plochu broušeného konce přes celý obdélník parametrů
    // (stav „Rozměry 30 × 30 × 103,7 mm“, „měřit těleso“ obálka 103,745) – rychlý kvádr (fastbox.ts) krajní bod ověří
    for (const [d, De, L0, n] of [[5, 30, 100, 10], [6, 40, 120, 8], [6.3, 38, 97, 5], [6.3, 50.5, 194, 12]]) {
      const res = await buildDoc(doc(spring("spring.compression", { d, De, L0, n, ends: "ground" })));
      expect(res.status[0].ok).toBe(true);
      const [[x0, y0, z0], [x1, y1, z1]] = res.metrics!.bbox;
      const what = `d ${d} De ${De} L0 ${L0}`;
      expect(z0, what).toBeCloseTo(0, 6);
      expect(z1, what).toBeCloseTo(L0, 6);
      expect(x1 - x0, what).toBeCloseTo(De, 3);
      expect(y1 - y0, what).toBeCloseTo(De, 3);
      // síť tělesa leží v téže obálce (kvádr se jen zpřesnil, nic neuřízl)
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 2; i < res.mesh!.vertices.length; i += 3) {
        lo = Math.min(lo, res.mesh!.vertices[i]);
        hi = Math.max(hi, res.mesh!.vertices[i]);
      }
      expect(lo, what).toBeGreaterThanOrEqual(z0 - 1e-6);
      expect(hi, what).toBeLessThanOrEqual(z1 + 1e-6);
    }
  }, 120_000);
  it("tvar na délce na doraz Ln i u n ≥ 17 (dřív o (n + 2)·3 %·d − d/2 delší – nález 8): platné těleso 0…Ln", async () => {
    for (const [n, ends] of [[20, "ground"], [30, "ground"], [30, "closed"]] as const) {
      const Ln = (n + 2) * 2 + (ends === "closed" ? 3 : 0);
      const t0 = Date.now();
      const res = await buildDoc(doc(spring("spring.compression", { d: 2, De: 20, L0: 2 * Ln, n, ends, len: Ln })));
      console.log(`tlačná n ${n} ${ends} na Ln ${Ln}: ${Date.now() - t0} ms`);
      expect(res.status[0].ok, `n ${n} ${ends}`).toBe(true);
      expect(res.metrics!.valid, `n ${n} ${ends}`).not.toBe(false);
      const [[, , z0], [, , z1]] = res.metrics!.bbox;
      if (ends === "ground") {
        expect(z0).toBeCloseTo(0, 6);
        expect(z1).toBeCloseTo(Ln, 6);
      } else expect(z1 - z0).toBeLessThan(Ln + 0.01);
    }
  }, 180_000);
  it("neobroušené a otevřené konce: objem = π·d²/4 · délka střednice do 1 %", async () => {
    for (const ends of ["closed", "open"] as const) {
      const res = await buildDoc(doc(spring("spring.compression", { d: 2, De: 20, L0: 50, n: 8, ends })));
      expect(res.status.every((s) => s.ok)).toBe(true);
      const want = Math.PI * pathLength(compressionPath(compressionSpec({ d: 2, D: 18, n: 8, L0: 50, ends }), 96));
      expect(Math.abs(res.metrics!.volume - want) / want).toBeLessThan(0.01);
      expect(res.metrics!.bbox[0][2]).toBeGreaterThan(-0.01);
      expect(res.metrics!.bbox[1][2]).toBeLessThan(50.01);
    }
  }, 60_000);
  it("stlačený tvar (len 30), osa X a poloha; výpočet a varování ve stavu prvku", async () => {
    const res = await buildDoc(doc(spring("spring.compression", { d: 2, De: 20, L0: 50, n: 8, len: 30, axis: "X", at: [5, 0, 0], L2: 30 })));
    const st = res.status[0];
    expect(st.ok).toBe(true);
    expect(st.warning).toBeUndefined();
    // výsledek prvku = spočtené hodnoty, které souhrn (featureSummary) nemá – stav je neopakuje (nález 11)
    expect(st.info).toBe("Ln + Sa 23,54 mm · Fn 104,8 N · τn 61 % τzul · vzpěr nevybočí · fe 280 Hz · 13,9 g");
    const [[x0], [x1]] = res.metrics!.bbox;
    expect(x0).toBeCloseTo(5, 4);
    expect(x1).toBeCloseTo(35, 4);
    // napětí nad dovoleným → ⚠ s textem ve stavu prvku
    const hot = await buildDoc(doc(spring("spring.compression", { d: 1, De: 12, n: 6, L0: 40, L2: 12 })));
    expect(hot.status[0].ok).toBe(true);
    // statická kontrola EN 13906-1 bez korekce (τ2 90 %) vyhoví – ⚠ jen jako přísnější kontrola s korekcí k (nález 5)
    expect(hot.status[0].warning).toMatch(/napětí s korekcí k 101 % dovoleného .* staticky vyhoví \(τ2 90 %\)/);
    // stav: varování jednou (⚠ ze stavby), souhrn bez varování, výsledky na řádku „→“ (dřív varování 2× a souhrn 2×)
    const hotDoc = doc(spring("spring.compression", { d: 1, De: 12, n: 6, L0: 40, L2: 12 }));
    const stav = docStatusText(hotDoc, hot).split("\n");
    const i = stav.findIndex((l) => /^ 1\. /.test(l));
    expect(stav[i].match(/korekcí k 101 %/g)?.length).toBe(1);
    expect(stav[i]).toMatch(/– tlačná d 1 · De 12 · L0 40 · n 6 · R 1,276 N\/mm · Ln 8 mm · F2 35,7 N$/);
    expect(stav[i + 1]).toMatch(/^ {4}→ Ln \+ Sa 9,69 mm · Fn /);
    // chyba zadání → ✗ s hláškou
    const bad = await buildDoc(doc(spring("spring.compression", { d: 2, De: 20, L0: 15, n: 8 })));
    expect(bad.status[0].ok).toBe(false);
    expect(bad.status[0].error).toMatch(/délka na doraz/);
  }, 60_000);
});

describe("tažná, zkrutná, talířová", () => {
  it("tažná s německými očky: platné těleso, vnitřní okraje oček v 0 a L0 (± 0,01·n·d), Ø De", async () => {
    for (const loop of ["german", "half", "side"]) {
      const t0 = Date.now();
      const { body } = await buildShape(doc(spring("spring.extension", { d: 1.6, De: 12, n: 12, F0: 5, loop, loop2: loop })));
      console.log(`tažná ${loop}: ${Date.now() - t0} ms`);
      expect(isValidShape(body!)).toBe(true);
      const [[, , z0], [, , z1]] = body!.boundingBox.bounds;
      const geo = extensionPieces({ d: 1.6, D: 10.4, turns: 12, loop: loop as "german" });
      expect(z0).toBeCloseTo(-1.6, 2);
      expect(z1 - 1.6).toBeCloseTo(geo.free, 2);
      if (loop === "german") expect(Math.abs(geo.free - 38.4)).toBeLessThan(0.01 * 12 * 1.6 + 1e-6);
    }
    // objem = π·d²/4 · délka střednice
    const res = await buildDoc(doc(spring("spring.extension", { d: 1.6, De: 12, n: 12 })));
    const want = Math.PI * 0.64 * pathLength(piecesPath(extensionPieces({ d: 1.6, D: 10.4, turns: 12, loop: "german" })));
    expect(Math.abs(res.metrics!.volume - want) / want).toBeLessThan(0.01);
  }, 60_000);
  it("zkrutná s rameny tečnými / radiálními / osovými: platné těleso", async () => {
    for (const leg of ["tangential", "radial", "axial"]) {
      const { body } = await buildShape(doc(spring("spring.torsion", { d: 2, De: 20, n: 6.25, leg1: leg, leg2: leg, l1: 25, l2: 30 })));
      expect(isValidShape(body!), leg).toBe(true);
    }
  }, 60_000);
  it("talířová A40 sloupec 4 × 2: výška L0 = 21,6, objem = 8 talířů", async () => {
    const res = await buildDoc(doc(spring("spring.disc", { series: "A", De: 40, ns: 4, np: 2 })));
    expect(res.status[0].ok).toBe(true);
    expect(res.metrics!.bbox[1][2] - res.metrics!.bbox[0][2]).toBeCloseTo(21.6, 4);
    expect(res.metrics!.bbox[1][0] - res.metrics!.bbox[0][0]).toBeCloseTo(40, 4);
    // průřez talíře je rovnoběžník s výškou t podél osy: objem = π/4·(De² − Di²)·t na talíř
    expect(res.metrics!.volume).toBeCloseTo(8 * (Math.PI / 4) * (40 * 40 - 20.4 * 20.4) * 2.25, 0);
  }, 60_000);
});

describe("registr a starší prvky", () => {
  it("spring.* jsou zaregistrované, ale skryté (jediný vstup = průvodce Pružina)", () => {
    for (const id of ["spring.compression", "spring.extension", "spring.torsion", "spring.disc"]) {
      expect(getExt(id)?.hidden, id).toBe(true);
      expect(visibleExt().some((d) => d.ext === id)).toBe(false);
    }
    expect(allExt().filter((d) => d.ext.startsWith("spring.")).length).toBe(5);
    expect(getExt("spring.table")).toMatchObject({ action: true, hidden: true });
  });
  it("starý prvek Pružina (konstantní stoupání) se staví beze změny", async () => {
    const old: Feature = { id: "o", name: "Pružina 1", type: "spring", radius: 10, pitch: 5, turns: 8, wire: 2, position: [0, 0, 0], axis: "Z", mode: "new" };
    const res = await buildDoc(doc(old));
    expect(res.status[0].ok).toBe(true);
    expect(res.metrics!.volume).toBeCloseTo(1584.13, 0);
  }, 60_000);
});
