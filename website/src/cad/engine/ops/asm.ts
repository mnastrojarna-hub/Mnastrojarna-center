/**
 * Sestava textem (cad/agent-asm.ts, provedení cad/asm-agent.ts): vazby, komponenty, pole, šroub, podsestavy, úprava
 * v kontextu, kusovník, rám formy, záložky, pohybová studie. Prostředí sestavy nad `ws` a jádrem (`engine/asm-env.ts`).
 */
import { setMateStatus } from "../result-key";
import { tr } from "../../i18n";
import type { AsmEnv } from "../../asm-agent";
import type { CadDoc } from "../../types";
import { makeAsmEnv } from "../asm-env";
import { isCode } from "../codes";
import { docKeyOf, flush, runOf } from "../run-doc";
import { startRunDoc, type RunDocStart } from "../runs";
import { asmHooks, coded, say, sayKv, type OpHandler } from "./util";

export const asmOp: OpHandler<"asm"> = async (op, ctx) => {
  const r = runOf(ctx);
  const { applyAsmCmd } = await import("../../asm-agent");
  if (r.changed && (op.cmd.k === "tab" || op.cmd.k === "closeTab" || (op.cmd.k === "edit" && r.openNew))) {
    // rozpracovaný dokument nejdřív do jeho záložky – přepnutí záložky čte záložky; úprava v kontextu nové sestavy
    // potřebuje, aby sestava už měla záložku (díl se pak otevře v ní a „sestava hotovo“ ji vrátí)
    await flush(ctx);
    r.openNew = false; // dokument už má svou záložku (je aktivní) – další změny do ní
    r.tabbed = false;
  }
  const stack = [...ctx.ws.asm.stack];
  const env = makeAsmEnv(ctx.ws, ctx.host.kernel, { stack, docKey: docKeyOf(ctx), ...asmHooks(ctx) });
  const res = await applyAsmCmd(r.doc, op.cmd, env);
  let st: RunDocStart | null = null;
  if (res.newTab) {
    await flush(ctx);
    r.currentBody = null;
    st = await startRunDoc(ctx, res.doc, { origin: "new" }); // rám formy / komponenta jako kopie – opakovaný běh (engine/runs.ts)
  } else if (res.switched) {
    r.doc = JSON.parse(JSON.stringify(res.doc)) as CadDoc;
    r.openNew = false;
    r.tabbed = false;
    r.changed = false;
    r.currentBody = null;
  } else {
    r.doc = res.doc;
    r.changed = r.changed || res.changed;
  }
  // stav vazeb s razítkem sestavy, kterou popisuje (výpis nad nepřepočtenou sestavou = polohy po přepočtu, ne dokument)
  if (res.mateStatus) setMateStatus(ctx.ws, docKeyOf(ctx), res.mateDoc ?? r.doc, res.mateStatus);
  if (res.motion) {
    // pohybová studie: panel aplikace vyzvedne pokyn (přehrát, krok, export snímků); bez 3D okna: `pohyb export csv` =
    // soubor (FileSink → řádek F), snímky PNG / video softwarovým vykreslovačem (kolo 7b, bod 13 – cad/motion-frames.ts),
    // přehrání ℹ ui.no-view
    const ui = ctx.host.ui?.motion;
    if (ui) ui(res.motion);
    else if (res.motion.export === "csv") await writeMotionCsv(ctx, r.doc, env);
    else if (res.motion.export === "png" || res.motion.export === "webm") await writeMotionVideo(ctx, r.doc, env, res.motion.export, res.motion.video ?? {});
    else if (res.motion.play) coded(ctx, "ui.no-view", { args: [tr("přehrání pohybu")] });
    // aktivní pohled studie se uloží do dokumentu; zobrazit ho (kamera, řez) bez 3D okna nejde (vlna 22, bod 14)
    else if (res.motion.view) coded(ctx, "ui.no-view", { args: [tr("zobrazení pohledu studie")] });
  }
  if (res.stackChanged) {
    ctx.ws.asm.stack = stack;
    ctx.host.ui?.asmStack?.(stack, r.doc);
  }
  // souhrn pohybové studie: jeden strojový řádek `= … motion …` ve stručném protokolu, výpis v plném (zkouška 959)
  if (res.kv) sayKv(ctx, res.kv, ...res.log);
  else say(ctx, ...res.log);
  st?.report();
  // selhané prvky dílu z `sestava hotovo`: rozhodne smyčka po ověření dílu (jeden ✗ feature.failed, ne dva)
  if (res.failures?.length) (r.partFailures ??= []).push(...res.failures);
  // záznamy s kódem z příkazu sestavy (kolize pohybu podle tříd – asm-agent-kin.ts motionClashLines)
  for (const c of res.codes ?? []) if (isCode(c.code)) coded(ctx, c.code, { ...(c.args ? { args: c.args } : {}), ...(c.text !== undefined ? { text: c.text } : {}) });
};

