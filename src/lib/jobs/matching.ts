import type { JobStage } from "@/lib/supabase/database.types";
import type {
  CaptureAlternative, CaptureDocKind, CustomerMatchCandidate, ExtractedBusinessDoc,
  ExtractedParty, JobMatchCandidate,
} from "@/lib/jobs/capture-types";
import { CLOSED_STAGES, stageMeta, stageRank } from "@/lib/jobs/stages";

/**
 * Párování přečteného dokladu na zákazníka a zakázku (čistá logika, testovatelná).
 * Data (kandidáty) načítá datová vrstva, tady se jen počítá skóre a důvod,
 * který se ukáže uživateli („podle čísla nabídky NAB-2026-031").
 */

// ── Normalizace ─────────────────────────────────────────────

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]+/g, "").toLowerCase();
}

/** Právní formy (po odstranění interpunkce, tj. „s.r.o." = „s r o"). Delší dřív. */
const LEGAL_FORMS = [
  "spol s r o", "spol sro", "s r o", "sro", "a s", "v o s", "k s", "s p", "z s",
  "druzstvo", "gmbh co kg", "co kg", "gmbh", "ag", "ltd", "limited", "inc",
];
const LEGAL_RE = new RegExp(`(^| )(?:${LEGAL_FORMS.join("|")})(?= |$)`, "g");

/** Název firmy pro porovnání: bez diakritiky, právní formy a interpunkce. */
export function normalizeCompanyName(name: string | null | undefined): string {
  if (!name) return "";
  let s = fold(name).replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(LEGAL_RE, "$1").replace(/\s+/g, " ").trim();
  }
  return s;
}

/** Číslo dokladu pro porovnání: velká písmena, bez mezer, oddělovače - / . _ → „-". */
export function normalizeDocNumber(n: string | null | undefined): string {
  if (!n) return "";
  return fold(n)
    .toUpperCase()
    .replace(/[\s  ]+/g, "")
    .replace(/[-/._\\]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Revizní přípona „-R2" / „-REV2" / „031R2" (nabídka NAB-2026-031-R2 = táž nabídka).
 * Bez oddělovače jen hned za číslicí, ať se neusekne konec čísla typu „BR100".
 */
const REVISION_SUFFIX = /(?:-(?:REV|R)-?|(\d)(?:REV|R)-?)\d{1,3}$/;

/** Skupiny znaků: písmena a číslice zvlášť (NAB2026-031 → NAB, 2026, 031). */
function groups(n: string): string[] {
  return n.match(/[A-Z]+|\d+/g) ?? [];
}

function stripZeros(g: string): string {
  return /^\d+$/.test(g) ? g.replace(/^0+(?=\d)/, "") : g;
}

function sameGroups(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((g, i) => stripZeros(g) === stripZeros(b[i]));
}

/**
 * Jsou dvě čísla dokladů totéž? Ignoruje velikost písmen, mezery, druh oddělovače,
 * úvodní nuly číselných skupin a revizní příponu -R<n>. Toleruje i chybějící
 * písmenný prefix („2026/031" = „NAB-2026-031"), pokud zbytek je dost dlouhý.
 */
export function docNumbersEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeDocNumber(a);
  const nb = normalizeDocNumber(b);
  if (!na || !nb) return false;
  if (na === nb) return true;

  const variants = (n: string) => {
    const base = n.replace(REVISION_SUFFIX, "$1");
    return base && base !== n ? [n, base] : [n];
  };
  for (const x of variants(na)) {
    for (const y of variants(nb)) {
      if (x === y) return true;
      const gx = groups(x);
      const gy = groups(y);
      const compactX = gx.join("");
      const compactY = gy.join("");
      if (compactX.length < 3 || compactY.length < 3) continue;
      // stejné skupiny (úvodní nuly nevadí)
      if (sameGroups(gx, gy)) return true;
      // mezery uvnitř čísla („4500 123 456" = „4500123456")
      if (compactX === compactY) return true;
      // chybějící písmenný prefix na jedné straně
      const [longer, shorter] = gx.length > gy.length ? [gx, gy] : [gy, gx];
      if (
        longer.length === shorter.length + 1 && /^[A-Z]+$/.test(longer[0])
        && shorter.length >= 2 && shorter.join("").length >= 6
        && sameGroups(longer.slice(1), shorter)
      ) return true;
    }
  }
  return false;
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const t = s.replace(/ /g, "");
  for (let i = 0; i < t.length - 1; i++) {
    const bg = t.slice(i, i + 2);
    m.set(bg, (m.get(bg) ?? 0) + 1);
  }
  return m;
}

/** Podobnost názvů firem 0..1 (Diceův koeficient nad bigramy normalizovaných názvů). */
export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeCompanyName(a);
  const nb = normalizeCompanyName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let total = 0;
  for (const c of ba.values()) total += c;
  for (const c of bb.values()) total += c;
  if (total === 0) return 0;
  let common = 0;
  for (const [bg, c] of ba) common += Math.min(c, bb.get(bg) ?? 0);
  return (2 * common) / total;
}

