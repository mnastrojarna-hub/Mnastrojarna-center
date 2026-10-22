"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Send, UserCheck, ChevronDown, Wand2, Search, FolderOpen, Mail, Inbox as InboxIcon, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CorrectionButton } from "@/components/correction-button";
import { useAccess } from "@/components/access-provider";
import type { SentItem } from "@/lib/data/types";
import {
  SENT_KIND_STYLE, SENT_AUTO_STYLE, SENT_KINDS, NO_MAILBOX, countSentKinds, filterSent, sentItemKind,
  type SentFilter, type MailboxOption,
} from "@/lib/email/visibility";
import { cn, formatDate, relativeTime } from "@/lib/utils";

function timeOf(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDate(d)} ${d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`;
}

/**
 * Odeslaná pošta — komu, co, kdy a ke které zakázce. Barevné odznaky podle druhu
 * (E-mail, Nabídka, Upomínka, Dodavateli) + „Automaticky". Klik rozbalí přesný text.
 */
export function SentList({
  items,
  mailboxes = [],
  mailboxId = null,
  scope = "own",
}: {
  items: SentItem[];
  /** Jen super admin — přepínač schránek. */
  mailboxes?: MailboxOption[];
  mailboxId?: string | null;
  scope?: "all" | "own";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useAccess();
  const canAi = can("dashboard");
  const [filter, setFilter] = React.useState<SentFilter>("all");
  const [query, setQuery] = React.useState("");
  const [openId, setOpenId] = React.useState<string | null>(null);

  const counts = React.useMemo(() => countSentKinds(items), [items]);
  const filtered = React.useMemo(() => filterSent(items, { kind: filter, query }), [items, filter, query]);

  const switchMailbox = (id: string | null) => {
    setOpenId(null);
    router.push(id ? `${pathname}?schranka=${encodeURIComponent(id)}` : pathname);
  };

  const chips: { key: SentFilter; label: string; icon?: React.ComponentType<{ className?: string }>; active: string; idle: string }[] = [
    { key: "all", label: "Vše", active: "border-foreground bg-foreground text-background", idle: "border-border bg-background text-foreground hover:bg-accent" },
    ...SENT_KINDS.map((k) => ({
      key: k as SentFilter,
      label: SENT_KIND_STYLE[k].label,
      icon: SENT_KIND_STYLE[k].icon,
      active: SENT_KIND_STYLE[k].active,
      idle: SENT_KIND_STYLE[k].chip,
    })),
    { key: "auto", label: SENT_AUTO_STYLE.label, icon: SENT_AUTO_STYLE.icon, active: SENT_AUTO_STYLE.active, idle: SENT_AUTO_STYLE.chip },
  ];

  return (
    <div className="space-y-4">
      {scope === "all" && mailboxes.length > 0 && (
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin sm:flex-wrap">
          <MailboxPill active={mailboxId === null} onClick={() => switchMailbox(null)} icon={InboxIcon} title="Všechny schránky" />
          {mailboxes.map((m) => (
            <MailboxPill
              key={m.id}
              active={mailboxId === m.id}
              onClick={() => switchMailbox(m.id)}
              icon={Mail}
              title={m.email}
              subtitle={m.ownerName ?? "bez vlastníka"}
              warn={!m.ownerName}
            />
          ))}
          <MailboxPill active={mailboxId === NO_MAILBOX} onClick={() => switchMailbox(NO_MAILBOX)} icon={Upload} title="Bez schránky" />
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat adresáta, předmět, číslo zakázky…"
            className="pl-9"
          />
        </div>
      </div>

      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin sm:flex-wrap">
        {chips
          .filter((c) => c.key === "all" || counts[c.key] > 0 || filter === c.key)
          .map((c) => {
            const active = filter === c.key;
            const Icon = c.icon;
            return (
              <button
                key={c.key}
                onClick={() => setFilter(c.key)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
                  active ? cn(c.active, "shadow-sm") : c.idle,
                )}
              >
                {Icon && <Icon className="h-3.5 w-3.5" />}
                {c.label}
                <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-white/25" : "bg-black/5 dark:bg-white/10")}>
                  {counts[c.key]}
                </span>
              </button>
            );
          })}
      </div>

      {filtered.length === 0 && (
        <Card>
          <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-cyan-100 to-blue-100 text-cyan-600 dark:from-cyan-500/15 dark:to-blue-500/15 dark:text-cyan-300">
              <Send className="h-7 w-7" />
            </div>
            {items.length === 0 ? (
              <>
                <p className="font-medium text-foreground">Zatím nic neodešlo.</p>
                <p>
                  Jakmile odešleš nabídku, potvrzení nebo odpověď, objeví se tady — včetně přesného
                  textu a odkazu na zakázku.
                </p>
                {canAi && (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/dashboard">Otevřít frontu ke schválení</Link>
                  </Button>
                )}
              </>
            ) : (
              <p>Nic neodpovídá filtru.</p>
            )}
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {filtered.map((item) => {
          const kind = sentItemKind(item);
          const st = SENT_KIND_STYLE[kind];
          const Icon = st.icon;
          const isOpen = openId === item.id;
          const AutoIcon = SENT_AUTO_STYLE.icon;
          return (
            <Card key={item.id} className={cn("overflow-hidden transition-shadow", isOpen && "shadow-md")}>
              <CardContent className="p-0">
                <button
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                  className="flex w-full items-start gap-3 p-3 text-left hover:bg-accent/40"
                  aria-expanded={isOpen}
                >
                  <div className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border", st.chip)}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">{item.title || "(bez předmětu)"}</span>
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", st.chip)}>
                        <Icon className="h-3 w-3" /> {st.label}
                      </span>
                      {item.auto ? (
                        <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", SENT_AUTO_STYLE.chip)}>
                          <AutoIcon className="h-3 w-3" /> {SENT_AUTO_STYLE.label}
                        </span>
                      ) : item.source === "approval" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
                          <UserCheck className="h-3 w-3" /> schváleno
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                      {item.target && (
                        <span>
                          komu: <span className="font-medium text-foreground">{item.target}</span>
                        </span>
                      )}
                      <span suppressHydrationWarning title={timeOf(item.sentAt)}>· {relativeTime(item.sentAt)}</span>
                      {scope === "all" && item.mailboxEmail && <span>· ze schránky {item.mailboxEmail}</span>}
                      {scope === "all" && item.senderName && <span>· {item.senderName}</span>}
                    </div>
                  </div>
                  <ChevronDown className={cn("mt-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                </button>

                {item.jobId && (
                  <div className="-mt-1 px-3 pb-3 pl-[3.75rem]">
                    <Link
                      href={`/orders/${item.jobId}`}
                      className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary hover:bg-primary/15"
                    >
                      <FolderOpen className="h-3.5 w-3.5" /> Zakázka {item.jobNumber ?? ""}
                    </Link>
                  </div>
                )}

                {isOpen && (
                  <div className="space-y-2 border-t bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                      Odesláno {timeOf(item.sentAt)}
                      {item.toEmail && item.toEmail !== item.target && <> · {item.toEmail}</>}
                    </p>
                    {item.body ? (
                      <pre className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-sans text-sm scrollbar-thin">
                        {item.body}
                      </pre>
                    ) : (
                      <p className="text-sm text-muted-foreground">Text zprávy se neuložil.</p>
                    )}
                    {canAi && item.body && (
                      <CorrectionButton
                        agentKey={kind === "email" ? "email" : "quote"}
                        field="content"
                        context={`Odesláno (${st.label}): ${item.title} → ${item.target}`}
                        aiValue={item.body}
                        label="Nemělo to tak odejít? Napiš správnou verzi (AI se naučí)"
                        multiline
                      />
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {canAi && items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <Wand2 className="mr-1 inline h-3.5 w-3.5" />
          U každé odeslané zprávy můžeš zpětně zapsat, jak měla vypadat — korekce se vloží
          do promptů a AI se příště zachová podle tebe.
        </p>
      )}
    </div>
  );
}

function MailboxPill({
  active, onClick, icon: Icon, title, subtitle, warn,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  warn?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors",
        active
          ? "border-cyan-500 bg-cyan-500 text-white shadow-sm"
          : "border-border bg-background hover:border-cyan-300 hover:bg-cyan-50 dark:hover:bg-cyan-500/10",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="flex flex-col leading-tight">
        <span className="font-semibold">{title}</span>
        {subtitle && (
          <span className={cn(active ? "text-white/80" : warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
            {subtitle}
          </span>
        )}
      </span>
    </button>
  );
}
