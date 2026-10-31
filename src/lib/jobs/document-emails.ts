import { czDate, czk, leadTimeLabel } from "@/lib/pdf/types";

/**
 * Výchozí e-maily k dokladům zakázky (předmět, text, HTML verze) a kontrola adres.
 * Čistá logika bez DB — testy v document-emails.test.ts. Oslovení a tykání / vykání dodá volající
 * podle nastavení odesílatele k adresátovi (src/lib/contacts/tone.ts); bez něj „Dobrý den," a vykání.
 */

export type DocumentEmailKind = "nabidka" | "potvrzeni" | "dodaci_list" | "faktura" | "ostatni";

export const DOCUMENT_EMAIL_KINDS: DocumentEmailKind[] = ["nabidka", "potvrzeni", "dodaci_list", "faktura", "ostatni"];

export function isDocumentEmailKind(v: unknown): v is DocumentEmailKind {
  return typeof v === "string" && (DOCUMENT_EMAIL_KINDS as string[]).includes(v);
}

/** Lidský název dokladu (1. pád): „Nabídka", „Potvrzení objednávky"… */
export const DOCUMENT_KIND_LABEL: Record<DocumentEmailKind, string> = {
  nabidka: "Nabídka",
  potvrzeni: "Potvrzení objednávky",
  dodaci_list: "Dodací list",
  faktura: "Faktura",
  ostatni: "Dokument",
};

/** Do historie zakázky: „Vystavena faktura", „Odesláno potvrzení objednávky"… */
const ISSUED: Record<DocumentEmailKind, string> = {
  nabidka: "Vystavena nabídka",
  potvrzeni: "Vystaveno potvrzení objednávky",
  dodaci_list: "Vystaven dodací list",
  faktura: "Vystavena faktura",
  ostatni: "Vystaven dokument",
};

const SENT: Record<DocumentEmailKind, string> = {
  nabidka: "Odeslána nabídka",
  potvrzeni: "Odesláno potvrzení objednávky",
  dodaci_list: "Odeslán dodací list",
  faktura: "Odeslána faktura",
  ostatni: "Odeslán dokument",
};

/**
 * „Vystavena faktura FV-2026-003 (PDF) — verze 2"; potvrzení k pozdější revizi objednávky
 * „Vystaveno potvrzení objednávky POT-2026-104 k rev 2 (PDF)". Doplněk „dílčí dodávka" u faktury,
 * která stav zakázky neposunula.
 */
export function issuedEventMessage(
  kind: DocumentEmailKind, number: string, version = 1, opts: { orderRevision?: number | null; partial?: boolean } = {},
): string {
  const rev = kind === "potvrzeni" && opts.orderRevision && opts.orderRevision > 1 ? ` k rev ${opts.orderRevision}` : "";
  const partial = kind === "faktura" && opts.partial ? " · dílčí dodávka, stav zakázky zůstává" : "";
  return `${ISSUED[kind]} ${number.trim()}${rev} (PDF)${version > 1 ? ` — verze ${version}` : ""}${partial}`;
}

/** „Odeslána nabídka NAB-2026-031 na nakup@firma.cz" */
export function sentEventMessage(kind: DocumentEmailKind, number: string | null | undefined, to: string): string {
  const n = (number ?? "").trim();
  return `${SENT[kind]}${n ? ` ${n}` : ""} na ${to}`;
}

export interface DocumentEmailInput {
  kind: DocumentEmailKind;
  /** Číslo dokladu (NAB-2026-031, POT-2026-104, DL-2026-001, FV-2026-003). */
  number?: string | null;
  /** Naše číslo zakázky (Z-2026-104). */
  jobNumber?: string | null;
  jobTitle?: string | null;
  /** Číslo objednávky zákazníka a její datum. */
  customerOrderNumber?: string | null;
  customerOrderDate?: string | null;
  /** Číslo poptávky zákazníka. */
  customerInquiryNumber?: string | null;
  /** Nabídka: platnost a dodací lhůta (dny). */
  validUntil?: string | null;
  leadTimeDays?: number | null;
  /** Potvrzení: dle naší nabídky č. */
  quoteNumber?: string | null;
  /** Potvrzení / dodací list: potvrzený termín dodání. */
  deliveryDate?: string | null;
  /** Faktura: splatnost, VS a částka k úhradě (s DPH) — po odečtení záloh / plateb = zbývá uhradit. */
  dueDate?: string | null;
  variableSymbol?: string | null;
  amount?: number | null;
  /** Faktura se zálohami: celkem s DPH a uhrazeno (s DPH); bez úhrad null. */
  invoiceTotal?: number | null;
  paidAmount?: number | null;
  currency?: string | null;
  /** Název přílohy (u ostatních dokumentů). */
  filename?: string | null;
  sender: { name?: string | null; position?: string | null; phone?: string | null; email?: string | null };
  company: { name: string; web?: string | null; phone?: string | null; email?: string | null };
  /**
   * Text podpisu odesílatele (Pošta → Nastavení pošty, včetně pozdravu) — při odeslání se z něj stane
   * grafický podpis s logem. Prázdný / bez zadání = jednoduchý textový podpis z `sender` a `company`.
   */
  signatureText?: string | null;
  /**
   * Tykání / vykání odesílatele s adresátem (src/lib/contacts/tone.ts) a hotový první řádek
   * („Ahoj Pavle," / „Dobrý den, pane Nováku,"). Bez zadání = vykání a „Dobrý den,".
   */
  address?: "ty" | "vy" | null;
  salutation?: string | null;
}

