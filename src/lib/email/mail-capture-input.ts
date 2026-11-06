import { cleanMailText, isSignatureStart, itemHintsFromMail, mailOwnText, splitSentences, type MailItemHint } from "@/lib/email/job-instructions";
import { normToken } from "@/lib/email/job-match";
import { CAPTURE_BATCH_MAX_FILES, type ReviewItem } from "@/lib/jobs/capture-review";
import { JOB_FILE_MAX_BYTES } from "@/lib/jobs/file-kinds";
import { makeWarning } from "@/lib/jobs/capture-batch";
import type { BatchReviewModel, BatchWarning } from "@/lib/jobs/capture-batch-types";
import type { CaptureDocKind, ExtractedBusinessDoc, ExtractedItem, ExtractedParty } from "@/lib/jobs/capture-types";
import { emptyExtracted, emptyParty } from "@/lib/jobs/extracted-normalize";

/**
 * Pošta → „Přidat doklad (foto)" (čistá logika, testy v mail-capture-input.test.ts).
 * Majitel 3. 11.: z e-mailu s víc výkresy / objednávkou / poptávkou se při „Založit zakázku" nebo
 * „Přidat k zakázce" přílohy roztřídí STEJNOU dávkou jako focení (stejné roztřídění AI, pravidla
 * dávky, kontrola) — pošta jen dodá vstup:
 *  1. selectMailAttachments — které přílohy jdou do dávky (loga z podpisu, vizitky, S/MIME podpisy
 *     a pozvánky ne; max. 50 MB a 40 souborů),
 *  2. MailCaptureContext — odesílatel, předmět a text e-mailu jako kontext (zákazník podle odesílatele,
 *     počty kusů z textu, kontaktní osoba),
 *  3. mailTextExtractRules — TEXT E-MAILU JAKO DOKLAD DÁVKY (majitel 6. 11.): předmět + vlastní text +
 *     podpis se čtou jako obchodní doklad bez souboru (druh poptávka / objednávka, zákazník z hlavičky
 *     podpisu — název, IČO, DIČ, adresa, kontaktní osoba, pozice, telefon —, položky s počty kusů, termín,
 *     čísla). Bez AI pravidly (tady), s AI readMailText (mail-text-reader.ts) a pravidla doplní mezery.
 *     V kontrole dávky je ten doklad primární, když e-mail nemá přiložený obchodní doklad: text e-mailu
 *     je nadřazený výkresu (počet kusů, zákazník); výkres dodá číslo, revizi, název, materiál.
 *  4. applyMailContextToReview — pojistka pro starší relace bez vytěžení textu: zákazník podle
 *     odesílatele, kontaktní osoba, název zakázky z předmětu a počty kusů výkresů z textu e-mailu.
 */

/** Řádek email_attachments (bez obsahu). */
export interface MailAttachmentRow {
  id: string;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
}

export interface MailAttachmentSkip {
  id: string;
  filename: string;
  reason: string;
  /** Příloha už je u cílové zakázky uložená (stejný obsah) — dokument, který ji drží. */
  jobFileId?: string;
}

/** Menší obrázek je skoro jistě logo / ikona z podpisu (stejný práh jako kopie příloh k zakázce). */
export const MAIL_MIN_IMAGE_BYTES = 15 * 1024;
/** Obrázek s kratší delší stranou je logo / banner podpisu, ne fotka dokladu ani výkresu. */
export const MAIL_MIN_IMAGE_SIDE = 500;
/** Obrázky pojmenované jako vložené obrázky podpisu do této velikosti se přeskočí. */
const SIGNATURE_IMAGE_MAX_BYTES = 300 * 1024;
const SIGNATURE_NAME_RE = /^(image\d{3}|outlook-[a-z0-9]+|logo|signature|podpis|banner|facebook|linkedin|instagram|twitter|youtube|xing|icon|ikona)/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|bmp|webp|heic|heif|tiff?)$/i;
/** S/MIME podpis, vizitka, pozvánka do kalendáře, obálka Outlooku — žádný obsah k roztřídění. */
const NOISE_RE = /(\.(p7s|p7m|p7c|vcf|ics|asc|sig)$)|(^winmail\.dat$)|(^smime\.p7)/i;

function nameOf(r: MailAttachmentRow): string {
  return (r.filename ?? "").trim() || "priloha";
}

export function isImageAttachment(filename: string, mime: string | null | undefined): boolean {
  return (mime ?? "").toLowerCase().startsWith("image/") || IMAGE_EXT_RE.test(filename);
}

/** Obrázek z podpisu podle názvu a velikosti (před stažením). */
export function isSignatureImage(filename: string, mime: string | null | undefined, size: number | null | undefined): boolean {
  if (!isImageAttachment(filename, mime)) return false;
  const bytes = size ?? 0;
  if (bytes > 0 && bytes < MAIL_MIN_IMAGE_BYTES) return true;
  return SIGNATURE_NAME_RE.test(filename) && bytes < SIGNATURE_IMAGE_MAX_BYTES;
}

/** Obrázek z podpisu podle rozměrů (po stažení): delší strana pod 500 px. */
export function isSignatureImageSize(dims: { width: number; height: number } | null): boolean {
  return Boolean(dims && Math.max(dims.width, dims.height) < MAIL_MIN_IMAGE_SIDE);
}

/**
 * Přílohy e-mailu do dávky. Pořadí zůstává (pořadí příloh = pořadí stránek), loga a šum se přeskočí
 * s důvodem (do upozornění roztřídění).
 */
