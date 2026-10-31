/**
 * „Vejde se váš díl?“ — orientační kontrola podle pracovních rozsahů strojů (pojezdy, nosnost stolu).
 * Čisté funkce, testované ve vitestu. Finální posouzení dělá technolog.
 */
export type FitShape = "rot" | "prism" | "edm";
export type FitInput = { shape: FitShape; d?: number; len?: number; x?: number; y?: number; z?: number; kg?: number };

const desc = (a: number[]) => [...a].sort((p, q) => q - p);
/** Kvádr a×b×c se vejde do obálky A×B×C v libovolné orientaci (rovnoběžně s osami). */
export function boxFits(part: [number, number, number], env: [number, number, number]) {
  const p = desc(part);
  const e = desc(env);
  return p.every((v, i) => v <= e[i]);
}

type Rule = { id: string; shapes: FitShape[]; maxKg?: number; check: (i: Required<Pick<FitInput, "shape">> & FitInput) => boolean };

const dims = (i: FitInput): [number, number, number] =>
  i.shape === "rot" ? [i.d ?? 0, i.d ?? 0, i.len ?? 0] : [i.x ?? 0, i.y ?? 0, i.z ?? 0];

export const FIT_RULES: Rule[] = [
  {
    // AXILE G8: Ø obrobku 1 000 mm, výška dle osy Z (550 mm), stůl 3 000 kg
    id: "axile-g8",
    shapes: ["rot", "prism"],
    maxKg: 3000,
    check: (i) => {
      const [a, b, c] = dims(i);
      // libovolná hrana může být „výška“ ≤ 550, zbylé dvě musí vejít do kruhu Ø 1 000
      const opts: [number, number, number][] = [
        [a, b, c],
        [a, c, b],
        [b, c, a],
      ];
      return opts.some(([p, q, h]) => h <= 550 && Math.hypot(p, q) <= 1000) || (i.shape === "rot" && (i.d ?? 0) <= 1000 && (i.len ?? 0) <= 550);
    },
  },
  {
    // HYPERTUN 65: oběžný průměr nad ložem 500 mm, točná délka 1 150 mm
    id: "hypertun-65",
    shapes: ["rot"],
    check: (i) => (i.d ?? 0) <= 500 && (i.len ?? 0) <= 1150,
  },
  {
    // MCV 754Q: pojezdy 754 / 500 / 550 mm, stůl 400 kg
    id: "mcv-754q",
    shapes: ["prism", "rot"],
    maxKg: 400,
    check: (i) => boxFits(dims(i), [754, 500, 550]),
  },
  {
    // VMCA 760: pojezdy 760 / 440 / 460 mm, stůl 350 kg
    id: "vmca-760",
    shapes: ["prism", "rot"],
    maxKg: 350,
    check: (i) => boxFits(dims(i), [760, 440, 460]),
  },
  {
    // FANUC ROBOCUT: max. obrobek 1 250 × 975 × 500 mm
    id: "fanuc-robocut",
    shapes: ["edm", "prism"],
    check: (i) => boxFits(dims(i), [1250, 975, 500]),
  },
];

export function checkFit(i: FitInput) {
  const valid = i.shape === "rot" ? (i.d ?? 0) > 0 && (i.len ?? 0) > 0 : (i.x ?? 0) > 0 && (i.y ?? 0) > 0 && (i.z ?? 0) > 0;
  return FIT_RULES.filter((r) => r.shapes.includes(i.shape)).map((r) => ({
    id: r.id,
    ok: valid && r.check(i) && (r.maxKg == null || (i.kg ?? 0) <= r.maxKg),
  }));
}