function t(v?: string | null): string {
  return (v ?? "").trim();
}

function quoted(title: string): string {
  return `„${title}“`;
}

function line(label: string, value: string): string {
  return `• ${label}: ${value}`;
}

/** Předmět e-mailu k dokladu. */
export function documentEmailSubject(d: DocumentEmailInput): string {
  const number = t(d.number);
  const company = t(d.company.name);
  const po = t(d.customerOrderNumber);
  const inquiry = t(d.customerInquiryNumber);
  const title = t(d.jobTitle);
  const job = t(d.jobNumber);
  const suffix = company ? ` – ${company}` : "";

  switch (d.kind) {
    case "nabidka": {
      const head = number ? `Cenová nabídka ${number}` : "Cenová nabídka";
      return `${head}${title ? ` – ${title}` : suffix}${inquiry ? ` (Vaše poptávka č. ${inquiry})` : ""}`;
    }
    case "potvrzeni":
      return po
        ? `Potvrzení objednávky č. ${po}${suffix}`
        : `Potvrzení objednávky${number ? ` ${number}` : ""}${suffix}`;
    case "dodaci_list":
      return `Dodací list${number ? ` ${number}` : ""}${po ? ` k objednávce č. ${po}` : ""}${suffix}`;
    case "faktura":
      return `Faktura${number ? ` ${number}` : ""}${suffix}${po ? ` (objednávka č. ${po})` : ""}`;
    default:
      return job
        ? `Dokument k zakázce ${job}${title ? ` – ${title}` : ""}`
        : `Dokument${title ? ` – ${title}` : ""}${suffix}`;
  }
}

/** Podpis: jméno, funkce, firma, kontakty. */
export function documentEmailSignature(d: Pick<DocumentEmailInput, "sender" | "company">): string {
  const rows = [
    t(d.sender.name),
    t(d.sender.position),
    t(d.company.name),
    t(d.sender.phone) || t(d.company.phone) ? `tel.: ${t(d.sender.phone) || t(d.company.phone)}` : "",
    t(d.sender.email) || t(d.company.email) ? `e-mail: ${t(d.sender.email) || t(d.company.email)}` : "",
    t(d.company.web),
  ].filter(Boolean);
  return ["S pozdravem", "", ...rows].join("\n");
}

function dateText(v?: string | null): string {
  return t(v) ? czDate(t(v)) : "";
}

