"use client";

/**
 * Příkazový řádek 2D výkresu (jako AutoCAD): historie protokolu, výzva s klikacími volbami, vstup s doplňováním
 * názvů příkazů (CS / EN / DE + zkratky), šipky nahoru / dolů = předchozí zadání, Enter / mezera = potvrdit, Esc = zrušit.
 */
import { tr } from "@/cad/i18n";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { cmdName, commands, kwLabel, promptText, type Prompt } from "@/cad/draft/commands";
import { cn } from "@/lib/cn";

export type CmdLineHandle = {
  /** vloží znak a zaměří vstup (psaní kamkoli do plátna jde do příkazového řádku) */
  type: (ch: string) => void;
  focus: () => void;
  clear: () => void;
  value: () => string;
};

type Props = {
  history: { text: string; kind?: "ok" | "err" | "cmd" | "info" }[];
  prompt: Prompt | null;
  /** název běžícího příkazu */
  running: string | null;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onKeyword: (id: string) => void;
  /** mezera potvrzuje (u textu a řádkových příkazů ne) */
  spaceSubmits: (value: string) => boolean;
  dark: boolean;
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export const DraftCmdLine = forwardRef<CmdLineHandle, Props>(function DraftCmdLine({ history, prompt, running, onSubmit, onCancel, onKeyword, spaceSubmits, dark }, ref) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [sugIdx, setSugIdx] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const recall = useRef<{ list: string[]; i: number }>({ list: [], i: -1 });
  const logRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    type: (ch) => {
      setValue((v) => v + ch);
      input.current?.focus();
    },
    focus: () => input.current?.focus(),
    clear: () => setValue(""),
    value: () => value,
  }));

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, open]);

  /** doplňování názvu příkazu (jen bez běžícího příkazu, první slovo) */
  const sugg = useMemo(() => {
    if (running || !value.trim() || /\s/.test(value.trim())) return [];
    const q = fold(value.trim());
    const out: { label: string; value: string; hint: string }[] = [];
    for (const d of commands()) {
      const names = [...d.names.cs, ...d.names.en, ...d.names.de, ...(d.alias ?? [])];
      const hit = names.find((n) => fold(n).startsWith(q));
      if (hit) out.push({ label: cmdName(d), value: hit, hint: `${d.id}${d.alias?.length ? ` · ${d.alias.join(", ")}` : ""}` });
    }
    return out.slice(0, 8);
  }, [value, running]);

  const submit = (text: string) => {
    const t = text;
    if (t.trim()) {
      recall.current.list = [...recall.current.list.filter((x) => x !== t), t].slice(-50);
    }
    recall.current.i = -1;
    setValue("");
    setSugIdx(0);
    onSubmit(t);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if (sugg.length && sugIdx > 0) return submit(sugg[sugIdx].value);
      return submit(value);
    }
    if (e.key === " " && spaceSubmits(value)) {
      e.preventDefault();
      e.stopPropagation();
      return submit(value);
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setValue("");
      onCancel();
      input.current?.blur();
      return;
    }
    if (e.key === "Tab" && sugg.length) {
      e.preventDefault();
      setValue(sugg[sugIdx]?.value ?? sugg[0].value);
      return;
    }
    if (e.key === "ArrowDown" && sugg.length) {
      e.preventDefault();
      setSugIdx((i) => (i + 1) % sugg.length);
      return;
    }
    if (e.key === "ArrowUp" && sugg.length > 1) {
      e.preventDefault();
      setSugIdx((i) => (i - 1 + sugg.length) % sugg.length);
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const r = recall.current;
      if (!r.list.length) return;
      e.preventDefault();
      r.i = e.key === "ArrowUp" ? (r.i < 0 ? r.list.length - 1 : Math.max(0, r.i - 1)) : r.i < 0 ? -1 : Math.min(r.list.length, r.i + 1);
      setValue(r.i >= 0 && r.i < r.list.length ? r.list[r.i] : "");
    }
  };

  const shown = open ? history.slice(-200) : history.slice(-3);
  return (
    <div data-draft-cmdline className={cn("relative shrink-0 border-t text-[12px]", dark ? "border-white/10 bg-[#1b2128] text-white/85" : "border-[#d5dbe2] bg-[#f6f8fa] text-[#1f2933]")}>
      <div ref={logRef} className={cn("overflow-y-auto px-2 py-0.5 font-mono text-[11.5px] leading-[1.45]", open ? "max-h-[38vh]" : "max-h-[54px]")} data-draft-log>
        {shown.map((h, i) => (
          <div key={i} className={cn("whitespace-pre-wrap break-words", h.kind === "err" ? "text-[#f87171]" : h.kind === "ok" ? (dark ? "text-[#86efac]" : "text-[#15803d]") : h.kind === "cmd" ? (dark ? "text-white/60" : "text-[#6b7785]") : "")}>
            {h.text}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 px-2 pb-1.5">
        <button type="button" onClick={() => setOpen((v) => !v)} title={tr("Rozbalit historii příkazového řádku (F2)")} className={cn("rounded px-1 font-mono text-[11px]", dark ? "text-white/50 hover:bg-white/10" : "text-[#6b7785] hover:bg-black/5")}>
          {open ? "▾" : "▸"}
        </button>
        <span className="shrink-0 font-mono text-[11px] font-semibold text-brand">{running ? `${running}:` : ""}</span>
        <span className="min-w-0 max-w-[55%] shrink truncate font-mono text-[11.5px]" data-draft-prompt title={prompt ? promptText(prompt) : ""}>
          {prompt ? (
            <>
              {prompt.msg}
              {"kw" in prompt && prompt.kw?.length ? (
                <>
                  {" ["}
                  {prompt.kw.map((k, i) => (
                    <span key={k.id}>
                      {i ? "/" : ""}
                      <button type="button" className="text-[#60a5fa] underline decoration-dotted underline-offset-2 hover:text-brand" onClick={() => onKeyword(k.id)} data-kw={k.id}>
                        {kwLabel(k)}
                      </button>
                    </span>
                  ))}
                  {"]"}
                </>
              ) : null}
              {"def" in prompt && prompt.def !== undefined && prompt.def !== "" ? ` <${typeof prompt.def === "number" ? Math.round(prompt.def * 1e4) / 1e4 : prompt.def}>` : ""}:
            </>
          ) : (
            tr("Příkaz:")
          )}
        </span>
        <div className="relative min-w-0 flex-1">
          <input
            ref={input}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSugIdx(0);
            }}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            aria-label={tr("Příkazový řádek")}
            data-draft-input
            placeholder={running ? "" : tr("napište příkaz (čára, kružnice, L, C…) nebo x,y")}
            className={cn("w-full rounded border px-2 py-1 font-mono text-[12px] outline-none", dark ? "border-white/15 bg-[#11161c] text-white placeholder:text-white/30 focus:border-brand" : "border-[#cfd6de] bg-white placeholder:text-[#9aa5b1] focus:border-brand")}
          />
          {sugg.length > 0 && (
            <div className={cn("absolute bottom-full left-0 z-40 mb-1 w-72 overflow-hidden rounded border shadow-xl", dark ? "border-white/15 bg-[#11161c]" : "border-[#cfd6de] bg-white")}>
              {sugg.map((s, i) => (
                <button key={s.label + s.value} type="button" onMouseDown={(e) => { e.preventDefault(); submit(s.value); }} className={cn("flex w-full items-center justify-between gap-2 px-2 py-1 text-left", i === sugIdx ? "bg-brand/15" : "hover:bg-brand/10")}>
                  <span className="font-medium">{s.label}</span>
                  <span className="truncate font-mono text-[10.5px] opacity-60">{s.hint}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
