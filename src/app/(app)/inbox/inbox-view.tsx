"use client";

import * as React from "react";
import Link from "next/link";
import { Mail, Sparkles, Reply, RefreshCw, ArrowLeft, Wand2, Check, Settings2, Upload } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CategoryBadge } from "@/components/status-badge";
import { AiConfidence } from "@/components/ai-confidence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAutomation } from "@/components/automation-provider";
import { recordCorrection } from "@/app/actions/corrections";
import { type EmailItem } from "@/lib/data/types";
import { OutlookImport } from "@/components/outlook-import";
import { debug } from "@/lib/debug/logger";
import { cn, relativeTime } from "@/lib/utils";

const categories = [
  "Vše",
  "Poptávka",
  "Objednávka",
  "Potvrzení objednávky",
  "Nabídka dodavatele",
  "Faktura",
  "Upomínka",
  "Reklamace",
  "Technická dokumentace",
  "Ostatní",
  "Spam",
] as const;

export function InboxView({ emails }: { emails: EmailItem[] }) {
  const [filter, setFilter] = React.useState<(typeof categories)[number]>("Vše");
  const [selectedId, setSelectedId] = React.useState<string>(emails[0]?.id ?? "");
  const [mobileDetail, setMobileDetail] = React.useState(false); // master-detail přepínač na mobilu
  const [syncing, setSyncing] = React.useState(false);
  const [syncMsg, setSyncMsg] = React.useState<string | null>(null);
  const { mode } = useAutomation();

  const [showImport, setShowImport] = React.useState(false);

  const sync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    debug.action("inbox-sync", "Spouštím synchronizaci schránky", { mode });
    try {
      const res = await fetch("/api/emails/sync", { method: "POST" });
      const data = await res.json();
      debug.info("inbox-sync", "Odpověď synchronizace", { status: res.status, data });
      setSyncMsg(
        data.configured
          ? `Staženo ${data.fetched}, zpracováno ${data.ingested}.`
          : (data.message ?? "Schránka není nakonfigurována."),
      );
    } catch (err) {
      debug.error("inbox-sync", "Synchronizace selhala", err);
      setSyncMsg("Synchronizace selhala.");
    } finally {
      setSyncing(false);
    }
  };

  const filtered = emails.filter((e) => filter === "Vše" || e.category === filter);
  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0];

  const changeFilter = (cat: (typeof categories)[number]) => {
    setFilter(cat);
    const first = emails.find((e) => cat === "Vše" || e.category === cat);
    setSelectedId(first?.id ?? "");
    setMobileDetail(false);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Inbox"
        description="Každý e-mail je automaticky roztříděn, ohodnocen a propojen se zákazníkem."
        actions={
          <div className="flex items-center gap-2">
            {syncMsg && <span className="hidden text-xs text-muted-foreground sm:inline">{syncMsg}</span>}
            <Button variant="outline" size="sm" onClick={() => setShowImport((s) => !s)}>
              <Upload className="h-4 w-4" /> Import z Outlooku
            </Button>
            <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} /> Synchronizovat
            </Button>
          </div>
        }
      />

      {showImport && (
        <Card>
          <CardContent className="pt-5">
            <OutlookImport />
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => changeFilter(cat)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === cat
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className={cn("space-y-2 lg:col-span-2 lg:block", mobileDetail && "hidden")}>
          {emails.length === 0 ? (
            <Card>
              <CardContent className="space-y-3 py-8 text-center text-sm text-muted-foreground">
                <Mail className="mx-auto h-8 w-8 opacity-40" />
                <p className="font-medium text-foreground">Zatím tu nejsou žádné e-maily.</p>
                <p>
                  Přidej schránku (server, port, heslo) v Nastavení a pak klikni na
                  tlačítko Synchronizovat vpravo nahoře.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/settings"><Settings2 className="h-4 w-4" /> Otevřít nastavení schránek</Link>
                </Button>
              </CardContent>
            </Card>
          ) : filtered.length === 0 && (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Žádné e-maily v této kategorii.</CardContent></Card>
          )}
          {filtered.map((email) => (
            <EmailRow
              key={email.id}
              email={email}
              active={email.id === selected?.id}
              onClick={() => {
                setSelectedId(email.id);
                setMobileDetail(true);
              }}
            />
          ))}
        </div>

        <div className={cn("lg:col-span-3 lg:block", !mobileDetail && "hidden")}>
          {selected ? (
            <EmailDetail email={selected} mode={mode} onBack={() => setMobileDetail(false)} />
          ) : (
            <EmptyDetail />
          )}
        </div>
      </div>
    </div>
  );
}

