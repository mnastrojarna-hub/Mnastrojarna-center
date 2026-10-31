// „Zanést fakturu" (31. 10.) — kontrakt klient ↔ server a čistá pravidla (bez server-only).
// Nahrává se JEN účetní doklad: jeden soubor = jedna faktura, PDF nebo obrázek. AI přečte všechno,
// nahrávající dostane jen potvrzení s hlavičkou (dodavatel, číslo, částka, splatnost).
import type { InvoiceDocumentType } from "@/lib/supplier-invoices/types";

/** Co „Zanést fakturu" přijme (výběr souboru v prohlížeči). */
export const INVOICE_ACCEPT = "application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif";

const EXT_RE = /\.(pdf|jpe?g|png|webp|heic|heif)$/i;
const MIME_RE = /^(application\/pdf|image\/(jpeg|jpg|pjpeg|png|webp|heic|heif|heic-sequence|heif-sequence))$/i;

export const ONLY_ONE_FILE = "Zanést jde vždy jen jednu fakturu — jeden soubor (vícestránkové PDF je jedna faktura).";

/** Hláška pro soubor, který není PDF ani obrázek. */
export function rejectTypeMessage(filename: string): string {
  const name = String(filename ?? "").trim().slice(0, 80) || "soubor";
  return `„${name}" není faktura v PDF ani obrázek. Zanést jde jen samotná faktura — PDF nebo fotka (JPG, PNG, HEIC, WEBP).`;
}

/** Prohlížeč: vypadá soubor jako PDF / obrázek faktury? (Server pak ověří obsah.) */
export function isAcceptedInvoiceFile(f: { name?: string | null; type?: string | null }): boolean {
  const type = String(f.type ?? "").trim().toLowerCase();
  const name = String(f.name ?? "").trim();
  if (type && MIME_RE.test(type)) return true;
  // některé telefony posílají prázdný / obecný typ — rozhodne přípona
  if (!type || type === "application/octet-stream") return EXT_RE.test(name);
  return false;
}

/** Druh souboru podle obsahu: PDF, obrázek, HEIC (převede se na JPG), jinak null. */
export function invoiceFileKind(bytes: Uint8Array): "pdf" | "image" | "heic" | null {
  const b = bytes;
  if (!b || b.length < 4) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image";
  if (b.length >= 12 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]).toLowerCase();
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1", "heif"].includes(brand)) return "heic";
    return null;
  }
  // %PDF může předcházet pár bajtů smetí
  const head = String.fromCharCode(...Array.from(b.subarray(0, 1024)));
  return head.includes("%PDF-") ? "pdf" : null;
}

const DOC_LABEL: Record<InvoiceDocumentType, string> = {
  faktura: "faktura",
  zalohova_faktura: "zálohová faktura",
  dobropis: "dobropis",
  dodaci_list: "dodací list",
  nabidka: "nabídka",
  objednavka: "objednávka",
  potvrzeni_objednavky: "potvrzení objednávky",
  upominka: "upomínka",
  jiny: "jiný doklad (ne faktura)",
};

export function documentTypeLabel(t: InvoiceDocumentType | null | undefined): string {
  return DOC_LABEL[t ?? "faktura"] ?? DOC_LABEL.jiny;
}

/** Účetní doklad, který patří do Faktur dodavatelů (faktura, zálohová, dobropis). */
export function isInvoiceDocument(t: InvoiceDocumentType | null | undefined): boolean {
  return !t || t === "faktura" || t === "zalohova_faktura" || t === "dobropis";
}

/** Hlavička zapsané faktury pro potvrzení (vidí ji i nahrávající bez práva na Faktury dodavatelů). */
export interface RecordedInvoiceHead {
  supplierName: string | null;
  number: string | null;
  /** Celkem k úhradě (s DPH), jinak bez DPH. */
  amount: number | null;
  currency: string;
  dueDate: string | null;
  documentType: InvoiceDocumentType;
}

export type RecordInvoiceResult =
  | {
      ok: true;
      kind: "recorded";
      head: RecordedInvoiceHead;
      /** false = AI nečetla (bez klíče / chyba) — údaje doplní účetní. */
      aiFilled: boolean;
      /** Jen kdo smí Faktury dodavatelů (odkaz „Otevřít fakturu"). */
      id?: string;
    }
  | {
      ok: true;
      kind: "duplicate";
      /** Kdy a kdo ji zapsal. */
      recordedAt: string;
      recordedBy: string | null;
      head: RecordedInvoiceHead | null;
      id?: string;
    }
  | {
      ok: true;
      kind: "not_invoice";
      documentType: InvoiceDocumentType;
      /** „dodací list" */
      label: string;
      head: RecordedInvoiceHead | null;
    }
  | { ok: false; error: string };

export interface RecordFormat {
  money: (n: number, cur: string) => string;
  date: (iso: string) => string;
}

/** Jedna věta výsledku (API, hláška v Poště, čtečky obrazovky). */
export function recordResultMessage(res: RecordInvoiceResult, fmt: RecordFormat): string {
  if (!res.ok) return res.error;
  if (res.kind === "recorded") {
    if (!res.aiFilled) return "Faktura zapsána ✓ — údaje doplní účetní.";
    const parts = confirmationParts(res.head, fmt);
    return parts.length ? `Faktura zapsána ✓ — ${parts.join(", ")}` : "Faktura zapsána ✓";
  }
  if (res.kind === "duplicate") {
    const when = res.recordedAt ? fmt.date(res.recordedAt.slice(0, 10)) : "";
    const who = [when, res.recordedBy].filter(Boolean).join(", ");
    return `Tahle faktura už je zapsaná${who ? ` (${who})` : ""}.`;
  }
  return `Tohle nevypadá jako faktura — AI v dokladu vidí ${res.label}.`;
}

/** Věta potvrzení: „Faktura zapsána ✓ — Dodavatel X, č. Y, částka Z Kč, splatnost D". */
export function confirmationParts(h: RecordedInvoiceHead, fmt: RecordFormat): string[] {
  const out: string[] = [];
  if (h.supplierName) out.push(h.supplierName);
  if (h.number) out.push(`č. ${h.number}`);
  if (h.amount !== null && Number.isFinite(h.amount)) out.push(`částka ${fmt.money(h.amount, h.currency)}`);
  if (h.dueDate) out.push(`splatnost ${fmt.date(h.dueDate)}`);
  return out;
}
