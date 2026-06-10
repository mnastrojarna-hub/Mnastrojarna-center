import {
  LayoutDashboard,
  Inbox,
  Send,
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
  SlidersHorizontal,
  MessageSquareQuote,
  Calculator,
  PackageCheck,
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

/**
 * Navigace kopíruje obchodní tok: pošta → poptávka → nacenění → nabídka →
 * potvrzení → zakázka → doklady. Každý krok má vlastní stránku, aby šel
 * průběh ladit a korigovat (mikromanagement, dokud se AI vše nenaučí).
 */
export const navSections: NavSection[] = [
  {
    items: [
      { title: "Přehled", href: "/dashboard", icon: LayoutDashboard, description: "Vše na jedné obrazovce" },
    ],
  },
  {
    label: "Pošta",
    items: [
      { title: "Přijatá pošta", href: "/inbox", icon: Inbox, badgeKey: "inbox", description: "Automaticky tříděné e-maily" },
      { title: "Odeslaná pošta", href: "/sent", icon: Send, description: "Co odešlo ven (člověk i automatika)" },
    ],
  },
  {
    label: "Obchodní tok",
    items: [
      { title: "Poptávky", href: "/inquiries", icon: MessageSquareQuote, badgeKey: "inquiries", description: "Nové poptávky od zákazníků" },
      { title: "Nacenění", href: "/pricing", icon: Calculator, badgeKey: "pricing", description: "Čeká na cenu (AI návrhy)" },
      { title: "Nabídky", href: "/quotes", icon: FileText, badgeKey: "quotes", description: "Generátor nabídek" },
      { title: "Potvrzení objednávek", href: "/confirmations", icon: PackageCheck, badgeKey: "confirmations", description: "Nové objednávky k potvrzení" },
      { title: "Kniha zakázek", href: "/orders", icon: ClipboardList, badgeKey: "orders", description: "Výrobní tok, termíny" },
      { title: "Dokumenty", href: "/documents", icon: ReceiptText, description: "Faktury, nabídky, dodací listy (PDF)" },
    ],
  },
  {
    label: "Data",
    items: [
      { title: "Zákazníci", href: "/customers", icon: Users, description: "CRM" },
      { title: "Dodavatelé", href: "/suppliers", icon: Factory, description: "Databáze dodavatelů" },
      { title: "Archiv výkresů", href: "/drawings", icon: FileBox, description: "PDF / STEP / DXF" },
      { title: "Znalostní DB", href: "/knowledge", icon: BrainCircuit, description: "Historie a RAG" },
    ],
  },
  {
    label: "AI",
    items: [
      { title: "AI Asistent", href: "/assistant", icon: Sparkles, description: "Ptej se na cokoliv" },
      { title: "Ladění & korekce", href: "/tuning", icon: SlidersHorizontal, description: "Pravidla, parametry, učení AI" },
    ],
  },
  {
    items: [
      { title: "Provize", href: "/commissions", icon: Wallet, description: "Obrat, marže, provize" },
      { title: "Nastavení", href: "/settings", icon: Settings, description: "Připojení, klíče, schránky" },
    ],
  },
];

export const allNavItems: NavItem[] = navSections.flatMap((s) => s.items);
