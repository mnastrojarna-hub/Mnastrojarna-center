"use client";

import * as React from "react";
import { Plus, Trash2, Mail, Loader2, Plug, Pencil, Check, X, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  addMailbox,
  updateMailbox,
  deleteMailbox,
  testMailboxConnection,
  type MailboxTestResult,
} from "@/app/actions/integrations";
import type { Mailbox, MailboxConfig, MailboxProvider } from "@/lib/supabase/database.types";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const PROVIDERS: { value: MailboxProvider; label: string }[] = [
  { value: "imap", label: "IMAP/SMTP (hosting90 a další)" },
  { value: "outlook", label: "Microsoft 365 / Outlook (Graph)" },
  { value: "gmail", label: "Gmail (IMAP/SMTP)" },
];

interface FormState {
  provider: MailboxProvider;
  email: string;
  displayName: string;
  imap_host: string;
  imap_port: string;
  imap_user: string;
  imap_password: string;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_password: string;
  ms_graph_client_id: string;
  ms_graph_client_secret: string;
  ms_graph_tenant_id: string;
}

const EMPTY_FORM: FormState = {
  provider: "imap",
  email: "",
  displayName: "",
  imap_host: "",
  imap_port: "993",
  imap_user: "",
  imap_password: "",
  smtp_host: "",
  smtp_port: "465",
  smtp_user: "",
  smtp_password: "",
  ms_graph_client_id: "",
  ms_graph_client_secret: "",
  ms_graph_tenant_id: "",
};

function formToConfig(f: FormState): MailboxConfig {
  if (f.provider === "outlook") {
    return {
      ms_graph_client_id: f.ms_graph_client_id,
      ms_graph_client_secret: f.ms_graph_client_secret,
      ms_graph_tenant_id: f.ms_graph_tenant_id,
    };
  }
  return {
    imap_host: f.imap_host,
    imap_port: f.imap_port ? Number(f.imap_port) : undefined,
    imap_user: f.imap_user || f.email,
    imap_password: f.imap_password,
    smtp_host: f.smtp_host,
    smtp_port: f.smtp_port ? Number(f.smtp_port) : undefined,
    smtp_user: f.smtp_user || f.imap_user || f.email,
    smtp_password: f.smtp_password || f.imap_password,
  };
}

function mailboxToForm(m: Mailbox): FormState {
  const c = m.config ?? {};
  return {
    provider: m.provider,
    email: m.email,
    displayName: m.display_name ?? "",
    imap_host: String(c.imap_host ?? ""),
    imap_port: String(c.imap_port ?? "993"),
    imap_user: String(c.imap_user ?? ""),
    imap_password: "",
    smtp_host: String(c.smtp_host ?? ""),
    smtp_port: String(c.smtp_port ?? "465"),
    smtp_user: String(c.smtp_user ?? ""),
    smtp_password: "",
    ms_graph_client_id: String(c.ms_graph_client_id ?? ""),
    ms_graph_client_secret: "",
    ms_graph_tenant_id: String(c.ms_graph_tenant_id ?? ""),
  };
}

function TestBadge({ result, label }: { result: { ok: boolean; error?: string } | null; label: string }) {
  if (!result) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        result.ok ? "text-success" : "text-destructive",
      )}
      title={result.error}
    >
      {result.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
      {label}: {result.ok ? "OK" : result.error ?? "chyba"}
    </span>
  );
}

