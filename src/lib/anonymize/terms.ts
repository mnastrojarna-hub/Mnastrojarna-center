import "server-only";
import { COMPANY } from "@/lib/company";
import { makeTerms, makeWordTerms, type Term } from "./rules";
import type { AnonSettings } from "./settings";

/**
 * Termíny pro anonymizaci: vlastní ze Nastavení + automaticky zákazník zakázky z CRM (název celý, bez
 * právní formy, výrazná slova názvu) a `customerName` z vytěženého razítka. Kontaktní osoby, doména a
 * IČO / DIČ jen se zapnutou kategorií (výchozí jen firma). Tyto zásahy NIKDY neruší výjimky ani AI (M5).
 * Výjimky: naše firma.
 */

interface Db {
  from(t: string): {
    select(c: string): {
      eq(col: string, v: string): { maybeSingle(): PromiseLike<{ data: unknown }> } & PromiseLike<{ data: unknown[] | null }>;
    };
  };
}

const FREEMAIL = new Set(["gmail", "seznam", "email", "centrum", "outlook", "hotmail", "yahoo", "post", "volny", "atlas", "icloud", "gmx", "web", "t-online", "live", "msn", "me", "proton", "protonmail", "tiscali", "quick", "o2active", "mail"]);

function domainTerms(email: string | null | undefined, web: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of [email?.split("@")[1], web?.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0]]) {
    const d = (raw ?? "").trim().toLowerCase();
    if (!d || !d.includes(".")) continue;
    const label = d.split(".")[0];
    if (FREEMAIL.has(label)) continue;
    out.push(d);
    if (label.length >= 4) out.push(label);
  }
  return out;
}

export function ourKeepTerms(settings: AnonSettings): string[] {
  const base = COMPANY.name.replace(/\s*s\.\s?r\.\s?o\.?$/i, "").trim();
  return [...new Set([...settings.keepTerms, base, "Mnástrojárna", "Mnastrojarna", "MNástrojárna"].filter(Boolean))];
}

export interface GatheredTerms {
  terms: Term[];
  /** Čitelné termíny (jen pro prompt AI za cache bodem a hash). */
  raw: string[];
  keep: string[];
}

/** Termíny zakázky (CRM) + vlastní + customerName z razítka. */
export async function gatherTerms(db: unknown, input: { jobId: string | null; settings: AnonSettings; extracted?: Record<string, unknown> | null }): Promise<GatheredTerms> {
  const d = db as Db;
  const keep = ourKeepTerms(input.settings);
  const custom = [...input.settings.extraTerms];
  const crm: string[] = [];
  const drawing: string[] = [];
  /** Názvy firem → i jednotlivá výrazná slova („STROJMETAL" z „Strojmetal Aluminium Forging s.r.o."). */
  const crmCompanies: string[] = [];
  if (input.jobId && input.settings.includeCrmCustomer) {
    try {
      const { data: job } = await d.from("orders").select("id, customer_id, customer_contact, customer_contact_email").eq("id", input.jobId).maybeSingle();
      const j = job as { customer_id: string | null; customer_contact: string | null; customer_contact_email: string | null } | null;
      if (j?.customer_contact) crm.push(j.customer_contact);
      crm.push(...domainTerms(j?.customer_contact_email, null));
      if (j?.customer_id) {
        const { data: c } = await d.from("customers").select("name, email, website, contact_person, ico, dic").eq("id", j.customer_id).maybeSingle();
        const cu = c as { name: string | null; email: string | null; website: string | null; contact_person: string | null; ico: string | null; dic: string | null } | null;
        if (cu?.name) { crm.push(cu.name); crmCompanies.push(cu.name); }
        for (const id of [cu?.ico, cu?.dic]) if (id && id.replace(/\s+/g, "").length >= 6) crm.push(id.replace(/\s+/g, ""));
        if (cu?.contact_person) crm.push(cu.contact_person);
        crm.push(...domainTerms(cu?.email, cu?.website));
        const { data: contacts } = await d.from("customer_contacts").select("name, email").eq("customer_id", j.customer_id);
        for (const ct of ((contacts ?? []) as { name: string | null; email: string | null }[]).slice(0, 30)) {
          if (ct.name) crm.push(ct.name);
          crm.push(...domainTerms(ct.email, null));
        }
      }
    } catch {
      // CRM je bonus — bez něj zůstanou vlastní termíny a pravidla
    }
  }
  // jen kategorie zapnuté v Nastavení (výchozí: jen název firmy — „Nic víc"): kontaktní osoby jen se
  // zapnutými osobami, doména / IČO / DIČ jen se zapnutými kontakty. Název firmy zákazníka (a vlastní
  // termíny) vždy, když je zapnutá firma.
  const r = input.settings.redact;
  const persons = r.person_drawn || r.person_checked || r.person_revisions;
  const crmKept = crm.filter((t) => {
    if (crmCompanies.includes(t)) return r.company;
    if (/^[A-Z]{0,2}\d{6,}$/i.test(t) || /\./.test(t) || /^[a-z0-9-]+$/.test(t)) return r.contact; // IČO / DIČ / doména
    return persons; // kontaktní osoba
  });
  crm.splice(0, crm.length, ...crmKept);
  if (!r.company) crmCompanies.splice(0, crmCompanies.length);
  const ex = input.extracted ?? null;
  const cn = ex && typeof ex === "object" ? (ex.customerName ?? (ex.drawing as Record<string, unknown> | undefined)?.customerName) : null;
  if (r.company && typeof cn === "string" && cn.trim()) drawing.push(cn.trim());
  const terms = [
    ...makeTerms(custom, "custom", keep),
    ...makeTerms(crm, "crm", keep),
    ...makeTerms(drawing, "drawing", keep),
    ...makeWordTerms(crmCompanies, "crm", keep),
    ...makeWordTerms(drawing, "drawing", keep),
  ];
  // bez duplicit (stejný compact)
  const seen = new Set<string>();
  const uniq = terms.filter((t) => (seen.has(t.compact) ? false : (seen.add(t.compact), true)));
  return { terms: uniq, raw: uniq.map((t) => t.raw), keep };
}
