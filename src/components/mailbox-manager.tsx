"use client";

import * as React from "react";
import {
  Plus, Trash2, Mail, Loader2, Plug, Pencil, Check, X, CheckCircle2, AlertCircle, UserRound, Wand2, RefreshCw,
  ChevronDown, ChevronRight, KeyRound, ShieldAlert, Power, Info, Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { addMailbox, updateMailbox, deleteMailbox, setMailboxActive } from "@/app/actions/integrations";
import { setMailboxOwner } from "@/app/actions/mailbox-owner";
import type { Mailbox, MailboxConfig, MailboxProvider } from "@/lib/supabase/database.types";
import {
  PRESETS, PRESET_IDS, STEP_LABEL, PROTO_LABEL, TLS_LABEL, defaultPort, defaultTlsForPort, endpointLabel, mailboxMissing, presetOf, protocolOfPort,
  providerForPreset, HOSTING90_IMAP_HOST, HOSTING90_SMTP_HOST,
  type DetectResult, type DiagResult, type PresetId, type SecretKey,
} from "@/lib/email/mail-config";
import { useRouter } from "next/navigation";
import { cn, relativeTime } from "@/lib/utils";

/** Uživatel, kterému lze schránku přiřadit (vidí pak její poštu). */
export interface MailboxUser {
  id: string;
  full_name: string;
  email: string | null;
}

function userLabel(u: MailboxUser): string {
  return u.full_name?.trim() || u.email || "Bez jména";
}

/** Výběr vlastníka schránky. */
function OwnerSelect({
  users,
  value,
  onChange,
  disabled,
  className,
}: {
  users: MailboxUser[];
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled}
      aria-label="Vlastník schránky"
      className={cn("h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm", className)}
    >
      <option value="">— bez vlastníka (jen super admin) —</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {userLabel(u)}
          {u.email && u.full_name?.trim() ? ` (${u.email})` : ""}
        </option>
      ))}
    </select>
  );
}

const PRESET_LABEL: Record<PresetId, string> = {
  hosting90: "hosting90 (vlastní doména) — @nastrojarstvi.com, @mnastrojarna.cz …",
  m365: "Microsoft 365 (Exchange Online) — ne Outlook v počítači",
  gmail: "Gmail / Google Workspace",
  other: "Jiný poskytovatel (IMAP / POP3)",
};

type TlsChoice = "" | "tls" | "starttls" | "none";

export interface FormState {
  preset: PresetId;
  email: string;
  displayName: string;
  incoming_protocol: "imap" | "pop3";
  imap_host: string;
  imap_port: string;
  imap_tls: TlsChoice;
  imap_user: string;
  imap_skip_name_check: boolean;
  smtp_host: string;
  smtp_port: string;
  smtp_tls: TlsChoice;
  smtp_user: string;
  smtp_skip_name_check: boolean;
  ms_graph_client_id: string;
  ms_graph_tenant_id: string;
  /** Nová hesla (posílají se jen výslovně). */
  password: string;
  smtpPassword: string;
  graphSecret: string;
  changePassword: boolean;
  separateSmtpPassword: boolean;
  changeGraphSecret: boolean;
}

// Šifrování ve výchozím stavu „podle portu" (prázdné) — změna portu pak nenechá nesedící šifrování.
function presetDefaults(preset: PresetId): Partial<FormState> {
  if (preset === "hosting90") {
    return { incoming_protocol: "imap", imap_host: HOSTING90_IMAP_HOST, imap_port: "993", imap_tls: "", smtp_host: HOSTING90_SMTP_HOST, smtp_port: "465", smtp_tls: "" };
  }
  if (preset === "gmail") {
    return { incoming_protocol: "imap", imap_host: "imap.gmail.com", imap_port: "993", imap_tls: "", smtp_host: "smtp.gmail.com", smtp_port: "465", smtp_tls: "" };
  }
  return {};
}

/**
 * Změna jednoho pole formuláře včetně navázaných polí:
 * - změna portu → šifrování „podle portu" (995/110 a 993/143 navíc napoví protokol),
 * - změna protokolu → výchozí port protokolu (SSL/TLS 993/995, STARTTLS 143/110) a šifrování podle portu.
 */
export function applyFieldChange(f: FormState, key: keyof FormState, value: string | boolean): FormState {
  const next = { ...f, [key]: value } as FormState;
  if (key === "imap_port") {
    next.imap_tls = "";
    const p = protocolOfPort(Number(value));
    if (p === "pop3" || p === "imap") next.incoming_protocol = p;
  }
  if (key === "smtp_port") next.smtp_tls = "";
  if (key === "incoming_protocol" && value !== f.incoming_protocol) {
    const proto = value === "pop3" ? "pop3" : "imap";
    const currentTls = f.imap_tls || (f.imap_port ? defaultTlsForPort(Number(f.imap_port)) : "tls");
    next.imap_port = String(defaultPort(proto, currentTls === "starttls" ? "starttls" : "tls"));
    next.imap_tls = "";
  }
  return next;
}

