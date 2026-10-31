"use client";

import * as React from "react";
import Link from "next/link";
import {
  Inbox, Mail, Loader2, Wand2, CheckCircle2, AlertTriangle, Send, PlugZap, Trash2, Pencil, Power, ChevronDown, ShieldCheck, X, Lock, Plug,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/account/password-input";
import { useMailSync } from "@/components/mail/use-mail-sync";
import { endpointLabel, PRESETS, PRESET_IDS, type DetectResult, type DiagResult, type PresetId } from "@/lib/email/mail-config";
import { progressText } from "@/lib/email/mail-types";
import type { MyMailbox } from "@/lib/email/my-mailbox";
import type { MailboxConfig } from "@/lib/supabase/database.types";
import { cn, relativeTime } from "@/lib/utils";

/**
 * „Moje e-mailová schránka" — jedna komponenta pro Pošta → Nastavení pošty → Schránka i Můj účet:
 * připojím si schránku sám (e-mail + heslo → nastavení příjmu i odesílání se najde samo), nebo vyplním
 * servery ručně (IMAP/POP3 server, port, šifrování, uživatel; SMTP server, port, šifrování, uživatel,
 * „SMTP má jiné heslo"), otestuji příjem i odeslání, uložím, upravím, vypnu nebo odpojím. Hesla se
 * do prohlížeče nevracejí.
 */

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/mailboxes/my", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as T | null;
  if (!data) throw new Error(res.status === 504 ? "Server nestihl odpovědět (časový limit) — zkus to znovu." : `Chyba serveru (HTTP ${res.status}).`);
  return data;
}

type Note = { ok: boolean; text: string } | null;

export function MyMailboxCard({ initial, isAdmin, inPanel = false, initialEditId = null, onChanged }: {
  initial: MyMailbox[];
  isAdmin: boolean;
  /** V panelu Pošta → Nastavení pošty (bez odkazu „Otevřít poštu"). */
  inPanel?: boolean;
  /** Rovnou otevřít úpravu této schránky (oprava hesla / neúplné nastavení z Pošty). */
  initialEditId?: string | null;
  /** Schránka přidána / upravena / odpojena (Pošta si obnoví přehled schránek). */
  onChanged?: () => void;
}) {
  const [boxes, setBoxes] = React.useState<MyMailbox[]>(initial);
  const [editing, setEditing] = React.useState<MyMailbox | "new" | null>(() => {
    const pick = initialEditId ? initial.find((b) => b.id === initialEditId && b.editable) : undefined;
    return pick ?? (initial.length ? null : "new");
  });
  const [note, setNoteState] = React.useState<Note>(null);
  const { progress, run } = useMailSync();
  // hláška pozdě doběhlého stahování nepřepíše novější (např. „Zkušební e-mail odeslán" kliknutý mezitím)
  const noteSeq = React.useRef(0);
  const setNote = React.useCallback((n: Note) => {
    noteSeq.current++;
    setNoteState(n);
  }, []);

  const refresh = async () => {
    const res = await fetch("/api/mailboxes/my").then((r) => r.json()).catch(() => null) as { mailboxes?: MyMailbox[] } | null;
    if (res?.mailboxes) setBoxes(res.mailboxes);
    onChanged?.();
  };

  const afterSave = async (id: string, msg: string) => {
    setEditing(null);
    setNote({ ok: true, text: `${msg} Stahuji poštu…` });
    const mine = noteSeq.current;
    await refresh();
    const out = await run({ mailboxId: id });
    if (out && noteSeq.current === mine) setNote({ ok: out.ok, text: `${msg} ${out.text}` });
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
          <BoxRow key={b.id} b={b} onEdit={() => { setNote(null); setEditing(b); }} onChanged={refresh} onNote={setNote} onSync={async () => {
            const mine = noteSeq.current;
            const out = await run({ mailboxId: b.id });
            if (out && noteSeq.current === mine) setNote({ ok: out.ok, text: out.text });
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
        {isAdmin ? (
          <>Jako super admin vidíš poštu všech schránek; firemní schránku (bez vlastníka) a schránky kolegů spravuješ v <Link href="/settings" className="font-medium text-primary underline-offset-4 hover:underline">Nastavení → E-mailové schránky</Link>.</>
        ) : (
          "Vidíš jen poštu svých schránek (a e-maily, které ti kolega předá). Firemní schránku nebo schránku kolegy ti může přiřadit super admin."
        )}
        {!inPanel && (
          <>
            {" "}<Link href="/inbox" className="font-medium text-primary underline-offset-4 hover:underline">Otevřít poštu</Link>
          </>
        )}
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
              <li className="text-amber-700 dark:text-amber-400" data-testid="my-box-smtp-separate">Odesílání používá zvlášť uložené SMTP heslo — Upravit ho nahradí heslem schránky (nezaškrtneš-li „SMTP má jiné heslo“).</li>
            )}
          </ul>
          {b.authBlocked ? (
            <p className="mt-1 text-xs text-destructive">Heslo odmítnuto — oprav ho (Upravit → nové heslo). Automatické stahování je pozastavené.</p>
          ) : b.lastSyncError ? (
            <p className="mt-1 break-words text-xs text-destructive">Poslední stažení selhalo: {b.lastSyncError}</p>
          ) : b.incomplete ? (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Nastavení není kompletní — klikni na Upravit.</p>
          ) : null}
          {b.lockedReason && (
            <p className="mt-1 flex items-start gap-1.5 rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground" data-testid="my-box-locked">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words">{b.lockedReason}</span>
            </p>
          )}
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", b.active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground")}>{b.active ? "aktivní" : "vypnutá"}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => void act("test")} disabled={busy !== null} data-testid="my-box-test">
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Otestovat připojení
        </Button>
        <Button size="sm" variant="outline" onClick={() => void act("testSend")} disabled={busy !== null || !b.canSend} data-testid="my-box-test-send">
          {busy === "testSend" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Vyzkoušet odeslání
        </Button>
        <Button size="sm" variant="outline" onClick={() => void onSync()} disabled={busy !== null || syncing || !b.active}>
          <Inbox className="h-4 w-4" /> Stáhnout
        </Button>
        {b.editable && (
          <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy !== null} data-testid="my-box-edit"><Pencil className="h-4 w-4" /> Upravit</Button>
        )}
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

