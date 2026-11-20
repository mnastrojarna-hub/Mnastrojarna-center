"use client";

import { tr } from "@/cad/i18n";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isFinal, runStateText } from "@/cad/engine/run-queue";
import { appRuns, consoleRuns, type RunRecord } from "./run-host";
import { entryDetail, entryLine, filterEntries, reportDocs, reportFileName, reportJson, runHeadline, summaryText, type LevelFilter } from "@/cad/engine/console-view";
import { entryRef } from "@/cad/engine/entry-ids";
import { writeSaved } from "@/lib/save-file";
import { useRuns } from "./run-chip";
import { AGENT_COMMANDS } from "@/cad/agent";
import { AGENT_GUIDE } from "@/cad/agent-guide";
import { attachedFiles } from "@/cad/attached-files";
import { copyText } from "@/lib/clipboard";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";
import { Btn, Modal } from "./ui";

/** poslední text a protokol přežijí zavření konzole (v rámci karty) */
let lastText = "";
let lastOutput = "";
/**
 * běh spuštěný konzolí (vlna 22, bod 12): id a id běhu, ke kterému patří zobrazený protokol – přežijí zavření konzole;
 * znovu otevřená konzole ukáže stav běžícího běhu a po doběhnutí jeho výsledek (run-host.ts `consoleRuns`)
 */
let consoleRunId: string | null = null;
let outputRunId: string | null = null;
/**
 * přepínač „Stručný souhrn“ (vlna 22, bod 15): výchozí ZAPNUTO – konzole ukáže souhrn běhu (stručný protokol MNCAD/1 jako
 * CLI, engine/console-view.ts), detail (dnešní plný text konzole) a záznamy s filtrem na vyžádání; vypnutý = detail.
 * Uloženo trvale v prohlížeči; výchozí `window.mncad.run` (text konzole) se nemění – stručný protokol dá `protocol: "short"`.
 */