function EmailRow({ email, active, onClick }: { email: EmailItem; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-lg border p-3 text-left transition-colors",
        active ? "border-primary/50 bg-primary/5" : "hover:border-primary/30 hover:bg-accent/50",
      )}
    >
      <div className="flex items-center gap-2">
        {email.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}
        <span className={cn("truncate text-sm", email.unread ? "font-semibold" : "font-medium")}>
          {email.from}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{relativeTime(email.receivedAt)}</span>
      </div>
      <p className="mt-1 truncate text-sm">{email.subject}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{email.preview}</p>
      <div className="mt-2 flex items-center gap-2">
        <CategoryBadge category={email.category} />
        {email.hasDraft && (
          <Badge variant="secondary">
            <Sparkles className="h-3 w-3" /> Návrh připraven
          </Badge>
        )}
        <AiConfidence value={email.aiConfidence} className="ml-auto" />
      </div>
    </button>
  );
}

function EmailDetail({
  email,
  mode,
  onBack,
}: {
  email: EmailItem;
  mode: "full" | "approval";
  onBack: () => void;
}) {
  return (
    <Card className="lg:sticky lg:top-2">
      <CardContent className="p-5">
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="h-4 w-4" /> Zpět na seznam
        </button>
        <div className="flex items-start gap-3">
          <Avatar className="h-10 w-10">
            <AvatarFallback>{email.from.split(" ").map((n) => n[0]).join("")}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug">{email.subject}</h2>
            <p className="text-sm text-muted-foreground">
              {email.from} · {email.fromEmail}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CategoryBadge category={email.category} />
          <Badge variant={email.priority === "Vysoká" ? "destructive" : "secondary"}>
            Priorita: {email.priority}
          </Badge>
          {email.customer && <Badge variant="outline">{email.customer}</Badge>}
          <AiConfidence value={email.aiConfidence} />
        </div>

        <CategoryCorrector email={email} />

        <div className="mt-4 rounded-lg bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground">
          {email.preview}
        </div>

        <div className="mt-4 rounded-lg border border-success/30 bg-success/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-success">
            <Sparkles className="h-4 w-4" /> Co AI zjistila
          </div>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>• Zařazeno jako <b className="text-foreground">{email.category}</b>{email.customer && <> od <b className="text-foreground">{email.customer}</b></>}.</li>
            {email.aiSummary && <li>• {email.aiSummary}</li>}
            {email.hasDraft && <li>• Odpověď je připravena ve frontě ke schválení.</li>}
          </ul>
        </div>

        {email.hasDraft && (
          <div className="mt-4 rounded-lg border p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Reply className="h-4 w-4 text-muted-foreground" /> Návrh odpovědi (AI)
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {mode === "full" ? (
                <Badge variant="success">
                  <Sparkles className="h-3 w-3" /> V plné automatice se odešle samo
                </Badge>
              ) : (
                <Badge variant="warning">Čeká na tvé schválení</Badge>
              )}
              <Button asChild variant="outline" size="sm">
                <Link href="/dashboard">Zkontrolovat a odeslat na Přehledu</Link>
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Text si tam přečteš, můžeš ho upravit (AI se z úpravy poučí) a teprve červeným
              tlačítkem se odešle.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const CORRECTABLE_CATEGORIES = categories.filter((c) => c !== "Vše");

function CategoryCorrector({ email }: { email: EmailItem }) {
  const [open, setOpen] = React.useState(false);
  const [cat, setCat] = React.useState<string>(email.category);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setCat(email.category);
    setNote("");
    setDone(false);
    setOpen(false);
    setError(null);
  }, [email.id, email.category]);

  const save = async () => {
    setSaving(true);
    setError(null);
    const res = await recordCorrection({
      agentKey: "email",
      field: "category",
      context: `Předmět: ${email.subject} (od ${email.fromEmail})`,
      aiValue: email.category,
      correctedValue: cat,
      note,
    });
    setSaving(false);
    if (res.ok) {
      setDone(true);
      setOpen(false);
    } else {
      setError(res.error ?? "Chyba");
    }
  };

  if (done) {
    return (
      <p className="mt-2 flex items-center gap-1 text-xs text-success">
        <Check className="h-3.5 w-3.5" /> Korekce uložena — AI se z ní příště poučí.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
      >
        <Wand2 className="h-3.5 w-3.5" /> Opravit kategorii (AI se naučí)
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="text-xs font-medium">Oprava kategorie — AI si zapamatuje</div>
      <div className="flex flex-wrap gap-2">
        <select
          value={cat}
          onChange={(e) => setCat(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {CORRECTABLE_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Pravidlo (např. faktury od TDK jdou vždy do Faktura)"
          className="min-w-[200px] flex-1"
        />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="success" onClick={save} disabled={saving}>Uložit korekci (AI se naučí)</Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Zrušit</Button>
      </div>
    </div>
  );
}

function EmptyDetail() {
  return (
    <Card className="flex h-64 items-center justify-center">
      <div className="text-center text-sm text-muted-foreground">
        <Mail className="mx-auto mb-2 h-8 w-8 opacity-40" />
        Vyber e-mail vlevo.
      </div>
    </Card>
  );
}
