/**
 * Řez rovinou: průnik trojúhelníkové sítě s rovinou (úsečky obrysu řezu) a jejich spojení
 * do křivek — úsečky, oblouky, kružnice (díry v řezu → střed), rohy. Výsledek má stejný tvar
 * jako topologie dílu, takže na něj funguje stejné uchopování při měření.
 */
import { classifyPolyline, weldVertices, type Curve, type Vec3 } from "./topology";

export interface PlaneDef {
  /** Jednotková normála. */
  normal: Vec3;
  /** n·p + constant = 0 (jako THREE.Plane). */
  constant: number;
}

export interface SectionTopology {
  edgeSegments: Float32Array;
  curves: Curve[];
  segCurve: Uint32Array;
  corners: Float32Array;
}

/** Úsečky průniku sítě s rovinou (dvojice bodů xyz). */
export function sliceMesh(positions: Float32Array, indices: Uint32Array | null | undefined, plane: PlaneDef): Float32Array {
  const [nx, ny, nz] = plane.normal;
  const c = plane.constant;
  const tri = indices ? Math.floor(indices.length / 3) : Math.floor(positions.length / 9);
  const out: number[] = [];
  const d = new Float64Array(3);
  const vi = [0, 0, 0];
  for (let t = 0; t < tri; t++) {
    for (let k = 0; k < 3; k++) {
      const v = indices ? indices[t * 3 + k] : t * 3 + k;
      vi[k] = v;
      d[k] = nx * positions[v * 3] + ny * positions[v * 3 + 1] + nz * positions[v * 3 + 2] + c;
    }
    // vrchol přesně v rovině bere jako „kladný" — žádné zdvojené body
    const s0 = d[0] >= 0, s1 = d[1] >= 0, s2 = d[2] >= 0;
    if (s0 === s1 && s1 === s2) continue;
    let n = 0;
    for (let k = 0; k < 3; k++) {
      const a = k;
      const b = (k + 1) % 3;
      const sa = d[a] >= 0;
      const sb = d[b] >= 0;
      if (sa === sb) continue;
      const tt = d[a] / (d[a] - d[b]);
      const pa = vi[a] * 3;
      const pb = vi[b] * 3;
      out.push(
        positions[pa] + (positions[pb] - positions[pa]) * tt,
        positions[pa + 1] + (positions[pb + 1] - positions[pa + 1]) * tt,
        positions[pa + 2] + (positions[pb + 2] - positions[pa + 2]) * tt,
      );
      n++;
    }
    if (n !== 2) out.length -= n * 3;
  }
  return Float32Array.from(out);
}

const COS_CORNER = Math.cos((25 * Math.PI) / 180);

