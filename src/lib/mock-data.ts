// Demo data pro UI/UX prototyp. V produkci nahradí Supabase dotazy.

export const badgeCounts: Record<string, number> = {
  inbox: 7,
  quotes: 3,
  orders: 5,
};

export type EmailCategory =
  | "Poptávka"
  | "Objednávka"
  | "Nabídka dodavatele"
  | "Potvrzení objednávky"
  | "Faktura"
  | "Upomínka"
  | "Reklamace"
  | "Technická dokumentace"
  | "Spam";

export interface EmailItem {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  preview: string;
  category: EmailCategory;
  priority: "Vysoká" | "Střední" | "Nízká";
  customer?: string;
  receivedAt: string;
  aiConfidence: number;
  unread: boolean;
  hasDraft: boolean;
}

export const emails: EmailItem[] = [
  {
    id: "e1",
    from: "Jan Dvořák",
    fromEmail: "dvorak@strojmetal.cz",
    subject: "Poptávka — frézované díly dle výkresu VK-2291",
    preview: "Dobrý den, poptáváme výrobu 50 ks dílu dle přiloženého výkresu, materiál 1.2379, termín do…",
    category: "Poptávka",
    priority: "Vysoká",
    customer: "Strojmetal a.s.",
    receivedAt: "2026-06-07T08:12:00",
    aiConfidence: 0.97,
    unread: true,
    hasDraft: true,
  },
  {
    id: "e2",
    from: "Petra Nováková",
    fromEmail: "nakup@tdkprecision.com",
    subject: "Objednávka č. OBJ-4471 — potvrzení",
    preview: "Tímto závazně objednáváme dle vaší nabídky NAB-2026-118. Prosím o potvrzení termínu…",
    category: "Objednávka",
    priority: "Vysoká",
    customer: "TDK Precision s.r.o.",
    receivedAt: "2026-06-07T07:48:00",
    aiConfidence: 0.99,
    unread: true,
    hasDraft: true,
  },
  {
    id: "e3",
    from: "Hofmann Tools GmbH",
    fromEmail: "sales@hofmann-tools.de",
    subject: "Angebot — Werkzeugstahl 1.2343 (300 kg)",
    preview: "Sehr geehrte Damen und Herren, anbei unser Angebot für den angefragten Werkzeugstahl…",
    category: "Nabídka dodavatele",
    priority: "Střední",
    receivedAt: "2026-06-06T16:30:00",
    aiConfidence: 0.94,
    unread: false,
    hasDraft: false,
  },
  {
    id: "e4",
    from: "Účtárna Strojmetal",
    fromEmail: "faktury@strojmetal.cz",
    subject: "Faktura FV-20260034 — splatnost 21.6.",
    preview: "V příloze zasíláme fakturu za dodané zboží dle objednávky OBJ-4390…",
    category: "Faktura",
    priority: "Střední",
    customer: "Strojmetal a.s.",
    receivedAt: "2026-06-06T14:02:00",
    aiConfidence: 0.98,
    unread: false,
    hasDraft: false,
  },
  {
    id: "e5",
    from: "Reklamace TDK",
    fromEmail: "quality@tdkprecision.com",
    subject: "Reklamace — rozměrová odchylka u dílu VK-2188",
    preview: "U poslední dodávky jsme naměřili odchylku tolerance H7 mimo rozsah. Žádáme o…",
    category: "Reklamace",
    priority: "Vysoká",
    customer: "TDK Precision s.r.o.",
    receivedAt: "2026-06-06T11:20:00",
    aiConfidence: 0.91,
    unread: true,
    hasDraft: true,
  },
  {
    id: "e6",
    from: "Casino Royale Bonus",
    fromEmail: "win@promo-blast.ru",
    subject: "🎰 Vyhráli jste 50 000 €!!!",
    preview: "Klikněte zde pro vyzvednutí vaší výhry, nabídka platí pouze dnes…",
    category: "Spam",
    priority: "Nízká",
    receivedAt: "2026-06-06T09:15:00",
    aiConfidence: 0.99,
    unread: false,
    hasDraft: false,
  },
];

export interface ApprovalItem {
  id: string;
  type: "E-mail odpověď" | "Nabídka" | "Objednávka dodavateli" | "Kategorizace";
  title: string;
  summary: string;
  target: string;
  createdAt: string;
  aiConfidence: number;
}

