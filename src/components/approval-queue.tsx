"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, Check, X, Mail, FileText, Factory, Tag, Bot, Send, Pencil, Loader2, ChevronDown, GraduationCap, ShieldAlert,
} from "lucide-react";
// faktura dodavatele (rozdělení na zakázky ke schválení)
import { Receipt } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { AiConfidence } from "@/components/ai-confidence";
import { useAutomation } from "@/components/automation-provider";
import { OUTBOUND_APPROVAL_TYPES, type ApprovalItem } from "@/lib/data/types";
import { resolveApproval, updateApprovalBody } from "@/app/actions/approvals";
import { relativeTime, cn } from "@/lib/utils";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import type { ResolvedApproval } from "@/lib/data/queries";

/** Položka fronty; proposedBy = kdo návrh připravil („✨ AI", „Systém (plánovač)"); quoteHref = „Otevřít nabídku". */
type QueueItem = ApprovalItem & { proposedBy?: string; quoteHref?: string | null };

const RESOLVED_LABEL: Record<ResolvedApproval["status"], string> = {
  approved: "Schváleno",
  rejected: "Zamítnuto",
  auto_executed: "Odesláno automaticky",
};

function agentKeyForType(rawType: ApprovalItem["rawType"]): string {
  switch (rawType) {
    case "email_reply": return "email";
    case "quote": return "quote";
    case "supplier_request": return "quote";
    // objednávka dodavateli = šablona serveru, ne AI návrh (žádné učení z úprav)
    case "purchase_order": return "purchase_order";
    case "categorization": return "email";
    default: return "confirmation";
  }
}

const typeIcon: Partial<Record<ApprovalItem["rawType"], React.ReactNode>> = {
  email_reply: <Mail className="h-4 w-4" />,
  quote: <FileText className="h-4 w-4" />,
  supplier_request: <Factory className="h-4 w-4" />,
  purchase_order: <Factory className="h-4 w-4" />,
  categorization: <Tag className="h-4 w-4" />,
  reminder: <Mail className="h-4 w-4" />,
  order_match: <FileText className="h-4 w-4" />,
  supplier_invoice: <Receipt className="h-4 w-4" />,
};