// ── Zákazník ────────────────────────────────────────────────

/** Veřejné e-mailové domény — shoda domény u nich nic neznamená. */
export const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "seznam.cz", "email.cz", "outlook.com", "hotmail.com", "yahoo.com",
  "centrum.cz", "icloud.com", "post.cz", "volny.cz", "atlas.cz", "live.com",
]);

function emailOf(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at > 0 && at < email.length - 1 ? email.slice(at + 1) : "";
}

function digits(v: string | null | undefined): string {
  return (v ?? "").replace(/\D+/g, "");
}

function dicKey(v: string | null | undefined): string {
  return (v ?? "").replace(/[\s.\-/]+/g, "").toUpperCase();
}

export interface PartyMatch {
  id: string;
  score: number;
  reason: string;
}

/**
 * Najde zákazníka k přečtené straně dokladu. Skóre: IČO 100, DIČ 95,
 * naše číslo dodavatele u zákazníka 90, přesný název 85, přesný e-mail 80,
 * firemní e-mailová doména 70, podobný název (≥ 0,82) 60–75. Jinak null.
 * Rozdílné IČO = jiná firma → kandidát se vyřadí, i kdyby se jmenoval stejně.
 *
 * Stejně jde použít i pro dodavatele (řádky suppliers převedené na CustomerMatchCandidate).
 */
export function matchCustomer(
  party: Partial<ExtractedParty>,
  customers: CustomerMatchCandidate[],
  opts: { supplierNumberAtCustomer?: string } = {},
): PartyMatch | null {
  const ico = digits(party.ico);
  const dic = dicKey(party.dic);
  const name = normalizeCompanyName(party.name);
  const email = emailOf(party.email);
  const domain = domainOf(email);
  const supplierNo = opts.supplierNumberAtCustomer?.trim() ?? "";

  let best: PartyMatch | null = null;
  for (const c of customers) {
    const cIco = digits(c.ico);
    if (ico && cIco && ico !== cIco) continue;

    let score = 0;
    let reason = "";
    const offer = (s: number, r: string) => {
      if (s > score) { score = s; reason = r; }
    };

    if (ico && cIco && ico === cIco) offer(100, `podle IČO ${ico}`);
    if (dic && dicKey(c.dic) === dic) offer(95, `podle DIČ ${dic}`);
    if (supplierNo && c.supplierNumberAtCustomer && docNumbersEqual(supplierNo, c.supplierNumberAtCustomer)) {
      offer(90, `podle našeho čísla dodavatele u zákazníka (${supplierNo})`);
    }
    const cName = normalizeCompanyName(c.name);
    if (name && cName && name === cName) offer(85, "podle názvu firmy");
    if (email) {
      const emails = [c.email, ...(c.contactEmails ?? [])].map(emailOf).filter(Boolean);
      if (emails.includes(email)) offer(80, `podle e-mailu ${email}`);
      else if (domain && !GENERIC_EMAIL_DOMAINS.has(domain) && emails.some((e) => domainOf(e) === domain)) {
        offer(70, `podle e-mailové domény @${domain}`);
      }
    }
    if (name && cName && score < 75) {
      const sim = nameSimilarity(name, cName);
      if (sim >= 0.82) {
        offer(Math.round(60 + ((sim - 0.82) / 0.18) * 15), `podobný název firmy (${Math.round(sim * 100)} %)`);
      }
    }

    if (score > 0 && (!best || score > best.score)) best = { id: c.id, score, reason };
  }
  return best;
}

/** Obecný alias — párování strany dokladu (zákazník i dodavatel). */
export const matchParty = matchCustomer;

// ── Zakázka ─────────────────────────────────────────────────

/** Od tohoto skóre se doklad k zakázce přiřadí automaticky. */
export const MATCH_THRESHOLD = 60;
/** Od tohoto skóre se zakázka nabídne jako „možná patří k…". */
export const ALTERNATIVE_THRESHOLD = 30;

const RECENT_DAYS = 180;
const DAY_MS = 86_400_000;

