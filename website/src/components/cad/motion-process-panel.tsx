"use client";

/**
 * Pohybová studie › Procesní vrstva (vlna 22, bod 4 zprávy majitele – „pohybová studie neukazovala vznik střihu a otisku“).
 *
 *  - `ProcessSettings`: seznam operací (střih / otisk, nástroj → obrobek, hloubka, začátek, odpad), přidání a smazání – mění
 *    `doc.motion.process` stejně jako text `pohyb proces …` (cad/agent-process.ts);
 *  - `ProcessState`: stav výrobku v zobrazeném kroku (plný → v záběru → děrovaný / označený, odebraný objem, hloubka, odpad) a
 *    věta, že jde o geometrickou aproximaci (booleovské odebrání), ne o simulaci materiálu.
 *
 * Výpočet je společný s protokolem (cad/motion-process.ts + jádro cad/process-kernel.ts) – panel nic nepočítá sám. Obrobek po
 * operaci a odpad ve 3D okně (WebGL i softwarový náhled, export snímků): components/cad/process-meshes.ts → cad-app `asmViews`.
 */
import { useState } from "react";
import { nf } from "@/cad/clash-report";
import { tr } from "@/cad/i18n";
import type { MotionResult } from "@/cad/motion";
import { opText, phaseWord, processLevelSentence, processLines, processOf, productStates } from "@/cad/motion-process";
import { uid, type CadDoc, type MotionStudy, type ProcessOp } from "@/cad/types";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Num } from "./props";

const cap = "mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#4a5664]";
const sel = "min-w-0 flex-1 rounded border border-[#cfd6de] bg-white px-1 py-0.5 text-[11.5px]";

