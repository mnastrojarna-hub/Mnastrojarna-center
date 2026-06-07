import {
  LayoutDashboard,
  Inbox,
  Users,
  Factory,
  FileBox,
  FileText,
  ReceiptText,
  ClipboardList,
  Wallet,
  BrainCircuit,
  Sparkles,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  badgeKey?: string;
  description?: string;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    items: [
      { title: "Přehled", href: "/dashboard", icon: LayoutDashboard, description: "Vše na jedné obrazovce" },
      { title: "AI Inbox", href: "/inbox", icon: Inbox, badgeKey: "inbox", description: "Automaticky tříděná pošta" },
    ],
  },
  {
    label: "Obchod",
    items: [
      { title: "Poptávky & Nabídky", href: "/quotes", icon: FileText, badgeKey: "quotes", description: "Generátor nabídek" },
      { title: "Kniha zakázek", href: "/orders", icon: ClipboardList, badgeKey: "orders", description: "Výrobní tok, termíny, doklady" },
      { title: "Dokumenty", href: "/documents", icon: ReceiptText, description: "Faktury, nabídky, dodací listy (PDF)" },
      { title: "Zákazníci", href: "/customers", icon: Users, description: "CRM" },
      { title: "Dodavatelé", href: "/suppliers", icon: Factory, description: "Databáze dodavatelů" },
    ],
  },
  {
    label: "Data & AI",
    items: [
      { title: "Archiv výkresů", href: "/drawings", icon: FileBox, description: "PDF / STEP / DXF" },
      { title: "Znalostní DB", href: "/knowledge", icon: BrainCircuit, description: "Historie a RAG" },
      { title: "AI Asistent", href: "/assistant", icon: Sparkles, description: "Ptej se na cokoliv" },
      { title: "Provize", href: "/commissions", icon: Wallet, description: "Obrat, marže, provize" },
    ],
  },
  {
    items: [{ title: "Nastavení", href: "/settings", icon: Settings, description: "Účet, AI, automatizace" }],
  },
];

export const allNavItems: NavItem[] = navSections.flatMap((s) => s.items);