export const EMPTY_FORM: FormState = {
  preset: "hosting90",
  email: "",
  displayName: "",
  incoming_protocol: "imap",
  imap_host: HOSTING90_IMAP_HOST,
  imap_port: "993",
  imap_tls: "",
  imap_user: "",
  imap_skip_name_check: false,
  smtp_host: HOSTING90_SMTP_HOST,
  smtp_port: "465",
  smtp_tls: "",
  smtp_user: "",
  smtp_skip_name_check: false,
  ms_graph_client_id: "",
  ms_graph_tenant_id: "",
  password: "",
  smtpPassword: "",
  graphSecret: "",
  changePassword: true,
  separateSmtpPassword: false,
  changeGraphSecret: true,
};

/** Konfigurace z formuláře — bez hesel; pole se při přepnutí typu NEmažou. */
function formToConfig(f: FormState): MailboxConfig {
  const port = (v: string) => (v.trim() ? Number(v) : undefined);
  return {
    preset: f.preset,
    incoming_protocol: f.incoming_protocol,
    imap_host: f.imap_host,
    imap_port: port(f.imap_port),
    imap_tls: f.imap_tls === "none" ? undefined : f.imap_tls || undefined, // příchozí vždy šifrovaně
    imap_user: f.imap_user || f.email,
    imap_skip_name_check: f.imap_skip_name_check || undefined,
    smtp_host: f.smtp_host,
    smtp_port: port(f.smtp_port),
    smtp_tls: f.smtp_tls || undefined,
    smtp_user: f.smtp_user || undefined,
    smtp_skip_name_check: f.smtp_skip_name_check || undefined,
    ms_graph_client_id: f.ms_graph_client_id,
    ms_graph_tenant_id: f.ms_graph_tenant_id,
  };
}

/**
 * Hesla k uložení / testu. „SMTP má jiné heslo než schránka":
 *  - odškrtnuté → uložené vlastní SMTP heslo se smaže (SMTP použije heslo schránky),
 *  - zaškrtnuté bez zadání → uložené SMTP heslo zůstane i při změně hesla schránky.
 */
export function formSecrets(f: FormState, isNew: boolean) {
  return {
    imap_password: (isNew || f.changePassword) && f.password ? f.password : undefined,
    smtp_password: f.separateSmtpPassword && f.smtpPassword ? f.smtpPassword : undefined,
    ms_graph_client_secret: (isNew || f.changeGraphSecret) && f.graphSecret ? f.graphSecret : undefined,
    ...(f.separateSmtpPassword ? { keep_smtp_password: true } : { clear_smtp_password: true }),
  };
}

export function mailboxToForm(m: Mailbox): FormState {
  const c = m.config ?? {};
  const preset = presetOf(m.provider, c);
  return {
    ...EMPTY_FORM,
    preset,
    email: m.email,
    displayName: m.display_name ?? "",
    incoming_protocol: c.incoming_protocol === "pop3" ? "pop3" : "imap",
    imap_host: String(c.imap_host ?? ""),
    imap_port: c.imap_port ? String(c.imap_port) : "",
    imap_tls: (c.imap_tls as TlsChoice) ?? "",
    imap_user: String(c.imap_user ?? ""),
    imap_skip_name_check: c.imap_skip_name_check === true,
    smtp_host: String(c.smtp_host ?? ""),
    smtp_port: c.smtp_port ? String(c.smtp_port) : "",
    smtp_tls: (c.smtp_tls as TlsChoice) ?? "",
    smtp_user: String(c.smtp_user ?? ""),
    smtp_skip_name_check: c.smtp_skip_name_check === true,
    ms_graph_client_id: String(c.ms_graph_client_id ?? ""),
    ms_graph_tenant_id: String(c.ms_graph_tenant_id ?? ""),
    // uložené vlastní SMTP heslo musí být vidět (dřív zaškrtávátko vždy prázdné → zastaralé heslo nešlo smazat)
    separateSmtpPassword: m.secrets_set?.smtp_separate === true,
    changePassword: false,
    changeGraphSecret: false,
  };
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => null)) as T | { error?: string } | null;
  if (!res.ok || !data) {
    const msg = (data as { error?: string } | null)?.error;
    throw new Error(msg ?? (res.status === 504 ? "Server nestihl odpovědět (časový limit)." : `Server odpověděl chybou ${res.status}.`));
  }
  return data as T;
}

interface TestResponse {
  incoming: DiagResult | null;
  smtp: DiagResult | null;
  graph: DiagResult | null;
  missing?: string[];
  notes?: string[];
  error?: string;
}

/** Výsledek testu po krocích: DNS → spojení → šifrování → přihlášení → INBOX. */
function DiagView({ title, result }: { title: string; result: DiagResult }) {
  return (
    <div
      className={cn(
        "space-y-1.5 rounded-lg border p-2.5 text-xs",
        result.ok ? "border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10",
      )}
      data-testid={`diag-${title.toLowerCase().split(" ")[0]}`}
    >
      <div className="flex flex-wrap items-center gap-1.5 font-medium">
        {result.ok ? <CheckCircle2 className="h-4 w-4 text-success" /> : <AlertCircle className="h-4 w-4 text-destructive" />}
        <span>{title}: {result.ok ? "OK" : "nefunguje"}</span>
        {result.endpoint && <span className="break-all font-normal text-muted-foreground">{endpointLabel(result.endpoint)}</span>}
        {result.ok && result.messages !== undefined && <span className="font-normal text-muted-foreground">· {result.messages} zpráv v INBOXu</span>}
      </div>
      <ol className="flex flex-wrap gap-1.5">
        {result.steps.map((s, i) => (
          <li
            key={`${s.id}-${i}`}
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5",
              s.ok ? "border-emerald-300/60 text-emerald-800 dark:text-emerald-300" : "border-red-300/60 text-red-700 dark:text-red-300",
            )}
            title={s.detail}
          >
            {s.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
            <span className="font-medium">{STEP_LABEL[s.id]}</span>
            {s.detail && <span className="truncate text-muted-foreground">{s.detail}</span>}
          </li>
        ))}
      </ol>
      {!result.ok && result.error && <p className="break-words text-sm text-destructive" data-testid="diag-error">{result.error}</p>}
      {result.note && <p className="break-words text-xs text-amber-700 dark:text-amber-400" data-testid="diag-note">{result.note}</p>}
    </div>
  );
}

