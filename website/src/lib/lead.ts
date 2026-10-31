/**
 * Poptávka z webu — validace, kvalifikace (skóre A/B/C) a formát e-mailu.
 * E-mail míří do firemní schránky, odkud ho CNC Sales OS (IMAP) automaticky převezme jako poptávku.
 */

export const BUDGETS = [
  { id: "pod-50k", label: "Méně než 50 000 Kč", points: -100 },
  { id: "50-200k", label: "50 – 200 tis. Kč", points: 15 },
  { id: "200k-1m", label: "200 tis. – 1 mil. Kč", points: 30 },
  { id: "1-5m", label: "1 – 5 mil. Kč", points: 40 },
  { id: "5m+", label: "Více než 5 mil. Kč", points: 45 },
  { id: "opakovane", label: "Opakované dodávky / rámcová smlouva", points: 40 },
  { id: "nevim", label: "Zatím nevím", points: 5 },
] as const;

export const NEEDS = [
  { id: "cnc-obrabeni", label: "CNC obrábění" },
  { id: "petiose-cnc-obrabeni", label: "5osé obrábění" },
  { id: "elektroerozivni-obrabeni", label: "Drátové řezání" },
  { id: "nahradni-dily-pro-vyrobni-linky", label: "Náhradní díly linek" },
  { id: "nastrojarstvi", label: "Nástroje / přípravky" },
  { id: "jednoucelove-stroje", label: "Jednoúčelový stroj" },
  { id: "vyroba-prototypu", label: "Prototyp" },
  { id: "programovani-a-konstrukce", label: "Konstrukce / programování" },
  { id: "konsignacni-skladovani", label: "Konsignační sklad" },
] as const;

export const DEADLINES = [
  { id: "urgent", label: "Urgentně (do 2 týdnů)" },
  { id: "1m", label: "Do 1 měsíce" },
  { id: "3m", label: "1 – 3 měsíce" },
  { id: "plan", label: "Plánovaný projekt / bez spěchu" },
] as const;

export const QUANTITIES = [
  { id: "1-5", label: "1 – 5 ks (prototyp / kusovka)" },
  { id: "6-50", label: "6 – 50 ks" },
  { id: "51-500", label: "51 – 500 ks" },
  { id: "500+", label: "500+ ks / série" },
  { id: "projekt", label: "Celý stroj / projekt" },
] as const;

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // limit těla requestu na Vercelu je 4,5 MB
export const ALLOWED_EXT = ["pdf", "step", "stp", "igs", "iges", "dxf", "dwg", "stl", "jpg", "jpeg", "png", "zip"];

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "seznam.cz", "email.cz", "post.cz", "centrum.cz", "atlas.cz", "volny.cz", "tiscali.cz",
  "quick.cz", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "gmx.com", "gmx.de", "proton.me", "protonmail.com",
]);

export type LeadInput = {
  needs: string[];
  budget: string;
  quantity: string;
  deadline: string;
  material?: string;
  description: string;
  dataLink?: string;
  ico: string;
  company: string;
  name: string;
  position?: string;
  email: string;
  phone?: string;
  gdpr: boolean;
  nda?: boolean;
  source?: string;
  cad?: string; // souhrn z 3D prohlížeče (gabarit, objem)
};

export type CompanyInfo = { ico: string; name: string; address?: string; dic?: string; legalForm?: string; selfEmployed?: boolean };

/** Kontrolní součet českého IČO (mod 11). */
export function isValidCzIco(ico: string) {
  const s = ico.replace(/\s/g, "");
  if (!/^\d{8}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) sum += Number(s[i]) * (8 - i);
  const mod = sum % 11;
  const check = mod === 0 ? 1 : mod === 1 ? 0 : 11 - mod;
  return check === Number(s[7]);
}

/** Zahraniční DIČ / VAT ID (např. DE123456789, SK2020123456). */
export function isForeignVat(v: string) {
  const s = v.replace(/[\s.-]/g, "").toUpperCase();
  return /^[A-Z]{2}[0-9A-Z]{6,13}$/.test(s) && !s.startsWith("CZ");
}

