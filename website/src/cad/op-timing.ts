/**
 * Časy operací běhu pro stručný protokol (`Σ … slow=L395:motion:12.1`) a JSON (`timing`: 5 nejpomalejších operací).
 * Smyčka běhu (engine) obalí každou operaci `timer.time(line, opKind(op), () => …)`; pohybová studie a kontrola kolizí k tomu
 * dodají podrobnosti (MotionResult.timing, InterferenceStats). Čisté funkce bez jádra a bez Reactu.
 */

/** Doba jedné operace: řádek skriptu, druh (ASCII, stejný ve všech jazycích), milisekundy. */
export type OpTime = { line: number; op: string; ms: number };

export type OpTimer = {
  /** zapíše hotovou operaci */
  add(line: number, op: string, ms: number): void;
  /** změří asynchronní operaci (zapíše i při výjimce) */
  time<T>(line: number, op: string, fn: () => Promise<T>): Promise<T>;
  /** všechny záznamy v pořadí běhu */
  all(): OpTime[];
  /** `n` nejpomalejších (sestupně podle času, při shodě dřívější řádek) */
  slowest(n?: number): OpTime[];
  /** součet časů operací [ms] */
  total(): number;
};

const clock = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export function opTimer(now: () => number = clock): OpTimer {
  const list: OpTime[] = [];
  const add = (line: number, op: string, ms: number) => {
    list.push({ line, op, ms: Math.max(0, ms) });
  };
  return {
    add,
    async time(line, op, fn) {
      const t0 = now();
      try {
        return await fn();
      } finally {
        add(line, op, now() - t0);
      }
    },
    all: () => list.slice(),
    slowest: (n = 5) => slowestOf(list, n),
    total: () => list.reduce((s, x) => s + x.ms, 0),
  };
}

/** `n` nejpomalejších operací (sestupně, při shodě dřívější řádek). */
export function slowestOf(list: OpTime[], n = 5): OpTime[] {
  return [...list].sort((a, b) => b.ms - a.ms || a.line - b.line).slice(0, Math.max(0, n));
}

/** Hodnota `slow=` do řádku Σ: `L395:motion:12.1` (nejpomalejší operace, sekundy s jedním desetinným místem); null = žádná. */
export function slowField(list: OpTime[]): string | null {
  const top = slowestOf(list, 1)[0];
  if (!top) return null;
  const s = (Math.round(top.ms / 100) / 10).toLocaleString("en-US", { useGrouping: false, minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${top.line > 0 ? `L${top.line}` : "L-"}:${top.op}:${s}`;
}

/**
 * Druh operace pro protokol z operace textového jazyka (AgentOp): `pohyb …` → `motion`, `sestava vazba …` → `mate`,
 * ostatní příkazy sestavy podle podpříkazu (`asm-…`), jinak druh operace (`feature`, `clash`, `drawingCmd` …). Jen [a-z0-9-].
 */
export function opKind(op: { k: string; cmd?: unknown }): string {
  const clean = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "op";
  if (op.k === "asm") {
    const sub = (op.cmd as { k?: string } | undefined)?.k;
    if (sub === "motion") return "motion";
    if (sub === "mate" || sub === "mateEdit") return "mate";
    return sub ? `asm-${clean(sub)}` : "asm";
  }
  return clean(op.k);
}
