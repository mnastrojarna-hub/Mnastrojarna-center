/**
 * Dodací listy dodavatelů (majitel 19. 11.: „stejně jako faktury vydané, objednávky dodavatelům, faktury
 * dodavatelů — další záložka"). Zdroj: dokumenty zakázek druhu „dodací list", které nevystavila naše firma
 * (vyfocené / z e-mailu / nahrané) — údaje přečetla AI (číslo, datum, dodavatel, naše objednávka).
 */
import { searchNormalize } from "@/lib/jobs/mapping";
import { docNumbersEqual } from "@/lib/jobs/matching";

export type DlPeriod = { kind: "all" } | { kind: "year"; year: number } | { kind: "month"; year: number; month: number };

export interface SupplierDlRow {
  fileId: string;
  jobId: string;
  jobNumber: string;
  jobTitle: string;
  customerName: string | null;
  number: string | null;
  /** Datum dodacího listu (z dokladu), jinak den nahrání. */
  date: string;
  supplierName: string | null;
  /** Naše objednávka dodavateli (číslo z DL) a její záznam v Nákupu, když se najde. */
  purchaseOrderNumber: string | null;
  purchaseOrderId: string | null;
  filename: string;
  title: string | null;
  createdAt: string;
}

export interface RawDlFile {
  id: string; job_id: string; filename: string; title: string | null; created_at: string;
  /** Kdo doklad vystavil (my / zákazník / dodavatel) — z AI čtení nebo ručně. */
  issuer?: string | null;
  dl_no?: string | null; dl_date?: string | null; sup_name?: string | null; po_no?: string | null;
  job?: { number?: string | null; title?: string | null; customer?: { name?: string | null } | null } | null;
}
export interface RawPo { id: string; job_id: string; number: string | null; supplier?: { name?: string | null } | null }

const isoDay = (v: string | null | undefined): string | null => {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? "").trim());
  return m ? m[1] : null;
};
const clean = (v: string | null | undefined): string | null => {
  const t = String(v ?? "").trim();
  return t ? t : null;
};

/** Naše firma v názvu „dodavatele" na dokladu (= náš dodací list, ne dodavatelův). */
const OUR_NAME_RE = /m\s*n[aá]str[oó]j[aá]rn/i;

/**
 * Je to NÁŠ dodací list (majitel 26. 11.: „v Dodacích listech dodavatelů mám naše dodací listy")? Vystavili
 * jsme ho my / zákazník, jeho číslo je naše číslo DL zakázky, nebo je na něm jako dodavatel naše firma.
 * Doklad s číslem naší objednávky dodavateli je vždy dodavatelův.
 */
export function isOurDeliveryNote(f: RawDlFile, ourDlNumbers: readonly string[], pos: readonly RawPo[]): boolean {
  const poNo = clean(f.po_no);
  if (poNo && pos.some((p) => p.number && docNumbersEqual(p.number, poNo))) return false;
  if (f.issuer === "my" || f.issuer === "zakaznik") return true;
  if (f.issuer === "dodavatel") return false;
  const no = clean(f.dl_no);
  if (no && ourDlNumbers.some((n) => docNumbersEqual(n, no))) return true;
  return OUR_NAME_RE.test(searchNormalize(f.sup_name ?? "")) || OUR_NAME_RE.test(String(f.sup_name ?? ""));
}

export function toDlRows(files: RawDlFile[], pos: RawPo[], ourDlNumbers: readonly string[] = []): SupplierDlRow[] {
  return files.filter((f) => !isOurDeliveryNote(f, ourDlNumbers, pos)).map((f) => {
    const poNo = clean(f.po_no);
    const po = poNo ? pos.find((p) => p.job_id === f.job_id && p.number && docNumbersEqual(p.number, poNo))
      ?? pos.find((p) => p.number && docNumbersEqual(p.number, poNo)) ?? null : null;
    return {
      fileId: f.id, jobId: f.job_id, jobNumber: clean(f.job?.number) ?? "", jobTitle: clean(f.job?.title) ?? "",
      customerName: clean(f.job?.customer?.name), number: clean(f.dl_no),
      date: isoDay(f.dl_date) ?? isoDay(f.created_at) ?? f.created_at.slice(0, 10),
      supplierName: clean(f.sup_name) ?? clean(po?.supplier?.name), purchaseOrderNumber: po?.number ?? poNo, purchaseOrderId: po?.id ?? null,
      filename: f.filename, title: clean(f.title), createdAt: f.created_at,
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function parseDlPeriod(raw: string | null | undefined, today: string): DlPeriod {
  const s = String(raw ?? "").trim();
  if (s === "vse") return { kind: "all" };
  let m = /^(\d{4})-(\d{2})$/.exec(s);
  if (m && +m[2] >= 1 && +m[2] <= 12) return { kind: "month", year: +m[1], month: +m[2] };
  m = /^(\d{4})$/.exec(s);
  if (m) return { kind: "year", year: +m[1] };
  return { kind: "month", year: +today.slice(0, 4), month: +today.slice(5, 7) };
}

export function inPeriod(date: string, p: DlPeriod): boolean {
  if (p.kind === "all") return true;
  if (p.kind === "year") return date.startsWith(`${p.year}-`);
  return date.startsWith(`${p.year}-${String(p.month).padStart(2, "0")}-`);
}

export function periodKey(p: DlPeriod): string {
  return p.kind === "all" ? "vse" : p.kind === "year" ? String(p.year) : `${p.year}-${String(p.month).padStart(2, "0")}`;
}

/** Hledání: číslo DL, dodavatel, objednávka, zakázka, zákazník, název souboru (bez diakritiky, i bez oddělovačů). */
export function matchesDl(r: SupplierDlRow, q: string): boolean {
  const words = searchNormalize(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = searchNormalize([r.number, r.supplierName, r.purchaseOrderNumber, r.jobNumber, r.jobTitle, r.customerName, r.filename, r.title].filter(Boolean).join(" "));
  const compact = hay.replace(/[^a-z0-9]+/g, "");
  return words.every((w) => hay.includes(w) || compact.includes(w.replace(/[^a-z0-9]+/g, "")));
}