/**
 * `pohyb export csv` bez aplikace: tabulka pohybové studie (výsledek, který příkaz právě spočítal – `motionCached`) jako
 * soubor `<sestava>-pohyb.csv` (stejný název jako tlačítko CSV panelu pohybu). Výpis CSV v protokolu zůstává.
 */
async function writeMotionCsv(ctx: Parameters<OpHandler<"asm">>[1], d: CadDoc, env: Pick<AsmEnv, "motion" | "geo">): Promise<void> {
  // kinematika beze změny (cad/motion.ts motionCsv), dynamika navíc s těžištěm, rychlostí a zrychlením těles (vlna 21)
  const [{ motionCached }, { studyCsv }] = await Promise.all([import("../../asm-agent-kin"), import("../../motion-dynamic-report")]);
  const res = motionCached(d, env);
  if (!res) return;
  const data = new TextEncoder().encode(studyCsv(res, d));
  await ctx.host.files.write({ name: `${d.name || tr("sestava")}-pohyb.csv`, mime: "text/csv;charset=utf-8", data, doc: d.name, format: "csv" });
}

/**
 * `pohyb export png | webm` bez aplikace (kolo 7b, bod 13): snímky studie softwarovým vykreslovačem v Node se stejným
 * časovým plánem, polohami a pohledy jako aplikace (cad/motion-frames.ts). PNG = ZIP se snímky, WebM = animované PNG (APNG)
 * se stejným časováním a ⚠ `motion.video-format` (kodér WebM je jen v prohlížeči); nehybný nebo neodpovídající soubor = ✗
 * `motion.video-failed`, nic se nezapíše.
 */
async function writeMotionVideo(ctx: Parameters<OpHandler<"asm">>[1], d: CadDoc, env: AsmEnv, kind: "png" | "webm", video: NonNullable<import("../../asm-agent-kin").MotionSignal["video"]>): Promise<void> {
  const [{ motionCached }, { renderMotionVideoNode }, { flattenLeaves }, { studyCsv }] = await Promise.all([import("../../asm-agent-kin"), import("../../motion-frames"), import("../../asm-flatten"), import("../../motion-dynamic-report")]);
  const res = motionCached(d, env);
  if (!res) {
    coded(ctx, "motion.video-failed", { args: [tr("pohybová studie není spočítaná – pohyb spustit")] });
    return;
  }
  // sítě dílů z jádra (stavba dílů sestavy; podsestavy rozložené na listy)
  const leaves = flattenLeaves(d);
  const seen = new Set<string>();
  const list = leaves.filter((l) => l.comp.source.kind !== "asm" && !seen.has(l.key) && (seen.add(l.key), true)).map((l) => ({ key: l.key, source: l.comp.source }));
  const built = new Map((await env.parts(list)).map((b) => [b.key, b.result?.mesh ?? null]));
  const out = await renderMotionVideoNode({ doc: d, res, kind, video, meshOf: (l) => built.get(l.key) ?? null, name: d.name, csv: kind === "png" ? studyCsv(res, d) : undefined });
  if (!out.ok || !out.file) {
    coded(ctx, "motion.video-failed", { args: [out.text.replace(/^✗\s*/, "")] });
    return;
  }
  await ctx.host.files.write({ name: out.file.name, mime: out.file.mime, data: out.file.data, doc: d.name, format: out.file.format });
  if (out.level === "warn" && kind === "webm") coded(ctx, "motion.video-format", { args: [out.text.replace(/^⚠\s*/, "")] });
  else say(ctx, out.text);
}
