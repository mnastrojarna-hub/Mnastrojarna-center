"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail, RefreshCw, Upload, Search, Loader2, Inbox as InboxIcon, UserRound, AlertCircle, CheckCircle2, X, PenSquare,
  Send, Flag, Layers, Ban, Share2, SlidersHorizontal, MailOpen, FolderKanban, FolderOpen, Wand2, Settings, Trash2, Clock,
} from "lucide-react";
import { MailSettingsPanel, type MailSettingsTab } from "@/components/mail/mail-settings-panel";
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
import { useMailLive, useMailLiveFast } from "@/components/mail/mail-live-provider";
import { useMailActionRunner } from "@/components/mail/mail-action-runner";
import { PRIORITY_STYLE, type PriorityValue } from "@/components/priority";
import { listThreadsAction, setThreadFlagAction, setThreadPriorityAction } from "@/app/actions/mail-inbox";
import { discardOutboxAction, flushOutboxAction, listOutboxAction, type FlushOutboxResult, type OutboxItem } from "@/app/actions/mail-compose";
import { updatedAgoLabel } from "@/lib/email/live-poll";
import { sendReceiveText } from "@/lib/email/send-receive";
import { backfillMailJobsAction, confirmJobSuggestionAction, rejectJobSuggestionAction } from "@/app/actions/mail-jobs";
import { CATEGORY_STYLE, INBOX_CATEGORIES, NO_MAILBOX, categoryCodeFromLabel, type MailboxOption } from "@/lib/email/visibility";
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
  { id: "jobs", icon: FolderKanban },
  { id: "sent", icon: Send },
  { id: "flagged", icon: Flag },
  { id: "shared", icon: Share2 },
  { id: "all", icon: Layers },
  { id: "spam", icon: Ban },
];

function folderCount(f: MailFolder, c: FolderCounts): number {
  return f === "inbox" ? c.inboxUnread : f === "jobs" ? (c.jobsUnread ?? 0) + (c.jobSuggestions ?? 0) : f === "flagged" ? c.flagged : f === "shared" ? c.sharedUnread : f === "spam" ? c.spam : 0;
}

/**
 * Pošta (jedna položka menu): složky (Přijaté, K zakázkám, Odeslané …), vlákna, vlaječka + priorita,
 * kategorie (štítek, čipy filtru, oprava ťuknutím), odpověď / přeposlání / nová zpráva, předání kolegovi,
 * ozubené kolo „Nastavení pošty" (podpis).
 */
