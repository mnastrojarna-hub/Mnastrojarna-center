"use client";

import * as React from "react";
import Link from "next/link";
import {
  Inbox, Mail, Loader2, Wand2, CheckCircle2, AlertTriangle, Send, PlugZap, Trash2, Pencil, Power, ChevronDown, ShieldCheck, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/account/password-input";
import { useMailSync } from "@/components/mail/use-mail-sync";
import { endpointLabel, PRESETS, PRESET_IDS, type DetectResult, type PresetId } from "@/lib/email/mail-config";
import { progressText } from "@/lib/email/mail-types";
import type { MyMailbox } from "@/lib/email/my-mailbox";
import { cn, relativeTime } from "@/lib/utils";

/**
 * Můj účet → „Moje e-mailová schránka": připojím si schránku sám (e-mail + heslo → nastavení příjmu
 * i odesílání se najde samo), vyzkouším příjem i odeslání, upravím, vypnu nebo odpojím. Hesla se
 * do prohlížeče nevracejí.
 */

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/mailboxes/my", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as T | null;
  if (!data) throw new Error(res.status === 504 ? "Server nestihl odpovědět (časový limit) — zkus to znovu." : `Chyba serveru (HTTP ${res.status}).`);
  return data;
}

type Note = { ok: boolean; text: string } | null;

