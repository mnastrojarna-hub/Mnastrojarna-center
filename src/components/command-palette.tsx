"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  ArrowRight, Camera, ClipboardList, Factory, FileBox, FileText, Loader2, MessageSquareQuote, Plus, Receipt, Search, ShoppingCart,
  Sparkles, Users,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { allNavItems } from "@/lib/nav";
import { useAccess } from "@/components/access-provider";
import { STAGES, isJobStage } from "@/lib/jobs/stages";
import { searchNormalize } from "@/lib/jobs/mapping";
import type { Feature } from "@/lib/auth/permissions";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";

/**
 * Globální hledání ⌘K (jako Spotlight / Raycast): zakázky (číslo, název, zákazník,
 * číslo objednávky zákazníka), zákazníci, dodavatelé, nabídky a výkresy (jen s právem)
 * + rychlé akce. Data se načtou z /api/search při každém otevření; hledá se lokálně
 * bez diakritiky a vykreslí se jen nejlepší shody (rychlé i s tisíci zakázek).
 */

export interface SearchEntry {
  id: string;
  label: string;
  hint?: string;
  href: string;
  /** Normalizovaný text pro hledání (bez diakritiky, malými písmeny). */
  keywords: string;
  stage?: JobStage;
}

export type SearchGroupKey = "jobs" | "customers" | "suppliers" | "quotes" | "drawings" | "supplierInvoices";
export type SearchData = Record<SearchGroupKey, SearchEntry[]>;

const EMPTY: SearchData = { jobs: [], customers: [], suppliers: [], quotes: [], drawings: [], supplierInvoices: [] };

/** Skóre shody: 0 = neodpovídá; vyšší = lepší (začátek popisku > popisek > klíčová slova). */
export function paletteScore(search: string, entry: Pick<SearchEntry, "label" | "keywords">): number {
  const tokens = searchNormalize(search).split(/\s+/).filter(Boolean);
  if (!tokens.length) return 1;
  const label = searchNormalize(entry.label);
  const hay = `${label} ${entry.keywords}`;
  if (!tokens.every((t) => hay.includes(t))) return 0;
  if (label.startsWith(tokens[0])) return 3;
  if (tokens.every((t) => label.includes(t))) return 2;
  return 1;
}

