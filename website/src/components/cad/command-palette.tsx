"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { CadIcon, type CadIconName, type Tone } from "./cad-icons";
import { Kbd } from "./ui";

export type Command = {
  id: string;
  label: string;
  group: string;
  icon?: CadIconName;
  tone?: Tone;
  kbd?: string;
  hint?: string;
  disabled?: boolean;
  run: () => void;
};

/** Jednoduché fuzzy skóre: pořadí znaků + bonus za začátek slova a souvislé úseky. */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const t = text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!q) return 1;
  if (t.includes(q)) return 100 - t.indexOf(q) + q.length * 2;
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, ti);
    if (i < 0) return 0;
    const wordStart = i === 0 || /[\s\-/(]/.test(t[i - 1]);
    streak = i === ti ? streak + 1 : 0;
    score += 1 + (wordStart ? 3 : 0) + streak;
    ti = i + 1;
  }
  return score;
}

/** Paleta příkazů (Ctrl+K): vyhledávání všech příkazů CAD s klávesnicí. */
export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => input.current?.focus(), []);

  const results = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: Math.max(fuzzyScore(q, c.label), fuzzyScore(q, `${c.group} ${c.label}`) * 0.8, c.hint ? fuzzyScore(q, c.hint) * 0.5 : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s);
    return (q ? scored : scored.sort((a, b) => a.c.group.localeCompare(b.c.group, "cs"))).slice(0, 60).map((x) => x.c);
  }, [commands, q]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const run = (c: Command) => {
    if (c.disabled) return;
    onClose();
    setTimeout(c.run, 0);
  };

  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-[#0b1220]/35 pt-[12vh]" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-[#cfd6de] bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-[#e3e8ee] px-3">
          <CadIcon name="measure" className="h-4 w-4 text-[#8a95a3]" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(results.length - 1, s + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(0, s - 1));
              } else if (e.key === "Enter" && results[sel]) run(results[sel]);
              else if (e.key === "Escape") onClose();
            }}
            placeholder="Hledat příkaz… (např. „díra“, „výkres“, „zaoblit“)"
            className="h-11 w-full bg-transparent text-[14px] outline-none placeholder:text-[#9aa5b1]"
          />
          <Kbd k="Esc" />
        </div>
        <div ref={listRef} className="max-h-[52vh] overflow-y-auto py-1">
          {results.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-[#6b7785]">Nic nenalezeno.</p>}
          {results.map((c, i) => {
            const head = !q && c.group !== lastGroup;
            lastGroup = c.group;
            return (
              <div key={c.id}>
                {head && <p className="px-4 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-[#8a95a3]">{c.group}</p>}
                <button
                  type="button"
                  data-i={i}
                  disabled={c.disabled}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => run(c)}
                  className={cn("flex w-full items-center gap-3 px-4 py-1.5 text-left text-[13px] disabled:opacity-40", i === sel ? "bg-[#eaf0f6]" : "")}
                >
                  <CadIcon name={c.icon ?? "cube"} tone={c.tone} className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{c.label}</span>
                    {(q || c.hint) && <span className="block truncate text-[11px] text-[#8a95a3]">{q ? c.group : ""}{q && c.hint ? " · " : ""}{c.hint ?? ""}</span>}
                  </span>
                  {c.kbd && <Kbd k={c.kbd} />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4 border-t border-[#e3e8ee] bg-[#f7f9fb] px-4 py-1.5 text-[11px] text-[#6b7785]">
          <span>
            <Kbd k="↑" /> <Kbd k="↓" /> výběr
          </span>
          <span>
            <Kbd k="Enter" /> spustit
          </span>
          <span className="ml-auto">{results.length} příkazů</span>
        </div>
      </div>
    </div>
  );
}