/** Operace procesní vrstvy (pod vůlí v panelu studie). */
export function ProcessSettings({ doc, study, onStudy }: { doc: CadDoc; study: MotionStudy; onStudy: (s: Partial<MotionStudy>) => void }) {
  const ops = study.process ?? [];
  const comps = (doc.components ?? []).filter((c) => c.source.kind !== "asm");
  const name = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  const [kind, setKind] = useState<ProcessOp["kind"]>("cut");
  const [tool, setTool] = useState("");
  const [target, setTarget] = useState("");
  const [depth, setDepth] = useState(0);
  const [start, setStart] = useState<"touch" | "time" | "phase">("touch");
  const [t0, setT0] = useState(0);
  const [phase, setPhase] = useState("");
  const [scrap, setScrap] = useState<NonNullable<ProcessOp["scrap"]>>("fall");
  // výchozí nástroj = pohyblivá komponenta, obrobek = ukotvená (jiná než nástroj)
  const it = tool || comps.find((c) => !c.fixed)?.id || comps[0]?.id || "";
  const ig = target || comps.find((c) => c.fixed && c.id !== it)?.id || comps.find((c) => c.id !== it)?.id || "";
  const ph = phase || study.phases?.[0]?.id || "";
  const need = kind === "imprint" && !(depth > 0);
  const add = () => {
    if (!it || !ig || it === ig || need) return;
    const at: ProcessOp["at"] = start === "time" ? { t: t0 } : start === "phase" && ph ? { phase: ph } : undefined;
    const op: ProcessOp = { id: uid(), kind, tool: it, target: ig, ...(depth > 0 ? { depth } : {}), ...(at ? { at } : {}), ...(kind === "cut" && scrap !== "fall" ? { scrap } : {}) };
    onStudy({ process: [...ops, op] });
  };
  return (
    <div data-process-settings className="space-y-1.5 rounded border border-[#e3e8ee] p-2">
      <p className={cap}>{tr("Procesní vrstva (střih, otisk)")}</p>
      {ops.length > 0 && (
        <ul className="space-y-1" data-process-ops={ops.length}>
          {ops.map((op, i) => (
            <li key={op.id} data-process-op={i + 1} data-process-kind={op.kind} className="flex items-center gap-1.5 rounded border border-[#d5dbe2] bg-white px-2 py-0.5 text-[11.5px]">
              <span className="min-w-0 flex-1">{opText(op, i, doc)}</span>
              <button type="button" data-process-remove={i + 1} title={tr("Odebrat operaci")} onClick={() => onStudy({ process: ops.filter((_, k) => k !== i).length ? ops.filter((_, k) => k !== i) : undefined })} className="text-[#6b7785] hover:text-brand">
                <CadIcon name="trash" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex rounded-md bg-[#eef2f6] p-0.5" role="group" aria-label={tr("Druh operace")}>
        {(["cut", "imprint"] as const).map((k) => (
          <button key={k} type="button" data-process-new-kind={k} aria-pressed={kind === k} onClick={() => setKind(k)} className={cn("flex-1 rounded px-1 py-0.5 text-[10.5px]", kind === k ? "bg-white shadow-sm" : "text-[#5b6776]")}>
            {k === "cut" ? tr("Střih / děrování") : tr("Otisk / ražení")}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <select data-process-tool aria-label={tr("Nástroj")} title={tr("Nástroj")} value={it} onChange={(e) => setTool(e.target.value)} className={sel}>
          {comps.map((c) => (
            <option key={c.id} value={c.id}>
              {name(c.id)}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-[#6b7785]">→</span>
        <select data-process-target aria-label={tr("Obrobek")} title={tr("Obrobek")} value={ig} onChange={(e) => setTarget(e.target.value)} className={sel}>
          {comps.map((c) => (
            <option key={c.id} value={c.id}>
              {name(c.id)}
            </option>
          ))}
        </select>
      </div>
      <div data-process-depth>
        <Num label={kind === "imprint" ? tr("Hloubka otisku") : tr("Hloubka (0 = do prostřižení)")} value={depth} step={0.1} min={0} onChange={(v) => setDepth(v > 0 ? v : 0)} />
      </div>
      <div className="flex items-center gap-1">
        <select data-process-start aria-label={tr("Začátek operace")} value={start} onChange={(e) => setStart(e.target.value as typeof start)} className={sel}>
          <option value="touch">{tr("od dotyku nástroje")}</option>
          <option value="time">{tr("od času")}</option>
          {study.phases?.length ? <option value="phase">{tr("se začátkem fáze")}</option> : null}
        </select>
        {start === "time" && (
          <div className="w-[96px]">
            <Num label="t" value={t0} step={0.05} min={0} suffix="s" onChange={(v) => setT0(Math.max(0, v))} />
          </div>
        )}
        {start === "phase" && (
          <select data-process-phase aria-label={tr("Fáze")} value={ph} onChange={(e) => setPhase(e.target.value)} className={sel}>
            {(study.phases ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {kind === "cut" && (
        <select data-process-scrap aria-label={tr("Odpad")} value={scrap} onChange={(e) => setScrap(e.target.value as typeof scrap)} className={cn(sel, "w-full")}>
          <option value="fall">{tr("odpad: s nástrojem, pak padá")}</option>
          <option value="tool">{tr("odpad: drží na nástroji")}</option>
          <option value="stay">{tr("odpad: zůstane na místě")}</option>
        </select>
      )}
      <button type="button" data-process-add disabled={!it || !ig || it === ig || need} onClick={add} className="w-full rounded border border-[#cfd6de] bg-white px-2 py-0.5 text-[11.5px] hover:bg-[#f3f6f9] disabled:opacity-50">
        {tr("Přidat operaci")}
      </button>
      <p data-process-level-note className="text-[10.5px] leading-snug text-[#6b7785]">
        {processLevelSentence()}
      </p>
    </div>
  );
}

/** Stav výrobku v zobrazeném kroku (pod výsledkem studie). */
export function ProcessState({ res, doc, step }: { res: MotionResult; doc: CadDoc; step: number }) {
  const [open, setOpen] = useState(false);
  const proc = processOf(res);
  if (!proc) return null;
  const states = productStates(proc, step);
  const name = (id: string) => doc.components?.find((c) => c.id === id)?.name ?? id;
  return (
    <div data-process-result className="space-y-1 rounded border border-[#e3e8ee] bg-[#fbfcfd] p-2 text-[11px] leading-snug text-[#4a5664]">
      {states.map((p) => (
        <p key={p.target} data-process-state={p.phase} data-process-for={name(p.target)} data-process-removed={Math.round(p.removed * 1000) / 1000} data-process-scrapped={p.scrap}>
          <b>{name(p.target)}</b>: {phaseWord(p.phase)}
          {p.removed > 0 ? ` · ${tr("odebráno {0} mm³", nf(p.removed, 3))}` : ""}
          {p.depth > 0 ? ` · ${tr("hloubka {0} mm", nf(p.depth, 3))}` : ""}
          {p.scrap ? ` · ${tr("odpad {0} oddělen", p.scrap)}` : ""}
        </p>
      ))}
      <p className="text-[10.5px] text-[#6b7785]">{tr("Geometrická aproximace (booleovské odebrání objemu) – ne simulace materiálu: žádné síly, otřep ani odpružení. Restart = plný obrobek, dokument se nemění.")}</p>
      <button type="button" data-process-detail onClick={() => setOpen(!open)} className="text-[10.5px] text-[#5b6776] underline">
        {open ? tr("Skrýt průběh operací") : tr("Průběh operací")}
      </button>
      {open && (
        <ul className="space-y-0.5">
          {processLines(res, doc)
            .slice(1)
            .map((l, i) => (
              <li key={i}>{l.trim()}</li>
            ))}
        </ul>
      )}
    </div>
  );
}
