"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Copy,
  Database,
  ExternalLink,
  KeyRound,
  Loader2,
  LogIn,
  Plug,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  testSupabaseConnection,
  saveSupabaseConfig,
  recheckSchema,
  createSuperAdmin,
  type SupabaseTestResult,
} from "@/app/actions/setup";
import { saveIntegrationSettings } from "@/app/actions/integrations";
import type { SetupStatus } from "@/lib/setup/status";
import { cn } from "@/lib/utils";

// ── Pomocné prvky ───────────────────────────────────────────

function StepHeader({
  index,
  title,
  done,
  active,
}: {
  index: number;
  title: string;
  done: boolean;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          done
            ? "bg-success/15 text-success"
            : active
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground",
        )}
      >
        {done ? <Check className="h-4 w-4" /> : index}
      </div>
      <div className="flex-1 text-base font-semibold">{title}</div>
      {done ? (
        <Badge variant="success">hotovo</Badge>
      ) : active ? (
        <Badge>tento krok</Badge>
      ) : (
        <Badge variant="muted">čeká</Badge>
      )}
    </div>
  );
}

function CheckLine({ ok, label }: { ok: boolean | null; label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {ok === true ? (
        <CheckCircle2 className="h-4 w-4 text-success" />
      ) : ok === false ? (
        <AlertCircle className="h-4 w-4 text-destructive" />
      ) : (
        <Circle className="h-4 w-4 text-muted-foreground" />
      )}
      <span className={cn(ok === false && "text-destructive")}>{label}</span>
    </div>
  );
}