const SHORT_KEY = "mn-cad-console-short";
const loadShort = () => {
  try {
    return localStorage.getItem(SHORT_KEY) !== "0";
  } catch {
    return true;
  }
};
type ConsoleView = "summary" | "detail" | "entries";

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
export function AgentConsole({ onClose, run, getDocJson, status }: { onClose: () => void; run: (text: string, opts?: { protocol?: "short"; source?: "console"; onQueued?: (id: string) => void }) => Promise<string>; getDocJson: () => string; status: () => Promise<string> }) {
  const [text, setText] = useState(lastText);
  const [short, setShort] = useState(loadShort);
  const [out, setOutRaw] = useState(lastOutput);
  /** id běhu, ke kterému patří zobrazený protokol (null = stav dokumentu / nic) */
  const [outRun, setOutRun] = useState<string | null>(outputRunId);
  const setOut = (t: string, id: string | null = null) => {
    setOutRaw(t);
    setOutRun(id);
    outputRunId = id;
  };
  const [runId, setRunId] = useState<string | null>(consoleRunId);
  const [statusBusy, setStatusBusy] = useState(false);
  useRuns();
  useSyncExternalStore(
    (f) => consoleRuns.subscribe(f),
    () => consoleRuns.get(runId) ?? null,
    () => null,
  );
  const entry = runId ? appRuns.get(runId) : undefined;
  /** běh konzole čeká nebo počítá (i po zavření a novém otevření konzole) */
  const running = !!entry && !isFinal(entry.state);
  const busy = running || statusBusy;
  // výsledek běhu, který doběhl, když byla konzole zavřená (nebo než se stihl zobrazit) – podle id běhu, ne podle instance
  const done = runId && !running ? consoleRuns.get(runId) : undefined;
  useEffect(() => {
    if (done !== undefined && outRun !== runId) setOut(done, runId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, runId]);
  // historie běhů, pohled a filtr (vlna 22, bod 15)
  useSyncExternalStore(
    (f) => consoleRuns.subscribe(f),
    () => consoleRuns.version,
    () => 0,
  );
  const history = consoleRuns.list("console");
  const rec: RunRecord | undefined = consoleRuns.record(outRun);
  const report = !running ? rec?.report : undefined;
  const [view, setView] = useState<ConsoleView>(short ? "summary" : "detail");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [docFilter, setDocFilter] = useState("");
  const [q, setQ] = useState("");
  const filtering = level !== "all" || !!docFilter || !!q.trim();
  const shownView: ConsoleView = report ? (filtering && view === "summary" ? "entries" : view) : "detail";
  const summary = report ? summaryText(report) : "";
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
    setNote(null);
    let id: string | null = null;
    try {
      const log = await run(t, {
        source: "console",
        onQueued: (rid) => {
          id = rid;
          consoleRunId = rid;
          setRunId(rid);
        },
      });
      if (id) setOut(log, id);
    } catch (e) {
      setOut(`✗ ${(e as Error).message}`, id);
    }
  };
  const flash = (m: string) => {
    setNote(m);
    setTimeout(() => setNote((n) => (n === m ? null : n)), 2500);
  };
  const fromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (!t.trim()) return flash(tr("Schránka je prázdná."));
      setText(t);
      await exec(t);
    } catch {
      flash(tr("Prohlížeč nedovolil číst schránku – vložte text do pole (Ctrl+V) a stiskněte Provést."));
    }
  };

  return (
    <Modal
      title={tr("Textové příkazy – pro AI agenty, automatizaci i rychlé zadání")}
      icon="palette"
      tone="tool"
      onClose={onClose}
      width="max-w-4xl"
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-[#6b7785]">{tr("Ctrl+Shift+K otevře konzoli kdykoli · Ctrl+Enter provede · příkazy se připojují k otevřenému dokumentu")}</span>
          <Btn onClick={onClose}>{tr("Zavřít")}</Btn>
        </>
      }
    >
      <div className="grid gap-3 text-[12.5px] text-[#26303b] md:grid-cols-2">
        <div className="min-w-0">
          <div className="mb-1 flex items-center justify-between">
            <label htmlFor="agent-input" className="font-semibold">
              {tr("Příkazy nebo JSON")}
            </label>
            <button type="button" onClick={() => setHelp((v) => !v)} className="text-[12px] text-brand underline-offset-2 hover:underline">
              {help ? tr("Skrýt seznam příkazů") : tr("Seznam příkazů")}
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
            aria-label={tr("Textové příkazy nebo JSON")}
            spellCheck={false}
            rows={14}
            className="w-full resize-y rounded border border-[#cfd6de] bg-white px-2 py-1.5 font-mono text-[12px] leading-snug outline-none focus:border-brand"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn primary disabled={busy || !text.trim()} onClick={() => void exec()} title={tr("Provede příkazy (Ctrl+Enter)")}>
              {running ? tr("Provádím…") : tr("Provést")}
            </Btn>
            {running && entry && (
              <Btn onClick={() => appRuns.cancel(entry.id)} title={tr("Zruší běh: čekající se neprovede, běžící se zastaví a dokument zůstane beze změny")}>
                <span data-run-cancel={entry.id}>{tr("Zrušit běh")}</span>
              </Btn>
            )}
            <Btn disabled={busy} onClick={() => void fromClipboard()} title={tr("Vloží text ze schránky a hned ho provede")}>
              {tr("Vložit ze schránky a provést")}
            </Btn>
            <Btn
              disabled={busy}
              onClick={async () => {
                setStatusBusy(true);
                try {
                  setOut(await status());
                } finally {
                  setStatusBusy(false);
                }
              }}
              title={tr("Vypíše rozměry, objem a seznam prvků se stavem")}
            >
              {tr("Stav dokumentu")}
            </Btn>
            <Btn onClick={() => void copyText(getDocJson()).then((ok) => flash(ok ? tr("Dokument (JSON) zkopírován.") : tr("Kopírování se nezdařilo.")))} title={tr("Zkopíruje otevřený dokument jako JSON (.mncad)")}>
              {tr("Kopírovat dokument (JSON)")}
            </Btn>
            <Btn onClick={() => void copyText(AGENT_GUIDE).then((ok) => flash(ok ? tr("Návod pro AI zkopírován – vložte ho agentovi do zadání.") : tr("Kopírování se nezdařilo.")))} title={tr("Návod s příkazy, formátem JSON a API pro AI agenty")}>
              {tr("Kopírovat návod pro AI")}
            </Btn>
          </div>
          <AttachFiles flash={flash} />
          {note && <p className="mt-1 text-[12px] text-brand">{note}</p>}
          {help && (
            <div className="mt-3 max-h-64 overflow-y-auto rounded border border-[#e3e8ee] bg-[#f7f9fb] p-2" data-agent-commands>
              {/* příkaz na vlastním řádku, popis pod ním – ve dvou sloupcích zbývalo na popis místo na jedno slovo */}
              <ul className="space-y-1.5 text-[11.5px]">
                {AGENT_COMMANDS.map((c) => (
                  <li key={c.cmd} className="border-b border-[#edf1f5] pb-1.5 last:border-0 last:pb-0">
                    <code className="block whitespace-pre-wrap break-words font-mono text-[11px] text-[#1f2933]">{c.cmd}</code>
                    <span className="block leading-snug text-[#4a5664]">
                      {c.desc} <span className="text-[#8a95a3]">({c.en} · {c.de})</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <p className="mb-1 flex items-center justify-between gap-2 font-semibold">
            <span>{tr("Protokol a stav dokumentu")}</span>
            {/* stav a id běhu (vlna 22, bod 12): protokol níže patří vždy uvedenému běhu */}
            {(entry || outRun) && (
              <span className="text-[11.5px] font-normal text-[#4a5664]" data-run-status={entry?.state ?? "done"} data-run-status-id={entry?.id ?? outRun ?? ""}>
                {entry ? tr("Běh {0}: {1}", entry.id, runStateText(entry.state)) : tr("Běh {0}", outRun ?? "")}
                {entry?.state === "queued" ? ` · ${tr("čeká na dokončení dřívějšího běhu")}` : ""}
              </span>
            )}
          </p>
          {report && (
            // pohled na běh: souhrn (výchozí) · detail · záznamy s filtrem (vlna 22, bod 15)
            <div className="mb-1 flex flex-wrap items-center gap-1 text-[11.5px]" role="tablist" data-console-views={shownView}>
              {(
                [
                  ["summary", tr("Souhrn")],
                  ["detail", tr("Detail")],
                  ["entries", tr("Záznamy")],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={shownView === k}
                  data-console-view={k}
                  onClick={() => setView(k)}
                  className={cn("rounded border px-1.5 py-0.5", shownView === k ? "border-brand bg-[#fdecea] text-brand" : "border-[#cfd6de] text-[#4a5664] hover:border-brand")}
                >
                  {label}
                </button>
              ))}
              <span className="ml-auto text-[#6b7785]" data-console-counts>
                {`✓${report.counts.ok} ⚠${report.counts.warnings} ✗${report.counts.errors}`}
              </span>
            </div>
          )}
          {report && (
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[#4a5664]" data-console-filter>
              <select aria-label={tr("Filtr úrovně")} data-console-filter-level value={level} onChange={(e) => setLevel(e.target.value as LevelFilter)} className="rounded border border-[#cfd6de] bg-white px-1 py-0.5">
                <option value="all">{tr("vše")}</option>
                <option value="problems">{tr("✗ chyby a ⚠ varování")}</option>
                <option value="error">{tr("✗ chyby")}</option>
                <option value="warn">{tr("⚠ varování")}</option>
              </select>
              <select aria-label={tr("Filtr dokumentu")} data-console-filter-doc value={docFilter} onChange={(e) => setDocFilter(e.target.value)} className="max-w-[10rem] rounded border border-[#cfd6de] bg-white px-1 py-0.5">
                <option value="">{tr("všechny dokumenty")}</option>
                {reportDocs(report).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tr("díl, vazba, kód, id…")}
                aria-label={tr("Filtr textu (díl, vazba, kód chyby, id záznamu)")}
                data-console-filter-q
                className="min-w-0 flex-1 rounded border border-[#cfd6de] bg-white px-1.5 py-0.5"
              />
            </div>
          )}
          {report && shownView === "summary" && (
            <pre data-console-summary aria-label={tr("Souhrn běhu")} className="h-[calc(14*1.35em+2.5rem)] min-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded border border-[#cfd6de] bg-[#1f2933] p-2 font-mono text-[11.5px] leading-[1.35] text-[#e6edf3]">
              {summary}
            </pre>
          )}
          {report && shownView === "entries" && <EntryList report={report} runId={outRun ?? undefined} level={level} doc={docFilter} q={q} />}
          <pre
            data-agent-output
            data-run-id={running ? entry!.id : (outRun ?? "")}
            data-run-state={running ? entry!.state : outRun ? (appRuns.get(outRun)?.state ?? "done") : ""}
            aria-label={tr("Protokol")}
            aria-live="polite"
            // detail (plný text konzole) je vždy v DOM; při souhrnu / záznamech skrytý – na vyžádání záložkou Detail
            hidden={!!report && shownView !== "detail"}
            className={cn("h-[calc(14*1.35em+2.5rem)] min-h-[200px] overflow-auto whitespace-pre-wrap break-words rounded border border-[#cfd6de] bg-[#1f2933] p-2 font-mono text-[11.5px] leading-[1.35] text-[#e6edf3]", (!out || running) && "text-[#8a95a3]")}
          >
            {running
              ? entry!.state === "queued"
                ? tr("Běh {0} čeká ve frontě – začne, až doběhne dřívější běh. Protokol se ukáže po jeho dokončení.", entry!.id)
                : tr("Probíhá běh {0}… Protokol se ukáže po jeho dokončení.", entry!.id)
              : out || tr("Zatím nic. Po „Provést“ se tu objeví řádek ✓ / ✗ pro každý příkaz a textový stav dokumentu (rozměry, objem, prvky) – zpětná vazba pro agenta bez obrázku.")}
          </pre>
          {running && out && (
            // předchozí protokol jasně označený jako předchozí – nikdy se nečte jako výsledek běžícího běhu
            <details className="mt-1 text-[11.5px] text-[#4a5664]" data-run-prev={outRun ?? ""}>
              <summary className="cursor-pointer">{outRun ? tr("Předchozí běh {0} – protokol (nepatří běžícímu běhu)", outRun) : tr("Předchozí výstup (nepatří běžícímu běhu)")}</summary>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[#f3f5f8] p-1.5 font-mono text-[11px]">{out}</pre>
            </details>
          )}
          <label className="mt-2 flex items-center gap-1.5 text-[12px] text-[#4a5664]" title={tr("Po běhu ukázat souhrn – stručný protokol MNCAD/1 (stejný jako mncad run v příkazové řádce): hlavička, ✗ / ⚠, řádky D dokumentů a Σ – do 2 kB; plný text konzole je v záložce Detail")}>
            <input
              type="checkbox"
              data-agent-short
              checked={short}
              onChange={(e) => {
                setShort(e.target.checked);
                setView(e.target.checked ? "summary" : "detail");
                try {
                  localStorage.setItem(SHORT_KEY, e.target.checked ? "1" : "0");
                } catch {
                  /* soukromé okno – přepínač platí jen do zavření */
                }
              }}
            />
            {tr("Stručný souhrn (výchozí)")}
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Btn disabled={!out || running} onClick={() => void copyText(report && shownView === "summary" ? summary : out).then((ok) => flash(ok ? tr("Protokol zkopírován.") : tr("Kopírování se nezdařilo.")))}>
              {tr("Kopírovat protokol")}
            </Btn>
            <Btn
              disabled={!report || running}
              title={tr("Stáhne strukturovaný protokol běhu (JSON jako mncad run --json: záznamy se stabilními id, dokumenty, soubory, odkazy, plný protokol)")}
              onClick={() => {
                if (!report) return;
                void writeSaved({ name: reportFileName(outRun ?? undefined), handle: null }, reportJson(report), "application/json").then(() => flash(tr("JSON protokolu běhu {0} stažen.", outRun ?? "")));
              }}
            >
              <span data-console-json>{tr("Stáhnout JSON")}</span>
            </Btn>
            <Btn disabled={!out || running} onClick={() => setOut("")}>
              {tr("Vymazat")}
            </Btn>
          </div>
          {history.length > 0 && (
            // historie běhů (vlna 22, bod 15): nový běh předchozí protokol nepřepíše – klik ukáže běh znovu
            <details className="mt-2 text-[11.5px] text-[#4a5664]" open={history.length > 1} data-run-history={history.length}>
              <summary className="cursor-pointer font-semibold">{tr("Historie běhů ({0})", history.length)}</summary>
              <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                {history.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      data-run-history-item={h.id}
                      aria-pressed={h.id === outRun}
                      disabled={running}
                      onClick={() => setOut(h.text, h.id)}
                      className={cn("w-full truncate rounded px-1 py-0.5 text-left font-mono text-[11px] hover:bg-[#eef2f6]", h.id === outRun && "bg-[#fdecea] text-brand")}
                      title={h.input}
                    >
                      {runHeadline({ id: h.id, at: h.at, label: h.label ?? "", ...(h.report ? { report: h.report } : { state: appRuns.get(h.id)?.state ?? "" }) })}
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[#6b7785]">
            <CadIcon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {tr("Pro skripty je k dispozici")}{" "}<code>window.mncad</code> {tr("(run, getDocument, setDocument, status, guide). Úplný návod a schéma:")}{" "}<a href="/cad/schema-pro-ai.md" target="_blank" rel="noopener" className="text-brand underline-offset-2 hover:underline">/cad/schema-pro-ai.md</a>{tr(". Data opouštějí prohlížeč jen u „sdílet“ a výstupů „… odkaz“: dokument nebo soubor se v prohlížeči zašifruje a nahraje do úložiště odkazů, klíč je jen v odkazu.")}
            </span>
          </p>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Záznamy běhu s filtrem (vlna 22, bod 15): každý záznam jeden řádek se stabilním id (`r3:L36.motion`), rozbalení ukáže
 * celý text, detail a data – detail na vyžádání, souhrn zůstává krátký.
 */
function EntryList({ report, runId, level, doc, q }: { report: NonNullable<RunRecord["report"]>; runId?: string; level: LevelFilter; doc: string; q: string }) {
  const list = filterEntries(report, { level, doc, q });
  return (
    <div data-console-entries={list.length} className="h-[calc(14*1.35em+2.5rem)] min-h-[200px] overflow-auto rounded border border-[#cfd6de] bg-[#1f2933] p-1.5 font-mono text-[11px] leading-[1.35] text-[#e6edf3]">
      {!list.length && <p className="p-1 text-[#8a95a3]">{tr("Žádný záznam neodpovídá filtru.")}</p>}
      {list.map((e) => (
        <details key={e.id} data-entry-id={entryRef(runId, e.id)} data-entry-level={e.level} className="border-b border-[#2c3742] last:border-0">
          <summary className={cn("cursor-pointer whitespace-pre-wrap break-words py-0.5", e.level === "error" ? "text-[#ff9b94]" : e.level === "warn" ? "text-[#f5c26b]" : "")}>{entryLine(e)}</summary>
          <pre className="whitespace-pre-wrap break-words pb-1 pl-3 text-[#b8c4d0]">{entryDetail(e, runId)}</pre>
        </details>
      ))}
    </div>
  );
}

/**
 * Připojené soubory pro příkazy, které berou soubor podle názvu (výkres razítko logo="firma.png", předloha "výkres.dwg",
 * porovnat "ref.step", otevřít "díl.mncad") – jen v paměti karty (jedno úložiště cad/engine/attachments.ts; také
 * window.mncad.attach), nic se neodesílá.
 */
function AttachFiles({ flash }: { flash: (m: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [list, setList] = useState(() => attachedFiles.list());
  useEffect(() => attachedFiles.subscribe(() => setList(attachedFiles.list())), []);
  const add = async (files: FileList) => {
    const names: string[] = [];
    for (const f of [...files]) {
      try {
        attachedFiles.add({ name: f.name, mime: f.type || "application/octet-stream", data: new Uint8Array(await f.arrayBuffer()) });
        names.push(f.name);
      } catch (e) {
        flash(tr("Soubor „{0}“ se nepodařilo načíst.", f.name) + (e instanceof Error && e.message ? ` ${e.message}` : ""));
      }
    }
    if (names.length) flash(tr("Připojeno: {0} – v příkazech podle názvu, např. výkres razítko logo=\"{1}\"", names.join(", "), names[0]));
    if (input.current) input.current.value = "";
  };
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-[#4a5664]" data-agent-attach>
      <Btn onClick={() => input.current?.click()} title={tr("Připojí soubor (logo do razítka, předlohu DWG / PDF, referenci pro porovnat \"ref.step\", dokument pro otevřít \"díl.mncad\") – příkazy ho najdou podle názvu; zůstane do obnovení stránky")}>
        {tr("Připojit soubor…")}
      </Btn>
      <input ref={input} type="file" multiple className="hidden" data-agent-attach-input onChange={(e) => e.target.files?.length && void add(e.target.files)} />
      {list.map((f) => (
        <span key={f.name} className="inline-flex items-center gap-1 rounded bg-[#eef2f6] px-1.5 py-0.5 font-mono text-[11px]" data-attached={f.name}>
          {f.name} ({Math.max(1, Math.round(f.bytes / 1024))} kB)
          <button type="button" className="text-[#8a95a3] hover:text-brand" aria-label={tr("Odebrat {0}", f.name)} onClick={() => attachedFiles.remove(f.name)}>
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
