"use client";

import * as React from "react";
import { Mail, Sparkles, Send, Pencil, Archive, Reply, Paperclip, Filter, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CategoryBadge } from "@/components/status-badge";
import { AiConfidence } from "@/components/ai-confidence";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAutomation } from "@/components/automation-provider";
import { type EmailItem } from "@/lib/mock-data";
import { cn, relativeTime } from "@/lib/utils";

const categories = [
  "Vše",
  "Poptávka",
  "Objednávka",
  "Nabídka dodavatele",
  "Faktura",
  "Reklamace",
  "Spam",
] as const;

export function InboxView({ emails }: { emails: EmailItem[] }) {
  const [filter, setFilter] = React.useState<(typeof categories)[number]>("Vše");
  const [selectedId, setSelectedId] = React.useState<string>(emails[0]?.id ?? "");
  const [syncing, setSyncing] = React.useState(false);
  const [syncMsg, setSyncMsg] = React.useState<string | null>(null);
  const { mode } = useAutomation();

  const sync = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/emails/sync", { method: "POST" });
      const data = await res.json();
      setSyncMsg(
        data.configured
          ? `Staženo ${data.fetched}, zpracováno ${data.ingested}.`
          : (data.message ?? "Schránka není nakonfigurována."),
      );
    } catch {
      setSyncMsg("Synchronizace selhala.");
    } finally {
      setSyncing(false);
    }
  };

  const filtered = emails.filter((e) => filter === "Vše" || e.category === filter);
  const selected = emails.find((e) => e.id === selectedId) ?? filtered[0];

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Inbox"
        description="Každý e-mail je automaticky roztříděn, ohodnocen a propojen se zákazníkem."
        actions={
          <div className="flex items-center gap-2">
            {syncMsg && <span className="hidden text-xs text-muted-foreground sm:inline">{syncMsg}</span>}
            <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} /> Synchronizovat
            </Button>
            <Button variant="outline" size="sm">
              <Filter className="h-4 w-4" /> Filtry
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-1.5">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
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
        <div className="space-y-2 lg:col-span-2">
          {filtered.length === 0 && (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">Žádné e-maily v této kategorii.</CardContent></Card>
          )}
          {filtered.map((email) => (
            <EmailRow
              key={email.id}
              email={email}
              active={email.id === selected?.id}
              onClick={() => setSelectedId(email.id)}
            />
          ))}
        </div>

        <div className="lg:col-span-3">
          {selected ? <EmailDetail email={selected} mode={mode} /> : <EmptyDetail />}
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

function EmailDetail({ email, mode }: { email: EmailItem; mode: "full" | "approval" }) {
  return (
    <Card className="sticky top-2">
      <CardContent className="p-5">
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
          <Button variant="ghost" size="icon-sm" aria-label="Archivovat">
            <Archive className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CategoryBadge category={email.category} />
          <Badge variant={email.priority === "Vysoká" ? "destructive" : "secondary"}>
            Priorita: {email.priority}
          </Badge>
          {email.customer && <Badge variant="outline">{email.customer}</Badge>}
          <AiConfidence value={email.aiConfidence} />
        </div>

        <div className="mt-4 rounded-lg bg-muted/50 p-4 text-sm leading-relaxed text-muted-foreground">
          {email.preview} Lorem ipsum — kompletní tělo e-mailu se načte ze Supabase Storage / IMAP.
        </div>

        <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Sparkles className="h-4 w-4" /> Analýza AI
          </div>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            <li>• Rozpoznáno jako <b className="text-foreground">{email.category}</b> {email.customer && <>od <b className="text-foreground">{email.customer}</b></>}.</li>
            <li>• Propojeno s výkresem a zákazníkem v CRM.</li>
            <li>• Navržena akce: připravit odpověď a koncept nabídky.</li>
          </ul>
        </div>

        {email.hasDraft && (
          <div className="mt-4 rounded-lg border p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium">
              <Reply className="h-4 w-4 text-muted-foreground" /> Návrh odpovědi (AI)
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Dobrý den, děkujeme za Vaši poptávku. Potvrzujeme přijetí a do dvou pracovních dnů
              Vám zašleme cenovou nabídku…
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {mode === "full" ? (
                <Badge variant="success">
                  <Sparkles className="h-3 w-3" /> Bude odesláno automaticky
                </Badge>
              ) : (
                <Button size="sm">
                  <Send className="h-4 w-4" /> Schválit a odeslat
                </Button>
              )}
              <Button variant="outline" size="sm">
                <Pencil className="h-4 w-4" /> Upravit
              </Button>
              <Button variant="ghost" size="sm">
                <Paperclip className="h-4 w-4" /> Přílohy
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
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