function ApprovalRow({
  item,
  compact,
  onResolved,
}: {
  item: QueueItem;
  compact: boolean;
  onResolved: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [body, setBody] = React.useState(item.body);
  const [target, setTarget] = React.useState(item.target);
  const [savedBody, setSavedBody] = React.useState(item.body);
  const [busy, setBusy] = React.useState<"approve" | "reject" | "save" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [learned, setLearned] = React.useState(false);

  const isOutbound = OUTBOUND_APPROVAL_TYPES.includes(item.rawType);

  const approve = async () => {
    setBusy("approve");
    setError(null);
    const res = await resolveApproval(item.id, "approved");
    setBusy(null);
    if (res.ok) onResolved(item.id);
    else setError(res.error ?? "Chyba");
  };

  const reject = async () => {
    setBusy("reject");
    setError(null);
    const res = await resolveApproval(item.id, "rejected");
    setBusy(null);
    if (res.ok) onResolved(item.id);
    else setError(res.error ?? "Chyba");
  };

  const saveEdit = async () => {
    setBusy("save");
    setError(null);
    const res = await updateApprovalBody({
      id: item.id,
      body,
      target,
      agentKey: agentKeyForType(item.rawType),
      originalBody: savedBody,
      context: `${item.type}: ${item.title} (${target})`,
    });
    setBusy(null);
    if (res.ok) {
      setEditing(false);
      if (savedBody.trim() !== body.trim()) setLearned(true);
      setSavedBody(body);
    } else {
      setError(res.error ?? "Chyba");
    }
  };

  return (
    <div className="rounded-lg border bg-card transition-colors hover:border-primary/30">
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {typeIcon[item.rawType] ?? <Mail className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-medium", item.rawType === "supplier_invoice" ? "line-clamp-2" : "truncate")}>{item.title}</span>
            <AiConfidence value={item.aiConfidence} />
          </div>
          {!compact && item.summary && (
            <p className="mt-0.5 text-sm text-muted-foreground">{item.summary}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="secondary">{item.type}</Badge>
            {item.rawType === "quote" && (
              // #25: AI nabídka čeká na super admina — do té doby ji nejde odeslat
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-900 ring-1 ring-inset ring-amber-400 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/50"
                title="Čeká na schválení super admina — do té doby ji nejde odeslat zákazníkovi."
              >
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Neschválená
              </span>
            )}
            {item.quoteHref && (
              <Link href={item.quoteHref} className="inline-flex min-h-8 items-center gap-0.5 font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline">
                Otevřít nabídku <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            )}
            {item.rawType === "supplier_invoice" && (
              <Link href="/supplier-invoices?stav=ke_kontrole" className="inline-flex min-h-8 items-center gap-0.5 font-medium text-foreground/80 underline-offset-2 hover:text-foreground hover:underline">
                Faktury ke kontrole <ArrowRight className="h-3 w-3" aria-hidden />
              </Link>
            )}
            {isOutbound && target && (
              <span className="truncate">
                příjemce: <span className="font-medium text-foreground">{target}</span>
              </span>
            )}
            <span>· {item.proposedBy ? `připravil ${item.proposedBy} · ` : ""}{relativeTime(item.createdAt)}</span>
            {item.body && (
              <button
                onClick={() => setOpen((o) => !o)}
                className="inline-flex items-center gap-0.5 font-medium text-foreground/70 hover:text-foreground"
              >
                {open ? "Skrýt text" : "Zobrazit text"}
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
              </button>
            )}
          </div>
        </div>

        {/* Rychlé akce: zelená = bezpečné potvrzení, červená = odešle ven */}
        <div className="flex shrink-0 items-center gap-1.5">
          <Button variant="ghost" size="icon-sm" aria-label="Zamítnout" onClick={reject} disabled={busy !== null}>
            {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
          </Button>
          {isOutbound ? (
            <Button variant="send" size="sm" onClick={approve} disabled={busy !== null}>
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Odeslat
            </Button>
          ) : (
            <Button variant="success" size="sm" onClick={approve} disabled={busy !== null}>
              {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Potvrdit
            </Button>
          )}
        </div>
      </div>

      {(open || editing) && (
        <div className="space-y-2 border-t bg-muted/30 p-3">
          {editing ? (
            <>
              {isOutbound && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Příjemce (e-mail)</label>
                  <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="adresa@firma.cz" />
                </div>
              )}
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={8}
                className="bg-background text-sm"
              />
              <div className="flex items-center gap-2">
                <Button variant="success" size="sm" onClick={saveEdit} disabled={busy !== null}>
                  {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                  Uložit úpravu (AI se naučí)
                </Button>
                <Button variant="ghost" size="sm" onClick={() => { setEditing(false); setBody(savedBody); }}>
                  Zrušit
                </Button>
              </div>
            </>
          ) : (
            <>
              <pre className="whitespace-pre-wrap rounded-md bg-background p-3 font-sans text-sm">{savedBody || "—"}</pre>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil className="h-4 w-4" /> Upravit text
                </Button>
                {learned && (
                  <span className="inline-flex items-center gap-1 text-xs text-success">
                    <GraduationCap className="h-3.5 w-3.5" /> Korekce uložena — AI se z ní poučí.
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {error && <p className="border-t px-3 py-2 text-sm text-destructive">{error}</p>}
    </div>
  );
}

export function ApprovalQueue({
  compact = false,
  initialItems = [],
  recent = [],
}: {
  compact?: boolean;
  initialItems?: QueueItem[];
  /** Naposledy vyřízené — oba autoři: kdo připravil a kdo schválil / zamítl. */
  recent?: ResolvedApproval[];
}) {
  const { mode } = useAutomation();
  const router = useRouter();
  const [items, setItems] = React.useState(initialItems);

  const onResolved = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
    router.refresh();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          {/* #25: ruční nabídky kolegů má panel „Nabídky ke schválení“ nad touto kartou — tady jen AI akce */}
          <CardTitle className="text-base">AI akce ke schválení</CardTitle>
          {items.length > 0 && <Badge variant="warning">{items.length}</Badge>}
        </div>
        {mode === "full" && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-success">
            <Bot className="h-3.5 w-3.5" /> Plná automatika
          </span>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {mode === "full" && (
          <div className="rounded-lg border border-dashed bg-success/5 p-3 text-xs text-muted-foreground">
            V režimu <span className="font-medium text-success">plné automatiky</span> AI tyto akce
            odesílá sama. Přepni na <span className="font-medium text-foreground">Se schválením</span>,
            pokud chceš každou akci nejprve potvrdit.
          </div>
        )}

        {items.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-primary">Červené tlačítko odešle e-mail příjemci.</span>{" "}
            Zelené jen potvrdí změnu uvnitř systému. Každý text můžeš před odesláním upravit — AI se z úprav učí.
          </p>
        )}

        {items.length === 0 && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Žádné AI akce nečekají.
          </div>
        )}

        {items.map((item) => (
          <ApprovalRow key={item.id} item={item} compact={compact} onResolved={onResolved} />
        ))}

        {recent.length > 0 && (
          <div className="border-t pt-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Naposledy vyřízeno</p>
            <ul className="space-y-1.5" aria-label="Naposledy vyřízené položky fronty">
              {recent.map((r) => (
                <li key={r.id} className="flex min-w-0 flex-col gap-0.5 rounded-md bg-muted/30 px-2.5 py-1.5 text-xs sm:flex-row sm:items-center sm:gap-2">
                  <span className="truncate font-medium">{r.title}</span>
                  <span className="text-[11px] text-muted-foreground sm:ml-auto">připravil {r.proposedBy} ·</span>
                  <ActorStamp
                    verb={RESOLVED_LABEL[r.status]}
                    stamp={r.status === "auto_executed" ? { ...r.stamp, by: null, byName: null, kind: "ai" } : r.stamp}
                    short
                    className={cn(r.status === "rejected" && "text-red-700 dark:text-red-300")}
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
