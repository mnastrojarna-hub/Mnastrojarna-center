"use client";

import * as React from "react";
import Link from "next/link";
import {
  Mail, RefreshCw, Upload, Search, Loader2, Inbox as InboxIcon, UserRound, AlertCircle, CheckCircle2, X, PenSquare,
  Send, Flag, Layers, Ban, Share2, SlidersHorizontal, MailOpen,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccess } from "@/components/access-provider";
import { OutlookImport } from "@/components/outlook-import";
import { ThreadRow } from "@/components/mail/thread-row";
import { ThreadView, type ThreadPatch } from "@/components/mail/thread-view";
import { ComposeDialog, type ComposeRequest } from "@/components/mail/compose-dialog";
import { useMailSync } from "@/components/mail/use-mail-sync";
import { useMailLive } from "@/components/mail/mail-live-provider";
import { PRIORITY_STYLE, type PriorityValue } from "@/components/priority";
import { listThreadsAction, setThreadFlagAction, setThreadPriorityAction } from "@/app/actions/mail-inbox";
import { CATEGORY_STYLE, INBOX_CATEGORIES, NO_MAILBOX, type MailboxOption } from "@/lib/email/visibility";
import {
  EMPTY_COUNTS, FOLDER_LABEL, SORT_LABEL, progressText, threadCountLabel, type FolderCounts, type MailFolder, type MailSort, type ThreadPage,
  type ThreadSummary,
} from "@/lib/email/mail-types";
import type { EmailCategory } from "@/lib/data/types";
import { debug } from "@/lib/debug/logger";
import { cn, relativeTime } from "@/lib/utils";

interface InboxViewProps {
  initial: ThreadPage;
  counts: FolderCounts;
  mailboxes: MailboxOption[];
  /** all = super admin (pošta všech schránek), own = jen vlastní schránka. */
  scope: "all" | "own";
  /** Vybraná schránka, null = všechny (moje). */
  mailboxId: string | null;
  folder: MailFolder;
}

const AUTO_SYNC_AFTER_MS = 5 * 60_000;
const DESKTOP_QUERY = "(min-width: 1024px)"; // = Tailwind lg (seznam + vlákno vedle sebe)

/** Je vidět rozdělené zobrazení (seznam + vlákno)? Na serveru / před hydratací ne. */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return desktop;
}
const FOLDERS: { id: MailFolder; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "inbox", icon: InboxIcon },
  { id: "sent", icon: Send },
  { id: "flagged", icon: Flag },
  { id: "shared", icon: Share2 },
  { id: "all", icon: Layers },
  { id: "spam", icon: Ban },
];

function folderCount(f: MailFolder, c: FolderCounts): number {
  return f === "inbox" ? c.inboxUnread : f === "flagged" ? c.flagged : f === "shared" ? c.sharedUnread : f === "spam" ? c.spam : 0;
}

