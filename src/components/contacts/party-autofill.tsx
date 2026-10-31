"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle, Camera, CheckCircle2, ClipboardPaste, FileUp, Landmark, Loader2, RotateCcw, Sparkles, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { uploadCapturePage, discardCaptureQuietly } from "@/components/jobs/capture/capture-client";
import { aresLookupAction } from "@/app/actions/ares";
import { icoDigits, isValidIco, type AresCompany } from "@/lib/ares/ares";
import type { CaptureFileRef } from "@/lib/jobs/capture-review";
import type { PartyKind } from "@/lib/contacts/roles";
import type { PartyAutofillData, PartyAutofillResponse, PartyDuplicate } from "@/lib/parties/autofill-types";
import { cn } from "@/lib/utils";

/**
 * „Vyplnit z dokladu" v dialogu Nový zákazník / Nový dodavatel (a „Doplnit z dokladu" u úpravy):
 * vyfoť / nahraj cokoli (fotka nebo screenshot e-mailu, objednávka, faktura, vizitka, PDF, .eml, .msg)
 * nebo vlož text či screenshot (Ctrl+V) → AI vytáhne JEN firmu a lidi, IČO ověří ARES → formulář se
 * předvyplní. Nic se neukládá a nezakládá žádná zakázka — uloží až uživatel tlačítkem dialogu.
 */

const WHO: Record<PartyKind, { acc: string; nom: string }> = {
  customer: { acc: "zákazníka", nom: "zákazník" },
  supplier: { acc: "dodavatele", nom: "dodavatel" },
};

const ACCEPT = "image/*,application/pdf,.pdf,.eml,.msg,.txt,.html,.htm,message/rfc822,application/vnd.ms-outlook,text/plain";
const MAX_FILES = 10;

/** Zvýraznění pole vyplněného AI (fialová) / z ARES (zelená). */
export function filledClass(from: "ai" | "ares" | undefined): string {
  if (from === "ares") return "bg-emerald-50 dark:bg-emerald-500/10";
  if (from === "ai") return "bg-violet-50 dark:bg-violet-500/10";
  return "";
}

/** Upozornění „firma už v adresáři je" s odkazem. */
export function DuplicateNotice({ kind, duplicate, onOpen }: { kind: PartyKind; duplicate: PartyDuplicate | null; onOpen?: () => void }) {
  if (!duplicate) return null;
  const why = duplicate.by === "ico" ? "stejné IČO" : duplicate.by === "dic" ? "stejné DIČ" : "stejný název";
  const href = kind === "customer" ? `/customers/${duplicate.id}` : `/suppliers?q=${encodeURIComponent(duplicate.label)}`;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200" role="status" data-testid="party-duplicate">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0">
        Tento {WHO[kind].nom} už v adresáři je: <strong>{duplicate.label}</strong> ({why}).{" "}
        <Link href={href} className="font-semibold underline" onClick={onOpen}>Otevřít existujícího</Link>
      </p>
    </div>
  );
}

// ── ARES podle IČO (tlačítko u pole IČO + automaticky po napsání IČO) ──
export interface AresNote {
  tone: "ok" | "warn";
  text: string;
}

export function useAresLookup(
  kind: PartyKind,
  exceptId: string | null | undefined,
  onFound: (company: AresCompany, duplicate: PartyDuplicate | null) => void,
) {
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<AresNote | null>(null);
  const found = React.useRef(onFound);
  found.current = onFound;
  const seq = React.useRef(0);

  const lookup = React.useCallback(async (raw: string) => {
    const ico = icoDigits(raw);
    if (!ico) {
      setNote({ tone: "warn", text: "Napiš IČO (8 číslic)." });
      return;
    }
    if (!isValidIco(ico)) {
      setNote({ tone: "warn", text: "Tohle IČO nemá platnou kontrolní číslici — zkontroluj ho." });
      return;
    }
    const my = ++seq.current;
    setBusy(true);
    setNote(null);
    try {
      const res = await aresLookupAction(kind, ico, exceptId ?? null);
      if (my !== seq.current) return;
      if (!res.ok) {
        setNote({ tone: "warn", text: res.error });
        return;
      }
      found.current(res.company, res.duplicate);
      const dead = res.company.defunct ? ` Pozor: firma v ARES zanikla${res.company.defunctDate ? ` (${res.company.defunctDate.split("-").reverse().join(". ")})` : ""}.` : "";
      setNote({ tone: dead ? "warn" : "ok", text: `Doplněno z ARES: ${res.company.name}.${dead}` });
    } catch {
      if (my === seq.current) setNote({ tone: "warn", text: "ARES teď neodpovídá — zkus to za chvíli." });
    } finally {
      if (my === seq.current) setBusy(false);
    }
  }, [kind, exceptId]);

  const reset = React.useCallback(() => {
    seq.current += 1;
    setBusy(false);
    setNote(null);
  }, []);

  return { busy, note, lookup, reset };
}

