/**
 * Export 3D modelu jako úloha s pojmenovanými fázemi (vlna 22, bod 22h) – stejný postup pro export z menu aplikace,
 * `window.mncad.exportFile`, textové `export step` (konzole, CLI, serve) i `--formats step` CLI:
 *
 *   model   – přestavba modelu (jen díl; mezipaměť jádra, průběh po prvcích „Počítám prvek k/n“)
 *   convert – převod do formátu (STEP, STL, BREP…; u sestavy včetně složení modelu)
 *   verify  – kontrola zpětným načtením (STEP / BREP: tělesa, objem, obálka proti modelu – `verifyExport`)
 *   write   – zápis souboru / stažení / předání dat volajícímu
 *
 * Mezi fázemi se kontroluje zrušení (`signal`) – zrušený export nic nezapíše (výjimka `CadCancelled`, stejná jako po tlačítku
 * Zrušit u výpočtu v jádře). Uklidit cíl, který už existuje (prázdný soubor z dialogu „Uložit jako“ File System Access API),
 * je věc volajícího (`components/cad/export-run.ts`).
 *
 * Výsledek nese revizi modelu (`modelRev`, engine/result-key.ts), ze které soubor vznikl, a časy fází.
 */
import { CadCancelled } from "../kernel-client";
import type { Export3dFormat, ExportCheck } from "../agent-out";
import type { CadDoc } from "../types";
import type { SolidParts } from "../solid-export";
import { embedBlobs } from "../blobs";
import { isEmptyDoc, modelBytes, stampStepRev, verifyExport } from "./files";
import type { KernelApi } from "./kernel";
import { modelRev } from "./result-key";
import { EXPORT_PHASES, exportPhaseText, type ExportPhase } from "./export-phases";
import { tr } from "../i18n";
import { CodedError } from "./codes";

export { EXPORT_PHASES, exportPhaseText, type ExportPhase };

export type ExportFormat3d = Exclude<Export3dFormat, "mncad">;

export type ExportJobDeps<T> = {
  kernel: Pick<KernelApi, "check" | "exportFile" | "exportStats">;
  /**
   * zápis dat (soubor CLI, stažení, FS Access, base64 volajícímu); `check` = výsledek kontroly zpětným načtením, když
   * proběhla před zápisem (`verifyFirst`) – volající podle něj smí soubor nezapsat (přísný režim, 22c kolo 6)
   */
  write: (data: Uint8Array, check?: ExportCheck) => Promise<T>;
  /**
   * zadržení zápisu po kontrole (jen `verifyFirst`): vrátí-li `{ out }`, soubor se nezapíše a fáze „zápis“ se nehlásí
   * (přísný režim, jehož nález kontroly zastaví běh – průběh CLI / hostitele dřív ukázal zápis souboru, který nevznikl)
   */
  hold?: (check: ExportCheck) => { out: T } | null;
  /** začátek fáze (průběh pro tracker / `--progress`) */
  phase?: (p: ExportPhase) => void;
  signal?: AbortSignal;
};

export type ExportJobOptions = {
  /** kontrola zpětným načtením (STEP / BREP); false = vynechat (`bez kontroly`) */
  check?: boolean;
  /** přestavba modelu jako samostatná fáze (výchozí: díl ano, sestava ne – sestava se skládá při převodu) */
  rebuild?: boolean;
  /** zápis až po kontrole (výchozí) – false = zapsat hned po převodu a kontrolovat potom (pořadí řádků protokolu textu) */
  verifyFirst?: boolean;
  /** rychlá kontrola platnosti souboru i nad mezí ploch (`EXPORT_VALID_FACES`) – přísný režim (22c kolo 7) */
  fullCheck?: boolean;
  /** komponenty sestavy bez tělesa / s volnými plochami – jména do hlášky kontroly (vlna 22, bod 22c – solid-check.ts) */
  parts?: SolidParts;
};

export type ExportJobResult<T> = {
  /** exportovaný dokument (stav v okamžiku startu úlohy) – záznam exportu nese jeho revizi, ne revizi dokumentu po konci */
  doc: CadDoc;
  data: Uint8Array;
  out: T;
  check?: ExportCheck;
  /** revize modelu, ze které soubor vznikl (`r·a1b2c3`) */
  modelRev: string;
  phases: { phase: ExportPhase; ms: number }[];
};

/** revize modelu exportu: stejný výpočet jako uložený .mncad (data importů vložená – prohlížeč i CLI dají totéž) */
export const exportModelRev = (doc: CadDoc): string => modelRev(embedBlobs(doc) as unknown as CadDoc);

const verifiable = (f: ExportFormat3d): f is "step" | "brep" => f === "step" || f === "brep";

type CheckOut = Awaited<ReturnType<KernelApi["check"]>>;

/** chyba převodu s diagnostikou (vlna 22, bod 22h): ve které fázi, co řeklo jádro a v jakém stavu byl model */
export class ExportConvertError extends Error {
  constructor(
    message: string,
    readonly diag: { phase: "convert"; format: string; kernel: string; solid?: boolean; failed: { name: string; error: string }[]; paramErrors: string[] },
  ) {
    super(message);
    this.name = "ExportConvertError";
  }
}