/** Přijatá pošta: složky, vlákna, vlaječka + priorita, odpověď / přeposlání / nová zpráva, předání kolegovi. */
export function InboxView({ initial, counts: initialCounts, mailboxes, scope, mailboxId: initialMailbox, folder: initialFolder }: InboxViewProps) {
  const { can } = useAccess();
  const canAi = can("dashboard"); // AI třídění, návrhy odpovědí a korekce — jen AI přehled
  const live = useMailLive();

  const [folder, setFolder] = React.useState<MailFolder>(initialFolder);
  const [mailboxId, setMailboxId] = React.useState<string | null>(initialMailbox);
  const [query, setQuery] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [priorityMax, setPriorityMax] = React.useState<number | null>(null);
  const [category, setCategory] = React.useState<EmailCategory | null>(null);
  const [unreadOnly, setUnreadOnly] = React.useState(false);
  const [sort, setSort] = React.useState<MailSort>("date");
  const [showFilters, setShowFilters] = React.useState(false);
  const [page, setPage] = React.useState<ThreadPage>(initial);
  const [counts, setCounts] = React.useState<FolderCounts>(initialCounts ?? EMPTY_COUNTS);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string>("");
  const [mobileDetail, setMobileDetail] = React.useState(false);
  const [threadVersion, setThreadVersion] = React.useState(0);
  const [compose, setCompose] = React.useState<ComposeRequest | null>(null);
  const [syncMsg, setSyncMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [showImport, setShowImport] = React.useState(false);
  const seq = React.useRef(0);
  const sentinel = React.useRef<HTMLDivElement>(null);

  const ownMailboxes = scope === "own" ? mailboxes : [];
  const noMailbox = scope === "own" && mailboxes.length === 0;

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const params = React.useMemo(
    () => ({ folder, mailboxId, query: debounced, priorityMax, unreadOnly, sort, category }),
    [folder, mailboxId, debounced, priorityMax, unreadOnly, sort, category],
  );

  const reload = React.useCallback(async (opts: { keep?: number } = {}) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const res = await listThreadsAction({ ...params, offset: 0, limit: Math.min(200, Math.max(50, opts.keep ?? 50)) });
      if (my !== seq.current) return;
      if (res.error) setSyncMsg({ ok: false, text: res.error });
      setPage({ items: res.items, total: res.total, offset: 0, hasMore: res.hasMore });
      if (res.counts) setCounts(res.counts);
    } catch (err) {
      debug.error("inbox", "Načtení pošty selhalo", err);
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [params]);

  // změna složky / filtru → první stránka znovu (počáteční data přišla ze serveru)
  const firstRun = React.useRef(true);
  React.useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    void reload();
  }, [reload]);

  // URL drží složku a schránku (odkaz / obnovení stránky) — bez navigace
  React.useEffect(() => {
    const u = new URL(window.location.href);
    if (folder === "inbox") u.searchParams.delete("slozka"); else u.searchParams.set("slozka", folder);
    if (mailboxId) u.searchParams.set("schranka", mailboxId); else u.searchParams.delete("schranka");
    window.history.replaceState(window.history.state, "", u.toString());
  }, [folder, mailboxId]);

  // živá pošta: přišlo něco nového → obnovit seznam (zachovat načtený počet) a otevřené vlákno
  const lastLive = React.useRef(live.version);
  React.useEffect(() => {
    if (live.version === lastLive.current) return;
    lastLive.current = live.version;
    void reload({ keep: page.items.length });
    setThreadVersion((v) => v + 1);
  }, [live.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = React.useCallback(async () => {
    if (loadingMore || !page.hasMore) return;
    setLoadingMore(true);
    const my = seq.current;
    try {
      const res = await listThreadsAction({ ...params, offset: page.items.length, limit: 50 });
      if (my !== seq.current) return;
      setPage((p) => {
        const seen = new Set(p.items.map((t) => t.threadId));
        const items = [...p.items, ...res.items.filter((t) => !seen.has(t.threadId))];
        return { items, total: res.total || p.total, offset: 0, hasMore: res.hasMore };
      });
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, page.hasMore, page.items.length, params]);

  // nekonečné rolování
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loadMore]);

  const { progress, run } = useMailSync({ canAi, onRound: () => void reload({ keep: page.items.length }) });

  const sync = async ({ auto = false }: { auto?: boolean } = {}) => {
    if (!auto) setSyncMsg(null);
    const out = await run({ auto, ...(mailboxId && mailboxId !== NO_MAILBOX ? { mailboxId } : {}) });
    if (!out) return;
    if (!auto || !out.ok || out.ingested > 0) setSyncMsg({ ok: out.ok, text: out.text });
    await reload({ keep: page.items.length });
    live.pokeNow();
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

  const patch = React.useCallback((threadId: string, p: ThreadPatch) => {
    setPage((pg) => ({
      ...pg,
      items: pg.items.map((t) => (t.threadId === threadId ? {
        ...t,
        ...(p.flagged !== undefined ? { flagged: p.flagged } : {}),
        ...(p.priority !== undefined ? { priority: p.priority } : {}),
        ...(p.priorityManual !== undefined ? { priorityManual: p.priorityManual } : {}),
        ...(p.unreadCount !== undefined ? { unreadCount: p.unreadCount } : {}),
        ...(p.category ? { category: p.category } : {}),
        ...(p.jobId ? { jobId: p.jobId, jobNumber: p.jobNumber } : {}),
        ...(p.shareUnread === false && t.share ? { share: { ...t.share, unread: false } } : {}),
      } : t)),
    }));
    if (p.unreadCount === 0 || p.shareUnread === false || p.flagged !== undefined) setTimeout(() => live.pokeNow(), 300);
  }, [live]);

  const toggleFlag = async (t: ThreadSummary) => {
    patch(t.threadId, { flagged: !t.flagged });
    const r = await setThreadFlagAction(t.threadId, !t.flagged);
    if (!r.ok) {
      patch(t.threadId, { flagged: t.flagged });
      setSyncMsg({ ok: false, text: r.error ?? "Vlaječku se nepodařilo uložit." });
    } else setCounts((c) => ({ ...c, flagged: Math.max(0, c.flagged + (t.flagged ? -1 : 1)) }));
  };
  const changePriority = async (t: ThreadSummary, v: PriorityValue | null) => {
    if (v !== null) patch(t.threadId, { priority: v, priorityManual: true });
    const r = await setThreadPriorityAction(t.threadId, v);
    if (!r.ok) {
      patch(t.threadId, { priority: t.priority, priorityManual: t.priorityManual });
      setSyncMsg({ ok: false, text: r.error ?? "Prioritu se nepodařilo uložit." });
    } else if (v === null) void reload({ keep: page.items.length });
  };

  const items = page.items;
  // Otevřené vlákno jen po kliknutí — žádný automatický výběr prvního (otevření = přečteno; nová pošta
  // by se jinak „přečetla" sama, i na mobilu se skrytým panelem). Po živém obnovení zůstane otevřené
  // i když ze stránky seznamu vypadne (poslední známá verze).
  const [openedSummary, setOpenedSummary] = React.useState<ThreadSummary | null>(null);
  const selected = selectedId ? items.find((t) => t.threadId === selectedId) ?? (openedSummary?.threadId === selectedId ? openedSummary : undefined) : undefined;
  React.useEffect(() => {
    const fresh = selectedId ? items.find((t) => t.threadId === selectedId) : undefined;
    if (fresh) setOpenedSummary(fresh);
  }, [items, selectedId]);
  const isDesktop = useIsDesktop();
  const paneVisible = isDesktop || mobileDetail;
  const open = (t: ThreadSummary) => {
    setOpenedSummary(t);
    setSelectedId(t.threadId);
    setMobileDetail(true);
  };
  const closeDetail = () => {
    setMobileDetail(false);
    // mobil: zavřený detail se nenechává skrytě otevřený (živá pošta by ho jinak „četla")
    if (!isDesktop) setSelectedId("");
  };
  const changeFolder = (f: MailFolder) => {
    setFolder(f);
    setSelectedId("");
    setMobileDetail(false);
  };
  const switchMailbox = (id: string | null) => {
    setMailboxId(id);
    setSelectedId("");
    setMobileDetail(false);
  };

  const description = scope === "all"
    ? "Pošta všech schránek ve vláknech. Vlaječka a priorita jedním ťuknutím, odpověď a přeposlání přímo odsud."
    : "Tvoje pošta ve vláknech — odpovídej, přeposílej a piš přímo odsud, vlaječka a priorita jedním ťuknutím.";

  const filtersOn = priorityMax !== null || unreadOnly || sort !== "date" || category !== null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Přijatá pošta"
        description={description}
        // mobil: bez popisu — seznam vláken má začít co nejvýš
        className="[&>div>p]:hidden sm:[&>div>p]:block"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImport((s) => !s)} className="hidden sm:inline-flex">
              <Upload className="h-4 w-4" /> Import z Outlooku
            </Button>
            <Button variant="outline" size="sm" onClick={() => sync()} disabled={progress.running || noMailbox}>
              <RefreshCw className={cn("h-4 w-4", progress.running && "animate-spin")} />
              {progress.running ? "Stahuji…" : "Stáhnout poštu"}
            </Button>
            <Button size="sm" variant="send" onClick={() => setCompose({ mode: "new" })} data-testid="btn-compose">
              <PenSquare className="h-4 w-4" /> Nová zpráva
            </Button>
          </div>
        }
      />

      {progress.running && (
        <div className="rounded-lg border bg-card px-3 py-2 text-sm" data-testid="sync-progress" aria-live="polite">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="font-medium">{progress.total ? progressText(progress.total, progress.remaining) : "Stahuji poštu…"}</span>
            <span className="ml-auto text-xs text-muted-foreground">nových {progress.ingested}</span>
          </div>
          {progress.total > 0 && (
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, Math.round(((progress.total - progress.remaining) / progress.total) * 100))}%` }} />
            </div>
          )}
        </div>
      )}

      {syncMsg && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm",
            syncMsg.ok
              ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
              : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300",
          )}
          data-testid="sync-msg"
        >
          {syncMsg.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1 break-words">{syncMsg.text}</span>
          <button onClick={() => setSyncMsg(null)} aria-label="Zavřít" className="opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      {scope === "all" ? (
        <>
          <MailboxSwitcher mailboxes={mailboxes} mailboxId={mailboxId} onSwitch={switchMailbox} />
          {/* neúplné nastavení ukazují jen dlaždice schránek (bez trvalého červeného řádku) */}
          <MailboxHealth mailboxes={mailboxes.filter((m) => !m.incomplete && m.lastSyncError)} />
        </>
      ) : noMailbox ? (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 dark:border-amber-500/30 dark:from-amber-500/10 dark:to-orange-500/10">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white"><Mail className="h-5 w-5" /></div>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-200">Zatím nemáš připojenou e-mailovou schránku.</p>
            <p className="text-amber-800/80 dark:text-amber-300/80">Připoj si ji sám v Můj účet — stačí e-mail a heslo, nastavení se najde samo.</p>
          </div>
          <Button asChild size="sm" variant="success"><Link href="/account#schranka">Připojit schránku</Link></Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 via-sky-50 to-cyan-50 px-3 py-2 dark:border-blue-500/30 dark:from-blue-500/10 dark:via-sky-500/10 dark:to-cyan-500/10">
          <InboxIcon className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
          <div className="min-w-0 flex-1 text-sm">
            <span className="text-blue-900/70 dark:text-blue-200/70">Tvoje schránka: </span>
            {ownMailboxes.length > 1 ? (
              <span className="inline-flex flex-wrap gap-1 align-middle">
                <button type="button" onClick={() => switchMailbox(null)} className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", !mailboxId ? "bg-blue-500 text-white" : "bg-white/60 text-blue-900 dark:bg-white/10 dark:text-blue-100")}>všechny</button>
                {ownMailboxes.map((m) => (
                  <button key={m.id} type="button" onClick={() => switchMailbox(m.id)} className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", mailboxId === m.id ? "bg-blue-500 text-white" : "bg-white/60 text-blue-900 dark:bg-white/10 dark:text-blue-100")}>{m.email}</button>
                ))}
              </span>
            ) : (
              ownMailboxes.map((m) => <span key={m.id} className="font-semibold text-blue-900 dark:text-blue-100">{m.email}</span>)
            )}
            <MailboxHealth mailboxes={ownMailboxes} />
          </div>
          <Link href="/account#schranka" className="text-xs font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300">Nastavení schránky</Link>
        </div>
      )}

      {showImport && (
        <Card><CardContent className="pt-5"><OutlookImport /></CardContent></Card>
      )}

      <div className="grid gap-4 lg:grid-cols-[10rem_minmax(0,19rem)_minmax(0,1fr)] xl:grid-cols-[11rem_minmax(0,23rem)_minmax(0,1fr)] 2xl:grid-cols-[12rem_minmax(0,26rem)_minmax(0,1fr)]">
        {/* Složky */}
        <nav aria-label="Složky pošty" className={cn("-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0", mobileDetail && "hidden lg:flex")} data-testid="mail-folders">
          {FOLDERS.map(({ id, icon: Icon }) => {
            const n = folderCount(id, counts);
            const active = folder === id;
            if (id === "shared" && !counts.shared && !active) return null;
            return (
              <button
                key={id}
                type="button"
                onClick={() => changeFolder(id)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors lg:w-full lg:border-transparent",
                  active ? "border-primary/30 bg-primary/10 text-primary" : "bg-background text-foreground/80 hover:bg-accent lg:bg-transparent",
                )}
                data-testid={`folder-${id}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="flex-1 text-left">{FOLDER_LABEL[id]}</span>
                {n > 0 && <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{n}</span>}
              </button>
            );
          })}
        </nav>

        {/* Seznam */}
        <div className={cn("min-w-0 space-y-2", mobileDetail && "hidden lg:block")}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hledat (předmět, odesílatel, text)…" className="pl-9" aria-label="Hledat v poště" data-testid="mail-search" />
            </div>
            <Button variant={filtersOn ? "secondary" : "outline"} size="icon" onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters} aria-label="Filtry a řazení" data-testid="mail-filters-toggle">
              <SlidersHorizontal className="h-4 w-4" />
            </Button>
          </div>
          {showFilters && (
            <div className="space-y-2 rounded-lg border bg-card p-2.5 text-sm" data-testid="mail-filters">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 text-xs text-muted-foreground">Priorita</span>
                {[null, 1, 2, 3].map((p) => (
                  <button
                    key={String(p)}
                    type="button"
                    onClick={() => setPriorityMax(p)}
                    className={cn("min-h-8 rounded-full border px-2.5 text-xs font-medium", priorityMax === p ? (p ? PRIORITY_STYLE[p as PriorityValue].solid : "border-foreground bg-foreground text-background") : "hover:bg-accent")}
                    data-testid={`filter-priority-${p ?? "all"}`}
                  >
                    {p === null ? "Vše" : p === 1 ? "Jen P1" : `P1–P${p}`}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 text-xs text-muted-foreground">Řadit</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as MailSort)} className="h-8 rounded-md border bg-background px-2 text-xs" aria-label="Řazení" data-testid="mail-sort">
                  {(Object.keys(SORT_LABEL) as MailSort[]).map((s) => <option key={s} value={s}>{SORT_LABEL[s]}</option>)}
                </select>
                <button type="button" onClick={() => setUnreadOnly((v) => !v)} aria-pressed={unreadOnly} className={cn("inline-flex min-h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium", unreadOnly ? "border-blue-500 bg-blue-500 text-white" : "hover:bg-accent")}>
                  <MailOpen className="h-3.5 w-3.5" /> Jen nepřečtené
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="w-16 text-xs text-muted-foreground">Kategorie</span>
                <button type="button" onClick={() => setCategory(null)} className={cn("min-h-7 rounded-full border px-2 text-[11px] font-medium", category === null ? "border-foreground bg-foreground text-background" : "hover:bg-accent")}>Vše</button>
                {INBOX_CATEGORIES.filter((c) => c !== "Spam").map((c) => (
                  <button key={c} type="button" onClick={() => setCategory(c)} className={cn("min-h-7 rounded-full border px-2 text-[11px] font-medium", category === c ? CATEGORY_STYLE[c].active : CATEGORY_STYLE[c].chip)}>{c}</button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
            <span data-testid="mail-total">{page.total ? threadCountLabel(page.total) : ""}</span>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </div>
          {folder === "sent" && scope === "all" && (
            <p className="px-1 text-xs text-muted-foreground">
              Starší odeslané z fronty schvalování: <Link href="/sent?archiv=1" className="text-primary underline-offset-4 hover:underline">archiv odeslané pošty</Link>
            </p>
          )}
          {items.length === 0 ? (
            <EmptyList scope={scope} noMailbox={noMailbox} folder={folder} filtered={Boolean(debounced) || filtersOn} />
          ) : (
            <div className="space-y-2" data-testid="thread-list">
              {items.map((t) => (
                <ThreadRow
                  key={t.threadId}
                  t={t}
                  active={t.threadId === selected?.threadId}
                  canAi={canAi}
                  showMailbox={scope === "all" && !mailboxId}
                  onOpen={() => open(t)}
                  onFlag={() => void toggleFlag(t)}
                  onPriority={(v) => void changePriority(t, v)}
                />
              ))}
              <div ref={sentinel} />
              {page.hasMore && (
                <Button variant="outline" size="sm" className="w-full" onClick={() => void loadMore()} disabled={loadingMore} data-testid="load-more">
                  {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Načíst další ({Math.max(0, page.total - items.length)})
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Vlákno */}
        <div
          className={cn(
            "min-w-0",
            // mobil / tablet: detail vlákna přes celou obrazovku (nad hlavičkou, nad spodní lištou zůstává navigace)
            mobileDetail
              ? "fixed inset-x-0 top-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 overflow-y-auto overscroll-contain bg-background p-3 md:bottom-0 lg:static lg:z-auto lg:overflow-visible lg:bg-transparent lg:p-0"
              : "hidden lg:block",
          )}
          data-testid="thread-pane"
        >
          {selected && paneVisible ? (
            <div className="lg:sticky lg:top-2">
              <ThreadView
                key={selected.threadId}
                summary={selected}
                canAi={canAi}
                version={threadVersion}
                onBack={closeDetail}
                onPatch={patch}
                onCompose={setCompose}
              />
            </div>
          ) : (
            <Card className="flex h-64 items-center justify-center">
              <div className="text-center text-sm text-muted-foreground"><Mail className="mx-auto mb-2 h-8 w-8 opacity-40" />Vyber e-mail vlevo.</div>
            </Card>
          )}
        </div>
      </div>

      <ComposeDialog
        request={compose}
        onClose={() => setCompose(null)}
        onSent={(r) => {
          setCompose(null);
          setSyncMsg({ ok: r.sentCopy !== "failed", text: `Odesláno${r.fromAddress ? ` z ${r.fromAddress}` : ""}. ${r.sentCopyText ?? ""}`.trim() });
          setThreadVersion((v) => v + 1);
          void reload({ keep: page.items.length });
          live.pokeNow();
        }}
      />
    </div>
  );
}

/** Stav stahování schránek (poslední stažení / chyba / neúplné nastavení). */
function MailboxHealth({ mailboxes }: { mailboxes: MailboxOption[] }) {
  const items = mailboxes
    .map((m) =>
      m.incomplete
        ? { id: m.id, bad: true, text: `${m.email}: nastavení není kompletní — doplň ho v Můj účet → Moje e-mailová schránka.` }
        : m.authBlocked
          ? { id: m.id, bad: true, text: `${m.email}: Heslo odmítnuto — oprav ho v Nastavení schránky (Můj účet → Moje e-mailová schránka → Upravit). Automatické stahování je do opravy pozastavené.` }
          : m.lastSyncError
            ? { id: m.id, bad: true, text: m.lastSyncError }
            : m.lastSyncAt
              ? { id: m.id, bad: false, text: `${mailboxes.length > 1 ? `${m.email}: ` : ""}staženo ${relativeTime(m.lastSyncAt)}` }
              : null,
    )
    .filter((x): x is { id: string; bad: boolean; text: string } => Boolean(x));
  // víc neúplných schránek (přehled admina) → jeden řádek místo stěny textu
  const incomplete = mailboxes.filter((m) => m.incomplete);
  if (incomplete.length > 1) {
    const ids = new Set(incomplete.map((m) => m.id));
    const rest = items.filter((x) => !ids.has(x.id));
    items.length = 0;
    items.push(
      { id: "incomplete", bad: true, text: `Neúplné nastavení: ${incomplete.map((m) => m.email).join(", ")} — majitel si ho doplní v Můj účet → Moje e-mailová schránka.` },
      ...rest,
    );
  }
  if (!items.length) return null;
  return (
    <div className="mt-0.5 space-y-0.5 text-xs" data-testid="mailbox-health">
      {items.map((x) => (
        <p key={x.id} suppressHydrationWarning className={cn("break-words", x.bad ? "text-red-700 dark:text-red-300" : "text-blue-900/60 dark:text-blue-200/60")}>{x.text}</p>
      ))}
    </div>
  );
}

function MailboxSwitcher({ mailboxes, mailboxId, onSwitch }: { mailboxes: MailboxOption[]; mailboxId: string | null; onSwitch: (id: string | null) => void }) {
  if (mailboxes.length === 0) return null;
  const optionLabel = (m: MailboxOption) =>
    `${m.email} — ${m.ownerName ?? "firemní"}${m.incomplete ? " (neúplné nastavení)" : m.lastSyncError ? " (chyba stahování)" : ""}`;
  const pill = (active: boolean) =>
    cn(
      "inline-flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs transition-colors",
      active ? "border-blue-500 bg-blue-500 text-white shadow-sm" : "border-border bg-background hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-500/10",
    );
  return (
    <>
    {/* mobil: kompaktní výběr místo řady dlaždic */}
    <label className="flex items-center gap-2 sm:hidden">
      <InboxIcon className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300" />
      <span className="sr-only">Schránka</span>
      <select
        value={mailboxId ?? ""}
        onChange={(e) => onSwitch(e.target.value || null)}
        className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm"
        data-testid="mailbox-select"
      >
        <option value="">Všechny schránky</option>
        {mailboxes.map((m) => <option key={m.id} value={m.id}>{optionLabel(m)}</option>)}
        <option value={NO_MAILBOX}>Bez schránky</option>
      </select>
    </label>
    <div className="-mx-1 hidden gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin sm:flex sm:flex-wrap">
      <button className={pill(mailboxId === null)} onClick={() => onSwitch(null)}>
        <InboxIcon className="h-3.5 w-3.5" /><span className="font-semibold">Všechny schránky</span>
      </button>
      {mailboxes.map((m) => {
        const active = mailboxId === m.id;
        return (
          <button key={m.id} className={pill(active)} onClick={() => onSwitch(m.id)} title={m.displayName ?? undefined}>
            <Mail className="h-3.5 w-3.5" />
            <span className="flex flex-col leading-tight">
              <span className="font-semibold">{m.email}</span>
              <span className={cn(active ? "text-white/80" : m.ownerName ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400")}>{m.ownerName ?? "firemní (bez vlastníka)"}</span>
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
        <Upload className="h-3.5 w-3.5" /><span className="font-semibold">Bez schránky</span>
      </button>
    </div>
    </>
  );
}

function EmptyList({ scope, noMailbox, folder, filtered }: { scope: "all" | "own"; noMailbox: boolean; folder: MailFolder; filtered: boolean }) {
  return (
    <Card>
      <CardContent className="space-y-3 py-10 text-center text-sm text-muted-foreground" data-testid="mail-empty">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-cyan-100 text-blue-600 dark:from-blue-500/15 dark:to-cyan-500/15 dark:text-blue-300">
          {noMailbox ? <UserRound className="h-7 w-7" /> : <Mail className="h-7 w-7" />}
        </div>
        {filtered ? (
          <p>Nic neodpovídá hledání nebo filtru.</p>
        ) : noMailbox ? (
          <>
            <p className="font-medium text-foreground">Zatím nemáš připojenou e-mailovou schránku.</p>
            <p>Připoj si ji v Můj účet (e-mail + heslo). Mezitím můžeš nahrát e-maily z Outlooku.</p>
          </>
        ) : folder !== "inbox" ? (
          <p>Ve složce {FOLDER_LABEL[folder]} nic není.</p>
        ) : scope === "all" ? (
          <>
            <p className="font-medium text-foreground">Zatím tu nejsou žádné e-maily.</p>
            <p>Připoj schránku v Můj účet (firemní v Nastavení) a klikni na Stáhnout poštu.</p>
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