type IncomingTlsChoice = "" | "tls" | "starttls";
type SmtpTlsChoice = "" | "tls" | "starttls" | "none";

/** Ručně vyplněné servery (formulář „Servery ručně"). */
export interface ManualServers {
  protocol: "imap" | "pop3";
  imapHost: string;
  imapPort: string;
  imapTls: IncomingTlsChoice;
  imapUser: string;
  smtpHost: string;
  smtpPort: string;
  smtpTls: SmtpTlsChoice;
  smtpUser: string;
  /** Potvrzené šifrování bez ověření jména v certifikátu (platí jen pro tentýž server). */
  imapSkip: boolean;
  smtpSkip: boolean;
}

export const EMPTY_SERVERS: ManualServers = {
  protocol: "imap", imapHost: "", imapPort: "", imapTls: "", imapUser: "", smtpHost: "", smtpPort: "", smtpTls: "", smtpUser: "", imapSkip: false, smtpSkip: false,
};

export function serversOf(b: MyMailbox | null): ManualServers {
  const s = b?.settings;
  if (!s) return EMPTY_SERVERS;
  return {
    protocol: s.incomingProtocol, imapHost: s.imapHost, imapPort: s.imapPort ? String(s.imapPort) : "", imapTls: s.imapTls, imapUser: s.imapUser,
    smtpHost: s.smtpHost, smtpPort: s.smtpPort ? String(s.smtpPort) : "", smtpTls: s.smtpTls, smtpUser: s.smtpUser,
    imapSkip: s.imapSkipNameCheck, smtpSkip: s.smtpSkipNameCheck,
  };
}

/** Změna pole; jiný server = staré potvrzení „bez ověření jména" neplatí. */
export function changeServer<K extends keyof ManualServers>(s: ManualServers, k: K, v: ManualServers[K]): ManualServers {
  const next = { ...s, [k]: v };
  if (k === "imapHost" && v !== s.imapHost) next.imapSkip = false;
  if (k === "smtpHost" && v !== s.smtpHost) next.smtpSkip = false;
  return next;
}