/**
 * Kandidát zakázky s volitelnými údaji o dodavateli (pro doklady od dodavatele).
 * Datová vrstva je může doplnit: orders.supplier_id a orders.supplier_order_number.
 */
export interface JobMatchCandidateExt extends JobMatchCandidate {
  supplierId?: string | null;
  supplierOrderNumber?: string | null;
  /** Vyrábí se bez objednávky zákazníka (31. 10.) — objednávka stejného zákazníka k ní patří. */
  awaitingCustomerPo?: boolean;
}

export interface JobMatchOptions {
  /** Zákazník dokladu (výsledek matchCustomer), pokud je znám. */
  customerId?: string | null;
  /** Dodavatel dokladu (u dokladů od dodavatele), pokud je znám. */
  supplierId?: string | null;
  now?: Date;
}

export interface JobMatch {
  jobId: string;
  jobNumber: string;
  score: number;
  reason: string;
}

export interface JobMatchResult {
  best: JobMatch | null;
  alternatives: CaptureAlternative[];
}

/**
 * Doklad je „dodavatelský": vystavil ho dodavatel, nebo jde o naši objednávku /
 * poptávku dodavateli. Číslo objednávky odběratele je pak NAŠE objednávka u dodavatele.
 */
export function isSupplierSideDoc(doc: Pick<ExtractedBusinessDoc, "docKind" | "issuer">): boolean {
  return doc.issuer === "dodavatel"
    || (doc.issuer === "my" && (doc.docKind === "objednavka" || doc.docKind === "poptavka"));
}

/** Stavy zakázky, ke kterým doklad daného druhu typicky patří (slabé párování). */
function stageFitsDoc(kind: CaptureDocKind, stage: JobStage): boolean {
  const r = stageRank(stage);
  switch (kind) {
    case "nabidka":
    case "objednavka":
      return stage === "poptavka" || stage === "naceneni" || stage === "nabidka";
    case "potvrzeni":
    case "dodaci_list":
    case "faktura":
      return r >= stageRank("objednavka") && r <= stageRank("fakturovano");
    default:
      return false;
  }
}

/** Zakázka čeká na dodavatele (doklad od dodavatele k ní může patřit). */
function waitsForSupplier(stage: JobStage): boolean {
  const r = stageRank(stage);
  return r >= stageRank("naceneni") && r <= stageRank("dodano_k_nam");
}

function overlappingDrawings(docDrawings: string[], jobDrawings: string[]): string[] {
  const out: string[] = [];
  for (const d of docDrawings) {
    if (jobDrawings.some((j) => docNumbersEqual(d, j)) && !out.some((o) => docNumbersEqual(o, d))) out.push(d);
  }
  return out;
}

function drawingReason(prefix: string, list: string[]): string {
  return `${prefix} ${list.length > 1 ? "výkresy" : "výkres"} ${list.join(", ")}`;
}

interface Scored {
  job: JobMatchCandidateExt;
  score: number;
  reason: string;
  time: number;
}

/**
 * Najde zakázku, ke které doklad patří.
 *
 * Skóre: naše číslo zakázky 100 · naše číslo nabídky 95 · číslo objednávky zákazníka 92
 * (u dodavatelských dokladů naše objednávka u dodavatele 92) · číslo poptávky zákazníka 88 ·
 * stejný zákazník + výkres 65 (+5 za každý další, max 85) · stejný dodavatel + výkres totéž ·
 * stejný zákazník + stav sedí k dokladu + založeno do 180 dní 45 (jen nabídka, nikdy auto).
 *
 * Srážky: uzavřená zakázka (dokončeno / nerealizováno / zrušeno) −30, pokud nesedí přesné
 * číslo; naše číslo sedí, ale zakázka patří jinému zákazníkovi −40; čísla zákazníka se
 * u jiného zákazníka nepočítají vůbec.
 *
 * best = nejvyšší skóre ≥ MATCH_THRESHOLD (při shodě novější zakázka),
 * alternatives = další až 3 zakázky se skóre ≥ 30.
 */
