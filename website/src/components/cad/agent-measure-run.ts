/**
 * `window.mncad.measure` v aplikaci: totéž měření jako příkaz `měřit` v enginu (`@/cad/agent-measure-run`) s klientem `cad`.
 */
import { cad } from "@/cad/client";
import { measureApiResult, measureTokens, parseMeasure, type MeasureApiResult } from "@/cad/agent-measure";
import { runMeasure } from "@/cad/agent-measure-run";
import type { CadDoc } from "@/cad/types";

/** `window.mncad.measure(a, b?)`: a/b = „F3“, „E5“, „V2“, [x, y, z], „těleso“, „díry“, „válce“, „plocha horní“, „Hřídel:F3“ */
export async function measureApi(d: CadDoc, a: string | number[], b?: string | number[]): Promise<MeasureApiResult> {
  const toks = (v: string | number[] | undefined) => (v === undefined ? [] : Array.isArray(v) ? v.map(String) : measureTokens(String(v)));
  try {
    return measureApiResult(await runMeasure(cad, d, parseMeasure([...toks(a), ...toks(b)])));
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    return { ok: false, error, lines: [`✗ ${error}`] };
  }
}
