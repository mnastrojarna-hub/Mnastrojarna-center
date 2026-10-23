import {
  LayoutDashboard,
  Inbox,
  Send,
  Users,
  Factory,
  FileBox,
  ReceiptText,
  ClipboardList,
  Wallet,
  BrainCircuit,
  Sparkles,
  Settings,
  SlidersHorizontal,
  MessageSquareQuote,
  Calculator,
  FileText,
  PackageCheck,
  UserCog,
  ShoppingBag,
  ScrollText,
  type LucideIcon,
} from "lucide-react";
import type { Feature } from "@/lib/auth/permissions";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Funkce, kterou uživatel musí mít, aby položku viděl. */
  feature: Feature;
  badgeKey?: string;
  description?: string;
  /** Barva ikony (každá sekce má svou — orientace bez čtení). */
  color: string;
  /** Hlavní položka — vizuálně zvýrazněná. */
  primary?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

/**
 * Navigace: Kniha zakázek je hlavní pracovní plocha pro všechny. Detaily
 * obchodního toku (poptávka → nacenění → nabídka → potvrzení) jsou pohledy na
 * stejné zakázky. AI, znalostní DB, archiv výkresů a nastavení vidí jen super admin.
 */
export const navSections: NavSection[] = [
  {
    items: [
      {
        title: "Kniha zakázek", href: "/orders", icon: ClipboardList, feature: "orders", badgeKey: "orders",
        description: "Všechny zakázky na jednom místě — stav, termíny, doklady",
        color: "text-primary", primary: true,
      },
    ],
  },
  {
    label: "Obchodní tok",
    items: [
      { title: "Poptávky", href: "/inquiries", icon: MessageSquareQuote, feature: "workflow", badgeKey: "inquiries", description: "Nové poptávky od zákazníků", color: "text-sky-500" },
      { title: "Nacenění", href: "/pricing", icon: Calculator, feature: "workflow", badgeKey: "pricing", description: "Zakázky čekající na cenu", color: "text-amber-500" },
      { title: "Nabídky", href: "/quotes", icon: FileText, feature: "workflow", badgeKey: "quotes", description: "Všechny nabídky — kdo zadal, kdo schválil", color: "text-violet-500" },
      { title: "Potvrzení objednávek", href: "/confirmations", icon: PackageCheck, feature: "workflow", badgeKey: "confirmations", description: "Objednávky k potvrzení", color: "text-orange-500" },
      { title: "Objednávky dodavatelům", href: "/purchasing", icon: ShoppingBag, feature: "margins", color: "text-lime-600", description: "Naše objednávky u dodavatelů" },
      { title: "Dokumenty", href: "/documents", icon: ReceiptText, feature: "documents", description: "Faktury, nabídky, dodací listy, výkresy", color: "text-emerald-500" },
    ],
  },
  {
    label: "Pošta",
    items: [
      { title: "Přijatá pošta", href: "/inbox", icon: Inbox, feature: "mail", badgeKey: "inbox", description: "Tvoje schránka", color: "text-blue-500" },
      { title: "Odeslaná pošta", href: "/sent", icon: Send, feature: "mail", description: "Co odešlo ven", color: "text-cyan-500" },
    ],
  },
  {
    label: "Adresář",
    items: [
      { title: "Zákazníci", href: "/customers", icon: Users, feature: "customers", description: "CRM", color: "text-green-600" },
      { title: "Dodavatelé", href: "/suppliers", icon: Factory, feature: "suppliers", description: "Kooperace a materiál", color: "text-orange-600" },
    ],
  },
  {
    label: "AI & znalosti",
    items: [
      { title: "AI přehled", href: "/dashboard", icon: LayoutDashboard, feature: "dashboard", badgeKey: "approvals", description: "Fronta schvalování a AI pošta", color: "text-fuchsia-500" },
      { title: "AI Asistent", href: "/assistant", icon: Sparkles, feature: "ai_assistant", description: "Ptej se na cokoliv", color: "text-purple-500" },
      { title: "Archiv výkresů", href: "/drawings", icon: FileBox, feature: "drawings", description: "PDF / STEP / DXF", color: "text-indigo-500" },
      { title: "Znalostní DB", href: "/knowledge", icon: BrainCircuit, feature: "knowledge", description: "Historie a RAG", color: "text-pink-500" },
      { title: "Ladění & korekce", href: "/tuning", icon: SlidersHorizontal, feature: "ai_tuning", description: "Pravidla a učení AI", color: "text-violet-600" },
    ],
  },
  {
    label: "Správa",
    items: [
      { title: "Provize", href: "/commissions", icon: Wallet, feature: "commissions", description: "Obrat, marže, provize", color: "text-emerald-600" },
      { title: "Uživatelé", href: "/users", icon: UserCog, feature: "users", description: "Účty, role, hesla, schránky, AI", color: "text-rose-500" },
      { title: "Nastavení", href: "/settings", icon: Settings, feature: "settings", description: "Připojení, klíče, firma", color: "text-slate-500" },
      { title: "Audit", href: "/settings/audit", icon: ScrollText, feature: "settings", description: "Kdo, kdy a co změnil", color: "text-teal-600" },
    ],
  },
];

export const allNavItems: NavItem[] = navSections.flatMap((s) => s.items);

/** Navigace jen s položkami, na které má uživatel právo (prázdné sekce zmizí). */
export function navForFeatures(features: readonly Feature[]): NavSection[] {
  return navSections
    .map((s) => ({ ...s, items: s.items.filter((i) => features.includes(i.feature)) }))
    .filter((s) => s.items.length > 0);
}

/** Cesta patří k položce (stejná adresa, nebo podstránka). */
export function matchesNavPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + "/");
}

/** Aktivní položka = nejdelší shoda (na /settings/audit svítí Audit, ne Nastavení). */
export function activeNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;
  for (const href of hrefs) {
    if (matchesNavPath(pathname, href) && (!best || href.length > best.length)) best = href;
  }
  return best;
}

/** Výchozí stránka po přihlášení. */
export const HOME_PATH = "/orders";