/** Tabulka „co se zkoušelo" (na mobilu jako seznam). */
function AttemptList({ attempts }: { attempts: DetectResult["attempts"] }) {
  const [open, setOpen] = React.useState(false);
  if (!attempts.length) return null;
  return (
    <div className="text-xs">
      <button type="button" className="inline-flex items-center gap-1 font-medium text-muted-foreground hover:text-foreground" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Co se zkoušelo ({attempts.length})
      </button>
      {open && (
        <ul className="mt-1.5 divide-y rounded-md border" data-testid="detect-attempts">
          {attempts.map((a, i) => (
            <li key={i} className="flex flex-col gap-0.5 px-2 py-1.5 sm:flex-row sm:items-start sm:gap-3">
              <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] sm:w-72">
                {a.ok ? <Check className="h-3 w-3 text-success" /> : <X className="h-3 w-3 text-destructive" />}
                <span className="break-all">{endpointLabel(a.endpoint)}</span>
              </span>
              <span className="min-w-0 flex-1 break-words text-muted-foreground">
                <span className="font-medium text-foreground">{a.stage === "probe" ? "spojení" : "přihlášení"}:</span> {a.ok ? a.message ?? "OK" : a.message}
                {a.endpoint.why ? <span className="opacity-70"> · {a.endpoint.why}</span> : null}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{a.ms} ms</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground", className)}>
      {label}
      {children}
    </label>
  );
}

const selectCls = "h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground";

function MailboxForm({
  initial,
  editing,
  users,
  onDone,
  onCancel,
}: {
  initial: FormState;
  /** Upravovaná schránka (null = nová). */
  editing: Mailbox | null;
  /** Jen u nové schránky — výběr vlastníka (u existující se mění přímo v seznamu). */
  users?: MailboxUser[];
  onDone: (id: string | null, message?: string) => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = React.useState<FormState>(initial);
  const [ownerId, setOwnerId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<"save" | "test" | "detect" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notes, setNotes] = React.useState<string[]>([]);
  const [test, setTest] = React.useState<TestResponse | null>(null);
  const [detect, setDetect] = React.useState<DetectResult | null>(null);
  const [advanced, setAdvanced] = React.useState(Boolean(editing) || initial.preset === "other");
  const isNew = !editing;
  const stored = editing?.secrets_set;
  const isGraph = form.preset === "m365";
  const provider: MailboxProvider = providerForPreset(form.preset);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value;
    setForm((f) => applyFieldChange(f, key, value));
  };

  const choosePreset = (preset: PresetId) => {
    setForm((f) => {
      const defaults = presetDefaults(preset);
      // předvolba přepíše jen servery; ruční údaje u „Jiný" zůstanou
      return { ...f, preset, ...defaults };
    });
    setAdvanced(preset === "other");
    setDetect(null);
    setTest(null);
  };

  const payloadBase = () => ({
    mailboxId: editing?.id ?? null,
    provider,
    email: form.email,
    config: formToConfig(form),
    secrets: formSecrets(form, isNew),
  });

  const runTest = async () => {
    setBusy("test");
    setError(null);
    setTest(null);
    try {
      const r = await postJson<TestResponse>("/api/mailboxes/diagnose", { action: "test", ...payloadBase() });
      setTest(r);
      if (r.error) setError(r.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Test připojení selhal.");
    } finally {
      setBusy(null);
    }
  };

  // „Vyzkoušet odeslání": zkušební e-mail ze schránky na její vlastní adresu (+ kopie do Odeslaných na serveru)
  const [sendBusy, setSendBusy] = React.useState(false);
  const [sendResult, setSendResult] = React.useState<{ ok: boolean; text: string } | null>(null);
  const runTestSend = async () => {
    if (!editing) return;
    setSendBusy(true);
    setSendResult(null);
    try {
      const r = await postJson<{ sent: boolean; text?: string; reason?: string; error?: string }>("/api/mailboxes/diagnose", { action: "testSend", mailboxId: editing.id });
      setSendResult({ ok: r.sent, text: r.sent ? `Zkušební e-mail odeslán. ${r.text ?? ""}` : r.text ?? r.reason ?? r.error ?? "Odeslání selhalo." });
    } catch (err) {
      setSendResult({ ok: false, text: err instanceof Error ? err.message : "Odeslání selhalo." });
    } finally {
      setSendBusy(false);
    }
  };

  const runDetect = async (allowNameMismatch = false) => {
    setBusy("detect");
    setError(null);
    setDetect(null);
    setTest(null);
    try {
      const r = await postJson<DetectResult>("/api/mailboxes/diagnose", {
        action: "detect",
        mailboxId: editing?.id ?? null,
        email: form.email,
        password: (isNew || form.changePassword) && form.password ? form.password : undefined,
        user: form.imap_user && form.imap_user !== form.email ? form.imap_user : undefined,
        // co uživatel vyplnil ručně (např. z Outlooku) — předvolené servery hosting90 se zkusí stejně
        host: advanced ? form.imap_host : undefined,
        port: advanced && form.imap_port ? Number(form.imap_port) : undefined,
        protocol: advanced ? form.incoming_protocol : undefined,
        smtpHost: advanced ? form.smtp_host : undefined,
        smtpPort: advanced && form.smtp_port ? Number(form.smtp_port) : undefined,
        smtpTls: advanced && form.smtp_tls ? form.smtp_tls : undefined,
        preset: form.preset,
        allowNameMismatch,
      });
      setDetect(r);
      if (r.ok && r.config) {
        const c = r.config;
        setForm((f) => ({
          ...f,
          preset: r.preset && r.preset !== "test" ? r.preset : f.preset === "m365" ? "other" : f.preset,
          incoming_protocol: c.incoming_protocol === "pop3" ? "pop3" : "imap",
          imap_host: c.imap_host ?? f.imap_host,
          imap_port: c.imap_port ? String(c.imap_port) : f.imap_port,
          imap_tls: (c.imap_tls as TlsChoice) ?? "",
          imap_skip_name_check: c.imap_skip_name_check === true,
          ...(c.smtp_host
            ? { smtp_host: c.smtp_host, smtp_port: String(c.smtp_port ?? ""), smtp_tls: (c.smtp_tls as TlsChoice) ?? "", smtp_skip_name_check: c.smtp_skip_name_check === true }
            : {}),
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Automatické zjištění selhalo.");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    setNotes([]);
    try {
      const payload = { provider, email: form.email, displayName: form.displayName, config: formToConfig(form), secrets: formSecrets(form, isNew) };
      const res = editing ? await updateMailbox(editing.id, payload) : await addMailbox({ ...payload, ownerId });
      if (res.ok) {
        const id = editing ? editing.id : ((res as { id?: string }).id ?? null);
        if (!editing) {
          setForm(EMPTY_FORM);
          setOwnerId(null);
          setTest(null);
          setDetect(null);
        }
        onDone(id, editing ? "Změny schránky uloženy." : `Schránka ${payload.email.trim().toLowerCase()} přidána — stahuji poštu…`);
      } else {
        setError(res.error ?? "Chyba");
        setNotes((res as { notes?: string[] }).notes ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Uložení selhalo.");
    } finally {
      setBusy(null);
    }
  };

  const presetInfo = PRESETS[form.preset];
  const passwordStored = Boolean(stored?.imap_password);
  const showPassword = isNew || form.changePassword || !passwordStored;

  return (
    <div className="space-y-3" data-testid="mailbox-form">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Poskytovatel" className="sm:col-span-2">
          <select value={form.preset} onChange={(e) => choosePreset(e.target.value as PresetId)} className={selectCls} aria-label="Poskytovatel">
            {PRESET_IDS.map((p) => (
              <option key={p} value={p}>{PRESET_LABEL[p]}</option>
            ))}
          </select>
        </Field>
        <Field label="E-mail schránky">
          <Input value={form.email} onChange={set("email")} placeholder="jmeno@nastrojarstvi.com" type="email" aria-label="E-mail schránky" autoComplete="off" />
        </Field>
        <Field label="Popis (volitelné)">
          <Input value={form.displayName} onChange={set("displayName")} placeholder="např. Obchod" aria-label="Popis schránky" />
        </Field>
      </div>

      <div className="flex items-start gap-1.5 rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0">
          {presetInfo.description}
          {presetInfo.notes.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {presetInfo.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
        </div>
      </div>

      {users && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-blue-200 bg-blue-50/60 p-2.5 dark:border-blue-500/30 dark:bg-blue-500/10">
          <UserRound className="h-4 w-4 text-blue-600 dark:text-blue-400" />
          <span className="text-sm font-medium">Čí je schránka?</span>
          <OwnerSelect users={users} value={ownerId} onChange={setOwnerId} className="w-full min-w-0 flex-1 sm:min-w-[220px]" />
          <span className="w-full text-xs text-muted-foreground">
            Schránku si uživatel nastaví sám v Můj účet — tady jen firemní schránka (bez vlastníka) nebo výjimečné přiřazení.
            Vlastník uvidí poštu této schránky ve své Přijaté a Odeslané poště a odesílá z ní. Bez vlastníka ji vidí jen super admin
            (a odchází z ní pošta lidí bez vlastní schránky).
          </span>
        </div>
      )}

      {!isGraph ? (
        <>
          <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Heslo ke schránce</span>
              {passwordStored && (
                <Badge variant="success" data-testid="password-stored"><Check className="h-3 w-3" /> heslo uloženo</Badge>
              )}
              {passwordStored && !isNew && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setForm((f) => ({ ...f, changePassword: !f.changePassword, password: "" }))}
                >
                  {form.changePassword ? "Ponechat uložené heslo" : "Změnit heslo"}
                </Button>
              )}
            </div>
            {showPassword && (
              <Input
                type="password"
                value={form.password}
                onChange={set("password")}
                placeholder={isNew ? "Heslo ke schránce (u hosting90 z administrace schránky)" : "Nové heslo"}
                aria-label="Heslo ke schránce"
                autoComplete="new-password"
              />
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" onClick={() => runDetect(false)} disabled={busy !== null} data-testid="detect-btn">
                {busy === "detect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                Najít nastavení automaticky
              </Button>
              <span className="text-xs text-muted-foreground">
                Zkusí servery a porty (IMAP 993/143, POP3 995/110, SMTP 465/587/25) a uloží první fungující.
              </span>
            </div>
          </div>

          {detect && (
            <div className="space-y-2 rounded-lg border p-3 text-sm" data-testid="detect-result">
              {detect.ok ? (
                <p className="flex flex-wrap items-start gap-1.5 text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">
                    Nalezeno{detect.presetLabel ? ` (${detect.presetLabel})` : ""}: <b>{detect.incoming && endpointLabel(detect.incoming)}</b>
                    {detect.incoming?.messages !== undefined ? `, ${detect.incoming.messages} zpráv v INBOXu` : ""}
                    {detect.smtp ? <>; odchozí <b>{endpointLabel(detect.smtp)}</b></> : null}. Nastavení je vyplněné níže — ulož schránku.
                  </span>
                </p>
              ) : (
                <p className="flex items-start gap-1.5 break-words text-destructive" data-testid="detect-error">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span className="min-w-0">{detect.error}</span>
                </p>
              )}
              {detect.smtpError && detect.ok && <p className="break-words text-xs text-amber-700 dark:text-amber-400">{detect.smtpError}</p>}
              {detect.needsConfirmation && (
                <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="confirm-mismatch">
                  <p className="flex items-start gap-1.5 font-medium text-amber-900 dark:text-amber-200">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 break-words">
                      Certifikát nesedí na doménu: {endpointLabel({ ...detect.needsConfirmation.endpoint, skipNameCheck: false })} má certifikát pro{" "}
                      {detect.needsConfirmation.certNames.join(", ") || "jiný název"}. Spojení bude šifrované, ale aplikace neověří, že mluví se
                      správným serverem. Používej jen u svého poskytovatele.
                    </span>
                  </p>
                  <Button type="button" size="sm" variant="outline" onClick={() => runDetect(true)} disabled={busy !== null}>
                    Rozumím — přesto používat šifrované spojení bez ověření jména
                  </Button>
                </div>
              )}
              {detect.evidence.length > 0 && <p className="break-words text-xs text-muted-foreground">DNS: {detect.evidence.join(" · ")}</p>}
              <AttemptList attempts={detect.attempts} />
            </div>
          )}

          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setAdvanced((a) => !a)}
            aria-expanded={advanced}
          >
            {advanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Servery a porty (ručně)
            {!advanced && form.imap_host && (
              <span className="font-normal">
                · {PROTO_LABEL[form.incoming_protocol]} {form.imap_host}:{form.imap_port || "—"}
                {form.smtp_host ? ` · SMTP ${form.smtp_host}:${form.smtp_port || "—"}` : ""}
              </span>
            )}
          </button>

          {advanced && (
            <>
              <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Příchozí pošta</div>
                <div className="grid gap-2 sm:grid-cols-6">
                  <Field label="Protokol" className="sm:col-span-1">
                    <select value={form.incoming_protocol} onChange={set("incoming_protocol")} className={selectCls} aria-label="Protokol příchozí pošty">
                      <option value="imap">IMAP</option>
                      <option value="pop3">POP3</option>
                    </select>
                  </Field>
                  <Field label="Server" className="sm:col-span-3">
                    <Input value={form.imap_host} onChange={set("imap_host")} placeholder={HOSTING90_IMAP_HOST} aria-label="Příchozí server" />
                  </Field>
                  <Field label="Port">
                    <Input value={form.imap_port} onChange={set("imap_port")} placeholder={form.incoming_protocol === "pop3" ? "995" : "993"} inputMode="numeric" aria-label="Port příchozího serveru" />
                  </Field>
                  <Field label="Šifrování">
                    <select value={form.imap_tls} onChange={set("imap_tls")} className={selectCls} aria-label="Šifrování příchozího serveru">
                      <option value="">podle portu</option>
                      <option value="tls">{TLS_LABEL.tls}</option>
                      <option value="starttls">{TLS_LABEL.starttls}</option>
                    </select>
                  </Field>
                  <Field label="Uživatel (výchozí = celá e-mailová adresa)" className="sm:col-span-6">
                    <Input value={form.imap_user} onChange={set("imap_user")} placeholder={form.email || "jmeno@nastrojarstvi.com"} aria-label="Uživatel příchozího serveru" />
                  </Field>
                </div>
                {form.imap_skip_name_check && (
                  <label className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <input type="checkbox" checked={form.imap_skip_name_check} onChange={set("imap_skip_name_check")} />
                    Šifrovat bez ověření jména v certifikátu (potvrzeno)
                  </label>
                )}
              </div>

              <div className="space-y-2 rounded-lg bg-muted/40 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Odchozí pošta (SMTP)</div>
                <div className="grid gap-2 sm:grid-cols-6">
                  <Field label="Server" className="sm:col-span-4">
                    <Input value={form.smtp_host} onChange={set("smtp_host")} placeholder={HOSTING90_SMTP_HOST} aria-label="Odchozí server" />
                  </Field>
                  <Field label="Port">
                    <Input value={form.smtp_port} onChange={set("smtp_port")} placeholder="465" inputMode="numeric" aria-label="Port odchozího serveru" />
                  </Field>
                  <Field label="Šifrování">
                    <select value={form.smtp_tls} onChange={set("smtp_tls")} className={selectCls} aria-label="Šifrování odchozího serveru">
                      <option value="">podle portu</option>
                      <option value="tls">{TLS_LABEL.tls}</option>
                      <option value="starttls">{TLS_LABEL.starttls}</option>
                      <option value="none">Žádné (jako Outlook)</option>
                    </select>
                  </Field>
                  <Field label="Uživatel (výchozí = jako příchozí)" className="sm:col-span-6">
                    <Input value={form.smtp_user} onChange={set("smtp_user")} placeholder={form.imap_user || form.email || "jmeno@nastrojarstvi.com"} aria-label="Uživatel odchozího serveru" />
                  </Field>
                </div>
                {form.smtp_tls === "none" && (
                  <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="smtp-tls-none-note">
                    Bez SSL jako v Outlooku („Žádné“): šifrování STARTTLS se použije, jen když ho server nabídne. Bezpečnější je {HOSTING90_SMTP_HOST} port 465 (SSL/TLS).
                  </p>
                )}
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input type="checkbox" checked={form.separateSmtpPassword} onChange={set("separateSmtpPassword")} data-testid="smtp-separate" />
                  SMTP má jiné heslo než schránka
                  {stored?.smtp_separate && <Badge variant="muted" data-testid="smtp-password-stored"><KeyRound className="h-3 w-3" /> vlastní SMTP heslo uloženo</Badge>}
                </label>
                {form.separateSmtpPassword && (
                  <Input type="password" value={form.smtpPassword} onChange={set("smtpPassword")} placeholder={stored?.smtp_separate ? "Heslo pro SMTP (prázdné = ponechat uložené)" : "Heslo pro SMTP"} aria-label="Heslo SMTP" autoComplete="new-password" />
                )}
                {!form.separateSmtpPassword && stored?.smtp_separate && (
                  <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="smtp-password-clear-note">
                    Po uložení se uložené vlastní SMTP heslo smaže — odesílání použije heslo schránky.
                  </p>
                )}
                {form.smtp_skip_name_check && (
                  <label className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                    <input type="checkbox" checked={form.smtp_skip_name_check} onChange={set("smtp_skip_name_check")} />
                    Šifrovat bez ověření jména v certifikátu (potvrzeno)
                  </label>
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <div className="space-y-2 rounded-lg bg-muted/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Microsoft 365 (Graph API)</div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Application (client) ID">
              <Input value={form.ms_graph_client_id} onChange={set("ms_graph_client_id")} placeholder="00000000-0000-…" aria-label="Client ID" />
            </Field>
            <Field label="Directory (tenant) ID">
              <Input value={form.ms_graph_tenant_id} onChange={set("ms_graph_tenant_id")} placeholder="00000000-0000-…" aria-label="Tenant ID" />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {stored?.ms_graph_client_secret && <Badge variant="success"><Check className="h-3 w-3" /> tajný klíč uložen</Badge>}
            {stored?.ms_graph_client_secret && !isNew && (
              <Button type="button" size="sm" variant="outline" onClick={() => setForm((f) => ({ ...f, changeGraphSecret: !f.changeGraphSecret, graphSecret: "" }))}>
                {form.changeGraphSecret ? "Ponechat uložený klíč" : "Změnit tajný klíč"}
              </Button>
            )}
          </div>
          {(isNew || form.changeGraphSecret || !stored?.ms_graph_client_secret) && (
            <Input type="password" value={form.graphSecret} onChange={set("graphSecret")} placeholder="Client Secret — HODNOTA (Value), ne Secret ID" aria-label="Client Secret" autoComplete="new-password" />
          )}
        </div>
      )}

      {test && (
        <div className="space-y-2" data-testid="test-result">
          {test.incoming && <DiagView title={`Příchozí ${PROTO_LABEL[test.incoming.endpoint?.protocol ?? "imap"]}`} result={test.incoming} />}
          {test.smtp && <DiagView title="Odchozí SMTP" result={test.smtp} />}
          {test.graph && <DiagView title="Microsoft Graph" result={test.graph} />}
          {test.missing && test.missing.length > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">Pro test doplň: {test.missing.join(", ")}.</p>
          )}
          {test.notes?.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={runTest} disabled={busy !== null} data-testid="test-btn">
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          Otestovat připojení
        </Button>
        {editing && (
          <Button size="sm" variant="outline" onClick={runTestSend} disabled={busy !== null || sendBusy} data-testid="test-send-btn">
            {sendBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Vyzkoušet odeslání
          </Button>
        )}
        <Button size="sm" onClick={save} disabled={busy !== null} data-testid="save-btn">
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {editing ? "Uložit změny" : "Přidat schránku"}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy !== null}>
            <X className="h-4 w-4" /> Zrušit
          </Button>
        )}
      </div>
      {sendResult && (
        <p className={cn("break-words text-sm", sendResult.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")} data-testid="test-send-result">{sendResult.text}</p>
      )}
      {error && <p className="break-words text-sm text-destructive" data-testid="form-error">{error}</p>}
      {notes.map((n) => <p key={n} className="text-xs text-muted-foreground">{n}</p>)}
    </div>
  );
}

/** Relativní čas (server a prohlížeč ho mohou spočítat o minutu jinak — bez varování hydratace). */
function Ago({ iso }: { iso: string }) {
  return <time dateTime={iso} suppressHydrationWarning>{relativeTime(iso)}</time>;
}

/** Stav schránky v seznamu: neúplná / poslední stažení / chyba / poslední test. */
function MailboxStatusLine({ m }: { m: Mailbox }) {
  const has = (k: SecretKey) => Boolean(m.secrets_set?.[k]);
  const missing = mailboxMissing(m.provider, m.config, has);
  const st = m.status;
  return (
    <div className="mt-1 space-y-0.5 text-xs" data-testid="mailbox-status">
      {missing.length > 0 ? (
        <p className="text-amber-700 dark:text-amber-400">Neúplná — chybí: {missing.join(", ")}. Pošta se nestahuje.</p>
      ) : st?.last_sync_error_kind === "auth" ? (
        <p className="break-words text-destructive" data-testid="auth-blocked">
          Heslo odmítnuto{st.last_sync_attempt_at ? <> <Ago iso={st.last_sync_attempt_at} /></> : null} — oprav ho: Upravit schránku → Změnit heslo.
          Automatické stahování je do opravy pozastavené (ochrana před zablokováním IP u poskytovatele); ručně tlačítkem Stáhnout.
        </p>
      ) : st?.last_sync_error ? (
        <p className="break-words text-destructive">
          Stažení selhalo{st.last_sync_attempt_at ? <> <Ago iso={st.last_sync_attempt_at} /></> : null}: {st.last_sync_error}
        </p>
      ) : st?.last_sync_ok_at ? (
        <p className="text-emerald-700 dark:text-emerald-400">
          Staženo <Ago iso={st.last_sync_ok_at} />
          {st.last_sync_new !== null && st.last_sync_new !== undefined ? ` · nových ${st.last_sync_new}` : ""}
          {st.last_sync_remaining ? ` · čeká ${st.last_sync_remaining}` : ""}
        </p>
      ) : (
        <p className="text-muted-foreground">Zatím nestaženo.</p>
      )}
      {st?.last_test_at && (
        <p className={cn(st.last_test_ok ? "text-muted-foreground" : "break-words text-destructive")}>
          Test <Ago iso={st.last_test_at} />: {st.last_test_ok ? "OK" : st.last_test_error ?? "chyba"}
        </p>
      )}
    </div>
  );
}

function endpointBadges(m: Mailbox) {
  const c = m.config ?? {};
  const out: string[] = [];
  if (m.provider !== "outlook" && c.imap_host) {
    const proto = c.incoming_protocol === "pop3" ? "POP3" : "IMAP";
    out.push(`${proto}: ${c.imap_host}:${c.imap_port ?? (proto === "POP3" ? 995 : 993)}${c.imap_tls ? ` ${TLS_LABEL[c.imap_tls]}` : ""}`);
  }
  if (m.provider !== "outlook" && c.smtp_host) out.push(`SMTP: ${c.smtp_host}:${c.smtp_port ?? 465}`);
  if (m.provider === "outlook") out.push("Microsoft Graph");
  return out;
}

export function MailboxManager({
  mailboxes,
  users = [],
}: {
  mailboxes: Mailbox[];
  users?: MailboxUser[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [rowBusy, setRowBusy] = React.useState<string | null>(null);
  const [ownerBusy, setOwnerBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const [rowMsg, setRowMsg] = React.useState<Record<string, { ok: boolean; text: string }>>({});
  const userById = React.useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const remove = async (m: Mailbox) => {
    if (!window.confirm(`Odebrat schránku ${m.email}? Už stažená pošta zůstane zachována.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await deleteMailbox(m.id);
      if (!res.ok) setError(res.error ?? "Schránku se nepodařilo odebrat.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const changeOwner = async (mailboxId: string, ownerId: string | null) => {
    setOwnerBusy(mailboxId);
    setError(null);
    try {
      const res = await setMailboxOwner(mailboxId, ownerId);
      if (!res.ok) setError(res.error ?? "Vlastníka se nepodařilo změnit.");
      router.refresh();
    } finally {
      setOwnerBusy(null);
    }
  };

  const toggleActive = async (m: Mailbox) => {
    setRowBusy(m.id);
    try {
      const res = await setMailboxActive(m.id, !m.active);
      if (!res.ok) setError(res.error ?? "Změna se nepodařila.");
      router.refresh();
    } finally {
      setRowBusy(null);
    }
  };

  const syncOne = async (id: string) => {
    setRowBusy(id);
    setRowMsg((r) => ({ ...r, [id]: { ok: true, text: "Stahuji poštu…" } }));
    try {
      const res = await fetch("/api/emails/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mailboxId: id }) });
      const data = (await res.json().catch(() => null)) as { fetched?: number; ingested?: number; message?: string; boxes?: { id: string; ok: boolean; error?: string; note?: string; fetched: number; ingested: number }[]; error?: string } | null;
      const box = data?.boxes?.find((b) => b.id === id);
      if (!data) setRowMsg((r) => ({ ...r, [id]: { ok: false, text: res.status === 504 ? "Server nestihl stáhnout poštu (časový limit) — zkus to znovu." : "Stažení selhalo." } }));
      else if (box) setRowMsg((r) => ({ ...r, [id]: { ok: box.ok, text: box.ok ? `Staženo ${box.fetched}, nových ${box.ingested}.${box.note ? ` ${box.note}` : ""}` : box.error ?? "Stažení selhalo." } }));
      else setRowMsg((r) => ({ ...r, [id]: { ok: false, text: data.message ?? data.error ?? "Stažení selhalo." } }));
      router.refresh();
    } catch {
      setRowMsg((r) => ({ ...r, [id]: { ok: false, text: "Stažení selhalo (síť)." } }));
    } finally {
      setRowBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <p className="flex items-center gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}
      {info && (
        <p className="flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" /> {info}
        </p>
      )}
      <div className="space-y-2">
        {mailboxes.length === 0 && (
          <p className="text-sm text-muted-foreground">Zatím žádná schránka. Přidej první níže.</p>
        )}
        {mailboxes.map((m) => {
          const owner = m.owner_id ? userById.get(m.owner_id) : undefined;
          const msg = rowMsg[m.id];
          return editingId === m.id ? (
            <div key={m.id} className="rounded-lg border p-3">
              <MailboxForm
                initial={mailboxToForm(m)}
                editing={m}
                onDone={(_, text) => {
                  setEditingId(null);
                  setInfo(text ?? null);
                  router.refresh();
                }}
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : (
            <div key={m.id} className="flex flex-col gap-3 rounded-lg border p-3 lg:flex-row lg:items-start" data-testid={`mailbox-row-${m.email}`}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    m.owner_id
                      ? "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"
                      : "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
                  )}
                >
                  <Mail className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                    <span className="break-all">{m.email}</span>
                    <Badge variant="secondary">{PRESETS[presetOf(m.provider, m.config)].label}</Badge>
                    {m.active ? <Badge variant="success">aktivní</Badge> : <Badge variant="muted">vypnutá</Badge>}
                    {m.secrets_set?.imap_password && m.provider !== "outlook" && <Badge variant="muted"><KeyRound className="h-3 w-3" /> heslo uloženo</Badge>}
                    {endpointBadges(m).map((b) => (
                      <Badge key={b} variant="muted" className="max-w-full break-all">{b}</Badge>
                    ))}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {m.display_name && <span>{m.display_name}</span>}
                    {m.owner_id ? (
                      <span className="inline-flex items-center gap-1 font-medium text-blue-700 dark:text-blue-300">
                        <UserRound className="h-3 w-3" /> {owner ? userLabel(owner) : "neznámý uživatel"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-medium text-amber-700 dark:text-amber-400">
                        <UserRound className="h-3 w-3" /> bez vlastníka — vidí jen super admin
                      </span>
                    )}
                  </div>
                  <MailboxStatusLine m={m} />
                  {msg && (
                    <p className={cn("mt-1 break-words text-xs", msg.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")} data-testid="row-sync-msg">
                      {msg.text}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {users.length > 0 && (
                  <OwnerSelect
                    users={users}
                    value={m.owner_id}
                    onChange={(id) => changeOwner(m.id, id)}
                    disabled={busy || ownerBusy !== null}
                    className="w-full sm:w-56"
                  />
                )}
                {ownerBusy === m.id && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <Button variant="outline" size="sm" onClick={() => syncOne(m.id)} disabled={busy || rowBusy !== null || !m.active} aria-label={`Stáhnout poštu ${m.email}`}>
                  <RefreshCw className={cn("h-4 w-4", rowBusy === m.id && "animate-spin")} /> Stáhnout
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => toggleActive(m)} disabled={busy || rowBusy !== null} aria-label={m.active ? "Vypnout schránku" : "Zapnout schránku"} title={m.active ? "Vypnout schránku" : "Zapnout schránku"}>
                  <Power className={cn("h-4 w-4", m.active ? "text-success" : "text-muted-foreground")} />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => { setInfo(null); setEditingId(m.id); }} disabled={busy} aria-label="Upravit schránku">
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => remove(m)} disabled={busy} aria-label="Odebrat schránku">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {editingId === null && (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="text-sm font-medium">Přidat schránku</div>
          <MailboxForm
            initial={EMPTY_FORM}
            editing={null}
            users={users}
            onDone={(id, text) => {
              setInfo(text ?? null);
              router.refresh();
              if (id) void syncOne(id); // po přidání rovnou stáhnout poštu
            }}
          />
          <p className="text-xs text-muted-foreground">
            Hesla se ukládají bezpečně na serveru a nezobrazují se zpět. Schránka s vyplněnými
            servery se používá přednostně; jinak platí globální klíče výše.
          </p>
        </div>
      )}
    </div>
  );
}
