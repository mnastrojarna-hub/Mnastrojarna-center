import {
  MessageSquareQuote, Calculator, FileText, ShoppingCart, BadgeCheck, PencilRuler, Box, Truck,
  ReceiptText, Camera, Mail, Paperclip, PackagePlus, type LucideIcon,
} from "lucide-react";
import type { JobFileKind } from "@/lib/supabase/database.types";

/** Druhy dokumentů zakázky — popisky, ikony a barvy (stejná logika jako stavy). */
export interface FileKindMeta {
  key: JobFileKind;
  label: string;
  icon: LucideIcon;
  badge: string;
  text: string;
}

export const FILE_KINDS: Record<JobFileKind, FileKindMeta> = {
  poptavka: { key: "poptavka", label: "Poptávka", icon: MessageSquareQuote, badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", text: "text-sky-600 dark:text-sky-400" },
  naceneni: { key: "naceneni", label: "Nacenění", icon: Calculator, badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", text: "text-amber-600 dark:text-amber-400" },
  nabidka: { key: "nabidka", label: "Nabídka", icon: FileText, badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300", text: "text-violet-600 dark:text-violet-400" },
  objednavka: { key: "objednavka", label: "Objednávka", icon: ShoppingCart, badge: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300", text: "text-orange-600 dark:text-orange-400" },
  objednavka_vydana: { key: "objednavka_vydana", label: "Objednávka dodavateli", icon: PackagePlus, badge: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300", text: "text-lime-700 dark:text-lime-400" },
  potvrzeni: { key: "potvrzeni", label: "Potvrzení", icon: BadgeCheck, badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300", text: "text-indigo-600 dark:text-indigo-400" },
  vykres: { key: "vykres", label: "Výkres", icon: PencilRuler, badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300", text: "text-blue-600 dark:text-blue-400" },
  model_3d: { key: "model_3d", label: "3D model", icon: Box, badge: "bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300", text: "text-purple-600 dark:text-purple-400" },
  dodaci_list: { key: "dodaci_list", label: "Dodací list", icon: Truck, badge: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300", text: "text-green-600 dark:text-green-400" },
  faktura: { key: "faktura", label: "Faktura", icon: ReceiptText, badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", text: "text-emerald-700 dark:text-emerald-400" },
  foto: { key: "foto", label: "Fotka", icon: Camera, badge: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300", text: "text-rose-600 dark:text-rose-400" },
  korespondence: { key: "korespondence", label: "Korespondence", icon: Mail, badge: "bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300", text: "text-cyan-600 dark:text-cyan-400" },
  ostatni: { key: "ostatni", label: "Ostatní", icon: Paperclip, badge: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300", text: "text-slate-600 dark:text-slate-400" },
};

export const FILE_KIND_ORDER: JobFileKind[] = [
  "poptavka", "naceneni", "nabidka", "objednavka", "potvrzeni", "objednavka_vydana", "vykres", "model_3d",
  "dodaci_list", "faktura", "foto", "korespondence", "ostatni",
];

export function isJobFileKind(value: unknown): value is JobFileKind {
  return typeof value === "string" && value in FILE_KINDS;
}

/** Přípony 3D modelů a výkresů z CAD (bez tečky, malými písmeny). */
export const CAD_3D_EXTENSIONS = [
  "step", "stp", "iges", "igs", "stl", "3mf", "x_t", "x_b", "sldprt", "sldasm", "catpart", "catproduct",
  "prt", "asm", "ipt", "iam", "par", "psm", "jt", "sat", "3dm", "f3d",
] as const;
export const CAD_2D_EXTENSIONS = ["dxf", "dwg"] as const;
export const CAD_EXTENSIONS: readonly string[] = [...CAD_3D_EXTENSIONS, ...CAD_2D_EXTENSIONS];

const CAD_ACCEPT = CAD_EXTENSIONS.map((e) => `.${e}`).join(",");

/** Povolené typy souborů zakázky (fotky z mobilu, PDF, CAD modely, kancelářské dokumenty). */
export const JOB_FILE_ACCEPT =
  `image/*,application/pdf,.pdf,${CAD_ACCEPT},.xlsx,.xls,.docx,.doc,.msg,.eml,.zip`;

/**
 * Výběr souborů v „Vyfotit doklad" (dávka): fotky, PDF, CAD, kancelář, ZIP — a na konci
 * cokoli (neznámý typ se uloží jako „Ostatní"). Explicitní přípony kvůli iOS výběru.
 */
export const CAPTURE_FILES_ACCEPT =
  `image/*,application/pdf,.pdf,${CAD_ACCEPT},.zip,.xlsx,.xls,.docx,.doc,.msg,.eml,.txt,.csv,*/*`;

export const JOB_FILE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB

/** Odhad druhu podle názvu souboru (výchozí volba při nahrání). */
export function guessFileKind(filename: string, mime?: string): JobFileKind {
  const f = filename.toLowerCase();
  const ext = /\.([a-z0-9_]{1,12})$/.exec(f)?.[1] ?? "";
  if ((CAD_3D_EXTENSIONS as readonly string[]).includes(ext)) return "model_3d";
  if ((CAD_2D_EXTENSIONS as readonly string[]).includes(ext)) return "vykres";
  if (/\.(msg|eml)$/.test(f)) return "korespondence";
  if (/faktur|invoice/.test(f)) return "faktura";
  if (/dodac|delivery|lieferschein/.test(f)) return "dodaci_list";
  if (/potvrz|confirm/.test(f)) return "potvrzeni";
  if (/objedn|order|bestell/.test(f)) return "objednavka";
  if (/nabid|quote|angebot/.test(f)) return "nabidka";
  if (/poptav|inquiry|anfrage|rfq/.test(f)) return "poptavka";
  if (/vykres|drawing|zeichnung|vkr/.test(f)) return "vykres";
  if (mime?.startsWith("image/")) return "foto";
  return "ostatni";
}
