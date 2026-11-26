import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { getAccess } from "@/lib/auth/session";
import { getJob, listJobs, listQuotes } from "@/lib/data/jobs";
import { listThreads, getThread } from "@/lib/data/mail-threads";
import { getVisibleEmailRow } from "@/lib/data/mail";
import { getCommissions, getCustomers, getCustomerDetail, getDrawings, getSuppliers } from "@/lib/data/queries";
import { listSupplierInvoices } from "@/lib/data/supplier-invoices";
import { listIssuedInvoices } from "@/lib/data/issued-invoices";
import { assertJobFileAccess } from "@/lib/jobs/job-file-access";
import { createAdminClient, hasServiceKey } from "@/lib/supabase/server";
import { STAGES } from "@/lib/jobs/stages";
import type { JobsDb } from "@/lib/jobs/events";
import type { MailFolder } from "@/lib/email/mail-types";

/**
 * Nástroje firemního AI asistenta (majitel 26. 11.: „nemá přístup úplně do všeho … nezvládá čtení pošty,
 * dokumentů, faktur"). Každý nástroj volá STÁVAJÍCÍ datovou vrstvu přihlášeného uživatele — asistent tak
 * vidí přesně to, co uživatel v aplikaci (obchodník své zakázky, provize jen s právem, faktury podle práv).
 * Jen čtení — asistent nic nemění ani neodesílá.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Nejvýš tolik znaků výsledku nástroje (zbytek se ořízne s poznámkou). */
const MAX_RESULT = 24_000;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown, def: number, min: number, max: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const matches = (q: string, ...fields: (string | null | undefined)[]) => {
  const words = norm(q).split(/\s+/).filter(Boolean);
  const hay = norm(fields.filter(Boolean).join(" "));
  return words.every((w) => hay.includes(w));
};