export const approvalQueue: ApprovalItem[] = [
  {
    id: "a1",
    type: "E-mail odpověď",
    title: "Odpověď na poptávku VK-2291",
    summary: "Potvrzení přijetí poptávky + příslib nabídky do 2 prac. dnů.",
    target: "dvorak@strojmetal.cz",
    createdAt: "2026-06-07T08:14:00",
    aiConfidence: 0.96,
  },
  {
    id: "a2",
    type: "Nabídka",
    title: "Nabídka NAB-2026-119 — Strojmetal",
    summary: "50 ks dílu VK-2291, materiál 1.2379, vč. termínu. Cena k doplnění.",
    target: "Strojmetal a.s.",
    createdAt: "2026-06-07T08:16:00",
    aiConfidence: 0.88,
  },
  {
    id: "a3",
    type: "Objednávka dodavateli",
    title: "Poptávka materiálu u Hofmann Tools",
    summary: "300 kg 1.2343 dle nejlepší historické ceny. Odeslat poptávku.",
    target: "sales@hofmann-tools.de",
    createdAt: "2026-06-07T08:20:00",
    aiConfidence: 0.92,
  },
];

export interface OrderItem {
  id: string;
  number: string;
  customer: string;
  title: string;
  status: "Přijato" | "Nacenění" | "Objednáno" | "Ve výrobě" | "Expedováno" | "Dokončeno";
  value: number;
  dueDate: string;
  owner: string;
  // Výrobní pole (kniha zakázek)
  drawing?: string;
  material?: string;
  quantity?: number;
  technology?: string;
  location?: string;
  requirements?: string;
  customerEmail?: string;
}

export const orders: OrderItem[] = [
  { id: "o1", number: "OBJ-4471", customer: "TDK Precision s.r.o.", title: "Frézované díly VK-2188", status: "Ve výrobě", value: 184000, dueDate: "2026-06-20", owner: "M. Novák", drawing: "VK-2188", material: "1.2343", quantity: 120, technology: "Frézování 5-osé + broušení", location: "Interní výroba", requirements: "Tolerance H7, Ra 0,8", customerEmail: "nakup@tdkprecision.com" },
  { id: "o2", number: "OBJ-4470", customer: "Strojmetal a.s.", title: "Soustružené čepy VK-2102", status: "Objednáno", value: 92500, dueDate: "2026-06-18", owner: "M. Novák", drawing: "VK-2102", material: "1.4301", quantity: 200, technology: "CNC soustružení", location: "Interní výroba", requirements: "Pasivace", customerEmail: "dvorak@strojmetal.cz" },
  { id: "o3", number: "OBJ-4469", customer: "Beneš CNC", title: "Formová deska 1.2311", status: "Nacenění", value: 240000, dueDate: "2026-07-02", owner: "P. Kraus", drawing: "VK-2271", material: "1.2311", quantity: 8, technology: "Frézování + EDM", location: "Kooperace — kalení", requirements: "Rovinnost 0,02", customerEmail: "info@benescnc.cz" },
  { id: "o4", number: "OBJ-4468", customer: "TDK Precision s.r.o.", title: "Kalené vložky", status: "Expedováno", value: 67000, dueDate: "2026-06-10", owner: "M. Novák", drawing: "VK-2188", material: "1.2379", quantity: 40, technology: "Broušení + kalení", location: "Kooperace — TepKal", requirements: "58–60 HRC", customerEmail: "nakup@tdkprecision.com" },
  { id: "o5", number: "OBJ-4467", customer: "AeroParts EU", title: "Hliníkové konzole 7075", status: "Dokončeno", value: 311000, dueDate: "2026-06-04", owner: "P. Kraus", drawing: "VK-2255", material: "7075-T6", quantity: 200, technology: "Frézování 3-osé", location: "Interní výroba", requirements: "Eloxování", customerEmail: "weber@aeroparts.eu" },
];

export const orderStatusOrder: OrderItem["status"][] = [
  "Přijato",
  "Nacenění",
  "Objednáno",
  "Ve výrobě",
  "Expedováno",
  "Dokončeno",
];

export interface QuoteItem {
  id: string;
  number: string;
  customer: string;
  drawing: string;
  qty: number;
  status: "Návrh AI" | "Ke schválení" | "Odesláno" | "Přijato" | "Zamítnuto";
  value?: number;
  createdAt: string;
}

export const quotes: QuoteItem[] = [
  { id: "q1", number: "NAB-2026-119", customer: "Strojmetal a.s.", drawing: "VK-2291", qty: 50, status: "Ke schválení", createdAt: "2026-06-07T08:16:00" },
  { id: "q2", number: "NAB-2026-118", customer: "TDK Precision s.r.o.", drawing: "VK-2188", qty: 120, status: "Přijato", value: 184000, createdAt: "2026-06-02T10:00:00" },
  { id: "q3", number: "NAB-2026-117", customer: "Beneš CNC", drawing: "VK-2271", qty: 8, status: "Odesláno", value: 240000, createdAt: "2026-06-01T09:30:00" },
  { id: "q4", number: "NAB-2026-116", customer: "AeroParts EU", drawing: "VK-2255", qty: 200, status: "Návrh AI", createdAt: "2026-06-07T07:00:00" },
];