function Field({
  label,
  hint,
  ...props
}: React.ComponentProps<typeof Input> & { label: string; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={props.id} className="text-sm font-medium">{label}</label>
      <Input {...props} />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── Průvodce ────────────────────────────────────────────────

export function SetupWizard({ status }: { status: SetupStatus }) {
  const router = useRouter();

  const step1Done = status.supabase.configured && status.supabase.secretKeySet;
  const step2Done = status.schema.ok;
  const step3Done = status.adminExists;
  const step4Done = status.signedIn;
  const step5Done = status.aiConfigured;

  const activeStep = !step1Done ? 1 : !step2Done ? 2 : !step3Done ? 3 : !step4Done ? 4 : 5;

  return (
    <div className="space-y-4">
      <SupabaseStep status={status} done={step1Done} active={activeStep === 1} onSaved={() => router.refresh()} />
      <SchemaStep status={status} done={step2Done} active={activeStep === 2} onChecked={() => router.refresh()} />
      <AdminStep status={status} done={step3Done} active={activeStep === 3} onCreated={() => router.refresh()} />
      <LoginStep status={status} done={step4Done} active={activeStep === 4} />
      <IntegrationsStep status={status} done={step5Done} active={activeStep === 5} onSaved={() => router.refresh()} />

      {step1Done && step2Done && step3Done && step4Done && (
        <div className="flex justify-center pt-2">
          <Button asChild size="lg">
            <Link href="/dashboard">
              Přejít do aplikace <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Krok 1: Supabase připojení ──────────────────────────────

function SupabaseStep({
  status,
  done,
  active,
  onSaved,
}: {
  status: SetupStatus;
  done: boolean;
  active: boolean;
  onSaved: () => void;
}) {
  const [url, setUrl] = React.useState(status.supabase.url);
  const [publishableKey, setPublishableKey] = React.useState(status.supabase.publishableKey);
  const [secretKey, setSecretKey] = React.useState("");
  const [busy, setBusy] = React.useState<"test" | "save" | null>(null);
  const [test, setTest] = React.useState<SupabaseTestResult | null>(null);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [envBlock, setEnvBlock] = React.useState<string | null>(null);

  const runTest = async () => {
    setBusy("test");
    setMessage(null);
    const res = await testSupabaseConnection({ url, publishableKey, secretKey });
    setTest(res);
    setBusy(null);
  };

  const save = async () => {
    setBusy("save");
    setMessage(null);
    setEnvBlock(null);
    const res = await saveSupabaseConfig({ url, publishableKey, secretKey });
    if (res.ok && res.persisted) {
      setMessage({ ok: true, text: "Připojení ověřeno a uloženo (.env.local + runtime)." });
      onSaved();
    } else if (res.ok && res.envBlock) {
      setEnvBlock(res.envBlock);
      setMessage({
        ok: true,
        text: "Připojení ověřeno a aktivováno. Na Vercelu navíc vlož tyto proměnné do Settings → Environment Variables, aby přežily restart:",
      });
      onSaved();
    } else {
      setMessage({ ok: false, text: res.error ?? "Uložení selhalo." });
    }
    setBusy(null);
  };

  return (
    <Card className={cn(!active && !done && "opacity-70")}>
      <CardHeader className="pb-3">
        <StepHeader index={1} title="Připojení Supabase" done={done} active={active} />
        <p className="pl-11 text-sm text-muted-foreground">
          Hodnoty najdeš v Supabase dashboardu: <b>Project Settings → API keys</b>. Aplikace je
          uloží sama — nic nemusíš editovat ručně.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pl-[4.25rem] pr-6">
        <div className="grid gap-3">
          <Field
            id="sb-url"
            label="URL projektu"
            placeholder="https://xxxx.supabase.co"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Field
            id="sb-pub"
            label="Publishable klíč (veřejný)"
            placeholder="sb_publishable_…"
            value={publishableKey}
            onChange={(e) => setPublishableKey(e.target.value)}
          />
          <Field
            id="sb-secret"
            label="Servisní klíč (tajný)"
            type="password"
            placeholder={status.supabase.secretKeySet ? "•••••••• (nastaven — ponech prázdné beze změny)" : "sb_secret_…"}
            value={secretKey}
            onChange={(e) => setSecretKey(e.target.value)}
            hint="Nutný pro plnou automatiku (ukládání e-mailů, vytvoření super admina). Zůstává jen na serveru."
          />
        </div>

        {test && (
          <div className="space-y-1 rounded-lg border bg-muted/40 p-3">
            <CheckLine ok={test.urlOk} label="Server Supabase odpovídá" />
            <CheckLine ok={test.publishableOk} label="Publishable klíč platí" />
            <CheckLine ok={test.secretOk} label={test.secretOk === null ? "Servisní klíč — nezadán" : "Servisní klíč platí"} />
            <CheckLine ok={test.schemaOk} label={test.schemaOk === null ? "Schéma — ověří se po zadání servisního klíče" : test.schemaOk ? "Databázové schéma existuje" : "Databázové schéma chybí (krok 2)"} />
            {test.message && <p className="pt-1 text-sm text-destructive">{test.message}</p>}
          </div>
        )}

        {message && (
          <p className={cn("text-sm", message.ok ? "text-success" : "text-destructive")}>{message.text}</p>
        )}
        {envBlock && (
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-3 text-xs">{envBlock}</pre>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={runTest} disabled={busy !== null}>
            {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            Otestovat připojení
          </Button>
          <Button onClick={save} disabled={busy !== null}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Ověřit a uložit
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Krok 2: Databázové schéma ───────────────────────────────

function SchemaStep({
  status,
  done,
  active,
  onChecked,
}: {
  status: SetupStatus;
  done: boolean;
  active: boolean;
  onChecked: () => void;
}) {
  const [busy, setBusy] = React.useState<"check" | "copy" | null>(null);
  const [missing, setMissing] = React.useState<string[] | null>(
    status.schema.checked ? status.schema.missing : null,
  );
  const [copied, setCopied] = React.useState(false);

  const projectRef = React.useMemo(() => {
    try {
      return new URL(status.supabase.url).hostname.split(".")[0];
    } catch {
      return null;
    }
  }, [status.supabase.url]);

  const check = async () => {
    setBusy("check");
    const res = await recheckSchema();
    setMissing(res.missing);
    if (res.ok) onChecked();
    setBusy(null);
  };

  const copySql = async () => {
    setBusy("copy");
    try {
      const res = await fetch("/api/setup/schema");
      const sql = await res.text();
      await navigator.clipboard.writeText(sql);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setCopied(false);
    }
    setBusy(null);
  };

  return (
    <Card className={cn(!active && !done && "opacity-70")}>
      <CardHeader className="pb-3">
        <StepHeader index={2} title="Databázové schéma" done={done} active={active} />
        <p className="pl-11 text-sm text-muted-foreground">
          Zkopíruj SQL migrace a spusť je jednou v <b>Supabase → SQL Editor</b>. Pak klikni na
          tlačítko Zkontrolovat.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pl-[4.25rem] pr-6">
        {missing !== null && missing.length > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <p className="font-medium text-destructive">Chybí tabulky:</p>
            <p className="mt-1 text-muted-foreground">{missing.join(", ")}</p>
          </div>
        )}
        {done && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> Všechny tabulky existují.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={copySql} disabled={busy !== null}>
            {busy === "copy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
            {copied ? "Zkopírováno ✓" : "Zkopírovat SQL migrace"}
          </Button>
          {projectRef && (
            <Button variant="outline" asChild>
              <a
                href={`https://supabase.com/dashboard/project/${projectRef}/sql/new`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-4 w-4" /> Otevřít SQL Editor
              </a>
            </Button>
          )}
          <Button onClick={check} disabled={busy !== null || !status.supabase.secretKeySet}>
            {busy === "check" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
            Zkontrolovat
          </Button>
        </div>
        {!status.supabase.secretKeySet && (
          <p className="text-xs text-muted-foreground">Kontrola vyžaduje servisní klíč z kroku 1.</p>
        )}
      </CardContent>
    </Card>
  );
}

// ── Krok 3: Super admin ─────────────────────────────────────

function AdminStep({
  status,
  done,
  active,
  onCreated,
}: {
  status: SetupStatus;
  done: boolean;
  active: boolean;
  onCreated: () => void;
}) {
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  const create = async () => {
    setBusy(true);
    setMessage(null);
    const res = await createSuperAdmin({ email, password, fullName });
    if (res.ok) {
      setMessage({
        ok: true,
        text: res.signedIn
          ? "Super admin vytvořen a přihlášen."
          : (res.error ?? "Super admin vytvořen."),
      });
      onCreated();
    } else {
      setMessage({ ok: false, text: res.error ?? "Vytvoření selhalo." });
    }
    setBusy(false);
  };

  return (
    <Card className={cn(!active && !done && "opacity-70")}>
      <CardHeader className="pb-3">
        <StepHeader index={3} title="Účet super admina" done={done} active={active} />
        <p className="pl-11 text-sm text-muted-foreground">
          {done
            ? "Super admin už existuje. Další uživatele přidáš v aplikaci."
            : "Hlavní účet s plným oprávněním — vytvoří se přímo tady a rovnou tě přihlásí."}
        </p>
      </CardHeader>
      {!done && (
        <CardContent className="space-y-4 pl-[4.25rem] pr-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="adm-name" label="Jméno" placeholder="Jan Novák" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Field id="adm-email" label="E-mail" type="email" placeholder="admin@mnastrojarna.cz" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Field id="adm-pass" label="Heslo (min. 8 znaků)" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {message && (
            <p className={cn("text-sm", message.ok ? "text-success" : "text-destructive")}>{message.text}</p>
          )}
          <Button onClick={create} disabled={busy || !status.supabase.secretKeySet}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Vytvořit super admina
          </Button>
          {!status.supabase.secretKeySet && (
            <p className="text-xs text-muted-foreground">Vyžaduje servisní klíč z kroku 1.</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

// ── Krok 4: Přihlášení ──────────────────────────────────────

function LoginStep({ status, done, active }: { status: SetupStatus; done: boolean; active: boolean }) {
  return (
    <Card className={cn(!active && !done && "opacity-70")}>
      <CardHeader className="pb-3">
        <StepHeader index={4} title="Přihlášení" done={done} active={active} />
        <p className="pl-11 text-sm text-muted-foreground">
          {done
            ? `Přihlášen: ${status.signedInEmail ?? ""}`
            : "Bez přihlášení se do aplikace nedostaneš — to platí na localhostu i na Vercelu."}
        </p>
      </CardHeader>
      {!done && (
        <CardContent className="pl-[4.25rem] pr-6">
          <Button asChild variant={active ? "default" : "outline"}>
            <Link href="/login">
              <LogIn className="h-4 w-4" /> Přejít na přihlášení
            </Link>
          </Button>
        </CardContent>
      )}
    </Card>
  );
}

// ── Krok 5: API klíče a schránky ────────────────────────────

function IntegrationsStep({
  status,
  done,
  active,
  onSaved,
}: {
  status: SetupStatus;
  done: boolean;
  active: boolean;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ ok: boolean; text: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    const res = await saveIntegrationSettings({ anthropic_api_key: apiKey }, ["anthropic_api_key"]);
    setMessage(res.ok ? { ok: true, text: "Claude API klíč uložen." } : { ok: false, text: res.error ?? "Chyba." });
    if (res.ok) onSaved();
    setBusy(false);
  };

  return (
    <Card className={cn(!active && !done && "opacity-70")}>
      <CardHeader className="pb-3">
        <StepHeader index={5} title="AI a e-mailové schránky" done={done} active={active} />
        <p className="pl-11 text-sm text-muted-foreground">
          Claude API klíč pro AI funkce. Schránky (IMAP/SMTP servery, porty, hesla) přidáš
          v <b>Nastavení → E-mailové schránky</b>{status.mailboxCount > 0 ? ` — máš jich ${status.mailboxCount}` : ""}.
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pl-[4.25rem] pr-6">
        {!done && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              placeholder="sk-ant-…"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="sm:max-w-md"
            />
            <Button onClick={save} disabled={busy || !apiKey.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Uložit klíč
            </Button>
          </div>
        )}
        {done && (
          <p className="flex items-center gap-2 text-sm text-success">
            <Sparkles className="h-4 w-4" /> AI je nakonfigurována.
          </p>
        )}
        {message && (
          <p className={cn("text-sm", message.ok ? "text-success" : "text-destructive")}>{message.text}</p>
        )}
        <Button variant="outline" asChild>
          <Link href="/settings">
            Otevřít kompletní nastavení (schránky, klíče, AI) <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
