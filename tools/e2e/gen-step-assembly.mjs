// Generátor velké STEP sestavy (AP214) pro zátěžové testy 3D prohlížeče — bez závislostí.
//
//   node tools/e2e/gen-step-assembly.mjs <výstup.stp> <MB> [seed]
//
// Sestava = kořen → podsestavy → díly; díl je hranol (n stěn) s m válcovými otvory (roviny,
// válce, kružnice, šev — jako skutečný obráběný díl), barva přes STYLED_ITEM, každý díl má 1–4
// výskyty (NEXT_ASSEMBLY_USAGE_OCCURRENCE + transformace). Velikost souboru řídí počet dílů.
import fs from "node:fs";

const f = (x) => {
  const s = Number(x.toFixed(6)).toString();
  return s.includes(".") || s.includes("e") ? s.replace("e", "E") : `${s}.`;
};

/** Deterministický generátor náhodných čísel (mulberry32). */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Zapíše sestavu do souboru; vrátí { bytes, parts, instances, faces }.
 * @param {string} file
 * @param {{ targetMB: number, seed?: number }} opts
 */
export function writeStepAssembly(file, { targetMB, seed = 1 }) {
  const target = targetMB * 1024 * 1024;
  const rand = rng(seed);
  const fd = fs.openSync(file, "w");
  let id = 0;
  let written = 0;
  let buf = [];
  let bufLen = 0;
  const flush = () => {
    if (!buf.length) return;
    const s = buf.join("");
    fs.writeSync(fd, s);
    written += Buffer.byteLength(s);
    buf = [];
    bufLen = 0;
  };
  const e = (body) => {
    id += 1;
    const line = `#${id}=${body};\n`;
    buf.push(line);
    bufLen += line.length;
    if (bufLen > 1 << 20) flush();
    return `#${id}`;
  };

  buf.push(
    "ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('E2E large assembly'),'2;1');\n" +
      `FILE_NAME('sestava-velka.stp','2026-11-13T00:00:00',(''),(''),'gen-step-assembly','gen','');\n` +
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));\nENDSEC;\nDATA;\n",
  );
  const appCtx = e("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
  e(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${appCtx})`);
  const prodCtx = e(`PRODUCT_CONTEXT('',${appCtx},'mechanical')`);
  const pdCtx = e(`PRODUCT_DEFINITION_CONTEXT('part definition',${appCtx},'design')`);
  const mm = e("(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))");
  const rad = e("(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))");
  const ster = e("(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())");
  const unc = e(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-07),${mm},'distance_accuracy_value','confusion accuracy')`);
  const ctx = e(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${ster}))REPRESENTATION_CONTEXT('',''))`);
  const origin = e("CARTESIAN_POINT('',(0.,0.,0.))");
  const dz = e("DIRECTION('',(0.,0.,1.))");
  const dzn = e("DIRECTION('',(0.,0.,-1.))");
  const dx = e("DIRECTION('',(1.,0.,0.))");
  const axOrigin = () => e(`AXIS2_PLACEMENT_3D('',${origin},${dz},${dx})`);

  const product = (name) => {
    const p = e(`PRODUCT('${name}','${name}','',(${prodCtx}))`);
    const pdf = e(`PRODUCT_DEFINITION_FORMATION('','',${p})`);
    const pd = e(`PRODUCT_DEFINITION('design','',${pdf},${pdCtx})`);
    const pds = e(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
    return { pd, pds };
  };
  const styled = [];

  /** Díl: hranol o n stěnách (poloměr R, výška h) s m otvory. */
  const part = (name) => {
    const n = 6 + Math.floor(rand() * 58);
    const m = 1 + Math.floor(rand() * 8);
    const R = 15 + rand() * 70;
    const h = 5 + rand() * 60;
    const th = (i) => (2 * Math.PI * (i % n)) / n;
    const P = (x, y, z) => e(`CARTESIAN_POINT('',(${f(x)},${f(y)},${f(z)}))`);
    const D = (x, y, z) => {
      const l = Math.hypot(x, y, z);
      return e(`DIRECTION('',(${f(x / l)},${f(y / l)},${f(z / l)}))`);
    };
    const line = (p, d, len) => e(`LINE('',${p},${e(`VECTOR('',${d},${f(len)})`)})`);
    const oe = (ec, s) => e(`ORIENTED_EDGE('',*,*,${ec},${s ? ".T." : ".F."})`);
    const loop = (oes) => e(`EDGE_LOOP('',(${oes.join(",")}))`);
    const faces = [];

    const bp = [], tp = [], bv = [], tv = [];
    for (let i = 0; i < n; i++) {
      const x = R * Math.cos(th(i)), y = R * Math.sin(th(i));
      bp.push(P(x, y, 0));
      tp.push(P(x, y, h));
      bv.push(e(`VERTEX_POINT('',${bp[i]})`));
      tv.push(e(`VERTEX_POINT('',${tp[i]})`));
    }
    const eb = [], et = [], ev = [];
    const side = 2 * R * Math.sin(Math.PI / n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const d = D(Math.cos(th(j)) - Math.cos(th(i)), Math.sin(th(j)) - Math.sin(th(i)), 0);
      eb.push(e(`EDGE_CURVE('',${bv[i]},${bv[j]},${line(bp[i], d, side)},.T.)`));
      et.push(e(`EDGE_CURVE('',${tv[i]},${tv[j]},${line(tp[i], d, side)},.T.)`));
      ev.push(e(`EDGE_CURVE('',${bv[i]},${tv[i]},${line(bp[i], dz, h)},.T.)`));
    }
    // boční stěny
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const mid = (th(i) + th(i) + 2 * Math.PI / n) / 2;
      const ref = D(Math.cos(th(j)) - Math.cos(th(i)), Math.sin(th(j)) - Math.sin(th(i)), 0);
      const pl = e(`PLANE('',${e(`AXIS2_PLACEMENT_3D('',${bp[i]},${D(Math.cos(mid), Math.sin(mid), 0)},${ref})`)})`);
      const lp = loop([oe(eb[i], true), oe(ev[j], true), oe(et[i], false), oe(ev[i], false)]);
      faces.push(e(`ADVANCED_FACE('',(${e(`FACE_OUTER_BOUND('',${lp},.T.)`)}),${pl},.T.)`));
    }
    // otvory
    const hr = Math.min(R * 0.12, (R * 0.55 * Math.PI) / (m + 1));
    const holesB = [], holesT = [];
    for (let k = 0; k < m; k++) {
      const a = (2 * Math.PI * k) / m + 0.3;
      const cx = m === 1 ? 0 : R * 0.55 * Math.cos(a), cy = m === 1 ? 0 : R * 0.55 * Math.sin(a);
      const cb0 = P(cx, cy, 0), ct0 = P(cx, cy, h);
      const pb = P(cx + hr, cy, 0), pt = P(cx + hr, cy, h);
      const vb = e(`VERTEX_POINT('',${pb})`), vt = e(`VERTEX_POINT('',${pt})`);
      const cb = e(`EDGE_CURVE('',${vb},${vb},${e(`CIRCLE('',${e(`AXIS2_PLACEMENT_3D('',${cb0},${dz},${dx})`)},${f(hr)})`)},.T.)`);
      const ct = e(`EDGE_CURVE('',${vt},${vt},${e(`CIRCLE('',${e(`AXIS2_PLACEMENT_3D('',${ct0},${dz},${dx})`)},${f(hr)})`)},.T.)`);
      const seam = e(`EDGE_CURVE('',${vb},${vt},${line(pb, dz, h)},.T.)`);
      const cyl = e(`CYLINDRICAL_SURFACE('',${e(`AXIS2_PLACEMENT_3D('',${cb0},${dz},${dx})`)},${f(hr)})`);
      const lp = loop([oe(seam, true), oe(ct, true), oe(seam, false), oe(cb, false)]);
      faces.push(e(`ADVANCED_FACE('',(${e(`FACE_OUTER_BOUND('',${lp},.T.)`)}),${cyl},.F.)`));
      holesB.push(e(`FACE_BOUND('',${loop([oe(cb, true)])},.T.)`));
      holesT.push(e(`FACE_BOUND('',${loop([oe(ct, false)])},.T.)`));
    }
    // dno a víko
    const bl = loop(Array.from({ length: n }, (_, k) => oe(eb[n - 1 - k], false)));
    const plB = e(`PLANE('',${e(`AXIS2_PLACEMENT_3D('',${origin},${dzn},${dx})`)})`);
    faces.push(e(`ADVANCED_FACE('',(${[e(`FACE_OUTER_BOUND('',${bl},.T.)`), ...holesB].join(",")}),${plB},.T.)`));
    const tl = loop(et.map((x) => oe(x, true)));
    const plT = e(`PLANE('',${e(`AXIS2_PLACEMENT_3D('',${P(0, 0, h)},${dz},${dx})`)})`);
    faces.push(e(`ADVANCED_FACE('',(${[e(`FACE_OUTER_BOUND('',${tl},.T.)`), ...holesT].join(",")}),${plT},.T.)`));

    const solid = e(`MANIFOLD_SOLID_BREP('${name}',${e(`CLOSED_SHELL('',(${faces.join(",")}))`)})`);
    const col = e(`COLOUR_RGB('',${f(0.3 + rand() * 0.7)},${f(0.3 + rand() * 0.7)},${f(0.3 + rand() * 0.7)})`);
    const fill = e(`FILL_AREA_STYLE('',(${e(`FILL_AREA_STYLE_COLOUR('',${col})`)}))`);
    const sss = e(`SURFACE_SIDE_STYLE('',(${e(`SURFACE_STYLE_FILL_AREA(${fill})`)}))`);
    const psa = e(`PRESENTATION_STYLE_ASSIGNMENT((${e(`SURFACE_STYLE_USAGE(.BOTH.,${sss})`)}))`);
    styled.push(e(`STYLED_ITEM('color',(${psa}),${solid})`));
    const ax = axOrigin();
    const rep = e(`ADVANCED_BREP_SHAPE_REPRESENTATION('',(${solid},${ax}),${ctx})`);
    const pr = product(name);
    e(`SHAPE_DEFINITION_REPRESENTATION(${pr.pds},${rep})`);
    return { ...pr, rep, ax, faces: faces.length, size: Math.max(R, h) };
  };

  const assembly = (name) => {
    const pr = product(name);
    const ax = axOrigin();
    const items = [ax];
    return { ...pr, ax, items, name };
  };
  let nauo = 0;
  const place = (parent, child, x, y, z, angle) => {
    const loc = e(`CARTESIAN_POINT('',(${f(x)},${f(y)},${f(z)}))`);
    const ref = e(`DIRECTION('',(${f(Math.cos(angle))},${f(Math.sin(angle))},0.))`);
    const axp = e(`AXIS2_PLACEMENT_3D('',${loc},${dz},${ref})`);
    parent.items.push(axp);
    nauo += 1;
    const occ = e(`NEXT_ASSEMBLY_USAGE_OCCURRENCE('${nauo}','${nauo}','',${parent.pd},${child.pd},$)`);
    const pds = e(`PRODUCT_DEFINITION_SHAPE('','',${occ})`);
    const idt = e(`ITEM_DEFINED_TRANSFORMATION('','',${child.ax},${axp})`);
    return { pds, idt, childRep: child.rep };
  };
  const pendingLinks = [];

  const root = assembly("SESTAVA-084");
  const subs = [];
  const nSubs = 12;
  for (let s = 0; s < nSubs; s++) subs.push(assembly(`PODSESTAVA-${s + 1}`));
  let parts = 0, instances = 0, faces = 0;
  while (written + bufLen < target * 0.985) {
    const sIdx = parts % nSubs;
    const sub = subs[sIdx];
    const p = part(`DIL-${String(parts + 1).padStart(5, "0")}`);
    parts += 1;
    const count = 1 + Math.floor(rand() * 4);
    for (let c = 0; c < count; c++) {
      const k = sub.items.length;
      const x = (k % 20) * 180, y = Math.floor(k / 20) * 180;
      pendingLinks.push({ sub, link: place(sub, p, x, y, 0, rand() * Math.PI) });
      instances += 1;
      faces += p.faces;
    }
  }
  // reprezentace podsestav (položky = umístění) + vazby dílů
  for (const s of subs) s.rep = e(`SHAPE_REPRESENTATION('',(${s.items.join(",")}),${ctx})`);
  for (const s of subs) e(`SHAPE_DEFINITION_REPRESENTATION(${s.pds},${s.rep})`);
  const link = (parentRep, l) => {
    const rr = e(`(REPRESENTATION_RELATIONSHIP('','',${l.childRep},${parentRep})REPRESENTATION_RELATIONSHIP_WITH_TRANSFORMATION(${l.idt})SHAPE_REPRESENTATION_RELATIONSHIP())`);
    e(`CONTEXT_DEPENDENT_SHAPE_REPRESENTATION(${rr},${l.pds})`);
  };
  for (const { sub, link: l } of pendingLinks) link(sub.rep, l);
  // podsestavy v kořeni (mřížka 3 × 4, rozteč ~4 m)
  const rootLinks = subs.map((s, i) => place(root, s, (i % 4) * 4000, Math.floor(i / 4) * 4000, 0, 0));
  root.rep = e(`SHAPE_REPRESENTATION('',(${root.items.join(",")}),${ctx})`);
  e(`SHAPE_DEFINITION_REPRESENTATION(${root.pds},${root.rep})`);
  for (const l of rootLinks) link(root.rep, { ...l, childRep: subs[rootLinks.indexOf(l)].rep });
  e(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styled.join(",")}),${ctx})`);
  buf.push("ENDSEC;\nEND-ISO-10303-21;\n");
  flush();
  fs.closeSync(fd);
  return { bytes: written, parts, instances, faces };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out, mb, seed] = process.argv.slice(2);
  if (!out || !mb) {
    console.error("použití: node tools/e2e/gen-step-assembly.mjs <výstup.stp> <MB> [seed]");
    process.exit(2);
  }
  const t = Date.now();
  const r = writeStepAssembly(out, { targetMB: Number(mb), seed: Number(seed ?? 1) });
  console.log(`${out}: ${(r.bytes / 1048576).toFixed(1)} MB, ${r.parts} dílů, ${r.instances} výskytů, ${r.faces} stěn (${Date.now() - t} ms)`);
}