export interface CustomerItem {
  id: string;
  name: string;
  ico: string;
  country: string;
  contact: string;
  email: string;
  orders: number;
  revenue: number;
  owner: string;
}

export const customers: CustomerItem[] = [
  { id: "c1", name: "Strojmetal a.s.", ico: "45274649", country: "CZ", contact: "Jan Dvořák", email: "dvorak@strojmetal.cz", orders: 34, revenue: 2840000, owner: "M. Novák" },
  { id: "c2", name: "TDK Precision s.r.o.", ico: "27082440", country: "CZ", contact: "Petra Nováková", email: "nakup@tdkprecision.com", orders: 51, revenue: 4120000, owner: "M. Novák" },
  { id: "c3", name: "Beneš CNC", ico: "61852309", country: "CZ", contact: "Tomáš Beneš", email: "info@benescnc.cz", orders: 12, revenue: 980000, owner: "P. Kraus" },
  { id: "c4", name: "AeroParts EU", ico: "DE811234567", country: "DE", contact: "Klaus Weber", email: "weber@aeroparts.eu", orders: 9, revenue: 3110000, owner: "P. Kraus" },
];

export interface SupplierItem {
  id: string;
  name: string;
  country: string;
  technologies: string[];
  materials: string[];
  leadDays: number;
  rating: number;
}

export const suppliers: SupplierItem[] = [
  { id: "s1", name: "Hofmann Tools GmbH", country: "DE", technologies: ["Nástrojová ocel", "Dodávka materiálu"], materials: ["1.2343", "1.2379", "1.2311"], leadDays: 7, rating: 4.7 },
  { id: "s2", name: "Kovohutě Trade", country: "CZ", technologies: ["Hliník", "Neželezné kovy"], materials: ["7075", "6082", "AlCu4Mg"], leadDays: 4, rating: 4.4 },
  { id: "s3", name: "TepKal s.r.o.", country: "CZ", technologies: ["Kalení", "Tepelné zpracování"], materials: ["—"], leadDays: 5, rating: 4.8 },
  { id: "s4", name: "CoatTech", country: "CZ", technologies: ["Povlakování PVD", "TiN / TiAlN"], materials: ["—"], leadDays: 6, rating: 4.5 },
];

export interface DrawingItem {
  id: string;
  number: string;
  revision: string;
  customer: string;
  material: string;
  dimensions: string;
  qty: number;
  fileType: "PDF" | "STEP" | "DXF" | "IMG";
  uploadedAt: string;
}

export const drawings: DrawingItem[] = [
  { id: "d1", number: "VK-2291", revision: "B", customer: "Strojmetal a.s.", material: "1.2379", dimensions: "120 × 80 × 25", qty: 50, fileType: "STEP", uploadedAt: "2026-06-07T08:12:00" },
  { id: "d2", number: "VK-2188", revision: "C", customer: "TDK Precision s.r.o.", material: "1.2343", dimensions: "Ø40 × 60", qty: 120, fileType: "PDF", uploadedAt: "2026-06-02T09:50:00" },
  { id: "d3", number: "VK-2271", revision: "A", customer: "Beneš CNC", material: "1.2311", dimensions: "300 × 200 × 40", qty: 8, fileType: "STEP", uploadedAt: "2026-06-01T09:10:00" },
  { id: "d4", number: "VK-2255", revision: "A", customer: "AeroParts EU", material: "7075-T6", dimensions: "150 × 60 × 12", qty: 200, fileType: "DXF", uploadedAt: "2026-05-30T15:00:00" },
];

export interface CommissionRow {
  id: string;
  owner: string;
  revenue: number;
  margin: number;
  rate: number;
  commission: number;
}

export const commissions: CommissionRow[] = [
  { id: "cm1", owner: "M. Novák", revenue: 980000, margin: 0.31, rate: 0.08, commission: 24304 },
  { id: "cm2", owner: "P. Kraus", revenue: 740000, margin: 0.28, rate: 0.075, commission: 15540 },
];

export const dashboardStats = [
  { key: "inquiries", label: "Nové poptávky", value: "7", delta: "+3 dnes", positive: true },
  { key: "orders", label: "Aktivní objednávky", value: "5", delta: "1,28 mil. Kč", positive: true },
  { key: "quotes", label: "Nabídky ke schválení", value: "3", delta: "čeká na tebe", positive: false },
  { key: "commission", label: "Provize tento měsíc", value: "39 844 Kč", delta: "+12 %", positive: true },
];