export function isFreeMail(email: string) {
  const d = email.split("@")[1]?.toLowerCase().trim();
  return !!d && FREE_MAIL.has(d);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateLead(l: LeadInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (!l.needs.length) e.needs = "Vyberte alespoň jednu oblast.";
  if (!BUDGETS.some((b) => b.id === l.budget)) e.budget = "Vyberte odhad hodnoty zakázky.";
  if (l.budget === "pod-50k") e.budget = "Zakázky pod 50 000 Kč bohužel nepřijímáme.";
  if (!l.description || l.description.trim().length < 10) e.description = "Popište prosím krátce, co potřebujete (min. 10 znaků).";
  if (l.description && l.description.length > 5000) e.description = "Popis je příliš dlouhý (max. 5 000 znaků).";
  const ico = l.ico.replace(/\s/g, "");
  if (!ico) e.ico = "Vyplňte IČO (nebo VAT ID u zahraniční firmy).";
  else if (/^\d+$/.test(ico) ? !isValidCzIco(ico) : !isForeignVat(ico)) e.ico = "Neplatné IČO / VAT ID.";
  if (!l.company || l.company.trim().length < 2) e.company = "Vyplňte název firmy.";
  if (!l.name || l.name.trim().length < 3) e.name = "Vyplňte jméno a příjmení.";
  if (!EMAIL_RE.test(l.email.trim())) e.email = "Zadejte platný e-mail.";
  if (l.phone && !/^[+\d][\d\s()-]{7,19}$/.test(l.phone.trim())) e.phone = "Neplatné telefonní číslo.";
  if (l.dataLink && !/^https?:\/\/\S+$/i.test(l.dataLink.trim())) e.dataLink = "Odkaz musí začínat http(s)://";
  if (!l.gdpr) e.gdpr = "Bez souhlasu nemůžeme poptávku zpracovat.";
  return e;
}

export type LeadScore = { score: number; grade: "A" | "B" | "C"; reasons: string[] };

export function scoreLead(l: LeadInput, opts: { company?: CompanyInfo | null; attachments: number }): LeadScore {
  const reasons: string[] = [];
  let s = 0;
  const b = BUDGETS.find((x) => x.id === l.budget);
  if (b) {
    s += b.points;
    reasons.push(`Hodnota: ${b.label}`);
  }
  if (opts.company) {
    if (opts.company.selfEmployed) {
      s += 5;
      reasons.push("ARES: fyzická osoba podnikající");
    } else {
      s += 15;
      reasons.push("ARES: ověřená právnická osoba");
    }
  } else if (isForeignVat(l.ico)) {
    s += 10;
    reasons.push("Zahraniční firma (VAT ID)");
  }
  if (isFreeMail(l.email)) {
    s -= 10;
    reasons.push("Freemail místo firemní domény");
  } else {
    s += 10;
    reasons.push("Firemní e-mail");
  }
  if (opts.attachments > 0 || l.dataLink || l.cad) {
    s += 15;
    reasons.push("Přiložená technická dokumentace");
  }
  if (l.needs.includes("jednoucelove-stroje") || l.needs.includes("konsignacni-skladovani") || l.quantity === "500+" || l.quantity === "projekt") {
    s += 10;
    reasons.push("Projekt / opakovaná výroba");
  }
  if (l.phone) s += 5;
  s = Math.max(0, Math.min(100, s));
  return { score: s, grade: s >= 65 ? "A" : s >= 40 ? "B" : "C", reasons };
}

const label = <T extends readonly { id: string; label: string }[]>(list: T, id: string) => list.find((x) => x.id === id)?.label ?? id;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function formatLeadEmail(l: LeadInput, score: LeadScore, company: CompanyInfo | null, files: { name: string; size: number }[]) {
  const subject = `Poptávka z webu [${score.grade}] – ${l.company.trim()} – ${l.needs.map((n) => label(NEEDS, n)).join(", ")}`;
  const rows: [string, string][] = [
    ["Firma", l.company],
    ["IČO / VAT", l.ico + (company ? ` (ARES: ${company.name}${company.address ? ", " + company.address : ""})` : "")],
    ["Kontakt", `${l.name}${l.position ? `, ${l.position}` : ""}`],
    ["E-mail", l.email],
    ["Telefon", l.phone || "—"],
    ["Oblast", l.needs.map((n) => label(NEEDS, n)).join(", ")],
    ["Hodnota zakázky", label(BUDGETS, l.budget)],
    ["Množství", label(QUANTITIES, l.quantity) || "—"],
    ["Termín", label(DEADLINES, l.deadline) || "—"],
    ["Materiál", l.material || "—"],
    ["Odkaz na data", l.dataLink || "—"],
    ["3D model (náhled)", l.cad || "—"],
    ["Přílohy", files.length ? files.map((f) => `${f.name} (${(f.size / 1024).toFixed(0)} kB)`).join(", ") : "—"],
    ["NDA", l.nda ? "Požaduje NDA před sdílením dat" : "Ne"],
    ["Zdroj", l.source || "web"],
  ];
  const text =
    `Nová poptávka z webu mnastrojarna.cz\n` +
    `Kvalifikace: ${score.grade} (${score.score}/100) – ${score.reasons.join("; ")}\n\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `\n\nPopis:\n${l.description}\n`;
  const gradeColor = score.grade === "A" ? "#1a7f37" : score.grade === "B" ? "#b26a00" : "#6C6D6F";
  const html = `<!doctype html><html><body style="font-family:Roboto,Arial,sans-serif;color:#272425;background:#f3f3f2;padding:24px">
<div style="max-width:640px;margin:auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e6e6e4">
<div style="background:#0f0e0e;color:#fff;padding:20px 24px"><div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#E03930">Poptávka z webu</div>
<div style="font-size:20px;font-weight:700;margin-top:6px">${esc(l.company)}</div></div>
<div style="padding:20px 24px"><p style="margin:0 0 16px"><span style="display:inline-block;background:${gradeColor};color:#fff;border-radius:999px;padding:4px 12px;font-weight:700">Lead ${score.grade} · ${score.score}/100</span>
<span style="color:#6C6D6F;font-size:13px"> ${esc(score.reasons.join(" · "))}</span></p>
<table style="width:100%;border-collapse:collapse;font-size:14px">${rows
    .map(([k, v]) => `<tr><td style="padding:6px 8px;color:#6C6D6F;white-space:nowrap;vertical-align:top;border-bottom:1px solid #f0f0f0">${esc(k)}</td><td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">${esc(v)}</td></tr>`)
    .join("")}</table>
<h3 style="margin:20px 0 8px;font-size:15px">Popis</h3><div style="white-space:pre-wrap;font-size:14px;line-height:1.5;background:#f7f7f6;border-radius:8px;padding:12px">${esc(l.description)}</div>
</div></div></body></html>`;
  return { subject, text, html };
}

export function formatConfirmationEmail(l: LeadInput, contact: { name: string; role: string; email: string; phone?: string }) {
  const subject = "Potvrzení přijetí poptávky – Mnástrojárna s.r.o.";
  const text =
    `Dobrý den,\n\nděkujeme za Vaši poptávku. Přijali jsme ji a technolog ji nyní posoudí. ` +
    `Ozveme se Vám s dalším postupem nebo cenovou nabídkou.\n\n` +
    `Souhrn: ${l.needs.map((n) => label(NEEDS, n)).join(", ")} · ${label(BUDGETS, l.budget)}\n\n` +
    `Váš kontakt: ${contact.name}, ${contact.role.toLowerCase()}\n${contact.email}${contact.phone ? `\n${contact.phone}` : ""}\n\n` +
    `S pozdravem\nMnástrojárna s.r.o. – Váš partner ve strojírenství\nwww.mnastrojarna.cz`;
  return { subject, text };
}