export function matchJob(
  doc: ExtractedBusinessDoc,
  candidates: JobMatchCandidateExt[],
  opts: JobMatchOptions = {},
): JobMatchResult {
  const now = (opts.now ?? new Date()).getTime();
  const customerId = opts.customerId ?? null;
  const supplierId = opts.supplierId ?? null;
  const supplierSide = isSupplierSideDoc(doc);
  const docDrawings = doc.items.map((i) => i.drawingNumber).filter(Boolean);

  const scored: Scored[] = [];
  for (const job of candidates) {
    const time = Date.parse(job.createdAt) || 0;
    const sameCustomer = Boolean(customerId && job.customerId && job.customerId === customerId);
    const otherCustomer = Boolean(customerId && job.customerId && job.customerId !== customerId);
    const sameSupplier = Boolean(supplierId && job.supplierId && job.supplierId === supplierId);

    let score = 0;
    let reason = "";
    let exact = false;
    const offer = (s: number, r: string, isExact = false) => {
      if (s > score) { score = s; reason = r; exact = isExact; }
    };

    // Naše čísla jsou jedinečná — platí i bez zákazníka
    if (doc.ourJobNumber && docNumbersEqual(doc.ourJobNumber, job.number)) {
      offer(otherCustomer ? 60 : 100, `podle našeho čísla zakázky ${job.number}`, true);
    }
    if (doc.ourQuoteNumber) {
      const q = job.quoteNumbers.find((n) => docNumbersEqual(doc.ourQuoteNumber, n));
      if (q) offer(otherCustomer ? 55 : 95, `podle čísla nabídky ${q}`, true);
    }

    // Čísla zákazníka mají smysl jen u téhož zákazníka
    if (!otherCustomer && !supplierSide) {
      if (doc.customerOrderNumber && docNumbersEqual(doc.customerOrderNumber, job.customerOrderNumber)) {
        offer(92, `podle čísla objednávky zákazníka ${job.customerOrderNumber}`, true);
      }
      if (doc.customerInquiryNumber && docNumbersEqual(doc.customerInquiryNumber, job.customerInquiryNumber)) {
        offer(88, `podle čísla poptávky zákazníka ${job.customerInquiryNumber}`, true);
      }
    }
    if (supplierSide && doc.customerOrderNumber && job.supplierOrderNumber
      && docNumbersEqual(doc.customerOrderNumber, job.supplierOrderNumber)) {
      offer(92, `podle naší objednávky u dodavatele ${job.supplierOrderNumber}`, true);
    }

    // Výkresy
    const overlap = docDrawings.length ? overlappingDrawings(docDrawings, job.drawingNumbers) : [];
    if (overlap.length) {
      const s = Math.min(85, 65 + 5 * (overlap.length - 1));
      if (sameCustomer) offer(s, drawingReason("stejný zákazník a", overlap));
      if (supplierSide && sameSupplier) offer(s, drawingReason("stejný dodavatel a", overlap));
      // dodavatelský doklad bez známého zákazníka: jen nabídnout, nikdy auto
      if (supplierSide && !otherCustomer && waitsForSupplier(job.stage)) {
        offer(Math.min(58, 50 + 4 * (overlap.length - 1)), drawingReason("stejný", overlap) + " (zakázka čeká na dodavatele)");
      }
    }

    // Vyrábí se bez objednávky: objednávka téhož zákazníka (bez čísla u zakázky) je ta, na kterou se čeká
    if (job.awaitingCustomerPo && sameCustomer && !supplierSide && doc.docKind === "objednavka" && !job.customerOrderNumber) {
      offer(overlap.length ? 90 : 70, "zakázka se vyrábí bez objednávky — čeká právě na objednávku zákazníka");
    }

    // Slabé: stejný zákazník, stav sedí, nedávno založená
    if (sameCustomer && stageFitsDoc(doc.docKind, job.stage) && now - time <= RECENT_DAYS * DAY_MS) {
      offer(45, `stejný zákazník, zakázka ve stavu ${stageMeta(job.stage).label}`);
    }

    if (score <= 0) continue;
    if (exact && otherCustomer) reason += " — pozor, zakázka patří jinému zákazníkovi";
    if (!exact && CLOSED_STAGES.includes(job.stage)) {
      score -= 30;
      reason += ` — zakázka je uzavřená (${stageMeta(job.stage).label})`;
    }
    scored.push({ job, score, reason, time });
  }

  scored.sort((a, b) => b.score - a.score || b.time - a.time);

  const top = scored[0];
  const best = top && top.score >= MATCH_THRESHOLD
    ? { jobId: top.job.id, jobNumber: top.job.number, score: top.score, reason: top.reason }
    : null;
  const alternatives: CaptureAlternative[] = scored
    .slice(best ? 1 : 0)
    .filter((s) => s.score >= ALTERNATIVE_THRESHOLD)
    .slice(0, 3)
    .map((s) => ({
      jobId: s.job.id,
      jobNumber: s.job.number,
      title: s.job.title,
      customerName: s.job.customerName,
      score: s.score,
      reason: s.reason,
    }));
  return { best, alternatives };
}
