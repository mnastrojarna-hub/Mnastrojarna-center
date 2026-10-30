"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, Inbox, Info, Loader2, PenSquare, RefreshCw, Settings, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SignatureEditor } from "@/components/mail/signature-editor";
import { saveSignatureSettingsAction, signatureEditorAction, type SignatureEditorState } from "@/app/actions/mail-signature";
import { sameSignature, type SignatureSettings } from "@/lib/email/signature";

/**
 * Pošta → ozubené kolo „Nastavení pošty": na mobilu přes celou obrazovku, na desktopu boční panel
 * vpravo. Zatím jedna záložka — Podpis (pro každou schránku zvlášť); další nastavení pošty sem
 * patří také. Data přes server actions (mail-signature), editor je SignatureEditor.
 */
export function MailSettingsPanel({ open, onOpenChange, initialMailbox = null }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Schránka, která je v Poště právě vybraná (adresa) — otevře se její podpis. */
  initialMailbox?: string | null;
}) {
  const dirty = React.useRef(false);
  const setDirty = React.useCallback((d: boolean) => {
    dirty.current = d;
  }, []);
  const close = () => {
    if (dirty.current && !window.confirm("Podpis má neuložené změny. Zavřít bez uložení?")) return;
    dirty.current = false;
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
      <DialogContent
        hideClose
        aria-describedby={undefined}
        // fokus na panel, ne na křížek (jinak svítí červený rámeček hned po otevření)
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
        className="inset-0 top-0 flex h-[100dvh] max-w-none translate-x-0 flex-col rounded-none focus:outline-none sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(100vw,60rem)] sm:rounded-l-2xl sm:rounded-r-none"
        data-testid="mail-settings-panel"
      >
        <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Settings className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="leading-tight">Nastavení pošty</DialogTitle>
            <p className="truncate text-xs text-muted-foreground">Podpis se vloží pod každou novou zprávu, odpověď i přeposlání.</p>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={close} aria-label="Zavřít">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1 border-b px-4 sm:px-6" role="tablist" aria-label="Nastavení pošty">
          <span role="tab" aria-selected="true" className="inline-flex items-center gap-1.5 border-b-2 border-primary px-2 py-2.5 text-sm font-semibold text-primary">
            <PenSquare className="h-4 w-4" /> Podpis
          </span>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pt-4 sm:px-6 sm:pt-5">
          {open && <MailSettingsContent initialMailbox={initialMailbox} onDirty={setDirty} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const OFFLINE = { ok: false as const, error: "Spojení se nepovedlo — zkus to znovu." };

/** Obsah panelu (bez dialogu) — načte podpis schránky, přepíná schránky, ukládá. */
export function MailSettingsContent({ initialMailbox = null, initial = null, onDirty }: {
  initialMailbox?: string | null;
  /** Předaný stav (testy / server) — jinak se načte. */
  initial?: SignatureEditorState | null;
  onDirty?: (dirty: boolean) => void;
}) {
  const [state, setState] = React.useState<SignatureEditorState | null>(initial);
  const [value, setValue] = React.useState<SignatureSettings | null>(initial?.value ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(!initial);
  const request = React.useRef(0);

  const load = React.useCallback(async (mailbox: string | null) => {
    const id = ++request.current;
    setLoading(true);
    setError(null);
    const r = await signatureEditorAction({ mailbox }).catch(() => OFFLINE);
    if (id !== request.current) return; // mezitím přepnuto na jinou schránku
    setLoading(false);
    if (!r.ok) return setError(r.error);
    setState(r);
    setValue(r.value);
  }, []);

  React.useEffect(() => {
    if (!initial) void load(initialMailbox);
  }, [initial, initialMailbox, load]);

  const changed = Boolean(state && value && !sameSignature(value, state.saved ?? state.defaults));
  // efekt nesmí nic vracet (React by návratovou hodnotu volal jako úklid)
  React.useEffect(() => {
    onDirty?.(changed);
  }, [changed, onDirty]);

  const switchMailbox = (key: string | null) => {
    if (!state || key === state.mailbox) return;
    if (changed && !window.confirm("Podpis má neuložené změny. Přepnout schránku bez uložení?")) return;
    void load(key);
  };

  const save = async (v: SignatureSettings) => {
    if (!state) return { ok: false, error: "Podpis není načtený." };
    const r = await saveSignatureSettingsAction({ mailbox: state.mailbox, settings: v }).catch(() => OFFLINE);
    if (!r.ok) return { ok: false, error: r.error };
    setState({ ...state, saved: r.settings, value: r.settings, source: state.mailbox ? "mailbox" : "default" });
    setValue(r.settings);
    return { ok: true };
  };

  if (error && !state) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert" data-testid="mail-settings-error">
        <p className="flex items-start gap-2 text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>
        <Button size="sm" variant="outline" onClick={() => void load(initialMailbox)}><RefreshCw className="h-4 w-4" /> Zkusit znovu</Button>
      </div>
    );
  }
  if (!state || !value) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground" data-testid="mail-settings-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> Načítám podpis…
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {/* schránka se nastavuje v Můj účet (jedno místo) — tady jen odkaz, ne druhý formulář */}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground" data-testid="mail-settings-mailbox">
        <Inbox className="h-3.5 w-3.5 shrink-0" />
        <span>Schránka{state.mailbox ? <>: <b className="font-medium text-foreground">{state.mailbox}</b></> : ""}</span>
        <span aria-hidden>·</span>
        <Link href="/account#schranka" className="font-medium text-primary underline-offset-4 hover:underline">heslo a server v Můj účet</Link>
      </p>
      {state.source === "legacy" && !state.saved && (
        <p className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200" data-testid="mail-settings-legacy">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Zatím se do zpráv vkládá tvůj textový podpis z Můj účet. Až uložíš grafický podpis, nahradí ho.</span>
        </p>
      )}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      <div className={loading ? "pointer-events-none opacity-60" : undefined} aria-busy={loading || undefined}>
        <SignatureEditor
          value={value}
          onChange={setValue}
          defaults={state.defaults}
          company={state.company}
          savedValue={state.saved}
          mailboxes={state.mailboxes}
          mailboxKey={state.mailbox}
          onMailboxChange={switchMailbox}
          onSave={save}
          disabled={loading}
        />
      </div>
    </div>
  );
}