export function selectMailAttachments(rows: readonly MailAttachmentRow[], max: number = CAPTURE_BATCH_MAX_FILES): { take: MailAttachmentRow[]; skipped: MailAttachmentSkip[] } {
  const take: MailAttachmentRow[] = [];
  const skipped: MailAttachmentSkip[] = [];
  for (const r of rows) {
    const filename = nameOf(r);
    const skip = (reason: string) => skipped.push({ id: r.id, filename, reason });
    if (NOISE_RE.test(filename) || /^application\/(pkcs7-signature|x-pkcs7-signature|ms-tnef)$/i.test(r.mime_type ?? "")) skip("podpis / vizitka / pozvánka");
    else if ((r.size_bytes ?? 0) > JOB_FILE_MAX_BYTES) skip("větší než 50 MB");
    else if (isSignatureImage(filename, r.mime_type, r.size_bytes)) skip("logo / obrázek z podpisu");
    else if (take.length >= max) skip(`najednou jde roztřídit nejvýš ${max} souborů`);
    else take.push(r);
  }
  return { take, skipped };
}

// ── Kontext e-mailu ─────────────────────────────────────────
export interface MailCaptureContext {
  emailId: string;
  threadId: string | null;
  subject: string;
  fromName: string;
  fromEmail: string;
  /** Kategorie e-mailu (DB slug, např. „poptavka"). */
  category: string | null;
  /** Zákazník podle e-mailu / adresy odesílatele (CRM). */
  customerId: string | null;
  customerName: string | null;
  /** Odesílatel je dodavatel (CRM) — text e-mailu se pak nebere jako doklad zákazníka. */
  supplierId?: string | null;
  /** Text e-mailu bez citací a podpisu (max. 4000 znaků). */
  body: string;
  /** Vlastní text včetně podpisu (bez citací), max. 8000 znaků — pro AI a čtení podpisu; chybí u starších relací. */
  ownText?: string;
  /** Telefon z podpisu odesílatele ("" = není). */
  phone: string;
  /**
   * Text e-mailu vytěžený jako obchodní doklad dávky (pravidla hned při přípravě, AI při roztřídění —
   * mailTextExtractRules / readMailText). Chybí u starších relací.
   */
  extract?: MailTextExtract | null;
  /** Přílohy zkopírované do dávky (cesta v capture → příloha e-mailu, obsah) — propojení po uložení. */
  files: { attachmentId: string; path: string; sha256: string }[];
  /** Přeskočené přílohy (logo z podpisu …). */
  skipped: MailAttachmentSkip[];
}

const PHONE_RE = /(?:\+|00)?\d[\d\s/().-]{7,18}\d/g;
const PHONE_LINE_RE = /\b(tel|telefon|phone|mobil|mobile|mob|gsm|fon|handy|t|m)\b\.?\s*[:.]?\s*/i;
const NOT_PHONE_LINE_RE = /\b(fax|i[čc]o?|di[čc]|ust|vat|iban|účet|ucet|account|konto|psč|zip)\b/i;

/** Telefon z podpisu e-mailu (posledních ~20 řádků před citací): řádek s „tel / mobil" má přednost. */
export function phoneFromSignature(body: string | null | undefined): string {
  const own = mailOwnText(body).split("\n").slice(-20);
  const pick = (onlyLabelled: boolean): string => {
    for (const l of own) {
      if (onlyLabelled && !PHONE_LINE_RE.test(l)) continue;
      if (NOT_PHONE_LINE_RE.test(l)) continue;
      for (const m of l.matchAll(PHONE_RE)) {
        const digits = m[0].replace(/\D/g, "");
        if (digits.length >= 9 && digits.length <= 15) return m[0].replace(/\s+/g, " ").trim().slice(0, 60);
      }
    }
    return "";
  };
  return pick(true) || pick(false);
}

// ── Podpis e-mailu: jméno, pozice, firma, IČO / DIČ, adresa ─
export interface MailSignatureInfo {
  /** Jméno podepsané osoby ("" = nenalezeno). */
  name: string;
  position: string;
  company: string;
  ico: string;
  dic: string;
  street: string;
  city: string;
  zip: string;
  phone: string;
  email: string;
  web: string;
}