/** Nejlepší shody skupiny (stabilní pořadí při stejném skóre). */
export function rankEntries<T extends Pick<SearchEntry, "label" | "keywords">>(entries: T[], search: string, limit: number): T[] {
  if (!search.trim()) return entries.slice(0, limit);
  return entries
    .map((e, i) => ({ e, i, s: paletteScore(search, e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}

interface QuickAction {
  key: string;
  label: string;
  hint: string;
  href: string;
  icon: React.ReactNode;
  tone: string;
  feature: Feature;
  keywords: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    key: "capture", label: "Vyfotit doklad", hint: "AI přečte a zařadí do knihy", href: "/orders?capture=1",
    icon: <Camera />, tone: "bg-primary text-primary-foreground", feature: "orders",
    keywords: "vyfotit doklad foto fotka kamera scan nahrat objednavka poptavka faktura dodaci list",
  },
  {
    key: "new", label: "Nová zakázka", hint: "ruční založení", href: "/orders?new=1",
    icon: <Plus />, tone: "bg-foreground text-background", feature: "orders",
    keywords: "nova zakazka zalozit pridat rucne",
  },
  {
    key: "book-orders", label: "Kniha zakázek — objednávky", hint: "hlavní pohled", href: "/orders",
    icon: <ShoppingCart />, tone: "bg-orange-500 text-white", feature: "orders",
    keywords: "kniha zakazek objednavky rozpracovane vyroba",
  },
  {
    key: "book-inquiries", label: "Kniha zakázek — poptávky & nabídky", hint: "před objednávkou", href: "/orders?segment=poptavky",
    icon: <MessageSquareQuote />, tone: "bg-sky-500 text-white", feature: "orders",
    keywords: "kniha zakazek poptavky nabidky naceneni",
  },
];

const GROUPS: { key: SearchGroupKey; heading: string; icon: React.ReactNode; tone: string; feature: Feature }[] = [
  { key: "jobs", heading: "Zakázky", icon: <ClipboardList />, tone: "text-primary", feature: "orders" },
  { key: "customers", heading: "Zákazníci", icon: <Users />, tone: "text-green-600 dark:text-green-400", feature: "customers" },
  { key: "quotes", heading: "Nabídky", icon: <FileText />, tone: "text-violet-600 dark:text-violet-400", feature: "orders" },
  { key: "suppliers", heading: "Dodavatelé", icon: <Factory />, tone: "text-orange-600 dark:text-orange-400", feature: "suppliers" },
  { key: "drawings", heading: "Výkresy", icon: <FileBox />, tone: "text-indigo-600 dark:text-indigo-400", feature: "drawings" },
  // faktury dodavatelů jen s právem (zatím super admin) — data posílá /api/search jen jemu
  { key: "supplierInvoices", heading: "Faktury dodavatelů", icon: <Receipt />, tone: "text-emerald-600 dark:text-emerald-400", feature: "supplier_invoices" },
];

/** Kolik shod ukázat ve skupině (bez hledání jen pár nejnovějších zakázek). */
const LIMIT_SEARCH = 8;
const LIMIT_IDLE: Partial<Record<SearchGroupKey, number>> = { jobs: 5 };

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CommandPaletteContext = React.createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette() {
  const ctx = React.useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<SearchData>(EMPTY);
  const [loading, setLoading] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const router = useRouter();
  const access = useAccess();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Při každém otevření čerstvá data (levné — jeden dotaz, filtruje se lokálně)
  React.useEffect(() => {
    if (!open) return;
    setSearch("");
    const ctrl = new AbortController();
    setLoading(true);
    fetch("/api/search", { signal: ctrl.signal, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : EMPTY))
      .then((d: Partial<SearchData>) => {
        setData({
          jobs: d.jobs ?? [], customers: d.customers ?? [], suppliers: d.suppliers ?? [],
          quotes: d.quotes ?? [], drawings: d.drawings ?? [], supplierInvoices: d.supplierInvoices ?? [],
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const q = search.trim();
  const actions = QUICK_ACTIONS.filter((a) => access.can(a.feature)).filter(
    (a) => paletteScore(q, { label: a.label, keywords: a.keywords }) > 0,
  );
  const nav = allNavItems
    .filter((item) => (item.feature === null || access.can(item.feature)) && !(item.hideWith && access.can(item.hideWith)))
    .filter((item) => paletteScore(q, { label: item.title, keywords: searchNormalize(item.description ?? "") }) > 0);
  const groups = GROUPS.filter((g) => access.can(g.feature)).map((g) => ({
    ...g,
    items: rankEntries(data[g.key], q, q ? LIMIT_SEARCH : (LIMIT_IDLE[g.key] ?? 0)),
  }));
  const nothing = !actions.length && !nav.length && groups.every((g) => !g.items.length);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent hideClose aria-describedby={undefined} className="top-[8%] w-[calc(100%-1.5rem)] max-w-xl overflow-hidden p-0 sm:top-[12%]">
          <DialogTitle className="sr-only">Globální vyhledávání</DialogTitle>
          <Command
            shouldFilter={false}
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-muted-foreground"
          >
            <div className="flex items-center gap-2 border-b px-4">
              {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : <Search className="h-4 w-4 shrink-0 text-muted-foreground" />}
              <Command.Input
                autoFocus
                value={search}
                onValueChange={setSearch}
                placeholder="Číslo zakázky, zákazník, č. objednávky, výkres… nebo příkaz"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:block">ESC</kbd>
            </div>
            <Command.List className="max-h-[65vh] overflow-y-auto scrollbar-thin p-2">
              {nothing && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  {loading ? "Načítám…" : (
                    <>Nic nenalezeno pro „{q}“. Zkus číslo zakázky (Z-2026-…), IČO nebo číslo objednávky zákazníka.</>
                  )}
                </div>
              )}

              {actions.length > 0 && (
                <Command.Group heading="Rychlé akce">
                  {actions.map((a) => (
                    <Item key={a.key} value={`akce-${a.key}`} onSelect={() => go(a.href)} icon={a.icon} iconTone={cn("rounded-md p-1", a.tone)} hint={a.hint}>
                      {a.label}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {groups.map((g) =>
                g.items.length ? (
                  <Command.Group key={g.key} heading={q ? g.heading : g.key === "jobs" ? "Naposledy změněné zakázky" : g.heading}>
                    {g.items.map((e) => (
                      <Item
                        key={e.id}
                        value={`${g.key}-${e.id}`}
                        onSelect={() => go(e.href)}
                        icon={g.icon}
                        iconTone={g.tone}
                        hint={e.hint}
                        stage={e.stage && isJobStage(e.stage) ? e.stage : undefined}
                      >
                        {e.label}
                      </Item>
                    ))}
                  </Command.Group>
                ) : null,
              )}

              {nav.length > 0 && (
                <Command.Group heading="Přejít na">
                  {nav.map((item) => (
                    <Item key={item.href} value={`nav-${item.href}`} onSelect={() => go(item.href)} icon={<item.icon />} iconTone={item.color} hint={item.description}>
                      {item.title}
                    </Item>
                  ))}
                </Command.Group>
              )}

              {access.can("ai_assistant") && (!q || paletteScore(q, { label: "Zeptat se AI asistenta", keywords: "ai asistent dotaz otazka" }) > 0) && (
                <Command.Group heading="AI">
                  <Item value="ai-assistant" onSelect={() => go("/assistant")} icon={<Sparkles />} iconTone="text-purple-500">
                    Zeptat se AI asistenta…
                  </Item>
                </Command.Group>
              )}
            </Command.List>
            <div className="hidden items-center gap-3 border-t px-4 py-2 text-[11px] text-muted-foreground sm:flex">
              <span><kbd className="rounded border bg-muted px-1">↑</kbd> <kbd className="rounded border bg-muted px-1">↓</kbd> výběr</span>
              <span><kbd className="rounded border bg-muted px-1">Enter</kbd> otevřít</span>
              <span className="ml-auto"><kbd className="rounded border bg-muted px-1">⌘K</kbd> / <kbd className="rounded border bg-muted px-1">Ctrl K</kbd> kdykoli</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </CommandPaletteContext.Provider>
  );
}

function Item({
  children,
  value,
  onSelect,
  icon,
  iconTone,
  hint,
  stage,
}: {
  children: React.ReactNode;
  value: string;
  onSelect: () => void;
  icon: React.ReactNode;
  iconTone?: string;
  hint?: string;
  stage?: JobStage;
}) {
  const m = stage ? STAGES[stage] : null;
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
      )}
    >
      <span className={cn("shrink-0 text-muted-foreground [&_svg]:size-4", iconTone)}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate">{children}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
      {m && (
        <span className={cn("hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline", m.badge)}>{m.short}</span>
      )}
      <ArrowRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-data-[selected=true]:opacity-60" />
    </Command.Item>
  );
}