export function clip(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return text.length > MAX_RESULT ? `${text.slice(0, MAX_RESULT)}\n… (oříznuto — zpřesni dotaz)` : text;
}

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "hledat_zakazky",
    description: "Hledá zakázky v Knize zakázek (číslo zakázky i jeho část, zákazník, číslo výkresu, číslo objednávky / nabídky / dokladu, materiál, poznámky, obsah příloh). Bez dotazu vrátí naposledy změněné. Vrací přehled; detail přes detail_zakazky.",
    input_schema: {
      type: "object",
      properties: {
        dotaz: { type: "string", description: "Slova k hledání, např. „026“, „Strojmetal příruba“, „VK-2291“. Prázdné = nejnovější." },
        limit: { type: "integer", description: "Kolik zakázek (1–50, výchozí 20)." },
      },
      required: [],
    },
  },
  {
    name: "detail_zakazky",
    description: "Celý detail jedné zakázky: zákazník, kontakt, termíny, stav, hodnota, položky (výkresy, počty, ceny), nabídky, dokumenty (id souborů pro precist_dokument), poznámky a historie změn.",
    input_schema: {
      type: "object",
      properties: { zakazka: { type: "string", description: "Číslo zakázky (Z-2026-025, 2026/025, 025) nebo její id." } },
      required: ["zakazka"],
    },
  },
  {
    name: "hledat_postu",
    description: "Hledá e-maily v Poště (předmět, text, odesílatel, příjemci, názvy i obsah příloh). Vrací seznam zpráv s id; celý text přes precist_email.",
    input_schema: {
      type: "object",
      properties: {
        dotaz: { type: "string", description: "Slova k hledání (firma, číslo zakázky, předmět…). Prázdné = nejnovější." },
        slozka: { type: "string", enum: ["all", "inbox", "sent", "jobs", "flagged", "spam"], description: "Složka (výchozí all)." },
        limit: { type: "integer", description: "Kolik zpráv (1–40, výchozí 15)." },
      },
      required: [],
    },
  },
  {
    name: "precist_email",
    description: "Přečte celý e-mail: odesílatel, příjemci, datum, text, celé vlákno konverzace a obsah příloh (text z PDF / co z dokumentu přečetla AI).",
    input_schema: {
      type: "object",
      properties: { email_id: { type: "string", description: "Id e-mailu z hledat_postu." } },
      required: ["email_id"],
    },
  },
  {
    name: "precist_dokument",
    description: "Přečte dokument zakázky (výkres, poptávka, objednávka, nabídka, faktura, dodací list…): co z něj vytěžila AI — čísla, položky, ceny, materiál, rozměry, termíny.",
    input_schema: {
      type: "object",
      properties: { soubor_id: { type: "string", description: "Id souboru z detail_zakazky (files[].id)." } },
      required: ["soubor_id"],
    },
  },
  {
    name: "nabidky",
    description: "Naše nabídky zákazníkům (číslo, zákazník, zakázka, stav, částka, položky).",
    input_schema: {
      type: "object",
      properties: {
        dotaz: { type: "string", description: "Číslo nabídky, zákazník, výkres…" },
        vcetne_archivu: { type: "boolean", description: "I archivované / starší verze." },
      },
      required: [],
    },
  },
  {
    name: "faktury_dodavatelu",
    description: "Přijaté faktury od dodavatelů (číslo, dodavatel, datum, částky, rozdělení na zakázky). Jen s oprávněním.",
    input_schema: {
      type: "object",
      properties: {
        dotaz: { type: "string", description: "Číslo faktury, dodavatel, zakázka…" },
        od: { type: "string", description: "Datum od RRRR-MM-DD." },
        do: { type: "string", description: "Datum do RRRR-MM-DD." },
      },
      required: [],
    },
  },
  {
    name: "faktury_vydane",
    description: "Naše vydané faktury zákazníkům za měsíc nebo rok (číslo, zákazník, zakázka, částky, splatnost, úhrada). Jen s oprávněním.",
    input_schema: {
      type: "object",
      properties: {
        rok: { type: "integer", description: "Rok, např. 2026." },
        mesic: { type: "integer", description: "Měsíc 1–12; bez něj celý rok." },
      },
      required: ["rok"],
    },
  },
  {
    name: "zakaznici",
    description: "Zákazníci (CRM): název, IČO, obchodník, počet zakázek, obrat. S id zakaznik_id vrátí detail (kontakty, historie).",
    input_schema: {
      type: "object",
      properties: {
        dotaz: { type: "string", description: "Název, IČO, město…" },
        zakaznik_id: { type: "string", description: "Id zákazníka pro detail." },
      },
      required: [],
    },
  },
  {
    name: "dodavatele",
    description: "Dodavatelé: technologie, materiály, certifikace, dodací lhůty, hodnocení, kontakty.",
    input_schema: { type: "object", properties: { dotaz: { type: "string", description: "Název, technologie, materiál…" } }, required: [] },
  },
  {
    name: "vykresy",
    description: "Archiv výkresů: číslo, revize, materiál, rozměry, počet, zákazník.",
    input_schema: { type: "object", properties: { dotaz: { type: "string", description: "Číslo výkresu, materiál, zákazník…" } }, required: [] },
  },
  {
    name: "provize",
    description: "Provize obchodníků za období (obrat, marže, provize). Jen s oprávněním.",
    input_schema: {
      type: "object",
      properties: { obdobi: { type: "string", enum: ["month", "quarter", "year"], description: "Měsíc, kvartál, rok (výchozí month)." } },
      required: [],
    },
  },
];

async function resolveJobId(ref: string): Promise<string | null> {
  if (UUID_RE.test(ref)) return ref;
  const m = /(\d{4})\D+(\d{1,5})/.exec(ref);
  const tail = m ? m[2].padStart(3, "0") : (/(\d{1,5})/.exec(ref)?.[1] ?? "").padStart(3, "0");
  const list = await listJobs({ q: ref, limit: 10, sort: "updated", dir: "desc" });
  const exact = list.find((j) => {
    const n = j.number.replace(/\D+/g, " ").trim().split(" ");
    return (m ? n[0] === m[1] : true) && n.at(-1)?.padStart(3, "0") === tail;
  });
  return (exact ?? list[0])?.id ?? null;
}

