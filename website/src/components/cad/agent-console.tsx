"use client";

import { useEffect, useRef, useState } from "react";
import { AGENT_COMMANDS } from "@/cad/agent";
import { AGENT_GUIDE } from "@/cad/agent-guide";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Btn, Modal } from "./ui";

/** poslední text a protokol přežijí zavření konzole (v rámci karty) */
let lastText = "";
let lastOutput = "";

const PLACEHOLDER = `Příkazy (jeden na řádek) nebo JSON dokumentu – například:
nový díl Příruba DN50
skica XY: kružnice 165
vysunout 18
trubka 88 61 30 v 0 0 18
díra 18 skrz v 62,5 0
pole kruhové 4
srazit 1,5
stav`;

/**
 * Konzole „Textové příkazy“: stejný CAD ovládaný textem – pro AI agenty, automatizaci i lidi.
 * Vstup = řádkové příkazy nebo JSON; výstup = protokol (✓/✗ s důvodem) a textový stav dokumentu.
 */
export function AgentConsole({ onClose, run, getDocJson, status }: { onClose: () => void; run: (text: string) => Promise<string>; getDocJson: () => string; status: () => Promise<string> }) {
  const [text, setText] = useState(lastText);
  const [out, setOut] = useState(lastOutput);
  const [busy, setBusy] = useState(false);
  const [help, setHelp] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ta.current?.focus(), []);
  useEffect(() => {
    lastText = text;
  }, [text]);
  useEffect(() => {
    lastOutput = out;
  }, [out]);

  const exec = async (t = text) => {
    if (!t.trim() || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const log = await run(t);
      setOut(log);
    } catch (e) {
      setOut(`✗ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const flash = (m: string) => {
    setNote(m);
    setTimeout(() => setNote((n) => (n === m ? null : n)), 2500);
  };
  const fromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) return flash("Schránka je prázdná.");
      setText(t);
      await exec(t);
    } catch {
      flash("Prohlížeč nedovolil číst schránku – vložte text do pole (Ctrl+V) a stiskněte Provést.");
    }
  };

  return (
    <Modal
      title="Textové příkazy – pro AI agenty, automatizaci i rychlé zadání"
      icon="palette"
      tone="tool"
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-[#6b7785]">Ctrl+Shift+K otevře konzoli kdykoli · Ctrl+Enter provede · příkazy se připojují k otevřenému dokumentu</span>
          <Btn onClick={onClose}>Zavřít</Btn>
        </>
      }
    >
      <div className="grid gap-3 text-[12.5px] text-[#26303b] md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="agent-input" className="font-semibold">
              Příkazy nebo JSON
            </label>
            <button type="button" onClick={() => setHelp((v) => !v)} className="text-[12px] text-brand underline-offset-2 hover:underline">
              {help ? "Skrýt seznam příkazů" : "Seznam příkazů"}
            </button>
          </div>
          <textarea
            id="agent-input"
            ref={ta}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void exec();
              }
            }}
            placeholder={PLACEHOLDER}
            aria-label="Textové příkazy nebo JSON"
            spellCheck={false}
            rows={14}
            className="w-full resize-y rounded border border-[#cfd6de] bg-white px-2 py-1.5 font-mono text-[12px] leading-snug outline-none focus:border-brand"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn primary disabled={busy || !text.trim()} onClick={() => void exec()} title="Provede příkazy (Ctrl+Enter)">
              {busy ? "Provádím…" : "Provést"}
            </Btn>
            <Btn disabled={busy} onClick={() => void fromClipboard()} title="Vloží text ze schránky a hned ho provede">
              Vložit ze schránky a provést
            </Btn>
            <Btn
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setOut(await status());
                } finally {
                  setBusy(false);
                }
              }}
              title="Vypíše rozměry, objem a seznam prvků se stavem"
            >
              Stav dokumentu
            </Btn>
            <Btn onClick={() => void copyText(getDocJson()).then((ok) => flash(ok ? "Dokument (JSON) zkopírován." : "Kopírování se nezdařilo."))} title="Zkopíruje otevřený dokument jako JSON (.mncad)">
              Kopírovat dokument (JSON)
            </Btn>
            <Btn onClick={() => void copyText(AGENT_GUIDE).then((ok) => flash(ok ? "Návod pro AI zkopírován – vložte ho agentovi do zadání." : "Kopírování se nezdařilo."))} title="Návod s příkazy, formátem JSON a API pro AI agenty">
              Kopírovat návod pro AI
            </Btn>
          </div>
          {note && <p className="mt-1 text-[12px] text-brand">{note}</p>}
          {help && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded border border-[#e3e8ee] bg-[#f7f9fb] p-2">
              <table className="w-full text-[11.5px]">
                <tbody>
                  {AGENT_COMMANDS.map((c) => (
                    <tr key={c.cmd} className="border-b border-[#edf1f5] align-top last:border-0">
                      <td className="py-1 pr-2 font-mono text-[11px] text-[#1f2933]">{c.cmd}</td>
                      <td className="py-1 text-[#4a5664]">
                        {c.desc} <span className="text-[#8a95a3]">({c.en})</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="mb-1 font-semibold">Protokol a stav dokumentu</p>
          <pre
            data-agent-output
            aria-label="Protokol"
            aria-live="polite"
            className={cn("h-[calc(14*1.35em+2.5rem)] min-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded border border-[#cfd6de] bg-[#1f2933] p-2 font-mono text-[11.5px] leading-[1.35] text-[#e6edf3]", !out && "text-[#8a95a3]")}
          >
            {out || "Zatím nic. Po „Provést“ se tu objeví řádek ✓ / ✗ pro každý příkaz a textový stav dokumentu (rozměry, objem, prvky) – zpětná vazba pro agenta bez obrázku."}
          </pre>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn disabled={!out} onClick={() => void copyText(out).then((ok) => flash(ok ? "Protokol zkopírován." : "Kopírování se nezdařilo."))}>
              Kopírovat protokol
            </Btn>
            <Btn disabled={!out} onClick={() => setOut("")}>
              Vymazat
            </Btn>
          </div>
          <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[#6b7785]">
            <CadIcon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Pro skripty je k dispozici <code>window.mncad</code> (run, getDocument, setDocument, status, guide). Úplný návod a schéma: <a href="/cad/schema-pro-ai.md" target="_blank" rel="noopener" className="text-brand underline-offset-2 hover:underline">/cad/schema-pro-ai.md</a>. Nic z toho neodesílá data mimo tento prohlížeč.
            </span>
          </p>
        </div>
      </div>
    </Modal>
  );
}