export function MyMailboxCard({ initial, isAdmin }: { initial: MyMailbox[]; isAdmin: boolean }) {
  const [boxes, setBoxes] = React.useState<MyMailbox[]>(initial);
  const [editing, setEditing] = React.useState<MyMailbox | "new" | null>(initial.length ? null : "new");
  const [note, setNote] = React.useState<Note>(null);
  const { progress, run } = useMailSync();

  const refresh = async () => {
    const res = await fetch("/api/mailboxes/my").then((r) => r.json()).catch(() => null) as { mailboxes?: MyMailbox[] } | null;
    if (res?.mailboxes) setBoxes(res.mailboxes);
  };

  const afterSave = async (id: string, msg: string) => {
    setEditing(null);
    setNote({ ok: true, text: `${msg} Stahuji poštu…` });
    await refresh();
    const out = await run({ mailboxId: id });
    if (out) setNote({ ok: out.ok, text: `${msg} ${out.text}` });
    await refresh();
  };

  return (
    <div className="space-y-3" data-testid="my-mailbox">
      {note && (
        <p className={cn("flex items-start gap-1.5 rounded-md px-2.5 py-2 text-sm", note.ok ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")} role="status" data-testid="my-mailbox-note">
          {note.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1 break-words">{note.text}</span>
          <button type="button" onClick={() => setNote(null)} aria-label="Zavřít" className="opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>
        </p>
      )}
      {progress.running && (
        <div className="rounded-lg border px-3 py-2 text-sm" data-testid="my-mailbox-progress">
          <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin text-primary" /> {progress.total ? progressText(progress.total, progress.remaining) : "Stahuji poštu…"}</span>
          {progress.total > 0 && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.round(((progress.total - progress.remaining) / progress.total) * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {boxes.map((b) => (
        editing && editing !== "new" && editing.id === b.id ? (
          <ConnectForm key={b.id} editing={b} onCancel={() => setEditing(null)} onSaved={(id, msg) => void afterSave(id, msg)} />
        ) : (
          <BoxRow key={b.id} b={b} onEdit={() => setEditing(b)} onChanged={refresh} onNote={setNote} onSync={async () => {
            const out = await run({ mailboxId: b.id });
            if (out) setNote({ ok: out.ok, text: out.text });
            await refresh();
          }} syncing={progress.running} />
        )
      ))}

      {editing === "new" ? (
        <ConnectForm editing={null} onCancel={boxes.length ? () => setEditing(null) : undefined} onSaved={(id, msg) => void afterSave(id, msg)} />
      ) : (
        <Button variant="outline" size="sm" onClick={() => setEditing("new")} data-testid="my-mailbox-add">
          <PlugZap className="h-4 w-4" /> {boxes.length ? "Připojit další schránku" : "Připojit schránku"}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        {isAdmin ? "Jako super admin vidíš poštu všech schránek; firemní schránku (bez vlastníka) spravuješ v Nastavení → E-mailové schránky." : "Vidíš jen poštu svých schránek (a e-maily, které ti kolega předá)."}{" "}
        <Link href="/inbox" className="font-medium text-primary underline-offset-4 hover:underline">Otevřít poštu</Link>
      </p>
    </div>
  );
}

function BoxRow({ b, onEdit, onChanged, onNote, onSync, syncing }: {
  b: MyMailbox; onEdit: () => void; onChanged: () => Promise<void>; onNote: (n: Note) => void; onSync: () => Promise<void>; syncing: boolean;
}) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      if (action === "test") {
        const r = await api<{ incoming?: { ok: boolean; error?: string; messages?: number } | null; smtp?: { ok: boolean; error?: string; note?: string } | null; graph?: { ok: boolean; error?: string } | null; error?: string }>({ action, mailboxId: b.id });
        const inc = r.incoming ?? r.graph;
        const parts = [
          inc ? (inc.ok ? `Příjem OK${typeof (inc as { messages?: number }).messages === "number" ? ` (${(inc as { messages?: number }).messages} zpráv v INBOXu)` : ""}` : `Příjem: ${inc.error}`) : r.error ?? "",
          r.smtp ? (r.smtp.ok ? "Odesílání (SMTP) OK" : `Odesílání: ${r.smtp.error}`) : b.provider === "outlook" ? "" : "Odesílání: SMTP není nastavené",
          r.smtp?.note ?? "",
        ].filter(Boolean);
        onNote({ ok: Boolean(inc?.ok && (r.smtp?.ok ?? b.provider === "outlook")), text: parts.join(" · ") });
      } else if (action === "testSend") {
        const r = await api<{ sent: boolean; text: string }>({ action, mailboxId: b.id });
        onNote({ ok: r.sent, text: r.sent ? `Zkušební e-mail odeslán. ${r.text}` : r.text });
      } else {
        const r = await api<{ ok: boolean; error?: string }>({ action, mailboxId: b.id, ...extra });
        if (!r.ok) onNote({ ok: false, text: r.error ?? "Chyba" });
        else onNote({ ok: true, text: action === "delete" ? `Schránka ${b.email} odpojena — stažená pošta ti zůstává.` : extra.active ? "Schránka zapnutá." : "Schránka vypnutá (nestahuje se ani se z ní neodesílá)." });
        await onChanged();
      }
    } catch (err) {
      onNote({ ok: false, text: err instanceof Error ? err.message : "Chyba" });
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  };
  return (
    <div className="min-w-0 space-y-2 rounded-lg border p-3" data-testid={`my-box-${b.email}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400"><Mail className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1 text-sm">
          <div className="truncate font-medium">{b.displayName || b.email}</div>
          <div className="truncate text-xs text-muted-foreground" suppressHydrationWarning>
            {b.displayName ? `${b.email} · ` : ""}{b.lastSyncAt ? `staženo ${relativeTime(b.lastSyncAt)}` : "zatím nestaženo"}
            {b.remaining ? ` · čeká ${b.remaining}` : ""}
          </div>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            <li className="break-words">Příjem: {b.incoming ?? "—"}</li>
            <li className={cn("break-words", !b.canSend && "text-amber-700 dark:text-amber-400")}>Odesílání: {b.smtp ?? "nenastaveno — doplň v Upravit"}</li>
            {b.smtpPasswordSeparate && (
              <li className="text-amber-700 dark:text-amber-400" data-testid="my-box-smtp-separate">Odesílání používá zvlášť uložené SMTP heslo — Upravit ho nahradí heslem schránky.</li>
            )}
          </ul>
          {b.authBlocked ? (
            <p className="mt-1 text-xs text-destructive">Heslo odmítnuto — oprav ho (Upravit → nové heslo). Automatické stahování je pozastavené.</p>
          ) : b.lastSyncError ? (
            <p className="mt-1 break-words text-xs text-destructive">Poslední stažení selhalo: {b.lastSyncError}</p>
          ) : b.incomplete ? (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Nastavení není kompletní — klikni na Upravit.</p>
          ) : null}
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", b.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{b.active ? "aktivní" : "vypnutá"}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => void act("test")} disabled={busy !== null} data-testid="my-box-test">
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Otestovat
        </Button>
        <Button size="sm" variant="outline" onClick={() => void act("testSend")} disabled={busy !== null || !b.canSend} data-testid="my-box-test-send">
          {busy === "testSend" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Vyzkoušet odeslání
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onSync()} disabled={busy !== null || syncing || !b.active}>
          <Inbox className="h-4 w-4" /> Stáhnout
        </Button>
        <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy !== null} data-testid="my-box-edit"><Pencil className="h-4 w-4" /> Upravit</Button>
        <Button size="sm" variant="ghost" onClick={() => void act("active", { active: !b.active })} disabled={busy !== null}><Power className="h-4 w-4" /> {b.active ? "Vypnout" : "Zapnout"}</Button>
        {confirmDelete ? (
          <span className="inline-flex items-center gap-1">
            <Button size="sm" variant="destructive" onClick={() => void act("delete")} disabled={busy !== null}>Opravdu odpojit</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Ne</Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy !== null} className="text-destructive"><Trash2 className="h-4 w-4" /> Odpojit</Button>
        )}
      </div>
    </div>
  );
}

/** Připojení / úprava: e-mail + heslo → najít nastavení (IMAP/POP3 + SMTP) → uložit. */
function ConnectForm({ editing, onCancel, onSaved }: { editing: MyMailbox | null; onCancel?: () => void; onSaved: (id: string, msg: string) => void }) {
  const [email, setEmail] = React.useState(editing?.email ?? "");
  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState(editing?.displayName ?? "");
  const [advanced, setAdvanced] = React.useState(false);
  const [preset, setPreset] = React.useState<PresetId>("hosting90");
  const [host, setHost] = React.useState("");
  const [smtpHost, setSmtpHost] = React.useState("");
  const [smtpPort, setSmtpPort] = React.useState("");
  const [smtpTls, setSmtpTls] = React.useState<"" | "tls" | "starttls" | "none">("");
  const [busy, setBusy] = React.useState<"detect" | "save" | null>(null);
  const [detect, setDetect] = React.useState<DetectResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const connect = async (allowNameMismatch = false) => {
    setError(null);
    setDetect(null);
    if (!email.trim()) return setError("Zadej e-mailovou adresu.");
    if (!editing && !password) return setError("Zadej heslo ke schránce.");
    setBusy("detect");
    try {
      const r = await api<DetectResult>({
        action: "detect", mailboxId: editing?.id ?? null, email, password: password || undefined, preset,
        host: advanced && host ? host : undefined, smtpHost: advanced && smtpHost ? smtpHost : undefined,
        smtpPort: advanced && smtpHost && Number(smtpPort) ? Number(smtpPort) : undefined, smtpTls: advanced && smtpHost && smtpTls ? smtpTls : undefined,
        allowNameMismatch,
      });
      setDetect(r);
      if (!r.ok || !r.config) {
        setBusy(null);
        if (!r.needsConfirmation) setError(r.error ?? "Nastavení se nepodařilo najít.");
        return;
      }
      setBusy("save");
      const saved = await api<{ ok: boolean; error?: string; id?: string; warning?: string }>({
        action: "save", mailboxId: editing?.id ?? null, email, displayName, password: password || undefined, config: r.config,
      });
      setBusy(null);
      if (!saved.ok || !saved.id) return setError(saved.error ?? "Schránku se nepodařilo uložit.");
      const found = `${r.incoming ? endpointLabel(r.incoming) : ""}${r.smtp ? ` · odesílání ${endpointLabel(r.smtp)}` : ""}`;
      onSaved(saved.id, `${editing ? "Schránka upravena" : "Schránka připojena"} (${found}).${saved.warning ? ` ${saved.warning}` : ""}`);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Chyba");
    }
  };

  return (
    <form
      className="space-y-2.5 rounded-lg border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-500/30 dark:bg-blue-500/5"
      onSubmit={(e) => { e.preventDefault(); void connect(false); }}
      data-testid="my-mailbox-form"
    >
      <p className="text-sm font-medium">{editing ? `Upravit ${editing.email}` : "Připojit e-mailovou schránku"}</p>
      <p className="text-xs text-muted-foreground">Stačí e-mail a heslo — příchozí (IMAP/POP3) i odchozí server (SMTP) se najdou a ověří samy (hosting90, Gmail, …).</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="space-y-1 text-xs font-medium">
          E-mail
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" placeholder="jmeno@nastrojarstvi.com" aria-label="E-mail schránky" />
        </label>
        <label className="space-y-1 text-xs font-medium">
          Heslo ke schránce{editing?.passwordStored ? " (prázdné = ponechat uložené)" : ""}
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" aria-label="Heslo ke schránce" />
        </label>
        <label className="space-y-1 text-xs font-medium sm:col-span-2">
          Popis (volitelné)
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="např. Obchod" aria-label="Popis schránky" />
        </label>
      </div>
      <button type="button" onClick={() => setAdvanced((a) => !a)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" aria-expanded={advanced}>
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advanced && "rotate-180")} /> Upřesnit (poskytovatel, servery)
      </button>
      {advanced && (
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-xs font-medium">
            Poskytovatel
            <select value={preset} onChange={(e) => setPreset(e.target.value as PresetId)} className="h-9 w-full rounded-md border bg-background px-2 text-sm" aria-label="Poskytovatel">
              {PRESET_IDS.filter((p) => p !== "m365").map((p) => <option key={p} value={p}>{PRESETS[p].label}</option>)}
            </select>
          </label>
          <label className="space-y-1 text-xs font-medium">
            Příchozí server
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="mail.hosting90.cz" aria-label="Příchozí server" />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Odchozí server (SMTP)
            <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.hosting90.cz" aria-label="Odchozí server" />
          </label>
          <label className="space-y-1 text-xs font-medium">
            Port SMTP (volitelné)
            <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="465 / 587 / 366" aria-label="Port odchozího serveru" />
          </label>
          <label className="space-y-1 text-xs font-medium sm:col-span-2">
            Šifrování SMTP
            <select value={smtpTls} onChange={(e) => setSmtpTls(e.target.value as typeof smtpTls)} className="h-9 w-full rounded-md border bg-background px-2 text-sm" aria-label="Šifrování odchozího serveru">
              <option value="">podle portu (465 SSL/TLS, 587 / 366 STARTTLS)</option>
              <option value="tls">SSL/TLS</option>
              <option value="starttls">STARTTLS</option>
              <option value="none">Žádné (jako Outlook — STARTTLS, nabídne-li ho server)</option>
            </select>
          </label>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Nastavení z Outlooku (např. SMTP smtp.nastrojarstvi.com, port 366, šifrování „Žádné“) sem opiš — zkusí se jako první. Heslo pro odesílání je vždy heslo ke schránce.
          </p>
        </div>
      )}
      {detect?.needsConfirmation && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="my-mailbox-confirm">
          <p>{detect.error}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void connect(true)}>Rozumím, použít šifrované spojení bez ověření jména</Button>
        </div>
      )}
      {detect?.ok && detect.smtpError && <p className="text-xs text-amber-700 dark:text-amber-400">{detect.smtpError}</p>}
      {error && <p className="break-words text-sm text-destructive" role="alert" data-testid="my-mailbox-error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="success" disabled={busy !== null} data-testid="my-mailbox-connect">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {busy === "detect" ? "Hledám nastavení…" : busy === "save" ? "Ukládám…" : editing ? "Ověřit a uložit" : "Najít nastavení a připojit"}
        </Button>
        {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy !== null}>Zrušit</Button>}
      </div>
    </form>
  );
}