function MailboxForm({
  initial,
  editingId,
  hasSecrets,
  onDone,
  onCancel,
}: {
  initial: FormState;
  editingId: string | null;
  hasSecrets: boolean; // u editace — tajné hodnoty už uložené
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [form, setForm] = React.useState<FormState>(initial);
  const [busy, setBusy] = React.useState<"save" | "test" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [test, setTest] = React.useState<MailboxTestResult | null>(null);

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const runTest = async () => {
    setBusy("test");
    setError(null);
    setTest(await testMailboxConnection(formToConfig(form)));
    setBusy(null);
  };

  const save = async () => {
    setBusy("save");
    setError(null);
    const payload = {
      provider: form.provider,
      email: form.email,
      displayName: form.displayName,
      config: formToConfig(form),
    };
    const res = editingId ? await updateMailbox(editingId, payload) : await addMailbox(payload);
    if (res.ok) onDone();
    else setError(res.error ?? "Chyba");
    setBusy(null);
  };

  const secretPlaceholder = hasSecrets ? "•••••••• (ponech prázdné beze změny)" : "••••••••";
  const isImapLike = form.provider !== "outlook";

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <select
          value={form.provider}
          onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as MailboxProvider }))}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
        <Input value={form.email} onChange={set("email")} placeholder="adresa@mnastrojarna.cz" type="email" />
        <Input value={form.displayName} onChange={set("displayName")} placeholder="Popis (volitelné)" />
      </div>

      {isImapLike ? (
        <>
          <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Příchozí pošta (IMAP)
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Input className="sm:col-span-2" value={form.imap_host} onChange={set("imap_host")} placeholder="Server, např. mail.hosting90.cz" />
              <Input value={form.imap_port} onChange={set("imap_port")} placeholder="Port (993)" inputMode="numeric" />
              <Input value={form.imap_user} onChange={set("imap_user")} placeholder="Uživatel (výchozí = e-mail)" />
            </div>
            <Input type="password" value={form.imap_password} onChange={set("imap_password")} placeholder={`Heslo do schránky ${hasSecrets ? "— " + secretPlaceholder : ""}`} />
          </div>

          <div className="space-y-2 rounded-lg bg-muted/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Odchozí pošta (SMTP)
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Input className="sm:col-span-2" value={form.smtp_host} onChange={set("smtp_host")} placeholder="Server, např. mail.hosting90.cz" />
              <Input value={form.smtp_port} onChange={set("smtp_port")} placeholder="Port (465)" inputMode="numeric" />
              <Input value={form.smtp_user} onChange={set("smtp_user")} placeholder="Uživatel (výchozí = IMAP)" />
            </div>
            <Input type="password" value={form.smtp_password} onChange={set("smtp_password")} placeholder="Heslo (výchozí = IMAP heslo)" />
          </div>
        </>
      ) : (
        <div className="space-y-2 rounded-lg bg-muted/40 p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Microsoft 365 (Graph API)
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={form.ms_graph_client_id} onChange={set("ms_graph_client_id")} placeholder="Client ID" />
            <Input value={form.ms_graph_tenant_id} onChange={set("ms_graph_tenant_id")} placeholder="Tenant ID" />
          </div>
          <Input type="password" value={form.ms_graph_client_secret} onChange={set("ms_graph_client_secret")} placeholder={`Client Secret ${hasSecrets ? "— " + secretPlaceholder : ""}`} />
        </div>
      )}

      {test && (
        <div className="flex flex-wrap gap-3">
          <TestBadge result={test.imap} label="IMAP" />
          <TestBadge result={test.smtp} label="SMTP" />
          <TestBadge result={test.graph} label="Graph" />
          {!test.imap && !test.smtp && !test.graph && (
            <span className="text-xs text-muted-foreground">Vyplň server, uživatele a heslo, pak otestuj.</span>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={runTest} disabled={busy !== null}>
          {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          Otestovat připojení
        </Button>
        <Button size="sm" onClick={save} disabled={busy !== null}>
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {editingId ? "Uložit změny" : "Přidat schránku"}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy !== null}>
            <X className="h-4 w-4" /> Zrušit
          </Button>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  );
}

export function MailboxManager({ mailboxes }: { mailboxes: Mailbox[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const remove = async (id: string) => {
    setBusy(true);
    await deleteMailbox(id);
    router.refresh();
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {mailboxes.length === 0 && (
          <p className="text-sm text-muted-foreground">Zatím žádná schránka. Přidej první níže.</p>
        )}
        {mailboxes.map((m) =>
          editingId === m.id ? (
            <div key={m.id} className="rounded-lg border p-3">
              <MailboxForm
                initial={mailboxToForm(m)}
                editingId={m.id}
                hasSecrets
                onDone={() => {
                  setEditingId(null);
                  router.refresh();
                }}
                onCancel={() => setEditingId(null)}
              />
            </div>
          ) : (
            <div key={m.id} className="flex items-center gap-3 rounded-lg border p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                <Mail className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {m.email}
                  <Badge variant="secondary">{m.provider}</Badge>
                  {m.active && <Badge variant="success">aktivní</Badge>}
                  {m.config?.imap_host ? (
                    <Badge variant="muted">IMAP: {String(m.config.imap_host)}:{String(m.config.imap_port ?? 993)}</Badge>
                  ) : null}
                  {m.config?.smtp_host ? (
                    <Badge variant="muted">SMTP: {String(m.config.smtp_host)}:{String(m.config.smtp_port ?? 465)}</Badge>
                  ) : null}
                </div>
                {m.display_name && <div className="text-xs text-muted-foreground">{m.display_name}</div>}
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setEditingId(m.id)} disabled={busy} aria-label="Upravit schránku">
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => remove(m.id)} disabled={busy} aria-label="Odebrat schránku">
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ),
        )}
      </div>

      {editingId === null && (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="text-sm font-medium">Přidat schránku</div>
          <MailboxForm
            initial={EMPTY_FORM}
            editingId={null}
            hasSecrets={false}
            onDone={() => router.refresh()}
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