const TITLE_RE = /^(ing|bc|mgr|dr|mudr|judr|phdr|rndr|doc|prof|dipl\.?-?ing|dipl|mba|ph\.?d|csc|drsc|m\.?sc|b\.?sc|msc|bsc|dis)\.?,?$/i;
const COMPANY_SUFFIX_CI_RE = /(^|[\s,])(s\.\s?r\.\s?o\.?|a\.\s?s\.?|spol\.\s*s\s*r\.\s?o\.?|k\.\s?s\.|v\.\s?o\.\s?s\.|z\.\s?s\.|s\.\s?p\.|o\.\s?p\.\s?s\.|gmbh|ltd\.?|limited|inc\.?|llc|corp\.?|co\.|s\.a\.|sp\.\s*z\s*o\.?o\.?|b\.v\.|n\.v\.|plc)\s*$/i;
/** Krátké přípony jen velkými písmeny (AG, KG, SE…) — „as", „se" jsou běžná slova. */
const COMPANY_SUFFIX_CS_RE = /(^|[\s,])(AG|KG|SE|SA|AB|OY|AS|SRO|A\.S|S\.R\.O)\.?\s*$/;
const COMPANY_SUFFIX_RE = { test: (v: string) => COMPANY_SUFFIX_CI_RE.test(v) || COMPANY_SUFFIX_CS_RE.test(v) };
const COMPANY_WORD_RE = /\b(group|holding|industries|industrie|engineering|technik|technology|technologies|maschinen|werk|metal|steel|tool|nástroj|strojír|kovo|company|firma)\b/i;
const DEPARTMENT_RE = /\b(n[aá]kup|obchod|prodej|objedn[aá]vk|info|office|kancel[aá]ř|team|t[yý]m|sales|purchas|einkauf|verkauf|vertrieb|support|podpora|recepce|sekretari[aá]t|fakturace|[uú][čc]t[aá]rna|technolog|konstruk|v[yý]roba|logistik|expedice|sklad|marketing|servis|service|quality|kvalit|jednatel|manager|mana[zž]er|vedouc[ií]|[řr]editel|director|head of|ceo|cfo|coo|cto|asistent|assistant|referent|specialist|specialista|technik|engineer|in[zž]en[yý]r|projekt|project|koordin|koordinator|coordinator|zástupce|representative|account|key account|disponent|disponentka|mistr|plánova[čc])\b/iu;
const SIGNATURE_PHONE_HINT_RE = /\b(tel|telefon|phone|mobil|mobile|mob|gsm|fon|handy|fax|e-?mail|www|http)\b/i;
const FREE_MAIL_RE = /^(gmail|googlemail|seznam|email|centrum|volny|atlas|post|tiscali|outlook|hotmail|live|msn|yahoo|icloud|me|mac|protonmail|proton|aol|azet|zoznam|gmx|web|t-online|o2|chello|upc|quick|iol|wp|onet|interia|o2active)$/i;

function wordsOf(s: string): string[] {
  return s.replace(/[|•·]/g, " ").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

function stripTitles(words: readonly string[]): string[] {
  return words.filter((w) => !TITLE_RE.test(w.replace(/,$/, "")));
}

/** Vypadá řádek jako jméno osoby (2–4 slova s velkým písmenem, bez číslic / adresy / firmy)? */
export function looksLikePerson(text: string): boolean {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 60 || /[\d@/]/.test(raw) || /\bwww\b/i.test(raw)) return false;
  if (COMPANY_SUFFIX_RE.test(raw) || COMPANY_WORD_RE.test(raw) || DEPARTMENT_RE.test(raw)) return false;
  const words = stripTitles(wordsOf(raw)).map((w) => w.replace(/[,.]+$/, ""));
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => /^\p{Lu}[\p{L}'’-]+$/u.test(w) || /^\p{Lu}[\p{Lu}'’-]+$/u.test(w));
}

/** „Ing. Jan Novák, Ph.D." → „Ing. Jan Novák, Ph.D." (jen uklizené mezery; tituly zůstávají). */
function cleanName(s: string): string {
  return s.replace(/[|•·].*$/, "").replace(/\s+/g, " ").replace(/[,;:]+$/, "").trim().slice(0, 200);
}

/** Jméno z místní části adresy („jan.cejka@…" → „Jan Cejka"; „nakup@" → ""). */
export function nameFromLocalPart(email: string): string {
  const local = (email ?? "").trim().toLowerCase().split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => p.length < 2 || !/^[a-z]+$/.test(p))) return "";
  if (parts.some((p) => DEPARTMENT_RE.test(p))) return "";
  return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
}

/** Firma z domény odesílatele („steeling.cz" → „Steeling"; freemail → ""). */
export function companyFromDomain(email: string): string {
  const domain = (email ?? "").trim().toLowerCase().split("@")[1] ?? "";
  const labels = domain.split(".").filter(Boolean);
  if (labels.length < 2) return "";
  // „firma.co.uk", „firma.com.pl" → firma
  const second = labels.length >= 3 && /^(co|com|org|net|gov|edu)$/.test(labels[labels.length - 2]) ? labels[labels.length - 3] : labels[labels.length - 2];
  if (!second || FREE_MAIL_RE.test(second) || second.length < 2) return "";
  return second[0].toUpperCase() + second.slice(1);
}

function parseZipCity(line: string): { street: string; city: string; zip: string } | null {
  const m = /^(?:(.+?),\s*)?([Cc][Zz]\s?-?\s?)?(\d{3}\s?\d{2}|\d{4,5})\s+([\p{L}][\p{L}\s.-]{1,60})$/u.exec(line.trim());
  if (!m) return null;
  const city = m[4].replace(/\s+/g, " ").trim();
  if (/\d/.test(city) || DEPARTMENT_RE.test(city)) return null;
  return { street: (m[1] ?? "").trim(), city, zip: m[3].replace(/\s+/g, " ") };
}

