/**
 * Oblasti k vypálení (spec §2.4): odsazení, sjednocení, ochrana keep polí, strop plochy,
 * přednost ruční sady, ořez a zaokrouhlení. Čisté funkce. Vstupy v jednotkách stránky
 * (body / px zdroje), výstup normalizovaně 0..1.
 */

import { quadBox } from "./lines";
import type { AnonCategory, AnonRegion, AnonSummary, AnonWarning, Box, KeepBox, Quad, RegionSource, Zone } from "./types";

export const CATEGORY_PRIORITY: AnonCategory[] = [
  "custom", "company", "person", "contact", "path", "code", "logo", "signature", "copyright_owner", "other",
];

export function categoryRank(c: AnonCategory): number {
  const i = CATEGORY_PRIORITY.indexOf(c);
  return i < 0 ? CATEGORY_PRIORITY.length : i;
}

/** Oblast v jednotkách stránky (před normalizací). */
export interface RawRegion {
  page: number;
  box: Box;
  quad?: Quad;
  category: AnonCategory;
  source: RegionSource;
  zone: Zone;
  /** Výška písma / řádku (pro odsazení), 0 = grafika. */
  textHeight: number;
  textHash?: string;
  confidence?: number;
  /** Čitelný text (jen do drawing_anon_texts, nikdy do anon_regions). */
  text?: string;
  /** Podřetězec položky (vedle zůstává popisek) — vodorovně bez dalšího odsazení (rezerva je v obdélníku). */
  tight?: boolean;
}

export type PadMode = "vector" | "photo";

/**
 * Odsazení: vektor vodorovně 0,6 × výška písma, svisle 0,25 × výška (min. 1 pt);
 * fotka 0,35 × výška řádku a min. 0,4 % delší strany (≥ 6 px), u čtyřúhelníku kolmo k hranám.
 */
export function padRegion(r: RawRegion, mode: PadMode, pageW: number, pageH: number): RawRegion {
  const h = r.textHeight;
  if (mode === "vector") {
    const px = r.tight ? 0 : h > 0 ? 0.6 * h : 1;
    const py = h > 0 ? Math.max(1, 0.25 * h) : 1;
    if (r.quad) return { ...r, quad: padQuad(r.quad, py, px), box: quadBox(padQuad(r.quad, py, px)) };
    return { ...r, box: { x: r.box.x - px, y: r.box.y - py, w: r.box.w + 2 * px, h: r.box.h + 2 * py } };
  }
  const minPad = Math.max(6, 0.004 * Math.max(pageW, pageH));
  const p = Math.max(minPad, 0.35 * (h > 0 ? h : 0));
  if (r.quad) {
    const q = padQuad(r.quad, p, p);
    return { ...r, quad: q, box: quadBox(q) };
  }
  return { ...r, box: { x: r.box.x - p, y: r.box.y - p, w: r.box.w + 2 * p, h: r.box.h + 2 * p } };
}

/**
 * Rozšíří čtyřúhelník kolmo k hranám. Body po obvodu: p1→p2 = směr textu (délka), p1→p4 = výška.
 * padAcross = podél kratší osy (výška), padAlong = podél směru textu.
 */
export function padQuad(q: Quad, padAcross: number, padAlong: number): Quad {
  const [x1, y1, x2, y2, , , x4, y4] = q;
  let ux = x2 - x1, uy = y2 - y1;
  let vx = x4 - x1, vy = y4 - y1;
  const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
  ux /= lu; uy /= lu; vx /= lv; vy /= lv;
  const ax = -ux * padAlong - vx * padAcross, ay = -uy * padAlong - vy * padAcross;
  const bx = ux * padAlong - vx * padAcross, by = uy * padAlong - vy * padAcross;
  const cx = ux * padAlong + vx * padAcross, cy = uy * padAlong + vy * padAcross;
  const dx = -ux * padAlong + vx * padAcross, dy = -uy * padAlong + vy * padAcross;
  return [q[0] + ax, q[1] + ay, q[2] + bx, q[3] + by, q[4] + cx, q[5] + cy, q[6] + dx, q[7] + dy];
}

