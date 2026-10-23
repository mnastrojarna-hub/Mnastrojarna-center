"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import {
  Mail, Sparkles, Reply, RefreshCw, ArrowLeft, Wand2, Check, Settings2, Upload, Search,
  FolderPlus, FolderOpen, Loader2, Paperclip, MailOpen, Inbox as InboxIcon, UserRound, Building2,
  AlertCircle, CheckCircle2, X,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { AiConfidence } from "@/components/ai-confidence";
import { useAutomation } from "@/components/automation-provider";
import { useAccess } from "@/components/access-provider";
import { OutlookImport } from "@/components/outlook-import";
import {
  createJobFromEmail, getEmailBody, markEmailRead, setEmailCategory, type EmailBody,
} from "@/app/actions/mail";
import type { EmailItem, EmailCategory } from "@/lib/data/types";
import {
  CATEGORY_STYLE, INBOX_CATEGORIES, NO_MAILBOX, categoryStyle, countByCategory, filterInbox,
  mailtoReply, categoryCodeFromLabel, type InboxFilter, type MailboxOption,
} from "@/lib/email/visibility";
import { debug } from "@/lib/debug/logger";
import { cn, formatDate, relativeTime } from "@/lib/utils";

interface InboxViewProps {
  emails: EmailItem[];
  mailboxes: MailboxOption[];
  /** all = super admin (pošta všech schránek), own = jen vlastní schránka. */
  scope: "all" | "own";
  /** Vybraná schránka (jen super admin), null = všechny. */
  mailboxId: string | null;
}

interface SyncState {
  ok: boolean;
  text: string;
}

interface SyncResponse {
  configured?: boolean;
  fetched?: number;
  ingested?: number;
  ai?: boolean;
  message?: string;
  error?: string;
  boxes?: { id: string; email: string; ok: boolean; skipped?: string; error?: string }[];
}

const AUTO_SYNC_AFTER_MS = 5 * 60_000;