/**
 * Diagnostika selhání převodu (bod 22h – „nebylo možné oddělit dlouhý výpočet, problém exportu…“): text jádra + fáze + stav
 * modelu z fáze přestavby (těleso ano/ne, prvky s chybou, chyby parametrů). Zrušení (`CadCancelled`) projde beze změny.
 * Vnitřní průběh zapisovače STEP v jádře (WASM) není k dispozici – fáze převodu je jedno volání jádra.
 */
export function convertError(e: unknown, doc: CadDoc, format: string, built?: CheckOut): unknown {
  // zrušení, kódované chyby (protokol je třídí podle kódu) a chyby ještě před jádrem (prázdný model, 2D výkres) beze změny
  if (e instanceof CadCancelled || e instanceof CodedError || doc.kind === "draft" || isEmptyDoc(doc)) return e;
  const kernel = e instanceof Error ? e.message : String(e);
  const names = new Map(doc.features.map((f) => [f.id, f.name]));
  const failed = (built?.status ?? []).filter((x) => !x.ok && !x.suppressed).map((x) => ({ name: names.get(x.id) ?? x.id, error: x.error ?? "?" }));
  const paramErrors = built?.paramErrors ?? [];
  const facts = built
    ? [
        built.solid ? tr("model má těleso") : tr("model NEMÁ těleso"),
        ...(failed.length ? [tr("prvky s chybou: {0}", failed.map((f) => `„${f.name}“ (${f.error})`).join(", "))] : []),
        ...(paramErrors.length ? [tr("chyby parametrů: {0}", paramErrors.join("; "))] : []),
      ]
    : [tr("model se před převodem nepřestavoval (sestava / bez přestavby)")];
  const msg = tr("převod do {0} selhal ve fázi „{1}“: {2} · {3}", format.toUpperCase(), exportPhaseText("convert", format), kernel, facts.join(" · "));
  return new ExportConvertError(msg, { phase: "convert", format, kernel, ...(built ? { solid: built.solid } : {}), failed, paramErrors });
}

/** Export jako úloha s fázemi (viz hlavička modulu). */
export async function runExportJob<T>(doc: CadDoc, format: ExportFormat3d, deps: ExportJobDeps<T>, o: ExportJobOptions = {}): Promise<ExportJobResult<T>> {
  const phases: { phase: ExportPhase; ms: number }[] = [];
  let cur: { phase: ExportPhase; t0: number } | null = null;
  const step = (p: ExportPhase) => {
    if (deps.signal?.aborted) throw new CadCancelled();
    const t = Date.now();
    if (cur) phases.push({ phase: cur.phase, ms: t - cur.t0 });
    cur = { phase: p, t0: t };
    deps.phase?.(p);
  };
  const close = () => {
    if (cur) phases.push({ phase: cur.phase, ms: Date.now() - cur.t0 });
    cur = null;
  };
  const rev = exportModelRev(doc);
  try {
    return await jobBody();
  } catch (e) {
    // fáze, ve které úloha skončila – trvalý záznam neúspěšného exportu (bod 22h kolo 7, cad/export-failures.ts)
    const at = (cur as { phase: ExportPhase } | null)?.phase;
    if (at && e && typeof e === "object" && !("exportPhase" in e)) Object.defineProperty(e, "exportPhase", { value: at, enumerable: false });
    throw e;
  }
  async function jobBody(): Promise<ExportJobResult<T>> {
  // prázdný model a 2D výkres: bez přestavby – převod skončí srozumitelnou chybou (`modelBytes`)
  const rebuild = o.rebuild ?? (doc.kind !== "assembly" && doc.kind !== "draft" && !isEmptyDoc(doc));
  let built: CheckOut | undefined;
  if (rebuild) {
    step("model");
    built = await deps.kernel.check(doc);
  }
  step("convert");
  // STEP nese revizi modelu v hlavičce (vlna 22, bod 12 – files.ts stampStepRev); chyba převodu = diagnostika (bod 22h)
  const raw = await modelBytes(deps.kernel, doc, format).catch((e: unknown) => {
    throw convertError(e, doc, format, built);
  });
  const data = format === "step" ? stampStepRev(raw, rev) : raw;
  const wantCheck = o.check !== false && verifiable(format);
  let check: ExportCheck | undefined;
  let out: T;
  if (o.verifyFirst === false) {
    step("write");
    out = await deps.write(data);
    if (wantCheck) {
      step("verify");
      check = await verifyExport(deps.kernel, doc, data, format as "step" | "brep", o.parts, o.fullCheck === true);
    }
  } else {
    if (wantCheck) {
      step("verify");
      check = await verifyExport(deps.kernel, doc, data, format as "step" | "brep", o.parts, o.fullCheck === true);
    }
    const held = check && deps.hold ? deps.hold(check) : null;
    if (held) out = held.out;
    else {
      step("write");
      out = await deps.write(data, check);
    }
  }
  close();
  return { doc, data, out, ...(check ? { check } : {}), modelRev: rev, phases };
  }
}