export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function intersection(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

export function area(b: Box): number {
  return Math.max(0, b.w) * Math.max(0, b.h);
}

export function iou(a: Box, b: Box): number {
  const i = intersection(a, b);
  if (!i) return 0;
  const ai = area(i);
  return ai / (area(a) + area(b) - ai || 1);
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Keep pole v jednotkách stránky. */
export interface RawKeep {
  page: number;
  box: Box;
  field: KeepBox["field"];
  value?: string;
}

/**
 * Ochrana keep polí: oblast, která keep pole jen ŠKRTNE (odsazením), se ořízne o jeho hranu.
 * Oblast, která keep pole PŘEKRYJE podstatně (> 30 % jeho plochy), se u vektoru zúží na stranu mimo pole;
 * když to nejde (fotka / uvnitř pole), zůstane a vrátí varování keep_overlap → review.
 * custom/path/contact se nikdy nezahodí (termíny se mažou vždy).
 */
export function protectKeep(regions: RawRegion[], keep: RawKeep[], mode: PadMode): { regions: RawRegion[]; warnings: AnonWarning[] } {
  const out: RawRegion[] = [];
  const warnings: AnonWarning[] = [];
  for (const r of regions) {
    let box = r.box;
    let quad = r.quad;
    let overlapWarn = false;
    for (const k of keep) {
      if (k.page !== r.page) continue;
      const inter = intersection(box, k.box);
      if (!inter) continue;
      const share = area(inter) / (area(k.box) || 1);
      // ořez o hranu: zvol stranu, kde leží většina oblasti
      const cut = trimAgainst(box, k.box);
      if (cut && (share < 0.3 || mode === "vector") && area(cut) >= 0.25 * area(box)) {
        box = cut;
        quad = undefined;
        continue;
      }
      if (share >= 0.3 || !cut) overlapWarn = true;
    }
    if (overlapWarn) warnings.push({ code: "keep_overlap", message: "Smazaná oblast zasahuje do chráněného pole (číslo výkresu, materiál…) — zkontroluj.", page: r.page });
    out.push({ ...r, box, ...(quad ? { quad } : { quad: undefined }) });
  }
  return { regions: out, warnings };
}

/** Největší část boxu `a` mimo `k` (vlevo / vpravo / nad / pod), nebo null. */
function trimAgainst(a: Box, k: Box): Box | null {
  const cands: Box[] = [];
  if (k.x > a.x) cands.push({ x: a.x, y: a.y, w: k.x - a.x, h: a.h });
  if (k.x + k.w < a.x + a.w) cands.push({ x: k.x + k.w, y: a.y, w: a.x + a.w - (k.x + k.w), h: a.h });
  if (k.y > a.y) cands.push({ x: a.x, y: a.y, w: a.w, h: k.y - a.y });
  if (k.y + k.h < a.y + a.h) cands.push({ x: a.x, y: k.y + k.h, w: a.w, h: a.y + a.h - (k.y + k.h) });
  const valid = cands.filter((c) => c.w > 0 && c.h > 0);
  if (!valid.length) return null;
  return valid.sort((p, q) => area(q) - area(p))[0];
}

/**
 * Sjednocení osových oblastí při překryvu (stejná stránka) — ne přes keep pole. Kategorie podle priority.
 * Čtyřúhelníky se neslučují.
 */
export function mergeRegions(regions: RawRegion[], keep: RawKeep[] = []): RawRegion[] {
  const quads = regions.filter((r) => r.quad);
  const boxes = regions.filter((r) => !r.quad).map((r) => ({ ...r }));
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        // text se slučuje s textem, grafika s grafikou (kategorie loga se neztratí pod firmou)
        if (a.page !== b.page || (a.textHeight > 0) !== (b.textHeight > 0) || !intersects(a.box, b.box)) continue;
        const u = union(a.box, b.box);
        const crossesKeep = keep.some((k) => k.page === a.page && intersects(u, k.box) && !intersects(a.box, k.box) && !intersects(b.box, k.box));
        if (crossesKeep) continue;
        const winner = categoryRank(a.category) <= categoryRank(b.category) ? a : b;
        boxes[i] = {
          ...winner,
          box: u,
          textHeight: Math.max(a.textHeight, b.textHeight),
          source: a.source === b.source ? a.source : winner.source,
          zone: a.zone === b.zone ? a.zone : (a.zone !== "body" ? a.zone : b.zone),
          text: [a.text, b.text].filter(Boolean).join(" · ") || undefined,
          textHash: a.textHash ?? b.textHash,
          confidence: Math.min(a.confidence ?? 1, b.confidence ?? 1),
        };
        boxes.splice(j, 1);
        changed = true;
        break outer;
      }
    }
  }
  return [...boxes, ...quads];
}