/** Spojí úsečky řezu do křivek a rozpozná je (úsečka / oblouk / kružnice), rohy = zlomy obrysu. */
export function chainSegments(segs: Float32Array, tol: number): SectionTopology {
  const segCount = Math.floor(segs.length / 6);
  if (!segCount) return { edgeSegments: new Float32Array(0), curves: [], segCurve: new Uint32Array(0), corners: new Float32Array(0) };
  const { ids, count, rep } = weldVertices(segs, Math.max(tol, 1e-7));
  const pos = new Float64Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = segs[rep[i] * 3];
    pos[i * 3 + 1] = segs[rep[i] * 3 + 1];
    pos[i * 3 + 2] = segs[rep[i] * 3 + 2];
  }
  // sousednost
  const adj: number[][] = Array.from({ length: count }, () => []);
  const ea: number[] = [];
  const eb: number[] = [];
  for (let s = 0; s < segCount; s++) {
    const a = ids[s * 2];
    const b = ids[s * 2 + 1];
    if (a === b) continue;
    const e = ea.length;
    ea.push(a);
    eb.push(b);
    adj[a].push(e);
    adj[b].push(e);
  }
  const used = new Uint8Array(ea.length);
  const chains: { verts: number[]; closed: boolean }[] = [];
  const walk = (start: number, firstEdge: number) => {
    const verts = [start];
    let v = start;
    let e = firstEdge;
    for (;;) {
      used[e] = 1;
      const next = ea[e] === v ? eb[e] : ea[e];
      if (next === start) return { verts, closed: true };
      verts.push(next);
      if (adj[next].length !== 2) return { verts, closed: false };
      const ne = adj[next][0] === e ? adj[next][1] : adj[next][0];
      if (used[ne]) return { verts, closed: false };
      v = next;
      e = ne;
    }
  };
  for (let v = 0; v < count; v++) {
    if (adj[v].length === 2) continue;
    for (const e of adj[v]) if (!used[e]) chains.push(walk(v, e));
  }
  for (let e = 0; e < ea.length; e++) if (!used[e]) chains.push(walk(ea[e], e));

  // rozdělit na zlomech (rohy obrysu)
  const isCorner = (prev: number, cur: number, next: number) => {
    const ax = pos[cur * 3] - pos[prev * 3], ay = pos[cur * 3 + 1] - pos[prev * 3 + 1], az = pos[cur * 3 + 2] - pos[prev * 3 + 2];
    const bx = pos[next * 3] - pos[cur * 3], by = pos[next * 3 + 1] - pos[cur * 3 + 1], bz = pos[next * 3 + 2] - pos[cur * 3 + 2];
    const la = Math.hypot(ax, ay, az);
    const lb = Math.hypot(bx, by, bz);
    if (la === 0 || lb === 0) return false;
    return (ax * bx + ay * by + az * bz) / (la * lb) < COS_CORNER;
  };
  const pieces: { verts: number[]; closed: boolean }[] = [];
  for (const ch of chains) {
    const n = ch.verts.length;
    if (ch.closed) {
      const cornersAt: number[] = [];
      for (let i = 0; i < n; i++) if (isCorner(ch.verts[(i - 1 + n) % n], ch.verts[i], ch.verts[(i + 1) % n])) cornersAt.push(i);
      if (!cornersAt.length) {
        pieces.push(ch);
        continue;
      }
      for (let k = 0; k < cornersAt.length; k++) {
        const from = cornersAt[k];
        const to = cornersAt[(k + 1) % cornersAt.length];
        const verts: number[] = [];
        for (let i = from; ; i = (i + 1) % n) {
          verts.push(ch.verts[i]);
          if (i === to && verts.length > 1) break;
          if (verts.length > n + 1) break;
        }
        pieces.push({ verts, closed: false });
      }
    } else {
      let start = 0;
      for (let i = 1; i < n - 1; i++) {
        if (isCorner(ch.verts[i - 1], ch.verts[i], ch.verts[i + 1])) {
          pieces.push({ verts: ch.verts.slice(start, i + 1), closed: false });
          start = i;
        }
      }
      pieces.push({ verts: ch.verts.slice(start), closed: false });
    }
  }

  const curves: Curve[] = [];
  const segOut: number[] = [];
  const segCurve: number[] = [];
  const corners = new Set<number>();
  for (const pc of pieces) {
    const n = pc.verts.length;
    if (n < 2) continue;
    const pts = new Float64Array(n * 3);
    pc.verts.forEach((v, i) => {
      pts[i * 3] = pos[v * 3];
      pts[i * 3 + 1] = pos[v * 3 + 1];
      pts[i * 3 + 2] = pos[v * 3 + 2];
    });
    const cls = classifyPolyline(pts, pc.closed, tol);
    const segStart = segOut.length / 6;
    const segs2 = pc.closed ? n : n - 1;
    for (let i = 0; i < segs2; i++) {
      const j = (i + 1) % n;
      segOut.push(pts[i * 3], pts[i * 3 + 1], pts[i * 3 + 2], pts[j * 3], pts[j * 3 + 1], pts[j * 3 + 2]);
      segCurve.push(curves.length);
    }
    const start: Vec3 = [pts[0], pts[1], pts[2]];
    const end: Vec3 = pc.closed ? start : [pts[(n - 1) * 3], pts[(n - 1) * 3 + 1], pts[(n - 1) * 3 + 2]];
    curves.push({
      kind: cls.kind, segStart, segCount: segs2, closed: pc.closed, length: cls.length, start, end, mid: cls.mid,
      center: cls.center, radius: cls.radius, normal: cls.normal,
    });
    if (!pc.closed) {
      corners.add(pc.verts[0]);
      corners.add(pc.verts[n - 1]);
    }
  }
  const c = new Float32Array(corners.size * 3);
  let k = 0;
  for (const v of corners) {
    c[k++] = pos[v * 3];
    c[k++] = pos[v * 3 + 1];
    c[k++] = pos[v * 3 + 2];
  }
  return { edgeSegments: Float32Array.from(segOut), curves, segCurve: Uint32Array.from(segCurve), corners: c };
}