export async function runAssistantTool(name: string, input: Record<string, unknown>): Promise<string> {
  const { can } = await getAccess();
  switch (name) {
    case "hledat_zakazky": {
      const jobs = await listJobs({ q: str(input.dotaz) || undefined, limit: num(input.limit, 20, 1, 50), sort: "updated", dir: "desc" });
      if (!jobs.length) return "Nic nenalezeno.";
      return clip(jobs.map((j) => ({
        id: j.id, cislo: j.number, nazev: j.title, zakaznik: j.customer?.name ?? null, stav: STAGES[j.stage]?.label ?? j.stage,
        objednavka_zakaznika: j.customerOrderNumber, poptavka_zakaznika: j.customerInquiryNumber,
        pozadovany_termin: j.customerRequiredDate, termin: j.dueDate, hodnota: j.value, mena: j.currency,
        vykresy: j.drawingNumbers.slice(0, 10), obchodnik: j.owner?.name ?? null, poznamka: j.note ?? null, zmeneno: j.updatedAt,
      })));
    }
    case "detail_zakazky": {
      const id = await resolveJobId(str(input.zakazka));
      const job = id ? await getJob(id) : null;
      if (!job) return "Zakázka nenalezena (nebo k ní nemáš přístup).";
      return clip({
        id: job.id, cislo: job.number, nazev: job.title, stav: STAGES[job.stage]?.label ?? job.stage,
        zakaznik: job.customer?.name ?? null, kontakt: [job.customerContact, job.customerContactEmail, job.customerContactPhone].filter(Boolean).join(", ") || null,
        objednavka_zakaznika: job.customerOrderNumber, poptavka_zakaznika: job.customerInquiryNumber,
        datum_poptavky: job.inquiryDate, datum_objednavky: job.orderDate, pozadovany_termin: job.customerRequiredDate, termin: job.dueDate,
        hodnota: job.value, mena: job.currency, marze: job.margin, obchodnik: job.owner?.name ?? null, zpracovava: job.assignee?.name ?? null,
        poznamka: job.note, technologie: job.technology, faktura: job.invoiceNumber, dodaci_list: job.deliveryNoteNumber,
        polozky: job.items.map((i) => ({ vykres: i.drawingNumber, revize: i.revision, nazev: i.name, material: i.material, ks: i.quantity, jednotka: i.unit, cena_ks: i.unitPrice, nakup_ks: i.purchaseUnitPrice, poznamka: i.note })),
        nabidky: job.quotes.map((q) => ({ cislo: q.number, stav: q.status, celkem: q.total, platnost: q.validUntil, archiv: q.archived })),
        dokumenty: job.files.filter((f) => !f.archived).map((f) => ({ id: f.id, soubor: f.filename, druh: f.kind, vykres: f.drawingNumber ?? null, ai_data: f.hasAiData, nahrano: f.createdAt })),
        historie: job.events.slice(0, 40).map((e) => ({ kdy: e.createdAt, kdo: e.actor?.name ?? e.actorName ?? null, co: e.message })),
      });
    }
    case "hledat_postu": {
      if (!can("mail")) return "Nemáš přístup k Poště.";
      const folder = (["all", "inbox", "sent", "jobs", "flagged", "spam"].includes(str(input.slozka)) ? str(input.slozka) : "all") as MailFolder;
      const page = await listThreads({ folder, query: str(input.dotaz) || undefined, limit: num(input.limit, 15, 1, 40), perMessage: true });
      const items = page.items ?? [];
      if (!items.length) return "Žádný e-mail nenalezen.";
      return clip(items.map((t) => ({
        email_id: t.emailId, smer: t.direction === "in" ? "přijatý" : "odeslaný", od: `${t.from} <${t.fromEmail}>`, komu: t.toEmail ?? null,
        predmet: t.subject, kdy: t.lastAt, kategorie: t.category, nahled: t.preview, souhrn_ai: t.aiSummary ?? null,
        zakazka: t.jobNumber ?? null, zakaznik: t.customer ?? null, prilohy: t.hasAttachments,
      })));
    }
    case "precist_email": {
      const emailId = str(input.email_id);
      const found = await getVisibleEmailRow<{ thread_id: string | null }>(emailId, "thread_id");
      if (!found) return "E-mail nenalezen (nebo k němu nemáš přístup).";
      const thread = found.row.thread_id ? await getThread(found.row.thread_id) : null;
      const messages = (thread?.ok ? thread.messages ?? [] : []);
      const ids = messages.length ? messages.map((m) => m.id) : [emailId];
      const attTexts: Record<string, { soubor: string; text: string }[]> = {};
      if (hasServiceKey()) {
        const { data } = await createAdminClient().from("email_attachments")
          .select("email_id, filename, content_text, job_file:job_files!job_file_id(ai_extracted)").in("email_id", ids).limit(60);
        type Att = { email_id: string; filename: string | null; content_text: string | null; job_file: { ai_extracted: unknown } | { ai_extracted: unknown }[] | null };
        for (const a of (data ?? []) as Att[]) {
          const jf = Array.isArray(a.job_file) ? a.job_file[0] : a.job_file;
          const text = (a.content_text ?? "").trim() || (jf?.ai_extracted ? JSON.stringify(jf.ai_extracted) : "");
          (attTexts[a.email_id] ??= []).push({ soubor: a.filename ?? "příloha", text: text ? text.slice(0, 6000) : "(obsah nepřečten)" });
        }
      }
      return clip({
        predmet: thread?.subject ?? null, zakazka: thread?.jobNumber ?? null,
        zpravy: messages.map((m) => ({
          email_id: m.id, smer: m.direction === "in" ? "přijatý" : "odeslaný", od: `${m.fromName} <${m.fromEmail}>`, komu: m.toEmail, kopie: m.ccEmail || null,
          kdy: m.receivedAt, predmet: m.subject, text: m.body.slice(0, 8000), prilohy: attTexts[m.id] ?? [],
        })),
      });
    }
    case "precist_dokument": {
      const fileId = str(input.soubor_id);
      if (!hasServiceKey()) return "Dokumenty teď nejde číst (chybí servisní klíč).";
      const db = createAdminClient() as unknown as JobsDb;
      const access = await getAccess();
      const chk = await assertJobFileAccess(db, fileId, access, "view");
      if (!chk.ok) return chk.error;
      const { data } = await createAdminClient().from("job_files").select("filename, kind, title, note, ai_extracted, created_at").eq("id", fileId).maybeSingle();
      const f = data as { filename: string; kind: string; title: string | null; note: string | null; ai_extracted: unknown; created_at: string } | null;
      if (!f) return "Dokument nenalezen.";
      return clip({ soubor: f.filename, druh: f.kind, nazev: f.title, poznamka: f.note, nahrano: f.created_at, obsah: f.ai_extracted ?? "(AI dokument zatím nepřečetla)" });
    }
    case "nabidky": {
      const list = await listQuotes({ q: str(input.dotaz) || undefined, includeArchived: input.vcetne_archivu === true });
      if (!list.length) return "Žádná nabídka nenalezena.";
      return clip(list.slice(0, 40).map((q) => ({
        cislo: q.number, zakaznik: q.customer?.name ?? null, zakazka: q.job?.number ?? null, stav: q.status, celkem: q.total,
        polozky: q.items.slice(0, 8).map((i) => ({ vykres: i.drawingNumber ?? i.name, ks: i.quantity, cena_ks: i.unitPrice })),
      })));
    }
    case "faktury_dodavatelu": {
      const res = await listSupplierInvoices({ q: str(input.dotaz) || null, from: str(input.od) || null, to: str(input.do) || null });
      if (!res) return "Faktury dodavatelů nemáš oprávnění vidět.";
      if (!res.items.length) return "Žádná faktura nenalezena.";
      return clip(res.items.slice(0, 50));
    }
    case "faktury_vydane": {
      const year = num(input.rok, new Date().getFullYear(), 2000, 2100);
      const month = input.mesic === undefined || input.mesic === null ? null : num(input.mesic, 1, 1, 12);
      const res = await listIssuedInvoices(month ? { kind: "month", year, month } : { kind: "year", year });
      if (!res) return "Vydané faktury nemáš oprávnění vidět.";
      if (!res.items.length) return "Za toto období žádné vydané faktury.";
      return clip(res.items.slice(0, 80));
    }
    case "zakaznici": {
      const id = str(input.zakaznik_id);
      if (id && UUID_RE.test(id)) {
        const d = await getCustomerDetail(id);
        return d ? clip(d) : "Zákazník nenalezen.";
      }
      const q = str(input.dotaz);
      const list = (await getCustomers()).filter((c) => !q || matches(q, c.name, c.ico, c.city, c.customerNumber));
      if (!list.length) return "Žádný zákazník nenalezen.";
      return clip(list.slice(0, 40).map((c) => ({ id: c.id, cislo: c.customerNumber, nazev: c.name, ico: c.ico, mesto: c.city, zakazek: c.totalJobs, obrat: c.revenue, obchodnik: c.owner?.name ?? null })));
    }
    case "dodavatele": {
      const q = str(input.dotaz);
      const list = (await getSuppliers()).filter((s) => !q || matches(q, s.name, s.technologies.join(" "), s.materials.join(" ")));
      if (!list.length) return "Žádný dodavatel nenalezen.";
      return clip(list.slice(0, 40));
    }
    case "vykresy": {
      if (!can("drawings")) return "Archiv výkresů nemáš oprávnění vidět.";
      const q = str(input.dotaz);
      const list = (await getDrawings()).filter((d) => !q || matches(q, d.number, d.material, d.customer));
      if (!list.length) return "Žádný výkres nenalezen.";
      return clip(list.slice(0, 50));
    }
    case "provize": {
      if (!can("commissions")) return "Provize nemáš oprávnění vidět.";
      const p = ["month", "quarter", "year"].includes(str(input.obdobi)) ? (str(input.obdobi) as "month" | "quarter" | "year") : "month";
      return clip(await getCommissions(p));
    }
    default:
      return `Neznámý nástroj ${name}.`;
  }
}