function initials(name: string): string {
  const parts = name.split(/[\s.@_-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

function timeOf(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return `${formatDate(d)} ${d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" })}`;
}

export function InboxView({ emails, mailboxes, scope, mailboxId }: InboxViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { can } = useAccess();
  const canAi = can("dashboard"); // AI třídění, návrhy odpovědí a korekce — jen AI přehled
  const { mode } = useAutomation();

  const [filter, setFilter] = React.useState<InboxFilter>("Vše");
  const [query, setQuery] = React.useState("");
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [mobileDetail, setMobileDetail] = React.useState(false); // master-detail přepínač na mobilu
  const [syncing, setSyncing] = React.useState(false);
  const [syncMsg, setSyncMsg] = React.useState<SyncState | null>(null);
  const [showImport, setShowImport] = React.useState(false);
  // Lokální přepis přečtení (hned po otevření, než dorazí obnovená data)
  const [readOverride, setReadOverride] = React.useState<Record<string, boolean>>({});
  const [categoryOverride, setCategoryOverride] = React.useState<Record<string, EmailCategory>>({});

  const list = React.useMemo(
    () =>
      emails.map((e) => {
        let next = e;
        if (e.id in readOverride) next = { ...next, unread: !readOverride[e.id] };
        if (e.id in categoryOverride) next = { ...next, category: categoryOverride[e.id] };
        return next;
      }),
    [emails, readOverride, categoryOverride],
  );
  const counts = React.useMemo(() => countByCategory(list), [list]);
  const unreadCount = React.useMemo(() => list.filter((e) => e.unread && e.category !== "Spam").length, [list]);
  // Právě otevřený e-mail v seznamu zůstane, i když se otevřením přečetl nebo dostal jinou kategorii
  const filtered = React.useMemo(() => {
    const visible = new Set(filterInbox(list, { category: filter, query }).map((e) => e.id));
    const kept = (id: string) => id === selectedId && id in categoryOverride;
    return list.filter(
      (e) => (visible.has(e.id) || kept(e.id)) && (!unreadOnly || e.unread || e.id === selectedId),
    );
  }, [list, filter, query, unreadOnly, selectedId, categoryOverride]);
  const selected = filtered.find((e) => e.id === selectedId) ?? filtered[0];

  const ownMailboxes = scope === "own" ? mailboxes : [];
  const noMailbox = scope === "own" && mailboxes.length === 0;

  /** Stažení pošty. `auto` = při otevření stránky (neblokuje, hlásí jen nové zprávy a chyby). */
  const sync = async ({ auto = false }: { auto?: boolean } = {}) => {
    setSyncing(true);
    if (!auto) setSyncMsg(null);
    debug.action("inbox-sync", "Spouštím synchronizaci schránky", { mode, scope, auto });
    try {
      const res = await fetch("/api/emails/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto }),
      });
      // Vercel při překročení limitu vrací HTML/504 — ne JSON
      const data = (await res.json().catch(() => null)) as SyncResponse | null;
      debug.info("inbox-sync", "Odpověď synchronizace", { status: res.status, data });
      if (!data) {
        setSyncMsg({ ok: false, text: res.status === 504 ? "Server nestihl stáhnout poštu (časový limit) — zbytek se stáhne při dalším stažení, zkus to znovu." : `Synchronizace selhala (HTTP ${res.status}).` });
      } else if (!res.ok && !data.message) {
        setSyncMsg({ ok: false, text: data.error ?? "Synchronizace selhala." });
      } else if (data.configured) {
        const ran = (data.boxes ?? []).filter((b) => !b.skipped);
        const base = `Staženo ${data.fetched ?? 0}, nových ${data.ingested ?? 0}${data.ai && canAi ? " · roztříděno AI" : ""}${ran.length > 1 ? ` (${ran.length} schránky)` : ""}.`;
        const failed = (data.boxes ?? []).some((b) => !b.ok);
        if (!auto || failed || (data.ingested ?? 0) > 0) {
          setSyncMsg({ ok: !failed && !(data.boxes ? false : data.message), text: data.message ? `${base} ${data.message}` : base });
        }
        router.refresh();
      } else if (!auto) {
        setSyncMsg({ ok: false, text: data.message ?? "Schránka není nakonfigurována." });
      }
    } catch (err) {
      debug.error("inbox-sync", "Synchronizace selhala", err);
      if (!auto) setSyncMsg({ ok: false, text: "Synchronizace selhala (síť)." });
    } finally {
      setSyncing(false);
    }
  };

  // Automatické stažení při otevření, je-li poslední starší než 5 min (na pozadí, UI neblokuje)
  const autoRan = React.useRef(false);
  React.useEffect(() => {
    if (autoRan.current || noMailbox) return;
    autoRan.current = true;
    // schránka s odmítnutým heslem se automaticky nestahuje (opakované špatné přihlášení = blokace IP)
    const stale = mailboxes.some((m) => !m.incomplete && !m.authBlocked && (!m.lastSyncAt || Date.now() - Date.parse(m.lastSyncAt) > AUTO_SYNC_AFTER_MS));
    if (stale) void sync({ auto: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const changeFilter = (cat: InboxFilter) => {
    setFilter(cat);
    setSelectedId("");
    setMobileDetail(false);
  };

  const switchMailbox = (id: string | null) => {
    setSelectedId("");
    setMobileDetail(false);
    router.push(id ? `${pathname}?schranka=${encodeURIComponent(id)}` : pathname);
  };

  const open = (email: EmailItem) => {
    setSelectedId(email.id);
    setMobileDetail(true);
    if (email.unread) {
      setReadOverride((r) => ({ ...r, [email.id]: true }));
      void markEmailRead(email.id, true);
    }
  };

  const setRead = (email: EmailItem, read: boolean) => {
    setReadOverride((r) => ({ ...r, [email.id]: read }));
    void markEmailRead(email.id, read);
  };

  const description =
    scope === "all"
      ? "Pošta všech schránek. Vyber schránku nahoře, klikni na e-mail a jedním tlačítkem z něj založ zakázku."
      : "Tvoje pošta na jednom místě. Klikni na e-mail a jedním tlačítkem z něj založ zakázku v Knize zakázek.";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Přijatá pošta"
        description={description}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImport((s) => !s)}>
              <Upload className="h-4 w-4" /> Import z Outlooku
            </Button>
            <Button size="sm" onClick={() => sync()} disabled={syncing || noMailbox}>
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
              {syncing ? "Stahuji…" : "Stáhnout poštu"}
            </Button>
          </div>
        }
      />

      {syncMsg && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            syncMsg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
          )}
        >
          {syncMsg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="flex-1">{syncMsg.text}</span>
          <button onClick={() => setSyncMsg(null)} aria-label="Zavřít" className="opacity-60 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Čí schránka */}
      {scope === "all" ? (
        <>
          <MailboxSwitcher mailboxes={mailboxes} mailboxId={mailboxId} onSwitch={switchMailbox} />
          <MailboxHealth mailboxes={mailboxes.filter((m) => m.incomplete || m.lastSyncError)} />
        </>
      ) : noMailbox ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 dark:border-amber-500/30 dark:from-amber-500/10 dark:to-orange-500/10">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
            <Mail className="h-5 w-5" />
          </div>
          <div className="text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-200">Zatím nemáš přiřazenou e-mailovou schránku.</p>
            <p className="text-amber-800/80 dark:text-amber-300/80">Super admin ti ji přiřadí v sekci Uživatelé.</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 via-sky-50 to-cyan-50 p-3 dark:border-blue-500/30 dark:from-blue-500/10 dark:via-sky-500/10 dark:to-cyan-500/10">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500 text-white">
            <InboxIcon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1 text-sm">
            <span className="text-blue-900/70 dark:text-blue-200/70">Tvoje schránka: </span>
            {ownMailboxes.map((m, i) => (
              <span key={m.id} className="font-semibold text-blue-900 dark:text-blue-100">
                {i > 0 && ", "}
                {m.email}
              </span>
            ))}
            <MailboxHealth mailboxes={ownMailboxes} />
          </div>
          {unreadCount > 0 && (
            <span className="rounded-full bg-blue-500 px-2.5 py-0.5 text-xs font-semibold text-white">
              {unreadCount} nepřečtených
            </span>
          )}
        </div>
      )}

      {showImport && (
        <Card>
          <CardContent className="pt-5">
            <OutlookImport />
          </CardContent>
        </Card>
      )}

      {/* Hledání + jen nepřečtené */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledat odesílatele, předmět, zákazníka, číslo zakázky…"
            className="pl-9"
          />
        </div>
        <button
          onClick={() => setUnreadOnly((v) => !v)}
          className={cn(
            "inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors",
            unreadOnly
              ? "border-blue-500 bg-blue-500 text-white"
              : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <MailOpen className="h-4 w-4" /> Jen nepřečtené
          {unreadCount > 0 && (
            <span className={cn("rounded-full px-1.5 text-xs", unreadOnly ? "bg-white/25" : "bg-blue-500 text-white")}>
              {unreadCount}
            </span>
          )}
        </button>
      </div>

      {/* Kategorie — každá má svou barvu */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin sm:flex-wrap">
        <FilterChip
          active={filter === "Vše"}
          onClick={() => changeFilter("Vše")}
          label="Vše"
          count={list.length - counts.Spam}
          activeClass="border-foreground bg-foreground text-background"
          idleClass="border-border bg-background text-foreground hover:bg-accent"
        />
        {INBOX_CATEGORIES.filter((c) => counts[c] > 0 || filter === c).map((cat) => {
          const st = CATEGORY_STYLE[cat];
          return (
            <FilterChip
              key={cat}
              active={filter === cat}
              onClick={() => changeFilter(cat)}
              label={cat}
              count={counts[cat]}
              icon={st.icon}
              activeClass={st.active}
              idleClass={cn(st.chip, "hover:brightness-95")}
            />
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className={cn("space-y-2 lg:col-span-2 lg:block", mobileDetail && "hidden")}>
          {list.length === 0 ? (
            <EmptyList scope={scope} noMailbox={noMailbox} />
          ) : (
            filtered.length === 0 && (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  {query || unreadOnly ? "Nic neodpovídá hledání." : "Žádné e-maily v této kategorii."}
                </CardContent>
              </Card>
            )
          )}
          {filtered.map((email) => (
            <EmailRow
              key={email.id}
              email={email}
              active={email.id === selected?.id}
              canAi={canAi}
              showMailbox={scope === "all" && !mailboxId}
              onClick={() => open(email)}
            />
          ))}
        </div>

        <div className={cn("lg:col-span-3 lg:block", !mobileDetail && "hidden")}>
          {selected ? (
            <EmailDetail
              key={selected.id}
              email={selected}
              mode={mode}
              canAi={canAi}
              onBack={() => setMobileDetail(false)}
              onToggleRead={() => setRead(selected, selected.unread)}
              onCategoryChange={(c) => setCategoryOverride((o) => ({ ...o, [selected.id]: c }))}
            />
          ) : (
            <EmptyDetail />
          )}
        </div>
      </div>
    </div>
  );
}

function FilterChip({
  active, onClick, label, count, icon: Icon, activeClass, idleClass,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon?: React.ComponentType<{ className?: string }>;
  activeClass: string;
  idleClass: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all",
        active ? cn(activeClass, "shadow-sm") : idleClass,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
      <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-white/25" : "bg-black/5 dark:bg-white/10")}>
        {count}
      </span>
    </button>
  );
}

/** Stav stahování schránek (poslední stažení / chyba / neúplné nastavení). */
function MailboxHealth({ mailboxes }: { mailboxes: MailboxOption[] }) {
  const items = mailboxes
    .map((m) =>
      m.incomplete
        ? { id: m.id, bad: true, text: `${m.email}: nastavení není kompletní — požádej super admina.` }
        : m.authBlocked
          ? { id: m.id, bad: true, text: `${m.email}: Heslo odmítnuto — oprav ho v Nastavení → E-mailové schránky (nebo požádej super admina). Automatické stahování je do opravy pozastavené.` }
          : m.lastSyncError
          ? { id: m.id, bad: true, text: m.lastSyncError }
          : m.lastSyncAt
            ? { id: m.id, bad: false, text: `${mailboxes.length > 1 ? `${m.email}: ` : ""}staženo ${relativeTime(m.lastSyncAt)}` }
            : null,
    )
    .filter((x): x is { id: string; bad: boolean; text: string } => Boolean(x));
  if (!items.length) return null;
  return (
    <div className="mt-0.5 space-y-0.5 text-xs" data-testid="mailbox-health">
      {items.map((x) => (
        <p key={x.id} suppressHydrationWarning className={cn("break-words", x.bad ? "text-red-700 dark:text-red-300" : "text-blue-900/60 dark:text-blue-200/60")}>
          {x.text}
        </p>
      ))}
    </div>
  );
}

function MailboxSwitcher({
  mailboxes, mailboxId, onSwitch,
}: {
  mailboxes: MailboxOption[];
  mailboxId: string | null;
  onSwitch: (id: string | null) => void;
}) {
  if (mailboxes.length === 0) return null;
  const pill = (active: boolean) =>
    cn(
      "inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors",
      active
        ? "border-blue-500 bg-blue-500 text-white shadow-sm"
        : "border-border bg-background hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10",
    );
  return (
    <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin sm:flex-wrap">
      <button className={pill(mailboxId === null)} onClick={() => onSwitch(null)}>
        <InboxIcon className="h-3.5 w-3.5" />
        <span className="font-semibold">Všechny schránky</span>
      </button>
      {mailboxes.map((m) => {
        const active = mailboxId === m.id;
        return (
          <button key={m.id} className={pill(active)} onClick={() => onSwitch(m.id)} title={m.displayName ?? undefined}>
            <Mail className="h-3.5 w-3.5" />
            <span className="flex flex-col leading-tight">
              <span className="font-semibold">{m.email}</span>
              <span className={cn(active ? "text-white/80" : m.ownerName ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400")}>
                {m.ownerName ?? "bez vlastníka"}
              </span>
              {(m.lastSyncError || m.incomplete) && (
                <span className={cn("text-[10px] font-medium", active ? "text-white" : "text-red-600 dark:text-red-400")} title={m.lastSyncError ?? undefined}>
                  {m.incomplete ? "neúplné nastavení" : "chyba stahování"}
                </span>
              )}
            </span>
          </button>
        );
      })}
      <button className={pill(mailboxId === NO_MAILBOX)} onClick={() => onSwitch(NO_MAILBOX)}>
        <Upload className="h-3.5 w-3.5" />
        <span className="font-semibold">Bez schránky</span>
      </button>
    </div>
  );
}

function CategoryPill({ category }: { category: EmailCategory }) {
  const st = categoryStyle(category);
  const Icon = st.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", st.chip)}>
      <Icon className="h-3 w-3" />
      {st.label}
    </span>
  );
}

function EmailRow({
  email, active, canAi, showMailbox, onClick,
}: {
  email: EmailItem;
  active: boolean;
  canAi: boolean;
  showMailbox: boolean;
  onClick: () => void;
}) {
  const st = categoryStyle(email.category);
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative w-full overflow-hidden rounded-xl border bg-card p-3 pl-4 text-left transition-all",
        active ? "border-blue-400 shadow-md ring-2 ring-blue-500/20" : "hover:-translate-y-px hover:shadow-sm",
        !email.unread && !active && "bg-card/60",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1", st.bar)} aria-hidden />
      <div className="flex items-center gap-2">
        {email.unread && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background", st.dot)} aria-label="Nepřečtený" />}
        <span className={cn("truncate text-sm", email.unread ? "font-bold" : "font-medium text-foreground/80")}>
          {email.from}
        </span>
        <span className="ml-auto shrink-0 text-xs text-muted-foreground" suppressHydrationWarning>
          {relativeTime(email.receivedAt)}
        </span>
      </div>
      <p className={cn("mt-1 truncate text-sm", email.unread ? "font-semibold" : "text-foreground/80")}>
        {email.subject || "(bez předmětu)"}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{email.preview}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <CategoryPill category={email.category} />
        {email.customer && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-500/10 dark:text-green-300">
            <Building2 className="h-3 w-3" /> {email.customer}
          </span>
        )}
        {email.jobNumber && (
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            <FolderOpen className="h-3 w-3" /> {email.jobNumber}
          </span>
        )}
        {showMailbox && email.mailboxEmail && (
          <span className="truncate text-[11px] text-muted-foreground">→ {email.mailboxEmail}</span>
        )}
        {canAi && email.hasDraft && (
          <Badge variant="secondary" className="text-[11px]">
            <Sparkles className="h-3 w-3" /> Návrh připraven
          </Badge>
        )}
        {canAi && email.aiConfidence > 0 && <AiConfidence value={email.aiConfidence} className="ml-auto" />}
      </div>
    </button>
  );
}

function EmailDetail({
  email, mode, canAi, onBack, onToggleRead, onCategoryChange,
}: {
  email: EmailItem;
  mode: "full" | "approval";
  canAi: boolean;
  onBack: () => void;
  onToggleRead: () => void;
  onCategoryChange: (c: EmailCategory) => void;
}) {
  const router = useRouter();
  const st = categoryStyle(email.category);
  const [body, setBody] = React.useState<EmailBody | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [jobError, setJobError] = React.useState<string | null>(null);
  const [createdJob, setCreatedJob] = React.useState<{ id: string; number?: string } | null>(null);

  // Celé tělo až po otevření (seznam nese jen náhled)
  React.useEffect(() => {
    let alive = true;
    getEmailBody(email.id)
      .then((res) => alive && setBody(res))
      .catch(() => alive && setBody({ ok: false, error: "Tělo e-mailu se nepodařilo načíst." }));
    return () => {
      alive = false;
    };
  }, [email.id]);

  const jobId = createdJob?.id ?? email.jobId;
  const jobNumber = createdJob?.number ?? email.jobNumber;
  const reply = mailtoReply(email);

  const createJob = async () => {
    setCreating(true);
    setJobError(null);
    const res = await createJobFromEmail(email.id);
    if (res.ok && res.id) {
      setCreatedJob({ id: res.id, number: res.number });
      router.push(`/orders/${res.id}`);
    } else {
      setJobError(res.error ?? "Zakázku se nepodařilo založit.");
      setCreating(false);
    }
  };

  return (
    <Card className="overflow-hidden lg:sticky lg:top-2">
      <div className={cn("h-1.5 w-full", st.bar)} aria-hidden />
      <CardContent className="p-5">
        <button
          onClick={onBack}
          className="mb-3 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground lg:hidden"
        >
          <ArrowLeft className="h-4 w-4" /> Zpět na seznam
        </button>

        <div className="flex items-start gap-3">
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white", st.dot)}>
            {initials(email.from)}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold leading-snug">{email.subject || "(bez předmětu)"}</h2>
            <p className="truncate text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{email.from}</span>
              {email.fromEmail && email.fromEmail !== email.from && <> · {email.fromEmail}</>}
            </p>
            <p className="text-xs text-muted-foreground" suppressHydrationWarning>
              {timeOf(email.receivedAt)}
              {email.mailboxEmail && <> · do schránky {email.mailboxEmail}</>}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <CategoryPill category={email.category} />
          {email.priority === "Vysoká" && <Badge variant="destructive">Vysoká priorita</Badge>}
          {email.customer && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-800 dark:bg-green-500/10 dark:text-green-300">
              <Building2 className="h-3 w-3" /> {email.customer}
            </span>
          )}
          {canAi && email.aiConfidence > 0 && <AiConfidence value={email.aiConfidence} />}
        </div>

        {/* Hlavní akce: zakázka */}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-dashed bg-muted/30 p-3">
          {jobId ? (
            <Button asChild variant="success" size="sm">
              <Link href={`/orders/${jobId}`}>
                <FolderOpen className="h-4 w-4" /> Otevřít zakázku {jobNumber ?? ""}
              </Link>
            </Button>
          ) : (
            <Button variant="success" size="sm" onClick={createJob} disabled={creating}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
              Založit zakázku
            </Button>
          )}
          {reply && (
            <Button asChild variant="outline" size="sm">
              <a href={reply}>
                <Reply className="h-4 w-4" /> Odpovědět
              </a>
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onToggleRead}>
            <MailOpen className="h-4 w-4" /> {email.unread ? "Označit jako přečtené" : "Označit jako nepřečtené"}
          </Button>
          {!jobId && (
            <p className="w-full text-xs text-muted-foreground">
              Z e-mailu vznikne nová zakázka v Knize zakázek ({email.category === "Objednávka" || email.category === "Potvrzení objednávky" ? "stav Objednávka" : "stav Poptávka"}) —
              zákazník, kontakt i datum se vyplní samy.
            </p>
          )}
          {jobError && <p className="w-full text-xs text-destructive">{jobError}</p>}
        </div>

        <CategoryEditor email={email} canAi={canAi} onSaved={onCategoryChange} />

        {/* Tělo e-mailu */}
        <div className="mt-4 rounded-xl bg-muted/40 p-4 text-sm leading-relaxed">
          {body === null ? (
            <div className="space-y-2">
              <p className="whitespace-pre-wrap text-muted-foreground">{email.preview}</p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Načítám celý e-mail…
              </p>
            </div>
          ) : body.ok ? (
            <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words scrollbar-thin">
              {body.body?.trim() || email.preview || "(prázdný e-mail)"}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="whitespace-pre-wrap text-muted-foreground">{email.preview}</p>
              <p className="text-xs text-destructive">{body.error}</p>
            </div>
          )}
        </div>

        {body?.ok && (body.attachments?.length ?? 0) > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {body.attachments!.map((a) => (
              <span key={a.id} className="inline-flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-xs">
                <Paperclip className="h-3.5 w-3.5 text-muted-foreground" /> {a.filename}
                {a.sizeBytes ? <span className="text-muted-foreground">· {Math.max(1, Math.round(a.sizeBytes / 1024))} kB</span> : null}
              </span>
            ))}
          </div>
        )}

        {canAi && email.aiSummary && (
          <div className="mt-4 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50 p-4 dark:border-violet-500/30 dark:from-violet-500/10 dark:to-fuchsia-500/10">
            <div className="flex items-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300">
              <Sparkles className="h-4 w-4" /> Co AI zjistila
            </div>
            <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
              <li>
                • Zařazeno jako <b className="text-foreground">{email.category}</b>
                {email.customer && <> od <b className="text-foreground">{email.customer}</b></>}.
              </li>
              <li>• {email.aiSummary}</li>
              {email.hasDraft && <li>• Odpověď je připravena ve frontě ke schválení.</li>}
            </ul>
          </div>
        )}

        {canAi && email.hasDraft && (
          <div className="mt-4 rounded-xl border p-4">
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

/**
 * Kategorie e-mailu — ručně ji změní každý (bez AI se tak pošta roztřídí).
 * Super admin může přidat pravidlo; oprava kategorie od AI se uloží jako korekce.
 */
function CategoryEditor({ email, canAi, onSaved }: { email: EmailItem; canAi: boolean; onSaved: (c: EmailCategory) => void }) {
  const [open, setOpen] = React.useState(false);
  const [cat, setCat] = React.useState<EmailCategory>(email.category);
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = async () => {
    const code = categoryCodeFromLabel(cat);
    if (!code) return;
    setSaving(true);
    setError(null);
    const res = await setEmailCategory(email.id, code, canAi ? note : undefined);
    setSaving(false);
    if (res.ok) {
      setDone(true);
      setOpen(false);
      onSaved(cat);
    } else {
      setError(res.error ?? "Chyba");
    }
  };

  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => {
            setCat(email.category);
            setNote("");
            setDone(false);
            setOpen(true);
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary"
        >
          <Wand2 className="h-3.5 w-3.5" /> {canAi ? "Změnit kategorii (AI se naučí)" : "Změnit kategorii"}
        </button>
        {done && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" /> Uloženo{canAi ? " — AI se z toho příště poučí" : ""}.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-500/30 dark:bg-blue-500/10">
      <div className="text-xs font-medium">Do jaké kategorie e-mail patří?</div>
      <div className="flex flex-wrap gap-1.5">
        {INBOX_CATEGORIES.map((c) => {
          const st = CATEGORY_STYLE[c];
          const Icon = st.icon;
          return (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                cat === c ? cn(st.active, "shadow-sm") : st.chip,
              )}
            >
              <Icon className="h-3 w-3" /> {c}
            </button>
          );
        })}
      </div>
      {canAi && (
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Pravidlo pro AI (volitelné, např. faktury od TDK jdou vždy do Faktura)"
        />
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="success" onClick={save} disabled={saving || (cat === email.category && !note.trim())}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Uložit
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Zrušit</Button>
      </div>
    </div>
  );
}

function EmptyList({ scope, noMailbox }: { scope: "all" | "own"; noMailbox: boolean }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-cyan-100 text-blue-600 dark:from-blue-500/15 dark:to-cyan-500/15 dark:text-blue-300">
          {noMailbox ? <UserRound className="h-7 w-7" /> : <Mail className="h-7 w-7" />}
        </div>
        {noMailbox ? (
          <>
            <p className="font-medium text-foreground">Zatím nemáš přiřazenou e-mailovou schránku.</p>
            <p>Super admin ti ji přiřadí v sekci Uživatelé. Mezitím můžeš nahrát e-maily z Outlooku.</p>
          </>
        ) : scope === "all" ? (
          <>
            <p className="font-medium text-foreground">Zatím tu nejsou žádné e-maily.</p>
            <p>Přidej schránku (server, port, heslo) v Nastavení a pak klikni na Stáhnout poštu.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/settings"><Settings2 className="h-4 w-4" /> Otevřít nastavení schránek</Link>
            </Button>
          </>
        ) : (
          <>
            <p className="font-medium text-foreground">Ve schránce zatím nic není.</p>
            <p>Klikni nahoře na Stáhnout poštu — nové e-maily se objeví tady.</p>
          </>
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
