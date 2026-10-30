"use client";

import * as React from "react";
import { AlertCircle, Inbox, Info, Loader2, PenSquare, RefreshCw, Server, Settings, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SignatureEditor } from "@/components/mail/signature-editor";
import { MyMailboxCard } from "@/components/mail/my-mailbox-card";
import { saveSignatureSettingsAction, signatureEditorAction, type SignatureEditorState } from "@/app/actions/mail-signature";
import { sameSignature, type SignatureSettings } from "@/lib/email/signature";
import type { MyMailbox } from "@/lib/email/my-mailbox";
import { cn } from "@/lib/utils";

export type MailSettingsTab = "schranka" | "podpis";

const TABS: { id: MailSettingsTab; label: string; icon: React.ComponentType<{ className?: string }>; hint: string }[] = [
  { id: "schranka", label: "Schránka", icon: Server, hint: "E-mail, heslo, příchozí (IMAP) a odchozí (SMTP) server — nastavíš si sám." },
  { id: "podpis", label: "Podpis", icon: PenSquare, hint: "Podpis se vloží pod každou novou zprávu, odpověď i přeposlání." },
];

/**
 * Pošta → ozubené kolo „Nastavení pošty": na mobilu přes celou obrazovku, na desktopu boční panel
 * vpravo. Záložky: Schránka (každý uživatel si tu sám připojí a upraví SVOU schránku — e-mail, heslo,
 * IMAP/SMTP server, port, šifrování, test; stejná komponenta jako Můj účet) a Podpis (pro každou
 * schránku zvlášť). Data: /api/mailboxes/my a server actions (mail-signature).
 */
export function MailSettingsPanel({ open, onOpenChange, initialMailbox = null, tab: tabProp, onTabChange, editMailboxId = null, isAdmin = false, onMailboxesChanged }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Schránka, která je v Poště právě vybraná (adresa) — otevře se její podpis. */
  initialMailbox?: string | null;
  /** Otevřená záložka (výchozí Schránka). */
  tab?: MailSettingsTab;
  onTabChange?: (tab: MailSettingsTab) => void;
  /** Rovnou upravit tuto schránku (oprava hesla / doplnění nastavení z Pošty). */
  editMailboxId?: string | null;
  isAdmin?: boolean;
  /** Schránka přidána / upravena / odpojena → Pošta obnoví přehled. */
  onMailboxesChanged?: () => void;
}) {
  const [ownTab, setOwnTab] = React.useState<MailSettingsTab>("schranka");
  const tab = tabProp ?? ownTab;
  const dirty = React.useRef(false);
  const setDirty = React.useCallback((d: boolean) => {
    dirty.current = d;
  }, []);
  const confirmLeave = () => !dirty.current || window.confirm("Podpis má neuložené změny. Zavřít bez uložení?");
  const close = () => {
    if (!confirmLeave()) return;
    dirty.current = false;
    onOpenChange(false);
  };
  const switchTab = (t: MailSettingsTab) => {
    if (t === tab) return;
    if (tab === "podpis" && !confirmLeave()) return;
    dirty.current = false;
    setOwnTab(t);
    onTabChange?.(t);
  };
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
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
            <p className="truncate text-xs text-muted-foreground">{active.hint}</p>
          </div>
          <Button size="icon-sm" variant="ghost" onClick={close} aria-label="Zavřít">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-1 border-b px-4 sm:px-6" role="tablist" aria-label="Nastavení pošty">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => switchTab(id)}
              className={cn(
                "inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              data-testid={`mail-settings-tab-${id}`}
            >
              <Icon className="h-4 w-4" /> {label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4 sm:px-6 sm:pt-5" role="tabpanel">
          {open && tab === "schranka" && <MailboxSettingsContent isAdmin={isAdmin} editMailboxId={editMailboxId} onChanged={onMailboxesChanged} />}
          {open && tab === "podpis" && <MailSettingsContent initialMailbox={initialMailbox} onDirty={setDirty} onOpenMailbox={() => switchTab("schranka")} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const OFFLINE = { ok: false as const, error: "Spojení se nepovedlo — zkus to znovu." };

/**
 * Záložka Schránka: moje schránky (načtené z /api/mailboxes/my) — připojit, upravit servery a heslo,
 * otestovat příjem i odeslání, vypnout, odpojit. Komponenta je stejná jako v Můj účet (MyMailboxCard).
 */
export function MailboxSettingsContent({ isAdmin, editMailboxId = null, onChanged, initial = null }: {
  isAdmin: boolean;
  editMailboxId?: string | null;
  onChanged?: () => void;
  /** Předaný stav (testy) — jinak se načte. */
  initial?: MyMailbox[] | null;
}) {
  const [boxes, setBoxes] = React.useState<MyMailbox[] | null>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/mailboxes/my", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as { mailboxes?: MyMailbox[]; error?: string } | null;
      if (!res.ok || !data?.mailboxes) throw new Error(data?.error ?? `Chyba serveru (HTTP ${res.status}).`);
      setBoxes(data.mailboxes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schránky se nepodařilo načíst.");
    }
  }, []);
  React.useEffect(() => {
    if (!initial) void load();
  }, [initial, load]);
  if (error && !boxes) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert" data-testid="mail-settings-error">
        <p className="flex items-start gap-2 text-destructive"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>
        <Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="h-4 w-4" /> Zkusit znovu</Button>
      </div>
    );
  }
  if (!boxes) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground" data-testid="mail-settings-loading">
        <Loader2 className="h-4 w-4 animate-spin" /> Načítám schránku…
      </p>
    );
  }
  return (
    <div className="space-y-3" data-testid="mail-settings-mailboxes">
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Inbox className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Tvoje e-mailová schránka — odsud přijímáš i odesíláš poštu. Stačí e-mail a heslo; servery (IMAP, SMTP) se najdou samy, nebo je vyplň ručně v <b className="font-medium text-foreground">Upřesnit</b>.</span>
      </p>
      <MyMailboxCard initial={boxes} isAdmin={isAdmin} inPanel initialEditId={editMailboxId} onChanged={onChanged} />
    </div>
  );
}

/** Obsah panelu (bez dialogu) — načte podpis schránky, přepíná schránky, ukládá. */
export function MailSettingsContent({ initialMailbox = null, initial = null, onDirty, onOpenMailbox }: {
  initialMailbox?: string | null;
  /** Předaný stav (testy / server) — jinak se načte. */
  initial?: SignatureEditorState | null;
  onDirty?: (dirty: boolean) => void;
  /** Přepnout na záložku Schránka (heslo a servery). */
  onOpenMailbox?: () => void;
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
      {/* heslo a servery schránky: vedlejší záložka Schránka (stejný panel) */}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground" data-testid="mail-settings-mailbox">
        <Inbox className="h-3.5 w-3.5 shrink-0" />
        <span>Schránka{state.mailbox ? <>: <b className="font-medium text-foreground">{state.mailbox}</b></> : ""}</span>
        {onOpenMailbox && (
          <>
            <span aria-hidden>·</span>
            <button type="button" onClick={onOpenMailbox} className="font-medium text-primary underline-offset-4 hover:underline">heslo a servery v záložce Schránka</button>
          </>
        )}
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