/** Konfigurace k testu / uložení z ručně vyplněných serverů (bez hesel). */
export function serversToConfig(s: ManualServers, preset: PresetId, email: string): MailboxConfig {
  const port = (v: string) => (v.trim() ? Number(v.trim()) : undefined);
  return {
    preset,
    incoming_protocol: s.protocol,
    imap_host: s.imapHost.trim(),
    imap_port: port(s.imapPort),
    imap_tls: s.imapTls || undefined,
    imap_user: s.imapUser.trim() || email.trim(),
    imap_skip_name_check: s.imapSkip || undefined,
    smtp_host: s.smtpHost.trim() || undefined,
    smtp_port: s.smtpHost.trim() ? port(s.smtpPort) : undefined,
    smtp_tls: s.smtpHost.trim() ? s.smtpTls || undefined : undefined,
    smtp_user: s.smtpUser.trim() || undefined,
    smtp_skip_name_check: (s.smtpHost.trim() && s.smtpSkip) || undefined,
  };
}

/** Servery z výsledku automatického hledání (vyplní formulář, ať uživatel vidí, co se našlo). */
function serversFromDetect(r: DetectResult, prev: ManualServers): ManualServers {
  const inc = r.incoming;
  const smtp = r.smtp;
  return {
    ...prev,
    ...(inc ? { protocol: inc.protocol === "pop3" ? "pop3" : "imap", imapHost: inc.host, imapPort: String(inc.port), imapTls: inc.tls === "starttls" ? "starttls" : "tls", imapSkip: Boolean(inc.skipNameCheck) } : {}),
    ...(smtp ? { smtpHost: smtp.host, smtpPort: String(smtp.port), smtpTls: smtp.tls, smtpSkip: Boolean(smtp.skipNameCheck) } : {}),
  } as ManualServers;
}

interface TestResult { incoming: DiagResult | null; smtp: DiagResult | null; graph?: DiagResult | null; missing?: string[]; notes?: string[]; error?: string }

/**
 * Připojení / úprava schránky:
 *  - jen e-mail + heslo → „Najít nastavení a připojit" (IMAP/POP3 + SMTP se najdou a ověří samy) → uložit,
 *  - „Servery ručně" s vyplněným příchozím serverem → uloží se PŘESNĚ vyplněné (po ověření příjmu;
 *    nefunguje-li, nabídne „Najít automaticky" nebo „Přesto uložit"),
 *  - „Otestovat připojení" = příjem + odesílání bez uložení.
 */