function isStreetLine(line: string): boolean {
  return /^[\p{L}][\p{L}\s.'-]{1,50}\s\d{1,5}(?:[/\s-]\d{1,5}[a-z]?)?$/u.test(line.trim()) && !SIGNATURE_PHONE_HINT_RE.test(line);
}

/**
 * Podpis e-mailu → jméno, pozice, firma, IČO, DIČ, adresa, telefon, e-mail, web. Blok podpisu = řádky za
 * „S pozdravem" (a spol.); bez té značky poslední odstavec vlastního textu, má-li telefon / e-mail / firmu.
 */
export function signatureInfo(body: string | null | undefined, fromEmail = ""): MailSignatureInfo {
  const out: MailSignatureInfo = { name: "", position: "", company: "", ico: "", dic: "", street: "", city: "", zip: "", phone: "", email: "", web: "" };
  const lines = mailOwnText(body).split("\n").map((l) => l.replace(/\s+/g, " ").trim());
  let start = lines.findIndex((l) => isSignatureStart(l));
  let block: string[];
  if (start >= 0) {
    block = lines.slice(start + 1);
  } else {
    // poslední odstavec jako podpis, jen když nese stopy podpisu (telefon, e-mail, web, firma, IČO)
    const lastBlank = lines.map((l, i) => (l ? -1 : i)).filter((i) => i >= 0).pop() ?? -1;
    const tail = lines.slice(lastBlank + 1);
    const signal = tail.length <= 8 && tail.some((l) => SIGNATURE_PHONE_HINT_RE.test(l) || /@/.test(l) || COMPANY_SUFFIX_RE.test(l) || /\bI[ČC]O?\b/i.test(l));
    block = signal ? tail : [];
    start = signal ? lastBlank : -1;
  }
  block = block.filter((l) => l && !/^-{2,}$/.test(l)).slice(0, 25);
  const email = (fromEmail ?? "").trim().toLowerCase();
  let nameAt = -1;
  const used = new Set<number>();
  for (const [i, l] of block.entries()) {
    const low = l.toLowerCase();
    const ico = /\bI[ČC]O?\s*[:.]?\s*(\d[\d ]{5,10}\d)/i.exec(l);
    if (ico) { out.ico ||= ico[1].replace(/\D/g, "").slice(0, 10); used.add(i); }
    const dic = /\b(?:DI[ČC]|VAT|UID|USt-?IdNr\.?)\s*[:.]?\s*([A-Z]{2}\s?\d{8,12})/i.exec(l);
    if (dic) { out.dic ||= dic[1].replace(/\s+/g, "").toUpperCase(); used.add(i); }
    const mail = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(l);
    if (mail) { if (!out.email && (!email || mail[0].toLowerCase() === email)) out.email = mail[0].toLowerCase(); used.add(i); }
    const web = /\b(?:https?:\/\/)?(?:www\.)[\w.-]+\.[a-z]{2,}(?:\/\S*)?/i.exec(l);
    if (web) { out.web ||= web[0]; used.add(i); }
    if (!out.phone && !NOT_PHONE_LINE_RE.test(l) && (PHONE_LINE_RE.test(l) || /^[+\d(]/.test(l))) {
      for (const m of l.matchAll(PHONE_RE)) {
        const digits = m[0].replace(/\D/g, "");
        if (digits.length >= 9 && digits.length <= 15) { out.phone = m[0].replace(/\s+/g, " ").trim().slice(0, 60); used.add(i); break; }
      }
    }
    if (ico || dic || mail || web || /\b(fax)\b/i.test(low)) continue;
    const zc = parseZipCity(l);
    if (zc) { if (!out.zip) { out.zip = zc.zip; out.city = zc.city; if (zc.street && !out.street) out.street = zc.street; } used.add(i); continue; }
    if (isStreetLine(l) && !looksLikePerson(l)) { out.street ||= l; used.add(i); continue; }
    if (!out.company && (COMPANY_SUFFIX_RE.test(l) || (COMPANY_WORD_RE.test(l) && !looksLikePerson(l) && !/\d/.test(l)))) {
      out.company = l.replace(/^(firma|company)\s*[:]?\s*/i, "").trim().slice(0, 200);
      used.add(i);
      continue;
    }
    if (nameAt < 0 && !used.has(i)) {
      // „Jan Novák | Nákup", „Jan Novák, vedoucí nákupu"
      const [head, ...rest] = l.split(/\s*[|,;•·]\s*|\s+[-–]\s+/);
      if (looksLikePerson(head)) {
        out.name = cleanName(head);
        nameAt = i;
        used.add(i);
        const tail = rest.join(", ").trim();
        if (tail && tail.length <= 80 && !/\d|@/.test(tail) && !COMPANY_SUFFIX_RE.test(tail)) out.position = tail.slice(0, 120);
      }
    }
  }
  // pozice = řádek hned za jménem (bez číslic, bez firmy), jinak kterýkoli řádek s názvem funkce
  if (nameAt >= 0 && !out.position) {
    const next = block[nameAt + 1] ?? "";
    if (next && next.length <= 80 && !/\d|@/.test(next) && !COMPANY_SUFFIX_RE.test(next) && !looksLikePerson(next) && next !== out.company) out.position = next.slice(0, 120);
  }
  if (!out.position) {
    const dep = block.find((l, i) => !used.has(i) && DEPARTMENT_RE.test(l) && !/\d|@/.test(l) && l.length <= 80 && !COMPANY_SUFFIX_RE.test(l));
    if (dep) out.position = dep.slice(0, 120);
  }
  // firma bez přípony: řádek za pozicí / jménem psaný velkými písmeny nebo s firemním slovem
  if (!out.company && nameAt >= 0) {
    const cand = block.slice(nameAt + 1, nameAt + 4).find((l, k) => !used.has(nameAt + 1 + k) && l !== out.position && !/\d|@/.test(l) && l.length <= 80
      && (COMPANY_WORD_RE.test(l) || (/^[\p{Lu}\s&.,-]{4,}$/u.test(l) && !looksLikePerson(l))));
    if (cand) out.company = cand.slice(0, 200);
  }
  if (!out.phone) out.phone = phoneFromSignature(body);
  return out;
}

/**
 * Jméno odesílatele pro kontaktní osobu: podepsané jméno z podpisu, jinak zobrazované jméno v hlavičce
 * (jen když vypadá jako osoba — ne adresa, ne firma / oddělení), jinak jméno z místní části adresy.
 * Nikdy surová e-mailová adresa.
 */
export function senderNameOf(input: { fromName: string | null | undefined; fromEmail: string | null | undefined; body: string | null | undefined }, sig?: MailSignatureInfo): string {
  const email = (input.fromEmail ?? "").trim().toLowerCase();
  const s = sig ?? signatureInfo(input.body, email);
  if (s.name) return s.name;
  const display = (input.fromName ?? "").replace(/\s+/g, " ").trim();
  if (display && !display.includes("@") && display.toLowerCase() !== email) {
    const plain = display.replace(/^["']|["']$/g, "");
    if (looksLikePerson(plain)) return cleanName(plain);
    // „Novák Jan (STEELING)" / „Jan Novák - Steeling"
    const head = plain.split(/\s*[(|,;]\s*|\s+[-–]\s+/)[0];
    if (head && looksLikePerson(head)) return cleanName(head);
  }
  return nameFromLocalPart(email);
}

/** Kontext e-mailu pro roztřídění AI (jen data, krátce — šetří tokeny). */
export function mailClassifyContext(ctx: Pick<MailCaptureContext, "subject" | "fromName" | "fromEmail" | "body">): string {
  const clip = (s: string, n: number) => s.replace(/[<>]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);
  const parts = [
    `Od: ${clip([ctx.fromName, ctx.fromEmail ? `<${ctx.fromEmail}>` : ""].filter(Boolean).join(" "), 160)}`,
    `Předmět: ${clip(ctx.subject, 200)}`,
    ctx.body ? `Text:\n${clip(ctx.body, 1200)}` : "",
  ].filter(Boolean);
  return parts.join("\n");
}

/** Čistý text e-mailu do kontextu (bez citací a podpisu, max. 4000 znaků). */
export function mailBodyForContext(body: string | null | undefined): string {
  return cleanMailText(body).slice(0, 4000);
}

// ── Text e-mailu jako doklad dávky ──────────────────────────
/** Kontaktní osoba odesílatele (z podpisu / hlavičky e-mailu). */
export interface MailPerson { name: string; position: string; email: string; phone: string }

/**
 * Text e-mailu vytěžený jako obchodní doklad bez souboru: druh (co zákazník chce), zákazník z podpisu
 * (název, IČO, DIČ, adresa, e-mail, telefon, kontaktní osoba), položky z textu (čísla výkresů / názvy,
 * počty kusů, materiál, termíny, ceny), požadovaný termín, čísla objednávky / poptávky, poznámka.
 */
export interface MailTextExtract {
  /** AI text četla (false = jen pravidla). */
  aiUsed: boolean;
  doc: ExtractedBusinessDoc;
  person: MailPerson;
  /** Proč AI nečetla / selhala (jen informace do kontroly). */
  reason?: string | null;
}

/** Testovací značka fixture textu e-mailu („__mail-<jméno>" v textu) — v produkci se nepoužívá. */
export const MAIL_FAKE_TAG_RE = /__mail-([a-z0-9_-]{1,40})\b/i;

const ORDER_SUBJECT_RE = /\b(objedn[aá]vk\w*|objedn[aá]v[aá]me|bestell\w*|auftrag|purchase\s+order|\bPO\b|order)/iu;
const INQUIRY_SUBJECT_RE = /\b(popt[aá]vk\w*|popt[aá]v[aá]me|rfq|anfrage|inquiry|enquiry|request\s+for\s+quot\w*|cenov[aá]\s+nab[ií]dk\w*|nab[ií]dku|nacen\w*|quotation|quote)/iu;
const DOC_NO_TOKEN = "([A-Z]{0,4}[-/]?\\d[A-Z0-9/.\\-]{1,30})";
const ORDER_NO_RE = new RegExp(`\\b(?:objedn[aá]vk\\w*|bestellung|purchase\\s+order|order|PO)\\s*(?:[čc]\\.|[čc][ií]slo|no\\.?|nr\\.?|number|#)?\\s*:?\\s*${DOC_NO_TOKEN}`, "iu");
const INQUIRY_NO_RE = new RegExp(`\\b(?:popt[aá]vk\\w*|RFQ|anfrage|inquiry|enquiry)\\s*(?:[čc]\\.|[čc][ií]slo|no\\.?|nr\\.?|number|#)?\\s*:?\\s*${DOC_NO_TOKEN}`, "iu");
const QUOTE_NO_RE = new RegExp(`\\b(?:nab[ií]dk\\w*|angebot|quotation|quote|offer)\\s*(?:[čc]\\.|[čc][ií]slo|no\\.?|nr\\.?|number|#)?\\s*:?\\s*${DOC_NO_TOKEN}`, "iu");
const DEADLINE_RE = /\b(?:term[ií]n\w*|dod[aá]n[ií]|dodat|dodejte|nejpozd[eě]ji|do|by|until|bis|liefertermin|delivery)\b[^\d\n]{0,30}?(\d{1,2})\.\s?(\d{1,2})\.?\s?(\d{4}|\d{2})?(?![\d.])/iu;
const ISO_DEADLINE_RE = /\b(?:term[ií]n\w*|dod[aá]n[ií]|dodat|nejpozd[eě]ji|do|by|until|bis|delivery)\b[^\d\n]{0,30}?(\d{4})-(\d{2})-(\d{2})\b/iu;

/** Druh dokladu z textu e-mailu: kategorie pošty, jinak předmět / text; neurčeno = poptávka. */
export function mailDocKindOf(ctx: Pick<MailCaptureContext, "category" | "subject" | "body">): CaptureDocKind {
  const cat = (ctx.category ?? "").toLowerCase();
  if (cat === "objednavka") return "objednavka";
  if (cat === "poptavka") return "poptavka";
  if (cat === "potvrzeni_objednavky") return "potvrzeni";
  const subject = ctx.subject ?? "";
  if (ORDER_SUBJECT_RE.test(subject) && !INQUIRY_SUBJECT_RE.test(subject)) return "objednavka";
  if (INQUIRY_SUBJECT_RE.test(subject)) return "poptavka";
  const head = (ctx.body ?? "").slice(0, 600);
  if (/\b(objedn[aá]v[aá]me|objedn[aá]v[aá]m|t[ií]mto\s+objedn|bestellen\s+wir|we\s+(hereby\s+)?order|please\s+(deliver|produce))\b/iu.test(head)) return "objednavka";
  return "poptavka";
}

/** Druh dokladu dávky pro text e-mailu (zákaznická strana); null = text se jako doklad nebere. */
export function mailDocTypeOf(doc: Pick<ExtractedBusinessDoc, "docKind" | "issuer">): "poptavka_zakaznik" | "objednavka_zakaznik" | null {
  if (doc.issuer === "dodavatel" || doc.issuer === "my") return null;
  if (doc.docKind === "objednavka" || doc.docKind === "potvrzeni") return "objednavka_zakaznik";
  if (doc.docKind === "poptavka" || doc.docKind === "ostatni" || doc.docKind === "nabidka") return "poptavka_zakaznik";
  return null;
}

function isoFromParts(d: string, m: string, y: string | undefined, now: Date): string {
  const day = Number(d);
  const mon = Number(m);
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return "";
  let year = y ? Number(y) : now.getFullYear();
  if (year < 100) year += 2000;
  if (!y) {
    // bez roku: datum, které už letos minulo, znamená příští rok
    const cand = new Date(Date.UTC(year, mon - 1, day));
    if (cand.getTime() < now.getTime() - 7 * 86_400_000) year += 1;
  }
  return `${year}-${String(mon).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Požadovaný termín z textu („termín 15. 11. 2026", „dodat do 20.12.", „by 2026-12-01"). */
export function deadlineFromMailText(text: string, now: Date = new Date()): string {
  for (const s of splitSentences(text)) {
    const iso = ISO_DEADLINE_RE.exec(s);
    if (iso) return isoFromParts(iso[3], iso[2], iso[1], now);
    const m = DEADLINE_RE.exec(s);
    if (m) {
      const v = isoFromParts(m[1], m[2], m[3], now);
      if (v) return v;
    }
  }
  return "";
}

function docNumberIn(re: RegExp, ...texts: string[]): string {
  for (const t of texts) {
    const m = re.exec(t);
    if (m && /\d/.test(m[1]) && !/^\d{1,2}\.\d{1,2}\.?$/.test(m[1])) return m[1].replace(/[.,;:)]+$/, "").slice(0, 40);
  }
  return "";
}

/**
 * Text e-mailu jako doklad — PRAVIDLA (bez AI; AI výsledek se tím doplňuje). Druh podle kategorie /
 * předmětu, zákazník z podpisu (jinak firma podle domény), kontaktní osoba z podpisu (nikdy surová
 * adresa), položky = výkresy s počtem kusů v textu, termín, čísla objednávky / poptávky / naší nabídky.
 */
export function mailTextExtractRules(
  ctx: Pick<MailCaptureContext, "subject" | "fromName" | "fromEmail" | "category" | "body"> & { rawBody?: string | null },
  filenames: readonly string[] = [],
  now: Date = new Date(),
): MailTextExtract {
  const raw = ctx.rawBody ?? ctx.body;
  const email = (ctx.fromEmail ?? "").trim().toLowerCase();
  const sig = signatureInfo(raw, email);
  const name = senderNameOf({ fromName: ctx.fromName, fromEmail: email, body: raw }, sig);
  const body = cleanMailText(raw);
  const docKind = mailDocKindOf({ ...ctx, body });
  const items: ExtractedItem[] = itemHintsFromMail(body, filenames)
    .filter((h): h is MailItemHint & { quantity: number } => h.quantity !== null && h.quantity > 0)
    .map((h) => ({ drawingNumber: h.drawingNumber, revision: "", name: h.name ?? "", description: "", material: "", quantity: h.quantity, unit: "ks", unitPrice: 0, deliveryDate: "" }));
  const customer: ExtractedParty = {
    ...emptyParty(),
    name: sig.company || companyFromDomain(email),
    ico: sig.ico, dic: sig.dic, street: sig.street, city: sig.city, zip: sig.zip,
    email, phone: sig.phone, contactPerson: name,
  };
  const subject = mailSubjectTitle(ctx.subject ?? "");
  const orderNo = docKind === "objednavka" || docKind === "potvrzeni" ? docNumberIn(ORDER_NO_RE, ctx.subject ?? "", body) : "";
  const inquiryNo = docNumberIn(INQUIRY_NO_RE, ctx.subject ?? "", body);
  // kategorie pošty dodavatelské strany (nabídka dodavatele, potvrzení naší objednávky, faktura, upomínka):
  // text e-mailu není doklad zákazníka (mailDocTypeOf → null), zůstane jen kontakt odesílatele
  const supplierMail = /^(nabidka_dodavatele|potvrzeni_objednavky|faktura|upominka)$/.test((ctx.category ?? "").toLowerCase());
  const doc: ExtractedBusinessDoc = {
    ...emptyExtracted(),
    docKind,
    issuer: supplierMail ? "dodavatel" : "zakaznik",
    documentNumber: docKind === "poptavka" ? inquiryNo : orderNo,
    customer,
    customerOrderNumber: orderNo,
    customerInquiryNumber: inquiryNo,
    ourQuoteNumber: docNumberIn(QUOTE_NO_RE, ctx.subject ?? "", body),
    requiredDeliveryDate: deadlineFromMailText(body, now),
    items,
    // název zakázky bez výkresu a položek = předmět e-mailu (planNewJob bere první větu shrnutí)
    summary: subject,
    confidence: 0,
  };
  return { aiUsed: false, doc, person: { name, position: sig.position, email, phone: sig.phone } };
}

const PARTY_KEYS: (keyof ExtractedParty)[] = ["name", "ico", "dic", "street", "city", "zip", "country", "email", "phone", "contactPerson"];

/**
 * Výsledek AI doplněný pravidly (jen prázdná místa): zákazník a kontakt z podpisu, položky z textu, čísla,
 * termín. Druh od AI; „ostatni" / „vykres" od AI = druh podle pravidel (text e-mailu u „Založit zakázku"
 * je poptávka, není-li to objednávka). Vystavitel dodavatel / my zůstává (text pak není doklad zákazníka).
 */
export function mergeMailExtract(ai: { doc: ExtractedBusinessDoc; position?: string }, rules: MailTextExtract): MailTextExtract {
  const doc: ExtractedBusinessDoc = { ...ai.doc, customer: { ...ai.doc.customer }, supplier: { ...ai.doc.supplier }, items: [...ai.doc.items] };
  if (doc.docKind === "ostatni" || doc.docKind === "vykres") doc.docKind = rules.doc.docKind;
  if (doc.issuer === "neznamy") doc.issuer = "zakaznik";
  for (const k of PARTY_KEYS) if (!String(doc.customer[k] ?? "").trim() && rules.doc.customer[k]) doc.customer[k] = rules.doc.customer[k];
  // kontaktní osoba nikdy adresa; jméno z podpisu má přednost před odhadem AI, který není jméno
  if (doc.customer.contactPerson.includes("@") || !looksLikePerson(doc.customer.contactPerson)) {
    if (rules.person.name) doc.customer.contactPerson = rules.person.name;
    else if (doc.customer.contactPerson.includes("@")) doc.customer.contactPerson = "";
  }
  if (!doc.items.length) doc.items = rules.doc.items;
  else {
    // AI položka bez počtu + text má počet u téhož výkresu → doplnit
    for (const it of doc.items) {
      if (it.quantity > 0 || !it.drawingNumber) continue;
      const r = rules.doc.items.find((x) => sameNumber(x.drawingNumber, it.drawingNumber));
      if (r) it.quantity = r.quantity;
    }
  }
  for (const k of ["customerOrderNumber", "customerInquiryNumber", "ourQuoteNumber", "requiredDeliveryDate", "documentNumber"] as const) {
    if (!doc[k] && rules.doc[k]) doc[k] = rules.doc[k];
  }
  if (!doc.summary.trim()) doc.summary = rules.doc.summary;
  const person: MailPerson = {
    name: doc.customer.contactPerson || rules.person.name,
    position: (ai.position ?? "").trim().slice(0, 120) || rules.person.position,
    email: rules.person.email || doc.customer.email,
    phone: doc.customer.phone || rules.person.phone,
  };
  return { aiUsed: true, doc, person };
}

// ── Kontrola dávky ──────────────────────────────────────────
function sameNumber(a: string, b: string): boolean {
  const x = normToken(a);
  const y = normToken(b);
  return Boolean(x && y && (x === y || (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x)))));
}

/** Počty kusů z textu e-mailu (podle čísel výkresů v textu i v názvech příloh). */
export function mailItemHints(ctx: Pick<MailCaptureContext, "body">, filenames: readonly string[]): MailItemHint[] {
  return itemHintsFromMail(ctx.body, filenames).filter((h) => h.quantity !== null && h.quantity > 0);
}

/**
 * Doplní do kontroly dávky údaje z e-mailu — jen prázdná místa (doklady mají přednost):
 *  - zákazník nové zakázky bez zákazníka z dokladu = zákazník odesílatele (CRM),
 *  - kontaktní osoba nové zakázky = odesílatel (jméno, e-mail, telefon z podpisu),
 *  - název zakázky bez obchodního dokladu = předmět e-mailu,
 *  - počet kusů výkresu bez počtu = počet z textu e-mailu („4711-02 … 10 ks").
 * Mění review na místě a vrací ho.
 */
export function applyMailContextToReview(review: BatchReviewModel, ctx: MailCaptureContext, filenames: readonly string[] = []): BatchReviewModel {
  // čísla výkresů z vytěžení (AI) i z názvů příloh — počet kusů u nich v textu e-mailu
  const drawingNames = review.docs.flatMap((d) => (d.kind === "drawing" ? [d.drawing.drawingNumber, ...(d.drawing.drawingNumbers ?? [])] : d.kind === "model" ? [d.meta.drawingNumber] : []))
    .filter((n): n is string => Boolean(n && n.trim())).map((n) => `${n.trim()}.pdf`);
  const hints = mailItemHints(ctx, [...drawingNames, ...filenames]);
  const filled = new Set<string>();
  for (const g of review.initial.groups) {
    const isNew = g.job.targetKey === "new";
    const groupModel = review.groups.find((x) => x.key === g.key)?.model;
    if (isNew && g.job.customer.mode === "none" && ctx.customerId) {
      g.job.customer = { mode: "existing", id: ctx.customerId, name: ctx.customerName ?? "", reason: "odesílatel e-mailu" };
      if (groupModel) groupModel.initial = { ...groupModel.initial, customer: g.job.customer };
    }
    if (isNew) {
      const f = g.job.fields;
      const contactEmpty = !(f.customerContact ?? "").trim() && !(f.customerContactEmail ?? "").trim();
      if (contactEmpty && (ctx.fromName || ctx.fromEmail)) {
        // jméno nikdy surová adresa (starší relace měly v from_name adresu)
        const person = ctx.extract?.person.name || (ctx.fromName.includes("@") ? senderNameOf({ fromName: ctx.fromName, fromEmail: ctx.fromEmail, body: ctx.body }) : ctx.fromName);
        if (person) f.customerContact = person.slice(0, 200);
        if (ctx.fromEmail) f.customerContactEmail = ctx.fromEmail.slice(0, 200);
        if (ctx.phone && !(f.customerContactPhone ?? "").trim()) f.customerContactPhone = ctx.phone.slice(0, 60);
      }
      if (!g.jobDraftTitle.trim() && !(f.title ?? "").trim() && ctx.subject.trim()) g.jobDraftTitle = mailSubjectTitle(ctx.subject);
    }
  }
  const linked = new Set<string>();
  if (hints.length) {
    for (const d of review.docs) {
      if (d.kind !== "drawing") continue;
      const st = review.initial.docs[d.docId];
      if (!st || st.kind !== "drawing") continue;
      const numbers = [st.state.drawingNumber, d.drawing.drawingNumber, ...(d.drawing.drawingNumbers ?? [])].filter(Boolean);
      const exact = hints.find((h) => numbers.some((n) => sameNumber(n, h.drawingNumber))) ?? null;
      const hit = exact ?? (hints.length === 1 && review.docs.filter((x) => x.kind === "drawing").length === 1 ? hints[0] : null);
      if (!hit?.quantity) continue;
      let next = st.state;
      if (!next.quantity.trim()) {
        next = { ...next, quantity: String(hit.quantity) };
        d.sources = { ...(d.sources ?? {}), quantity: "z textu e-mailu" };
        filled.add(d.docId);
        // řádek položky založený z tohoto výkresu (Položky) dostane stejný počet
        const link = next.link;
        const g = review.initial.groups.find((x) => x.docIds.includes(d.docId));
        const row = link.mode === "docItem" && g ? g.job.items.find((i: ReviewItem) => i.key === link.itemKey) : null;
        if (row && !row.quantity.trim()) row.quantity = String(hit.quantity);
      }
      // e-mail výslovně jmenuje výkres s počtem kusů → nová položka (jinak by výkres zůstal bez položky)
      if (exact && next.link.mode === "none") {
        next = { ...next, link: { mode: "add" } };
        linked.add(d.docId);
      }
      if (next !== st.state) {
        st.state = next;
        d.initial = next;
      }
    }
  }
  if (filled.size || linked.size) {
    review.warnings = review.warnings.filter((w: BatchWarning) => !(
      (w.code === "drawing_quantity_missing" && w.docIds.every((id) => filled.has(id)))
      || (w.code === "unlinked_drawing" && w.docIds.every((id) => linked.has(id)))
    ));
  }
  if (ctx.skipped.length) {
    const list = ctx.skipped.slice(0, 6).map((s) => s.filename).join(", ");
    const id = `sort_uncertain:mail-skipped`;
    if (!review.warnings.some((w) => w.id === id)) {
      review.warnings.push({ ...makeWarning("sort_uncertain", "info", [], `Z e-mailu vynecháno (logo z podpisu, vizitka…): ${list}${ctx.skipped.length > 6 ? "…" : ""}`), id });
    }
  }
  return review;
}

/** Předmět e-mailu jako název zakázky (bez „RE: / FW: / Poptávka:"). */
export function mailSubjectTitle(subject: string): string {
  let s = subject.replace(/\s+/g, " ").trim();
  for (let i = 0; i < 4; i++) s = s.replace(/^(re|fw|fwd|aw|wg|odp|vs|tr)\s*:\s*/i, "");
  return s.slice(0, 300);
}

// ── Kontakt odesílatele ─────────────────────────────────────
export interface SenderContactPlan {
  /** existing = odesílatel je kontakt zákazníka, new = nový kontakt (nabídnout přidání), none = bez zákazníka / adresy. */
  status: "existing" | "new" | "none";
  /** Jméno z podpisu / hlavičky (nikdy surová adresa; "" = neznámé). */
  name: string;
  email: string;
  phone: string;
  /** Pozice a firma z podpisu ("" = neuvedeno). */
  position?: string;
  company?: string;
  contactId: string | null;
}

/** Odesílatel vůči kontaktům zákazníka (Karta zákazníka). */
export function senderContactPlan(
  sender: { name: string; email: string; phone?: string; position?: string; company?: string },
  customerId: string | null,
  contacts: readonly { id: string; name: string | null; email: string | null }[],
): SenderContactPlan {
  const email = sender.email.trim().toLowerCase();
  const base = {
    name: sender.name.trim(), email, phone: (sender.phone ?? "").trim(), contactId: null,
    ...(sender.position?.trim() ? { position: sender.position.trim() } : {}), ...(sender.company?.trim() ? { company: sender.company.trim() } : {}),
  };
  if (!customerId || !email) return { ...base, status: "none" };
  const hit = contacts.find((k) => (k.email ?? "").trim().toLowerCase() === email);
  return hit ? { ...base, status: "existing", contactId: hit.id, name: hit.name || base.name } : { ...base, status: "new" };
}