/** Text e-mailu (čistý text — HTML verze vzniká z něj). */
export function documentEmailBody(d: DocumentEmailInput): string {
  const number = t(d.number);
  const po = t(d.customerOrderNumber);
  const poDate = dateText(d.customerOrderDate);
  const inquiry = t(d.customerInquiryNumber);
  const title = t(d.jobTitle);
  const job = t(d.jobNumber);
  const facts: string[] = [];
  let intro: string;
  let outro: string;
  // tykání: „ti posíláme", „tvou objednávku" (bez rodu v minulém čase), vykání beze změny
  const v = (vy: string, ty: string) => (d.address === "ty" ? ty : vy);

  switch (d.kind) {
    case "nabidka": {
      intro = `${v("děkujeme za Vaši poptávku", "díky za tvou poptávku")}${inquiry ? ` č. ${inquiry}` : ""}. V příloze ${v("Vám zasíláme", "ti posíláme")} cenovou nabídku${number ? ` č. ${number}` : ""}${title ? ` na ${quoted(title)}` : ""}.`;
      if (t(d.validUntil)) facts.push(line("Platnost nabídky", `do ${dateText(d.validUntil)}`));
      if (d.leadTimeDays && d.leadTimeDays > 0) facts.push(line("Dodací lhůta", `${leadTimeLabel(d.leadTimeDays)} od potvrzení objednávky`));
      if (job) facts.push(line("Naše číslo zakázky", `${job} (${v("prosíme, uveďte ho ve Vaší objednávce", "prosím, uveď ho v objednávce")})`));
      outro = v(
        "Pokud budete mít k nabídce jakékoli dotazy nebo budete potřebovat úpravu, rádi Vám vyjdeme vstříc. Těšíme se na Vaši objednávku.",
        "Když budeš mít k nabídce dotazy nebo budeš potřebovat úpravu, dej vědět. Těšíme se na tvou objednávku.",
      );
      break;
    }
    case "potvrzeni": {
      const ref = po ? ` č. ${po}${poDate ? ` ze dne ${poDate}` : ""}` : "";
      intro = `${v("děkujeme za Vaši objednávku", "díky za tvou objednávku")}${ref}. V příloze ${v("Vám zasíláme", "ti posíláme")} její potvrzení${number ? ` č. ${number}` : ""}.`;
      if (t(d.deliveryDate)) facts.push(line("Potvrzený termín dodání", dateText(d.deliveryDate)));
      if (t(d.quoteNumber)) facts.push(line("Dle naší nabídky", t(d.quoteNumber)));
      if (job) facts.push(line("Naše číslo zakázky", job));
      outro = v(
        "O průběhu zakázky Vás budeme informovat. V případě jakýchkoli dotazů jsme Vám k dispozici.",
        "O průběhu zakázky tě budeme informovat. Když budeš cokoli potřebovat, dej vědět.",
      );
      break;
    }
    case "dodaci_list": {
      intro = `v příloze ${v("Vám zasíláme", "ti posíláme")} dodací list${number ? ` č. ${number}` : ""}${po ? ` ${v("k Vaší objednávce", "k tvé objednávce")} č. ${po}` : ""}.`;
      if (t(d.deliveryDate)) facts.push(line("Termín dodání", dateText(d.deliveryDate)));
      if (job) facts.push(line("Naše číslo zakázky", job));
      outro = v(
        "Prosíme o kontrolu dodávky. Pokud by cokoli nesouhlasilo, dejte nám prosím vědět.",
        "Prosím zkontroluj dodávku. Kdyby cokoli nesouhlasilo, dej vědět.",
      );
      break;
    }
    case "faktura": {
      intro = `v příloze ${v("Vám zasíláme", "ti posíláme")} fakturu${number ? ` č. ${number}` : ""}${po ? ` ${v("k Vaší objednávce", "k tvé objednávce")} č. ${po}` : ""}.`;
      const cur = t(d.currency) || "CZK";
      const due = d.amount !== null && d.amount !== undefined && Number.isFinite(d.amount) ? d.amount : null;
      const paid = d.paidAmount !== null && d.paidAmount !== undefined && Number.isFinite(d.paidAmount) && d.paidAmount > 0 ? d.paidAmount : null;
      let paidUp = false;
      if (paid !== null) {
        // zálohy / platby: celková částka faktury, uhrazeno a co zbývá (stejně jako PDF a QR)
        if (d.invoiceTotal !== null && d.invoiceTotal !== undefined && Number.isFinite(d.invoiceTotal)) {
          facts.push(line("Celkem s DPH", czk(d.invoiceTotal, cur)));
        }
        facts.push(line("Uhrazeno (zálohy a platby)", czk(paid, cur)));
        if (due !== null && due > 0) facts.push(line("Zbývá uhradit", czk(due, cur)));
        else {
          paidUp = true;
          facts.push(line("Zbývá uhradit", `${czk(0, cur)} — Faktura je již uhrazena, nic dalšího ${v("neplaťte", "neplať")}.`));
        }
      } else if (due !== null && due > 0) {
        facts.push(line("Částka k úhradě", czk(due, cur)));
      }
      if (t(d.dueDate) && !paidUp) facts.push(line("Datum splatnosti", dateText(d.dueDate)));
      if (t(d.variableSymbol)) facts.push(line("Variabilní symbol", t(d.variableSymbol)));
      if (job) facts.push(line("Naše číslo zakázky", job));
      outro = paidUp ? "Děkujeme za spolupráci a za úhradu." : "Děkujeme za spolupráci a za úhradu v termínu splatnosti.";
      break;
    }
    default: {
      const file = t(d.filename);
      intro = `v příloze ${v("Vám zasíláme", "ti posíláme")} dokument${file ? ` ${file}` : ""}${job ? ` k zakázce ${job}` : ""}${title ? ` (${title})` : ""}.`;
      outro = v("V případě jakýchkoli dotazů jsme Vám k dispozici.", "Když budeš mít dotazy, dej vědět.");
    }
  }

  return [
    t(d.salutation) || "Dobrý den,",
    "",
    intro,
    ...(facts.length ? ["", ...facts] : []),
    "",
    outro,
    "",
    t(d.signatureText) || documentEmailSignature(d),
  ].join("\n");
}

