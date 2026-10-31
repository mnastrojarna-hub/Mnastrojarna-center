/** Valivá ložiska. */
import { uid, type Feature } from "../types";
import { has, nums, score } from "./parse-util";
import { BEARINGS } from "./tables";
import type { Family } from "./types";
import { chamferAll, fmt, num, part, str, tube } from "./util";

const SEALS = [
  { v: "", l: "otevřené" },
  { v: "2Z", l: "2Z – plechové kryty" },
  { v: "2RS", l: "2RS – gumová těsnění" },
];

export const deepGrooveBearing: Family = {
  id: "bearing6",
  name: "Kuličkové ložisko jednořadé",
  group: "Ložiska",
  icon: "tube",
  standards: ["ISO 15", "DIN 625", "ČSN 02 4630"],
  keywords: ["lozisko", "kulickove lozisko", "bearing", "ball bearing", "6205", "skf", "zkl"],
  params: [
    { key: "code", label: "Označení", kind: "enum", options: Object.keys(BEARINGS).map((k) => ({ v: k, l: `${k} (${BEARINGS[k].d}×${BEARINGS[k].D}×${BEARINGS[k].B})` })), default: "6205" },
    { key: "seal", label: "Krytí", kind: "enum", options: SEALS, default: "2RS" },
    { key: "balls", label: "Modelovat kuličky", kind: "bool", default: true, hint: "vypněte u velkých sestav" },
  ],
  sizes: { key: "code", columns: [{ key: "d", label: "d" }, { key: "D", label: "D" }, { key: "B", label: "B" }], rows: Object.entries(BEARINGS).map(([k, v]) => ({ code: k, ...v })) },
  parse: (q) => {
    const kw = has(q, "lozisk", "bearing", "skf", "zkl", "fag");
    const code = (q.match(/\b(6[0-3]\d{2}|6[02][4-8])(?!\d)/) ?? [])[1];
    if (!kw && !code) return null;
    if (code && !BEARINGS[code]) return kw ? { values: {}, score: 0.5 } : null;
    const seal = /2rs|rs/.test(q) ? "2RS" : /2z|zz/.test(q) ? "2Z" : /otev|open/.test(q) ? "" : undefined;
    const values: Record<string, string> = {};
    if (code) values.code = code;
    if (seal != null) values.seal = seal;
    if (!code && kw) {
      // „ložisko d25“ → první ložisko řady 62 s tímto d
      const d = nums(q)[0];
      const hit = d ? Object.entries(BEARINGS).find(([k, b]) => k.startsWith("62") && b.d === d) : undefined;
      if (hit) values.code = hit[0];
    }
    return { values, score: score(kw, code ? 0.4 : values.code ? 0.3 : 0) || 0.6 };
  },
  describe: (v) => `Ložisko ${v.code}${v.seal ? "-" + v.seal : ""} (${BEARINGS[str(v.code)]?.d}×${BEARINGS[str(v.code)]?.D}×${BEARINGS[str(v.code)]?.B})`,
  make: (v) => {
    const code = str(v.code, "6205");
    const b = BEARINGS[code] ?? BEARINGS["6205"];
    const h = (b.D - b.d) / 2; // výška průřezu
    const dw = h * 0.58; // průměr kuličky
    const dm = (b.d + b.D) / 2;
    const innerOD = dm - dw * 0.55;
    const outerID = dm + dw * 0.55;
    const z = Math.max(7, Math.round((Math.PI * dm) / (dw * 1.6)));
    const f: Feature[] = [tube("Vnitřní kroužek", innerOD, b.d, b.B, 0, "new"), tube("Vnější kroužek", b.D, outerID, b.B, 0, "add"), chamferAll(Math.min(0.6, h * 0.08))];
    if (v.balls !== false) {
      const ball: Feature = { id: uid(), name: "Kulička", type: "sphere", radius: dw / 2, position: [dm / 2, 0, b.B / 2], mode: "add" };
      f.push(ball, { id: uid(), name: "Kuličky", type: "pattern", featureId: ball.id, kind: "circular", count: z, angle: 360, axis: "Z", center: [0, 0, 0] });
    }
    const seal = str(v.seal);
    if (seal) {
      const t = Math.min(0.8, b.B * 0.06);
      f.push(tube("Krytí 1", outerID + 0.2, innerOD - 0.2, t, t * 0.8, "add"), tube("Krytí 2", outerID + 0.2, innerOD - 0.2, t, b.B - t * 1.8, "add"));
    }
    return part(`Ložisko ${code}${seal ? "-" + seal : ""}`, "ocel", f, `${code}${seal ? "-" + seal : ""} – ${b.d}×${b.D}×${b.B}`, seal === "2RS" ? "#7a2e2e" : "#b9c2cc");
  },
};

export const BEARING_FAMILIES: Family[] = [deepGrooveBearing];
export const bearingDesc = (code: string) => `${code} (${BEARINGS[code]?.d}×${BEARINGS[code]?.D}×${fmt(BEARINGS[code]?.B ?? 0)})`;
export const bearingNum = (v: unknown) => num(v);