/** Strop: součet oblastí > 25 % plochy razítka nebo > 8 % stránky → review. */
export function areaCapWarning(regions: RawRegion[], pageW: number, pageH: number, titleBlock: Box | null, page: number): AnonWarning | null {
  const on = regions.filter((r) => r.page === page);
  const total = on.reduce((s, r) => s + area(r.box), 0);
  if (total > 0.08 * pageW * pageH) {
    return { code: "area_cap", message: "Smazaná plocha je neobvykle velká (> 8 % stránky) — zkontroluj, že nezmizely technické údaje.", page };
  }
  if (titleBlock && area(titleBlock) > 0) {
    const inTb = on.reduce((s, r) => s + area(intersection(r.box, titleBlock) ?? { x: 0, y: 0, w: 0, h: 0 }), 0);
    if (inTb > 0.25 * area(titleBlock)) {
      return { code: "area_cap", message: "Smazaná plocha v razítku je neobvykle velká (> 25 %) — zkontroluj.", page };
    }
  }
  return null;
}

const R5 = (v: number) => Math.round(v * 1e5) / 1e5;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Do 0..1 vůči stránce, ořez a zaokrouhlení na 1e-5. */
export function normalizeRegion(r: RawRegion, pageW: number, pageH: number, id: string): AnonRegion | null {
  const x0 = clamp01(r.box.x / pageW), y0 = clamp01(r.box.y / pageH);
  const x1 = clamp01((r.box.x + r.box.w) / pageW), y1 = clamp01((r.box.y + r.box.h) / pageH);
  if (x1 - x0 <= 0 || y1 - y0 <= 0) return null;
  const out: AnonRegion = {
    id, page: r.page, x: R5(x0), y: R5(y0), w: R5(x1 - x0), h: R5(y1 - y0),
    category: r.category, source: r.source, zone: r.zone,
  };
  if (r.quad) {
    out.quad = r.quad.map((v, i) => R5(clamp01(v / (i % 2 === 0 ? pageW : pageH)))) as Quad;
  }
  if (r.textHash) out.textHash = r.textHash;
  if (typeof r.confidence === "number") out.confidence = Math.round(r.confidence * 1000) / 1000;
  return out;
}

/** Stabilní pořadí (stránka, shora dolů, zleva doprava). */
export function sortRegions<T extends { page: number; x: number; y: number }>(rs: T[]): T[] {
  return [...rs].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}

/**
 * Ruční sada má přednost: manual:"removed" zruší automatický zásah (stejné id, nebo IoU ≥ 0,5 na stejné
 * stránce — i pravidla), manual:"added" se nikdy nepřepočítá.
 */
export function applyManual(auto: AnonRegion[], manual: AnonRegion[]): AnonRegion[] {
  const removed = manual.filter((m) => m.manual === "removed");
  const added = manual.filter((m) => m.manual === "added");
  const kept = auto.filter((a) => !removed.some((m) => m.id === a.id || (m.page === a.page && iou(m, a) >= 0.5)));
  return sortRegions([...kept, ...added.map((a) => ({ ...a, source: "manual" as const }))]);
}

/** Oblasti, které se skutečně vypálí (bez ručně zrušených). */
export function burnable(regions: AnonRegion[]): AnonRegion[] {
  return regions.filter((r) => r.manual !== "removed");
}

export function summarize(regions: AnonRegion[], warnings: AnonWarning[] = []): AnonSummary {
  const counts: Partial<Record<AnonCategory, number>> = {};
  const live = burnable(regions);
  for (const r of live) counts[r.category] = (counts[r.category] ?? 0) + 1;
  const seen = new Set<string>();
  const ws = warnings.filter((w) => {
    const k = `${w.code}:${w.page ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { counts, total: live.length, warnings: ws };
}

/** Česky: „firma, 2 jména, cesta (4 oblasti)" — pro historii zakázky. */
export function describeSummary(s: AnonSummary): string {
  const names: Record<AnonCategory, [string, string]> = {
    company: ["firma", "firmy"], logo: ["logo", "loga"], person: ["jméno", "jména"], signature: ["podpis", "podpisy"],
    path: ["cesta", "cesty"], contact: ["kontakt", "kontakty"], code: ["kód", "kódy"], copyright_owner: ["vlastník v doložce", "vlastníci v doložce"],
    custom: ["termín", "termíny"], other: ["jiné", "jiné"],
  };
  const parts: string[] = [];
  for (const c of CATEGORY_PRIORITY) {
    const n = s.counts[c] ?? 0;
    if (!n) continue;
    parts.push(n === 1 ? names[c][0] : `${n} ${names[c][1]}`);
  }
  if (!parts.length) return "nic k smazání";
  const word = s.total === 1 ? "oblast" : s.total >= 2 && s.total <= 4 ? "oblasti" : "oblastí";
  return `${parts.join(", ")} (${s.total} ${word})`;
}