export function draftDocumentEmail(d: DocumentEmailInput): { subject: string; body: string } {
  return { subject: documentEmailSubject(d), body: documentEmailBody(d) };
}

// ── HTML verze ──────────────────────────────────────────────

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SAFE_COLOR = /^#[0-9a-f]{3,8}$/i;

/**
 * Jednoduchá brandovaná HTML verze textu (červený proužek, název firmy, patička).
 * Text se escapuje — uživatel ho mohl libovolně upravit.
 */
export function documentEmailHtml(
  body: string,
  opts: { companyName: string; slogan?: string | null; web?: string | null; accent?: string | null },
): string {
  const accent = opts.accent && SAFE_COLOR.test(opts.accent) ? opts.accent : "#E03930";
  const paragraphs = String(body ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 14px 0">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const name = escapeHtml(opts.companyName || "");
  const slogan = opts.slogan ? `<span style="color:#6C6D6F;font-weight:400"> — ${escapeHtml(opts.slogan)}</span>` : "";
  const web = (opts.web ?? "").trim();
  const webHref = /^https?:\/\//i.test(web) ? web : web ? `https://${web}` : "";
  const footer = web
    ? `<a href="${escapeHtml(webHref)}" style="color:#6C6D6F;text-decoration:none">${escapeHtml(web)}</a>`
    : "";

  return [
    '<!doctype html><html lang="cs"><head><meta charset="utf-8"></head>',
    '<body style="margin:0;padding:0;background:#f4f4f5">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px"><tr><td align="center">',
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#ffffff;border-radius:10px;overflow:hidden;border-top:4px solid ${accent}">`,
    `<tr><td style="padding:18px 28px 0 28px;font-family:Roboto,Arial,sans-serif;font-size:15px;font-weight:700;color:#272425">${name}${slogan}</td></tr>`,
    `<tr><td style="padding:16px 28px 8px 28px;font-family:Roboto,Arial,sans-serif;font-size:14px;line-height:1.55;color:#272425">${paragraphs}</td></tr>`,
    `<tr><td style="padding:12px 28px 18px 28px;border-top:1px solid #eeeeee;font-family:Roboto,Arial,sans-serif;font-size:12px;color:#6C6D6F">${name}${footer ? ` · ${footer}` : ""}</td></tr>`,
    "</table></td></tr></table></body></html>",
  ].join("");
}

// ── Adresy ──────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]{2,}$/;

export function isEmail(v: unknown): v is string {
  return typeof v === "string" && EMAIL_RE.test(v.trim());
}

/** První platná adresa z kandidátů (kontakt zakázky → e-mail zákazníka…). */
export function firstEmail(...candidates: (string | null | undefined)[]): string | null {
  for (const c of candidates) {
    for (const part of String(c ?? "").split(/[,;\s]+/)) {
      if (isEmail(part)) return part.trim();
    }
  }
  return null;
}

/** „a@b.cz; Jan <c@d.cz>, x" → platné a neplatné adresy (bez duplicit). */
export function parseEmailList(text: string | null | undefined): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? "").split(/[,;\n]+/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = /<([^<>]+)>\s*$/.exec(part);
    const addr = (m ? m[1] : part).trim();
    if (!isEmail(addr)) {
      invalid.push(part);
      continue;
    }
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push(addr);
  }
  return { valid, invalid };
}

// ── Faktura před vystavením (A2: „Zrušit" nic nevystaví) ─────
/** Číslo faktury se přidělí až při vystavení — v návrhu e-mailu je místo něj tato značka. */
export const INVOICE_NUMBER_PLACEHOLDER = "[číslo faktury]";
/** Variabilní symbol (číslice čísla faktury) — doplní se spolu s číslem. */
export const INVOICE_VS_PLACEHOLDER = "[variabilní symbol]";

/** Doplní přidělené číslo faktury (a variabilní symbol z jeho číslic) místo značek v návrhu e-mailu. */
export function fillInvoicePlaceholders(text: string, number: string | null | undefined): string {
  const n = (number ?? "").trim();
  if (!n) return text;
  const digits = n.replace(/\D/g, "");
  const vs = digits.length > 10 ? digits.slice(-10) : digits;
  return text.split(INVOICE_NUMBER_PLACEHOLDER).join(n).split(INVOICE_VS_PLACEHOLDER).join(vs || n);
}