export function AresNoteText({ note, fallback }: { note: AresNote | null; fallback: React.ReactNode }) {
  if (!note) return <>{fallback}</>;
  return (
    <span className={cn(note.tone === "ok" ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400")} data-testid="ares-note">
      {note.text}
    </span>
  );
}

export function AresButton({ busy, disabled, onClick, testId }: { busy: boolean; disabled?: boolean; onClick: () => void; testId?: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      disabled={busy || disabled}
      title="Doplnit název, DIČ a sídlo z ARES podle IČO"
      data-testid={testId}
      className="shrink-0"
    >
      {busy ? <Loader2 className="animate-spin" /> : <Landmark />} ARES
    </Button>
  );
}

/** „Podpis e-mailu: Karel Kalič…" — druh dokladu jen když ho věta AI sama neříká. */
export function docLine(kind: string, summary: string): string {
  const k = kind.trim();
  if (!k || summary.toLowerCase().startsWith(k.toLowerCase())) return summary;
  return `${k.charAt(0).toUpperCase()}${k.slice(1)}: ${summary}`;
}

// ── Panel „Vyplnit z dokladu" ───────────────────────────────
type Phase = "idle" | "text" | "busy" | "done" | "error";

interface Done {
  data: PartyAutofillData;
  summary: string;
  picked: string | null;
}

export function PartyAutofill({
  kind,
  exceptId,
  compact = false,
  onApply,
  onApplyAres,
}: {
  kind: PartyKind;
  /** Upravovaná firma (sama sebe za duplicitu nepovažuje). */
  exceptId?: string | null;
  /** Úprava existujícího: sbalené do jednoho tlačítka. */
  compact?: boolean;
  /** Výsledek → formulář; vrací souhrn „Vyplněno: …". */
  onApply: (data: PartyAutofillData) => string;
  /** Vybraný kandidát z ARES → formulář; vrací souhrn. */
  onApplyAres: (company: AresCompany, duplicate: PartyDuplicate | null) => string;
}) {
  const who = WHO[kind];
  const [expanded, setExpanded] = React.useState(!compact);
  const [phase, setPhase] = React.useState<Phase>("idle");
  const [busyLabel, setBusyLabel] = React.useState("");
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<Done | null>(null);
  const [picking, setPicking] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState(false);
  const camera = React.useRef<HTMLInputElement>(null);
  const picker = React.useRef<HTMLInputElement>(null);
  const abort = React.useRef<AbortController | null>(null);
  const apply = React.useRef(onApply);
  apply.current = onApply;
  const applyAres = React.useRef(onApplyAres);
  applyAres.current = onApplyAres;
  const busy = phase === "busy";

  React.useEffect(() => () => abort.current?.abort(), []);

  const run = React.useCallback(async (files: File[], pasted: string) => {
    if (abort.current) return;
    const list = files.slice(0, MAX_FILES);
    if (!list.length && !pasted.trim()) return;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setExpanded(true);
    setPhase("busy");
    setError(null);
    setDone(null);
    const refs: CaptureFileRef[] = [];
    try {
      for (const [i, f] of list.entries()) {
        setBusyLabel(list.length > 1 ? `Nahrávám ${i + 1}/${list.length}…` : "Nahrávám…");
        const r = await uploadCapturePage(f, { sortPreview: false, master: false });
        if (ctrl.signal.aborted) break;
        if (!r.ok) throw new Error(r.error);
        refs.push(r.ref);
      }
      if (ctrl.signal.aborted) {
        if (refs.length) discardCaptureQuietly({ paths: refs.map((r) => r.path) });
        setPhase("idle");
        return;
      }
      setBusyLabel(`AI čte ${list.length ? "doklad" : "text"} a ověřuje IČO v ARES…`);
      const res = await fetch("/api/parties/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, files: refs, text: pasted.trim() || undefined, exceptId: exceptId ?? undefined }),
        signal: ctrl.signal,
      });
      const j = (await res.json().catch(() => ({ ok: false, error: "Čtení se nepovedlo — zkus to znovu." }))) as PartyAutofillResponse;
      if (!j.ok) throw new Error(j.error);
      const summary = apply.current(j);
      setDone({ data: j, summary, picked: null });
      setText("");
      setPhase("done");
    } catch (err) {
      if (ctrl.signal.aborted) {
        setPhase("idle");
        return;
      }
      setError(err instanceof Error && err.message ? err.message : "Spojení selhalo — zkus to znovu.");
      setPhase("error");
    } finally {
      abort.current = null;
    }
  }, [kind, exceptId]);

  const cancel = () => {
    abort.current?.abort();
    abort.current = null;
    setPhase("idle");
  };

  // Ctrl+V screenshotu kdekoli v dialogu (text do polí se vkládá normálně)
  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/") || f.type === "application/pdf");
      if (!files.length || abort.current) return;
      e.preventDefault();
      void run(files, "");
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [run]);

  const pickCandidate = async (c: AresCompany) => {
    if (!done || picking) return;
    setPicking(c.ico);
    try {
      const res = await aresLookupAction(kind, c.ico, exceptId ?? null);
      const company = res.ok ? res.company : c;
      const summary = applyAres.current(company, res.ok ? res.duplicate : null);
      setDone({ ...done, summary, picked: c.ico });
    } finally {
      setPicking(null);
    }
  };

  const reset = () => {
    setPhase("idle");
    setDone(null);
    setError(null);
  };

  const inputs = (
    <>
      <input ref={camera} type="file" accept="image/*" capture="environment" multiple className="hidden"
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void run(f, ""); }} data-testid="party-autofill-camera" />
      <input ref={picker} type="file" accept={ACCEPT} multiple className="hidden"
        onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; void run(f, ""); }} data-testid="party-autofill-file" />
    </>
  );

  if (!expanded) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-violet-300 px-3 py-2 dark:border-violet-500/40">
        {inputs}
        <Sparkles className="h-4 w-4 text-violet-600 dark:text-violet-300" />
        <span className="mr-auto text-sm text-muted-foreground">Chybí údaje? Doplním je z dokladu nebo e-mailu.</span>
        <Button type="button" size="sm" variant="outline" onClick={() => setExpanded(true)} data-testid="party-autofill-expand">
          <Sparkles /> Doplnit z dokladu
        </Button>
      </div>
    );
  }

  const ares = done?.data.ares;
  const aresOk = ares && (ares.status === "found" || (ares.status === "by_name") || done?.picked);

  return (
    <section
      className={cn(
        "space-y-3 rounded-xl border border-violet-200 bg-violet-50/60 p-3 transition dark:border-violet-500/30 dark:bg-violet-500/5 sm:p-4",
        drag && "ring-2 ring-violet-400",
      )}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault();
        setDrag(false);
        void run([...e.dataTransfer.files], "");
      }}
      data-testid="party-autofill"
    >
      {inputs}
      <div className="flex items-start gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{compact ? "Doplnit z dokladu" : "Vyplnit z dokladu"}</h3>
          <p className="text-xs text-muted-foreground">
            Vyfoť nebo nahraj e-mail, objednávku, fakturu, vizitku… AI vyplní jen {who.acc} — žádnou zakázku — a IČO ověří v ARES.
          </p>
        </div>
        {compact && phase !== "busy" && (
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Sbalit" onClick={() => { reset(); setExpanded(false); }}>
            <X />
          </Button>
        )}
      </div>

      {(phase === "idle" || phase === "error") && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" className="h-auto flex-col gap-1 py-2.5 sm:flex-row sm:py-2" onClick={() => camera.current?.click()} data-testid="party-autofill-camera-btn">
              <Camera /> <span>Vyfotit</span>
            </Button>
            <Button type="button" variant="outline" className="h-auto flex-col gap-1 py-2.5 sm:flex-row sm:py-2" onClick={() => picker.current?.click()} data-testid="party-autofill-file-btn">
              <FileUp /> <span>Nahrát</span>
            </Button>
            <Button type="button" variant="outline" className="h-auto flex-col gap-1 py-2.5 sm:flex-row sm:py-2" onClick={() => { setPhase("text"); setError(null); }} data-testid="party-autofill-text-btn">
              <ClipboardPaste /> <span>Vložit text</span>
            </Button>
          </div>
          <p className="hidden text-[11px] text-muted-foreground sm:block">
            Tip: screenshot e-mailu vlož rovnou Ctrl+V, soubor sem můžeš i přetáhnout. Umí fotky, PDF, .eml a .msg z Outlooku.
          </p>
        </>
      )}

      {phase === "text" && (
        <div className="space-y-2">
          <Textarea
            autoFocus
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="vlož podpis z e-mailu, hlavičku objednávky, text z webu… (nebo Ctrl+V screenshot)"
            className="bg-background placeholder:italic"
            data-testid="party-autofill-text"
          />
          <div className="flex gap-2">
            <Button type="button" variant="send" disabled={!text.trim()} onClick={() => void run([], text)} data-testid="party-autofill-text-submit">
              <Sparkles /> Přečíst a vyplnit
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setPhase("idle"); setText(""); }}>Zpět</Button>
          </div>
        </div>
      )}

      {phase === "busy" && (
        <div className="flex items-center gap-2 rounded-lg bg-background/70 px-3 py-2.5 text-sm" role="status" data-testid="party-autofill-busy">
          <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
          <span className="mr-auto">{busyLabel}</span>
          <Button type="button" size="sm" variant="ghost" onClick={cancel}>Zrušit</Button>
        </div>
      )}

      {phase === "error" && error && (
        <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert" data-testid="party-autofill-error">{error}</p>
      )}

      {phase === "done" && done && (
        <div className="space-y-2" data-testid="party-autofill-done">
          <p className="flex items-start gap-2 text-sm font-medium">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span data-testid="party-autofill-summary">{done.summary}</span>
          </p>
          {done.data.summary && <p className="text-xs text-muted-foreground">{docLine(done.data.documentKind, done.data.summary)}</p>}
          {ares && (
            <p
              className={cn(
                "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
                aresOk ? "bg-emerald-100/70 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200" : "bg-amber-100/70 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
              )}
              data-testid="party-autofill-ares"
              data-status={done.picked ? "picked" : ares.status}
            >
              <Landmark className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{done.picked ? "Vybraná firma doplněna z ARES." : ares.message}</span>
            </p>
          )}
          {ares && ares.candidates.length > 0 && !done.picked && (
            <ul className="space-y-1.5" data-testid="party-autofill-candidates">
              {ares.candidates.map((c) => (
                <li key={c.ico}>
                  <button
                    type="button"
                    onClick={() => void pickCandidate(c)}
                    disabled={Boolean(picking)}
                    className="flex w-full items-start gap-2 rounded-lg border bg-background px-3 py-2 text-left text-sm transition hover:bg-accent disabled:opacity-60"
                  >
                    {picking === c.ico ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : <Landmark className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0">
                      <span className="block font-medium">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">IČO {c.ico}{c.address ? ` · ${c.address}` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {done.data.warnings.length > 0 && (
            <ul className="space-y-1 text-xs text-amber-800 dark:text-amber-300" data-testid="party-autofill-warnings">
              {done.data.warnings.map((w) => (
                <li key={w} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-violet-200 dark:bg-violet-500/40" /> přečetla AI</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-200 dark:bg-emerald-500/40" /> z ARES</span>
            <span>Zkontroluj a ulož — nic se zatím neuložilo.</span>
            <Button type="button" size="sm" variant="ghost" className="ml-auto h-7" onClick={reset} data-testid="party-autofill-again">
              <RotateCcw /> Jiný doklad
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
