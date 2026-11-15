/** Společné pro obsluhy operací: zápis řádků protokolu konzole + záznamů reportu za právě prováděnou operaci. */
import type { AsmEnvOptions } from "../asm-env";
import type { CodeEntryInit, Code } from "../codes";
import type { OpCtx, OpHandler, OpKind } from "./registry";

export type { OpCtx, OpHandler, OpKind };

/** řádky protokolu operace (texty jako dřív v `log.push` smyčky v cad-app.tsx) */
export function say(ctx: OpCtx, ...texts: string[]): void {
  const doc = ctx.run.doc?.name;
  if (ctx.log) ctx.log.push(ctx.line, opKind(ctx), texts, doc);
  else for (const t of texts) ctx.report.add({ line: ctx.line, level: "measure", code: "value", text: t });
}

/**
 * Řádky protokolu operace s výpisem, který má strojovou část (`kv`, engine/kv.ts – stejná v cs/en/de): konzole dostane
 * `texts` beze změny, stručný protokol `= <loc> <druh> "<dokument>" <kv>` a lokalizovaný výpis je v `Entry.detail`.
 */
export function sayKv(ctx: OpCtx, kv: string, ...texts: string[]): void {
  sayKvAs(ctx, ctx.run.doc?.name, kv, ...texts);
}

/**
 * Jako `sayKv`, ale výpis patří jinému dokumentu / dílu než pracovnímu dokumentu běhu (`kontrola díl "B"`, `porovnat …
 * díl "B"`): v uvozovkách stručného protokolu i v JSON `entries[].doc` je název kontrolovaného dílu, ne aktivní záložky.
 */
export function sayKvAs(ctx: OpCtx, doc: string | undefined, kv: string, ...texts: string[]): void {
  if (ctx.log) ctx.log.push(ctx.line, opKind(ctx), texts, doc, kv);
  else ctx.report.measure(ctx.line, opKind(ctx), kv, { ...(doc !== undefined ? { doc } : {}), detail: texts.join("\n") });
}

/** záznam s kódem a jeho řádek v konzoli (ℹ ui.no-view, ✗ host.app-only, …) */
export function coded(ctx: OpCtx, code: Code, o: CodeEntryInit = {}): void {
  if (ctx.log) ctx.log.coded(ctx.line, code, { doc: ctx.run.doc?.name, ...o });
  else ctx.report.code(code, { line: ctx.line, ...o });
}

const opKind = (ctx: OpCtx): string => ctx.kind ?? "value";

/**
 * Háčky prostředí sestavy pro operaci (sestava, stav, kolize, výkres): restart jádra vyprázdnil mezipaměti → ℹ
 * `asm.kernel-restarted` na řádku operace, plocha dílu ani po novém postavení → ✗ `asm.face-missing`, nové díly v mezipaměti
 * → překreslit 3D okno aplikace (kap. 2.5).
 */
export function asmHooks(ctx: OpCtx): Required<Pick<AsmEnvOptions, "onRestart" | "onFaceMissing" | "onParts" | "onFacesTruncated">> {
  return {
    onRestart: () => coded(ctx, "asm.kernel-restarted"),
    onFaceMissing: (m) => coded(ctx, "asm.face-missing", { args: [m.index + 1, m.name] }),
    onParts: () => ctx.host.ui?.partsLoaded?.(),
    onFacesTruncated: (name, limit) => coded(ctx, "asm.faces-truncated", { args: [name, limit] }),
  };
}