function ConnectForm({ editing, onCancel, onSaved }: { editing: MyMailbox | null; onCancel?: () => void; onSaved: (id: string, msg: string) => void }) {
  const [email, setEmail] = React.useState(editing?.email ?? "");
  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState(editing?.displayName ?? "");
  // úprava existující schránky: servery rovnou vidět (předvyplněné) — ať jdou opravit bez hledání
  const [advanced, setAdvanced] = React.useState(Boolean(editing?.settings?.imapHost));
  const [preset, setPreset] = React.useState<PresetId>(
    editing ? (editing.settings?.preset && editing.settings.preset !== "m365" ? editing.settings.preset : "other") : "hosting90",
  );
  const [servers, setServers] = React.useState<ManualServers>(serversOf(editing));
  const [separateSmtp, setSeparateSmtp] = React.useState(false);
  const [smtpPassword, setSmtpPassword] = React.useState("");
  const [busy, setBusy] = React.useState<"detect" | "save" | "test" | null>(null);
  const [detect, setDetect] = React.useState<DetectResult | null>(null);
  const [test, setTest] = React.useState<TestResult | null>(null);
  const [offerForce, setOfferForce] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const set = <K extends keyof ManualServers>(k: K, v: ManualServers[K]) => setServers((s) => changeServer(s, k, v));
  const manual = advanced && servers.imapHost.trim() !== "";
  const secrets = () => ({
    password: password || undefined,
    smtpPassword: separateSmtp && smtpPassword ? smtpPassword : undefined,
    keepSmtpPassword: separateSmtp && !smtpPassword ? true : undefined,
  });

  const runDetect = async (allowNameMismatch: boolean): Promise<DetectResult | null> => {
    setDetect(null);
    const adv = advanced;
    const r = await api<DetectResult>({
      action: "detect", mailboxId: editing?.id ?? null, email, password: password || undefined, preset,
      host: adv && servers.imapHost ? servers.imapHost : undefined,
      port: adv && servers.imapHost && Number(servers.imapPort) ? Number(servers.imapPort) : undefined,
      protocol: adv && servers.imapHost ? servers.protocol : undefined,
      user: adv && servers.imapUser && servers.imapUser !== email ? servers.imapUser : undefined,
      smtpHost: adv && servers.smtpHost ? servers.smtpHost : undefined,
      smtpPort: adv && servers.smtpHost && Number(servers.smtpPort) ? Number(servers.smtpPort) : undefined,
      smtpTls: adv && servers.smtpHost && servers.smtpTls ? servers.smtpTls : undefined,
      allowNameMismatch,
    });
    setDetect(r);
    return r;
  };

  const save = async (config: MailboxConfig, found: string) => {
    setBusy("save");
    const saved = await api<{ ok: boolean; error?: string; id?: string; warning?: string }>({
      action: "save", mailboxId: editing?.id ?? null, email, displayName, config, ...secrets(),
    });
    setBusy(null);
    if (!saved.ok || !saved.id) return setError(saved.error ?? "Schránku se nepodařilo uložit.");
    onSaved(saved.id, `${editing ? "Schránka upravena" : "Schránka připojena"} (${found}).${saved.warning ? ` ${saved.warning}` : ""}`);
  };

  /** Uložit přesně vyplněné servery — po ověření příjmu (force = bez ověření, na výslovné přání). */
  const saveManual = async (force: boolean) => {
    const config = serversToConfig(servers, preset, email);
    if (!force) {
      setBusy("test");
      const r = await runTestDraft(config);
      setBusy(null);
      if (!r) return;
      if (r.error) return setError(r.error);
      if (!r.incoming?.ok) {
        setOfferForce(true);
        return setError(`Příjem s vyplněnými servery nefunguje: ${r.incoming?.error ?? (r.missing?.length ? `chybí ${r.missing.join(", ")}` : "neznámá chyba")}. Oprav údaje, zkus „Najít nastavení automaticky", nebo ulož i tak.`);
      }
    }
    const smtpLabel = servers.smtpHost.trim() ? ` · odesílání ${servers.smtpHost.trim()}:${servers.smtpPort || "výchozí port"}` : "";
    await save(config, `${servers.protocol.toUpperCase()} ${servers.imapHost.trim()}:${servers.imapPort || "výchozí port"}${smtpLabel}`);
  };

  const runTestDraft = async (config: MailboxConfig): Promise<TestResult | null> => {
    setTest(null);
    const r = await api<TestResult>({
      action: "testDraft", mailboxId: editing?.id ?? null, email, password: password || undefined, separateSmtp, smtpPassword: separateSmtp && smtpPassword ? smtpPassword : undefined, config,
    });
    setTest(r);
    return r;
  };

  const connect = async (allowNameMismatch = false) => {
    setError(null);
    setDetect(null);
    setTest(null);
    setOfferForce(false);
    if (!email.trim()) return setError("Zadej e-mailovou adresu.");
    if (!editing && !password) return setError("Zadej heslo ke schránce.");
    try {
      if (manual) return await saveManual(false);
      setBusy("detect");
      const r = await runDetect(allowNameMismatch);
      if (!r) return;
      if (!r.ok || !r.config) {
        setBusy(null);
        if (!r.needsConfirmation) setError(`${r.error ?? "Nastavení se nepodařilo najít."} Můžeš vyplnit servery ručně (Upřesnit — servery IMAP / SMTP ručně).`);
        return;
      }
      // SMTP s jiným heslem: vyplněný SMTP server se uloží tak, jak je (hledání ho heslem schránky ověřit nemůže)
      const config: MailboxConfig = separateSmtp && servers.smtpHost.trim()
        ? { ...r.config, smtp_host: servers.smtpHost.trim(), smtp_port: Number(servers.smtpPort) || undefined, smtp_tls: servers.smtpTls || undefined, smtp_user: servers.smtpUser.trim() || undefined }
        : r.config;
      const found = `${r.incoming ? endpointLabel(r.incoming) : ""}${r.smtp ? ` · odesílání ${endpointLabel(r.smtp)}` : ""}`;
      await save(config, found);
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Chyba");
    }
  };

  /** „Otestovat připojení": ručně vyplněné → test přesně těch údajů; jinak najít a ukázat (bez uložení). */
  const testOnly = async () => {
    setError(null);
    setTest(null);
    setDetect(null);
    setOfferForce(false);
    if (!email.trim()) return setError("Zadej e-mailovou adresu.");
    if (!editing && !password) return setError("Zadej heslo ke schránce.");
    try {
      if (manual) {
        setBusy("test");
        const r = await runTestDraft(serversToConfig(servers, preset, email));
        if (r?.error) setError(r.error);
      } else {
        setBusy("detect");
        const r = await runDetect(false);
        if (r?.ok) {
          setServers((s) => serversFromDetect(r, s));
          setAdvanced(true);
        } else if (r && !r.needsConfirmation) setError(r.error ?? "Nastavení se nepodařilo najít.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setBusy(null);
    }
  };

  const findAuto = async () => {
    setError(null);
    setOfferForce(false);
    setBusy("detect");
    try {
      const r = await runDetect(false);
      if (r?.ok) {
        setServers((s) => serversFromDetect(r, s));
        setTest(null);
      } else if (r && !r.needsConfirmation) setError(r.error ?? "Nastavení se nepodařilo najít.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Chyba");
    } finally {
      setBusy(null);
    }
  };

  const selectCls = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
  return (
    <form
      className="min-w-0 space-y-2.5 rounded-lg border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-500/30 dark:bg-blue-500/5"
      onSubmit={(e) => { e.preventDefault(); void connect(false); }}
      data-testid="my-mailbox-form"
    >
      <p className="text-sm font-medium">{editing ? `Upravit ${editing.email}` : "Připojit e-mailovou schránku"}</p>
      <p className="text-xs text-muted-foreground">Stačí e-mail a heslo — příchozí (IMAP/POP3) i odchozí server (SMTP) se najdou a ověří samy (hosting90, Gmail, …). Servery můžeš vyplnit i ručně.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="min-w-0 space-y-1 text-xs font-medium">
          E-mail
          <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="off" placeholder="e-mail schránky" aria-label="E-mail schránky" className="placeholder:italic" />
        </label>
        <label className="min-w-0 space-y-1 text-xs font-medium">
          Heslo ke schránce{editing?.passwordStored ? " (prázdné = ponechat uložené)" : ""}
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" aria-label="Heslo ke schránce" />
        </label>
        <label className="min-w-0 space-y-1 text-xs font-medium sm:col-span-2">
          Popis (volitelné)
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="např. Obchod" aria-label="Popis schránky" />
        </label>
      </div>
      <button type="button" onClick={() => setAdvanced((a) => !a)} className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-primary hover:underline" aria-expanded={advanced} data-testid="my-mailbox-advanced">
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", advanced && "rotate-180")} /> Upřesnit — servery IMAP / SMTP ručně
      </button>
      {advanced && (
        <div className="space-y-2.5" data-testid="my-mailbox-servers">
          <label className="block min-w-0 space-y-1 text-xs font-medium">
            Poskytovatel
            <select value={preset} onChange={(e) => setPreset(e.target.value as PresetId)} className={selectCls} aria-label="Poskytovatel">
              {PRESET_IDS.filter((p) => p !== "m365").map((p) => <option key={p} value={p}>{PRESETS[p].label}</option>)}
            </select>
          </label>
          <fieldset className="min-w-0 space-y-2 rounded-md border bg-background/60 p-2.5">
            <legend className="px-1 text-xs font-semibold">Příchozí pošta</legend>
            <div className="grid gap-2 sm:grid-cols-6">
              <label className="min-w-0 space-y-1 text-xs font-medium sm:col-span-2">
                Protokol
                <select value={servers.protocol} onChange={(e) => set("protocol", e.target.value === "pop3" ? "pop3" : "imap")} className={selectCls} aria-label="Protokol příchozí pošty">
                  <option value="imap">IMAP</option>
                  <option value="pop3">POP3</option>
                </select>
              </label>
              <label className="min-w-0 space-y-1 text-xs font-medium sm:col-span-4">
                Příchozí server
                <Input value={servers.imapHost} onChange={(e) => set("imapHost", e.target.value)} placeholder="mail.hosting90.cz" aria-label="Příchozí server" />
              </label>
              <label className="min-w-0 space-y-1 text-xs font-medium sm:col-span-2">
                Port
                <Input value={servers.imapPort} onChange={(e) => set("imapPort", e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder={servers.protocol === "pop3" ? "995" : "993"} aria-label="Port příchozího serveru" />
              </label>
              <label className="min-w-0 space-y-1 text-xs font-medium sm:col-span-4">
                Šifrování
                <select value={servers.imapTls} onChange={(e) => set("imapTls", e.target.value as IncomingTlsChoice)} className={selectCls} aria-label="Šifrování příchozího serveru">
                  <option value="">podle portu (993 / 995 SSL/TLS, 143 / 110 STARTTLS)</option>
                  <option value="tls">SSL/TLS</option>
                  <option value="starttls">STARTTLS</option>
                </select>
              </label>
              <label className="min-w-0 space-y-1 text-xs font-medium sm:col-span-6">
                Uživatelské jméno (prázdné = celá e-mailová adresa)
                <Input value={servers.imapUser} onChange={(e) => set("imapUser", e.target.value)} placeholder={email || "přihlašovací jméno (obvykle e-mail)"} autoComplete="off" aria-label="Uživatelské jméno" className="placeholder:italic" />
              </label>
            </div>
          </fieldset>
          <fieldset className="min-w-0 space-y-2 rounded-md border bg-background/60 p-2.5">
            <legend className="px-1 text-xs font-semibold">Odchozí pošta (SMTP)</legend>
            <div className="grid gap-2 sm:grid-cols-6">
              <label className="min-w-0 space-y-1 text-xs font-medium sm:col-span-6">
                Odchozí server (SMTP)
                <Input value={servers.smtpHost} onChange={(e) => set("smtpHost", e.target.value)} placeholder="smtp.hosting90.cz" aria-label="Odchozí server" />
              </label>
              <label className="min-w-0 space-y-1 text-xs font-medium sm:col-span-2">
                Port SMTP
                <Input value={servers.smtpPort} onChange={(e) => set("smtpPort", e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="465 / 587 / 366" aria-label="Port odchozího serveru" />
              </label>
              <label className="min-w-0 space-y-1 text-xs font-medium sm:col-span-4">
                Šifrování SMTP
                <select value={servers.smtpTls} onChange={(e) => set("smtpTls", e.target.value as SmtpTlsChoice)} className={selectCls} aria-label="Šifrování odchozího serveru">
                  <option value="">podle portu (465 SSL/TLS, 587 / 366 STARTTLS)</option>
                  <option value="tls">SSL/TLS</option>
                  <option value="starttls">STARTTLS</option>
                  <option value="none">Žádné (jako Outlook — STARTTLS, nabídne-li ho server)</option>
                </select>
              </label>
              <label className="min-w-0 space-y-1 text-xs font-medium sm:col-span-6">
                Uživatelské jméno pro SMTP (prázdné = jako u příchozí)
                <Input value={servers.smtpUser} onChange={(e) => set("smtpUser", e.target.value)} placeholder={servers.imapUser || email || "přihlašovací jméno (obvykle e-mail)"} autoComplete="off" aria-label="Uživatelské jméno SMTP" className="placeholder:italic" />
              </label>
            </div>
            <label className="flex min-h-8 items-center gap-2 text-xs">
              <input type="checkbox" checked={separateSmtp} onChange={(e) => setSeparateSmtp(e.target.checked)} className="h-4 w-4" data-testid="my-mailbox-smtp-separate" />
              SMTP má jiné heslo než schránka
            </label>
            {separateSmtp && (
              <label className="block min-w-0 space-y-1 text-xs font-medium">
                Heslo pro SMTP{editing?.smtpPasswordSeparate ? " (prázdné = ponechat uložené)" : ""}
                <PasswordInput value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} autoComplete="new-password" aria-label="Heslo SMTP" />
              </label>
            )}
            <p className="text-xs text-muted-foreground">
              Nastavení z Outlooku (např. SMTP smtp.nastrojarstvi.com, port 366, šifrování „Žádné“) sem opiš — použije se přesně.
              {!separateSmtp && " Pro odesílání se použije heslo ke schránce."}
            </p>
          </fieldset>
        </div>
      )}
      {detect?.needsConfirmation && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="my-mailbox-confirm">
          <p>{detect.error}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void connect(true)}>Rozumím, použít šifrované spojení bez ověření jména</Button>
        </div>
      )}
      {detect?.ok && detect.smtpError && <p className="text-xs text-amber-700 dark:text-amber-400">{detect.smtpError}</p>}
      {detect?.ok && busy === null && !error && !test && (
        <p className="text-xs text-success" data-testid="my-mailbox-found">
          Nalezeno: {detect.incoming ? endpointLabel(detect.incoming) : "—"}{detect.smtp ? ` · odesílání ${endpointLabel(detect.smtp)}` : ""}. Servery jsou vyplněné níže — ulož je.
        </p>
      )}
      {test && <TestView test={test} />}
      {error && <p className="break-words text-sm text-destructive" role="alert" data-testid="my-mailbox-error">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" variant="success" disabled={busy !== null} data-testid="my-mailbox-connect">
          {busy === "detect" || busy === "save" || (busy === "test" && manual) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
          {busy === "detect" ? "Hledám nastavení…" : busy === "save" ? "Ukládám…" : busy === "test" ? "Ověřuji…" : editing ? "Ověřit a uložit" : manual ? "Ověřit a připojit" : "Najít nastavení a připojit"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void testOnly()} disabled={busy !== null} data-testid="my-mailbox-test">
          <Plug className="h-4 w-4" /> Otestovat připojení
        </Button>
        {manual && (
          <Button type="button" size="sm" variant="ghost" onClick={() => void findAuto()} disabled={busy !== null} data-testid="my-mailbox-detect">
            <Wand2 className="h-4 w-4" /> Najít nastavení automaticky
          </Button>
        )}
        {offerForce && manual && (
          <Button type="button" size="sm" variant="ghost" onClick={() => void saveManual(true).catch((e: unknown) => { setBusy(null); setError(e instanceof Error ? e.message : "Chyba"); })} disabled={busy !== null} data-testid="my-mailbox-force">
            Přesto uložit
          </Button>
        )}
        {onCancel && <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy !== null}>Zrušit</Button>}
      </div>
    </form>
  );
}

/** Výsledek „Otestovat připojení": příjem a odesílání zvlášť, česky. */
function TestView({ test }: { test: TestResult }) {
  const row = (label: string, r: DiagResult | null | undefined, missing?: string) => (
    <li className={cn("flex items-start gap-1.5 break-words", r?.ok ? "text-success" : "text-destructive")}>
      {r?.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
      <span className="min-w-0">
        <b className="font-medium">{label}:</b>{" "}
        {r ? (r.ok ? `OK${r.endpoint ? ` (${endpointLabel(r.endpoint)})` : ""}${typeof r.messages === "number" ? ` · ${r.messages} zpráv v INBOXu` : ""}` : r.error ?? "nefunguje") : missing ?? "nevyplněno"}
        {r?.note ? <span className="block text-amber-700 dark:text-amber-400">{r.note}</span> : null}
      </span>
    </li>
  );
  return (
    <ul className="space-y-1 rounded-md border bg-background/60 p-2.5 text-xs" data-testid="my-mailbox-test-result">
      {row("Příjem", test.incoming, test.missing?.length ? `chybí ${test.missing.join(", ")}` : undefined)}
      {row("Odesílání (SMTP)", test.smtp, "odchozí server není vyplněný — odesílat z aplikace nepůjde")}
      {test.notes?.map((n) => <li key={n} className="text-muted-foreground">{n}</li>)}
    </ul>
  );
}