export function InboxView({ initial, counts: initialCounts, mailboxes, scope, mailboxId: initialMailbox, folder: initialFolder }: InboxViewProps) {
  const { can } = useAccess();
  const canAi = can("dashboard"); // AI třídění, návrhy odpovědí a korekce — jen AI přehled
  const live = useMailLive();
  // otevřená Pošta: nová pošta se kontroluje každých 30 s (skrytá karta nekontroluje) a objeví se sama
  useMailLiveFast();
  const router = useRouter();

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

  // Fronta K odeslání (neodeslané zprávy) — odejdou tlačítkem Přijmout a odeslat
  const [outbox, setOutbox] = React.useState<OutboxItem[]>([]);
  const loadOutbox = React.useCallback(async () => {
    const r = await listOutboxAction().catch(() => null);
    if (r?.ok) setOutbox(r.items);
  }, []);
  React.useEffect(() => {
    void loadOutbox();
  }, [loadOutbox, live.version]);

  /**
   * „Přijmout a odeslat": nejdřív odešle vše, co čeká (moje fronta K odeslání + odeslání s hotovými
   * výkresy), pak přijme poštu ze všech mých schránek. Výsledek krátce: „Přijato 3, odesláno 1."
   */
  const [sendBusy, setSendBusy] = React.useState(false);
  const [needsSettings, setNeedsSettings] = React.useState(false);
  const sendReceive = async () => {
    if (noMailbox) return openSettings("schranka");
    setSyncMsg(null);
    setNeedsSettings(false);
    setSendBusy(true);
    let sent: FlushOutboxResult | null = null;
    try {
      sent = await flushOutboxAction();
    } catch (err) {
      sent = { ok: false, error: err instanceof Error ? err.message : "Odeslání selhalo (síť).", sent: 0, failed: 0, errors: [], needsSettings: false, waitingDrawings: 0, blockedDrawings: 0 };
    } finally {
      setSendBusy(false);
    }
    // příjem: všechny moje schránky (vybraná schránka v přepínači = jen ta, jako dřív)
    const received = await run(mailboxId && mailboxId !== NO_MAILBOX ? { mailboxId } : {});
    const summary = sendReceiveText(received, sent);
    setSyncMsg({ ok: summary.ok, text: summary.text });
    setNeedsSettings(summary.needsSettings);
    await Promise.all([reload({ keep: page.items.length }), loadOutbox()]);
    if (sent?.sent) setThreadVersion((v) => v + 1);
    live.pokeNow();
  };
  const discardOutbox = async (item: OutboxItem) => {
    if (!window.confirm(`Zahodit neodeslanou zprávu „${item.subject || "bez předmětu"}“? Neodejde.`)) return;
    const r = await discardOutboxAction(item.id).catch(() => ({ ok: false, error: "Spojení se nepovedlo." }));
    if (!r.ok) setSyncMsg({ ok: false, text: r.error ?? "Zprávu se nepodařilo zahodit." });
    await loadOutbox();
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
        ...(p.jobCleared ? { jobId: undefined, jobNumber: undefined, jobTitle: undefined, jobLinkSource: undefined, jobLinkActor: undefined } : {}),
        ...(p.suggestionDone ? { suggestion: undefined } : {}),
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

  // Pošta B: návrh „Patří k Z-…?" přímo v seznamu (jedno ťuknutí)
  const [suggBusy, setSuggBusy] = React.useState<string | null>(null);
  const answerSuggestion = async (t: ThreadSummary, accept: boolean) => {
    if (!t.suggestion) return;
    setSuggBusy(t.threadId);
    const r = accept ? await confirmJobSuggestionAction(t.suggestion.id) : await rejectJobSuggestionAction(t.suggestion.id);
    setSuggBusy(null);
    if (!r.ok) return setSyncMsg({ ok: false, text: r.error ?? "Nepodařilo se." });
    const jobNumber = t.suggestion.jobNumber;
    patch(t.threadId, accept ? { jobId: t.suggestion.jobId, jobNumber, suggestionDone: true } : { suggestionDone: true });
    setSyncMsg({ ok: true, text: accept ? `Přiřazeno k ${jobNumber}.` : `Dobře, nepatří k ${jobNumber}.` });
    setCounts((c) => ({ ...c, jobSuggestions: Math.max(0, (c.jobSuggestions ?? 0) - 1) }));
    setThreadVersion((v) => v + 1);
  };
  const [backfilling, setBackfilling] = React.useState(false);
  const backfill = async () => {
    setBackfilling(true);
    try {
      let total = { processed: 0, linked: 0, suggested: 0 };
      for (let round = 0; round < 10; round++) {
        const r = await backfillMailJobsAction();
        if (!r.ok) {
          setSyncMsg({ ok: false, text: r.error ?? "Přiřazení staré pošty selhalo." });
          return;
        }
        total = { processed: total.processed + (r.processed ?? 0), linked: total.linked + (r.linked ?? 0), suggested: total.suggested + (r.suggested ?? 0) };
        if (!r.remaining || !r.processed) break;
      }
      setSyncMsg({ ok: true, text: `Stará pošta prošla (${total.processed}): přiřazeno ${total.linked}, návrhů ${total.suggested}.` });
      await reload({ keep: page.items.length });
    } finally {
      setBackfilling(false);
    }
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
  // Pošta E: hlavní akce zprávy přímo z řádku (Vytvořit nabídku, Zpracovat objednávku, Zapsat fakturu …)
  const rowActions = useMailActionRunner({
    onLinked: (tid, id, number) => patch(tid, { jobId: id, jobNumber: number }),
    onNotice: (n) => setSyncMsg({ ok: n.ok, text: n.text }),
    // objednávka může patřit k víc zakázkám → otevřít vlákno (výběr je v detailu)
    onChoices: (tid) => {
      const t = page.items.find((x) => x.threadId === tid);
      if (t) open(t);
    },
  });
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
    ? "Pošta všech schránek ve vláknech. Vlaječka, priorita i kategorie jedním ťuknutím, odpověď a přeposlání přímo odsud."
    : "Tvoje pošta ve vláknech — odpovídej, přeposílej a piš přímo odsud, vlaječka, priorita i kategorie jedním ťuknutím.";

  const filtersOn = priorityMax !== null || unreadOnly || sort !== "date";
  // čipy kategorií v každé složce (ve Spamu ne; v „K zakázkám" bez „K zakázce" — to je složka sama)
  const chipCategories = folder === "spam" ? [] : INBOX_CATEGORIES.filter((c) => c !== "Spam" && !(folder === "jobs" && c === "K zakázce"));
  React.useEffect(() => {
    if (category && !chipCategories.includes(category)) setCategory(null);
  }, [folder]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nastavení pošty: ozubené kolo v hlavičce (záložky Schránka a Podpis), tlačítka u stavu schránky,
  // odkaz z Můj účet (/inbox?nastaveni=podpis | schranka)
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] = React.useState<MailSettingsTab>("schranka");
  const [editMailboxId, setEditMailboxId] = React.useState<string | null>(null);
  const mailboxesChanged = React.useRef(false);
  function openSettings(tab: MailSettingsTab = "schranka", editId: string | null = null) {
    setSettingsTab(tab);
    setEditMailboxId(editId);
    setSettingsOpen(true);
  }
  const onSettingsOpenChange = (o: boolean) => {
    setSettingsOpen(o);
    // po zavření: změněná schránka → obnovit přehled schránek ze serveru a stáhnout poštu
    if (!o && mailboxesChanged.current) {
      mailboxesChanged.current = false;
      router.refresh();
      void reload({ keep: page.items.length });
      live.pokeNow();
    }
  };
  React.useEffect(() => {
    const u = new URL(window.location.href);
    if (!u.searchParams.has("nastaveni")) return;
    openSettings(u.searchParams.get("nastaveni") === "podpis" ? "podpis" : "schranka");
    u.searchParams.delete("nastaveni");
    window.history.replaceState(window.history.state, "", u.toString());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const selectedMailboxEmail = mailboxId ? mailboxes.find((m) => m.id === mailboxId)?.email ?? null : null;

  // „Aktualizováno před X s" — nenápadně, tiká po 5 s
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(t);
  }, []);
  const updatedLabel = noMailbox ? "" : updatedAgoLabel(live.at, now);

  const recategorize = (t: ThreadSummary, c: EmailCategory) => patch(t.threadId, { category: c });

  return (
    // mobil: menší mezery — seznam vláken má začít co nejvýš (čipy kategorií přibyly)
    <div className="space-y-3 sm:space-y-4">
      <div className="relative">
      {/* mobil: stav živé pošty vpravo vedle nadpisu (bez dalšího řádku nad seznamem) */}
      {updatedLabel && (
        <span
          className={cn("absolute right-0 top-1.5 text-[11px] sm:hidden", live.error ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground/80")}
          data-testid="mail-updated-mobile"
          suppressHydrationWarning
        >
          {updatedLabel}
        </span>
      )}
      <PageHeader
        title="Pošta"
        description={description}
        // mobil: bez popisu — seznam vláken má začít co nejvýš
        className="[&>div>p]:hidden sm:[&>div>p]:block"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowImport((s) => !s)} className="hidden sm:inline-flex">
              <Upload className="h-4 w-4" /> Import z Outlooku
            </Button>
            <Button
              variant="outline" size="sm" onClick={() => void sendReceive()} disabled={progress.running || sendBusy}
              title="Přijme novou poštu ze všech tvých schránek a odešle, co čeká na odeslání" data-testid="btn-send-receive"
            >
              <RefreshCw className={cn("h-4 w-4", (progress.running || sendBusy) && "animate-spin")} />
              {sendBusy ? "Odesílám…" : progress.running ? "Přijímám…" : "Přijmout a odeslat"}
            </Button>
            <Button size="sm" variant="send" onClick={() => setCompose({ mode: "new" })} data-testid="btn-compose">
              <PenSquare className="h-4 w-4" /> Nová zpráva
            </Button>
            <Button
              size="sm" variant="outline" onClick={() => openSettings("schranka")}
              aria-label="Nastavení pošty" title="Nastavení pošty (schránka, servery, heslo, podpis)" data-testid="btn-mail-settings"
              className="px-2.5"
            >
              <Settings className="h-4 w-4" /><span className="hidden sm:inline">Nastavení pošty</span>
            </Button>
          </div>
        }
      />
      </div>

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
          <span className="min-w-0 flex-1 break-words">
            {syncMsg.text}
            {needsSettings && !syncMsg.ok && (
              <Button size="sm" variant="outline" className="ml-2 mt-1 h-7 bg-background text-xs" onClick={() => openSettings("schranka")} data-testid="sync-msg-settings">
                <Settings className="h-3.5 w-3.5" /> Nastavení pošty
              </Button>
            )}
          </span>
          <button onClick={() => setSyncMsg(null)} aria-label="Zavřít" className="opacity-60 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      {outbox.length > 0 && (
        <OutboxBar
          items={outbox}
          busy={sendBusy || progress.running}
          onSend={() => void sendReceive()}
          onDiscard={(i) => void discardOutbox(i)}
          onSettings={() => openSettings("schranka")}
        />
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
            <p className="text-amber-800/80 dark:text-amber-300/80">Připoj si ji sám tady v Nastavení pošty — stačí e-mail a heslo, nastavení se najde samo (nebo ho vyplníš ručně).</p>
          </div>
          <Button size="sm" variant="success" onClick={() => openSettings("schranka")} data-testid="btn-connect-mailbox">Připojit schránku</Button>
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
            <MailboxHealth mailboxes={ownMailboxes} onFix={(id) => openSettings("schranka", id)} />
          </div>
          <button
            type="button" onClick={() => openSettings("schranka")} data-testid="btn-mailbox-settings"
            className="inline-flex min-h-8 items-center text-xs font-medium text-blue-700 underline-offset-4 hover:underline dark:text-blue-300"
          >
            Nastavení schránky
          </button>
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
            </div>
          )}
          {chipCategories.length > 0 && (
            // kategorie vždy na očích: jeden řádek čipů (na mobilu se posouvá do strany)
            <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin" role="group" aria-label="Filtr kategorie" data-testid="category-chips">
              {/* mobil: řádek s počtem vláken není (seznam začne výš) — načítání ukáže kolečko tady */}
              {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground sm:hidden" aria-label="Načítám" />}
              <button
                type="button" onClick={() => setCategory(null)} aria-pressed={category === null}
                className={cn("min-h-8 shrink-0 rounded-full border px-2.5 text-xs font-medium", category === null ? "border-foreground bg-foreground text-background" : "bg-background hover:bg-accent")}
                data-testid="category-chip-all"
              >
                Všechny
              </button>
              {chipCategories.map((c) => {
                const Icon = CATEGORY_STYLE[c].icon;
                return (
                  <button
                    key={c} type="button" onClick={() => setCategory(category === c ? null : c)} aria-pressed={category === c}
                    className={cn("inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-2.5 text-xs font-medium", category === c ? CATEGORY_STYLE[c].active : CATEGORY_STYLE[c].chip)}
                    data-testid={`category-chip-${categoryCodeFromLabel(c)}`}
                  >
                    <Icon className="h-3.5 w-3.5" /> {c}
                  </button>
                );
              })}
            </div>
          )}
          {/* mobil s čipy: řádek není (seznam začne výš) — stav živé pošty je vedle nadpisu */}
          <div className={cn("items-center justify-between gap-2 px-1 text-xs text-muted-foreground", chipCategories.length ? "hidden sm:flex" : "flex")}>
            <span data-testid="mail-total">{page.total ? threadCountLabel(page.total) : ""}</span>
            <span className="ml-auto inline-flex items-center gap-1.5">
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {updatedLabel && (
                <span
                  className={cn("text-[11px]", live.error ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground/80")}
                  title={live.error ? `Poslední kontrola: ${live.error}` : "Nová pošta se kontroluje sama každých 30 s"}
                  data-testid="mail-updated"
                  suppressHydrationWarning
                >
                  {updatedLabel}
                </span>
              )}
            </span>
          </div>
          {folder === "sent" && scope === "all" && (
            <p className="px-1 text-xs text-muted-foreground">
              Starší odeslané z fronty schvalování: <Link href="/sent?archiv=1" className="text-primary underline-offset-4 hover:underline">archiv odeslané pošty</Link>
            </p>
          )}
          {folder === "jobs" && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-fuchsia-200 bg-fuchsia-50/60 px-3 py-2 text-xs text-fuchsia-900 dark:border-fuchsia-500/30 dark:bg-fuchsia-500/10 dark:text-fuchsia-200" data-testid="jobs-folder-hint">
              <FolderKanban className="h-4 w-4 shrink-0" />
              <span className="min-w-0 flex-1">Pošta k běžícím zakázkám a poptávkám — přiřazuje se sama. Nejisté má otázku „Patří k…?“.</span>
              <Button size="sm" variant="outline" className="h-7 bg-background text-xs" onClick={() => void backfill()} disabled={backfilling} data-testid="jobs-backfill">
                {backfilling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} Přiřadit starou poštu
              </Button>
            </div>
          )}
          {items.length === 0 ? (
            <EmptyList scope={scope} noMailbox={noMailbox} folder={folder} filtered={Boolean(debounced) || filtersOn || category !== null} onConnect={() => openSettings("schranka")} />
          ) : (
            <div className="space-y-2" data-testid="thread-list">
              {items.map((t, i) => (
                <React.Fragment key={t.threadId}>
                  {folder === "jobs" && (i === 0 || groupKey(items[i - 1]) !== groupKey(t)) && <JobGroupHeader t={t} />}
                  <ThreadRow
                    t={t}
                    active={t.threadId === selected?.threadId}
                    canAi={canAi}
                    showMailbox={scope === "all" && !mailboxId}
                    hideJob={folder === "jobs"}
                    onOpen={() => open(t)}
                    onFlag={() => void toggleFlag(t)}
                    onPriority={(v) => void changePriority(t, v)}
                    onSuggestion={(accept) => void answerSuggestion(t, accept)}
                    suggestionBusy={suggBusy === t.threadId}
                    onCategory={(c) => recategorize(t, c)}
                    onError={(text) => setSyncMsg({ ok: false, text })}
                    onAction={(key) => void rowActions.run(key, { threadId: t.threadId, emailId: t.emailId, jobId: t.jobId })}
                    actionBusy={rowActions.busy?.threadId === t.threadId ? rowActions.busy.key : null}
                  />
                </React.Fragment>
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
                onSplit={() => void reload({ keep: page.items.length })}
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
          void loadOutbox();
          live.pokeNow();
        }}
        onQueued={() => void loadOutbox()}
        onOpenSettings={() => openSettings("schranka")}
      />
      <MailSettingsPanel
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        initialMailbox={selectedMailboxEmail}
        tab={settingsTab}
        onTabChange={setSettingsTab}
        editMailboxId={editMailboxId}
        isAdmin={scope === "all"}
        onMailboxesChanged={() => { mailboxesChanged.current = true; }}
      />
    </div>
  );
}

/** Neodeslané zprávy (fronta K odeslání): odejdou tlačítkem Přijmout a odeslat, nebo je zahodím. */
function OutboxBar({ items, busy, onSend, onDiscard, onSettings }: {
  items: OutboxItem[]; busy: boolean; onSend: () => void; onDiscard: (i: OutboxItem) => void; onSettings: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const n = items.length;
  const label = n === 1 ? "1 zpráva čeká na odeslání" : `${n} ${n >= 2 && n <= 4 ? "zprávy čekají" : "zpráv čeká"} na odeslání`;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200" data-testid="outbox-bar">
      <div className="flex flex-wrap items-center gap-2">
        <Clock className="h-4 w-4 shrink-0" />
        <button type="button" onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left font-medium underline-offset-4 hover:underline" aria-expanded={open}>
          K odeslání: {label}
        </button>
        <Button size="sm" variant="outline" className="h-8 bg-background" onClick={onSettings}><Settings className="h-3.5 w-3.5" /> Nastavení pošty</Button>
        <Button size="sm" variant="send" className="h-8" onClick={onSend} disabled={busy} data-testid="outbox-send">
          <Send className="h-3.5 w-3.5" /> Přijmout a odeslat
        </Button>
      </div>
      {open && (
        <ul className="mt-2 divide-y divide-amber-200 rounded-md border border-amber-200 bg-background/70 dark:divide-amber-500/20 dark:border-amber-500/20" data-testid="outbox-list">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-2 px-2.5 py-2 text-xs">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">{i.subject || "(bez předmětu)"}</p>
                <p className="truncate text-muted-foreground">Komu: {i.to}</p>
                {i.error && <p className="break-words text-destructive">Neodesláno: {i.error}</p>}
              </div>
              <Button size="icon-sm" variant="ghost" onClick={() => onDiscard(i)} aria-label={`Zahodit zprávu ${i.subject}`} title="Zahodit (neodešle se)">
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Stav stahování schránek (poslední stažení / chyba / neúplné nastavení); vlastní schránku jde opravit hned. */
function MailboxHealth({ mailboxes, onFix }: { mailboxes: MailboxOption[]; onFix?: (mailboxId: string) => void }) {
  const items = mailboxes
    .map((m) =>
      m.incomplete
        ? { id: m.id, bad: true, fix: true, text: `${m.email}: nastavení není kompletní — doplň heslo a servery.` }
        : m.authBlocked
          ? { id: m.id, bad: true, fix: true, text: `${m.email}: Heslo odmítnuto — oprav ho v Nastavení pošty. Automatické stahování je do opravy pozastavené.` }
          : m.lastSyncError
            ? { id: m.id, bad: true, fix: true, text: m.lastSyncError }
            : m.lastSyncAt
              ? { id: m.id, bad: false, fix: false, text: `${mailboxes.length > 1 ? `${m.email}: ` : ""}staženo ${relativeTime(m.lastSyncAt)}` }
              : null,
    )
    .filter((x): x is { id: string; bad: boolean; fix: boolean; text: string } => Boolean(x));
  // víc neúplných schránek (přehled admina) → jeden řádek místo stěny textu
  const incomplete = mailboxes.filter((m) => m.incomplete);
  if (incomplete.length > 1) {
    const ids = new Set(incomplete.map((m) => m.id));
    const rest = items.filter((x) => !ids.has(x.id));
    items.length = 0;
    items.push(
      { id: "incomplete", bad: true, fix: false, text: `Neúplné nastavení: ${incomplete.map((m) => m.email).join(", ")} — majitel si ho doplní v Pošta → Nastavení pošty → Schránka.` },
      ...rest,
    );
  }
  if (!items.length) return null;
  return (
    <div className="mt-0.5 space-y-0.5 text-xs" data-testid="mailbox-health">
      {items.map((x) => (
        <p key={x.id} suppressHydrationWarning className={cn("break-words", x.bad ? "text-red-700 dark:text-red-300" : "text-blue-900/60 dark:text-blue-200/60")}>
          {x.text}
          {x.fix && onFix && (
            <button
              type="button" onClick={() => onFix(x.id)} data-testid="mailbox-health-fix"
              className="ml-1.5 inline-flex min-h-7 items-center rounded-md border border-red-300 bg-background px-2 font-semibold text-red-700 hover:bg-red-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              Opravit nastavení
            </button>
          )}
        </p>
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

function EmptyList({ scope, noMailbox, folder, filtered, onConnect }: { scope: "all" | "own"; noMailbox: boolean; folder: MailFolder; filtered: boolean; onConnect: () => void }) {
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
            <p>Připoj si ji v Nastavení pošty (e-mail + heslo). Mezitím můžeš nahrát e-maily z Outlooku.</p>
            <Button size="sm" variant="success" onClick={onConnect}>Připojit schránku</Button>
          </>
        ) : folder !== "inbox" ? (
          <p>Ve složce {FOLDER_LABEL[folder]} nic není.</p>
        ) : scope === "all" ? (
          <>
            <p className="font-medium text-foreground">Zatím tu nejsou žádné e-maily.</p>
            <p>Připoj schránku v Nastavení pošty (firemní v Nastavení → E-mailové schránky) a klikni na Přijmout a odeslat.</p>
          </>
        ) : (
          <>
            <p className="font-medium text-foreground">Ve schránce zatím nic není.</p>
            <p>Nová pošta se objeví sama — nebo klikni nahoře na Přijmout a odeslat.</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Skupina ve složce „K zakázkám": zakázka vlákna, jinak „Bez zakázky" (návrh / K zakázce bez přiřazení). */
function groupKey(t: ThreadSummary): string {
  return t.jobId ?? `t:${t.threadId}`;
}

function JobGroupHeader({ t }: { t: ThreadSummary }) {
  if (!t.jobId) {
    return (
      <p className="flex items-center gap-1.5 px-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground" data-testid="job-group">
        <FolderKanban className="h-3.5 w-3.5" /> {t.suggestion ? "Návrh přiřazení" : "Bez zakázky"}
      </p>
    );
  }
  return (
    <Link
      href={`/orders/${t.jobId}?tab=komunikace`}
      className="flex items-center gap-1.5 rounded-lg px-1 pt-2 text-sm font-semibold text-primary hover:underline"
      data-testid="job-group"
      data-job={t.jobNumber}
    >
      <FolderOpen className="h-4 w-4 shrink-0" />
      <span className="tabular-nums">{t.jobNumber}</span>
      {t.jobTitle && <span className="min-w-0 truncate font-normal text-foreground/80">{t.jobTitle}</span>}
    </Link>
  );
}
