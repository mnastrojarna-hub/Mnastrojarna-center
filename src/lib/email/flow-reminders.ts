import "server-only";
import { createAdminClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { cronActor, type ActorContext } from "@/lib/supabase/actor-headers";
import { COMPANY } from "@/lib/company";
import type { FlowProposal } from "@/lib/supabase/database.types";
import { recipientsFor, toneFor } from "@/lib/contacts/server";
import { DEFAULT_TONE, salutationFor } from "@/lib/contacts/tone";

/**
 * Plánovač toku (spouští cron s poštou): AI dělá vše, člověk jen potvrdí.
 *  • poptávka „Čeká na podklady" déle než 14 dní → NÁVRH „Stažená zákazníkem — Bez odezvy"
 *    (rozhodne obchodník jedním ťuknutím; nikdy se neuzavře sama);
 *  • nabídka „Odeslaná" bez odezvy 7 dní → připomenutí zákazníkovi do fronty ke schválení.
 * Autor: Systém (plánovač). Opakované spuštění nic nezdvojí.
 */

export const WAITING_PROPOSAL_DAYS = 14;
export const QUOTE_REMINDER_DAYS = 7;
const BATCH = 200;

export interface FlowRemindersResult {
  proposals: number;
  reminders: number;
}

const DAY_MS = 86_400_000;

/** Text připomenutí nabídky (zákazník, číslo, platnost) — upraví se ve frontě před odesláním. */
export function quoteReminderText(q: {
  number: string; customerName: string | null; contact: string | null; validUntil: string | null; sentAt: string | null;
  /** Oslovení a tykání / vykání obchodníka s adresátem (src/lib/contacts/tone.ts); bez nich vykání. */
  salutation?: string | null; address?: "ty" | "vy" | null;
}): { subject: string; body: string } {
  const greet = q.salutation?.trim() || salutationFor(DEFAULT_TONE, q.contact);
  const ty = q.address === "ty";
  const when = q.sentAt ? new Date(q.sentAt).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" }) : null;
  const valid = q.validUntil ? new Date(`${q.validUntil}T12:00:00Z`).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague" }) : null;
  const body = [
    greet,
    "",
    `${ty ? "jen připomínám" : "dovolujeme si připomenout"} naši cenovou nabídku ${q.number}${when ? ` ze dne ${when}` : ""}.`,
    valid ? `Nabídka platí do ${valid}.` : null,
    ty ? "Máš k ní dotazy nebo připomínky? Rádi ji upravíme podle tvých požadavků." : "Máte k ní dotazy nebo připomínky? Rádi ji upravíme podle Vašich požadavků.",
    "",
    "S pozdravem",
    COMPANY.name,
  ].filter((l): l is string => l !== null).join("\n");
  return { subject: `Připomenutí nabídky ${q.number} — ${COMPANY.name}`, body };
}

/** Jeden běh plánovače (best-effort; chyba jedné položky neshodí ostatní). */
export async function runFlowReminders(opts: {
  now?: Date;
  actor?: ActorContext;
  /** Jen tyto zakázky (ruční spuštění u vybraných zakázek; bez = všechny). */
  jobIds?: string[];
} = {}): Promise<FlowRemindersResult> {
  const now = opts.now ?? new Date();
  const out: FlowRemindersResult = { proposals: 0, reminders: 0 };
  if (!isSupabaseConfigured() || !hasServiceKey()) return out;
  if (opts.jobIds && !opts.jobIds.length) return out;
  const db = createAdminClient({ actor: opts.actor ?? cronActor("flow-reminders") });

  // 1) Poptávky bez podkladů 14 dní → návrh „Stažená — Bez odezvy"
  const waitBefore = new Date(now.getTime() - WAITING_PROPOSAL_DAYS * DAY_MS).toISOString();
  let wq = db.from("orders").select("id, number, waiting_since, waiting_note")
    .eq("inquiry_status", "ceka_na_podklady").lt("waiting_since", waitBefore).is("flow_proposal", null)
    .order("waiting_since", { ascending: true }).limit(BATCH);
  if (opts.jobIds) wq = wq.in("id", opts.jobIds);
  const { data: waiting } = await wq;
  for (const j of (waiting ?? []) as { id: string; number: string; waiting_since: string; waiting_note: string | null }[]) {
    const days = Math.floor((now.getTime() - Date.parse(j.waiting_since)) / DAY_MS);
    const proposal: FlowProposal = {
      phase: "inquiry", to: "stazena", reason: "bez_odezvy", kind: "ai", agent: "flow-reminders",
      label: "Poptávka stažena zákazníkem — Bez odezvy",
      note: `Čeká na podklady ${days} dní${j.waiting_note ? ` (${j.waiting_note})` : ""} — zákazník neodpověděl.`.slice(0, 500),
    };
    const { data } = await db.from("orders").update({ flow_proposal: proposal } as never)
      .eq("id", j.id).eq("inquiry_status", "ceka_na_podklady").is("flow_proposal", null).select("id");
    if ((data ?? []).length) out.proposals += 1;
  }

  // 2) Odeslané nabídky bez odezvy 7 dní → připomenutí do fronty ke schválení (jednou na odeslání)
  const sentBefore = new Date(now.getTime() - QUOTE_REMINDER_DAYS * DAY_MS).toISOString();
  const today = now.toISOString().slice(0, 10);
  // propadlé řeší „Vypršela platnost"; nejnovější odeslání první (staré nezahltí dávku)
  let qq = db.from("quotes")
    .select("id, number, job_id, sent_at, valid_until, owner_id, customer:customers!customer_id(id, name, email), job:orders!job_id(id, number, owner_id, customer_contact, customer_contact_email, customer:customers!customer_id(id, name, email))")
    .eq("state", "odeslana").eq("archived", false).lt("sent_at", sentBefore)
    .or(`valid_until.is.null,valid_until.gte.${today}`)
    .order("sent_at", { ascending: false }).limit(BATCH);
  if (opts.jobIds) qq = qq.in("job_id", opts.jobIds);
  const { data: quotes } = await qq;
  type Party = { id?: string | null; name: string | null; email: string | null };
  type Q = {
    id: string; number: string; job_id: string | null; sent_at: string | null; valid_until: string | null; owner_id: string | null;
    customer: Party | Party[] | null;
    job: { id: string; number: string; owner_id: string | null; customer_contact: string | null; customer_contact_email: string | null; customer: Party | Party[] | null } | null;
  };
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const list = (quotes ?? []) as unknown as Q[];
  // už připomenuté (po posledním odeslání) jedním dotazem, ne dotaz na každou nabídku
  const reminded = new Map<string, string>();
  for (let i = 0; i < list.length; i += 100) {      // po 100 id (délka URL)
    const { data: prev } = await db.from("approval_queue").select("quote_id, created_at").eq("type", "reminder")
      .in("quote_id", list.slice(i, i + 100).map((q) => q.id));
    for (const p of (prev ?? []) as { quote_id: string | null; created_at: string }[]) {
      if (p.quote_id && (reminded.get(p.quote_id) ?? "") < p.created_at) reminded.set(p.quote_id, p.created_at);
    }
  }
  for (const q of list) {
    if (q.valid_until && q.valid_until < today) continue;
    const last = reminded.get(q.id);
    if (last && last >= (q.sent_at ?? "1970-01-01")) continue;
    const job = one(q.job);
    const customer = one(job?.customer) ?? one(q.customer);
    // komu: kontakt zakázky → e-mail zákazníka pro nabídky → e-mail zákazníka; oslovení dle tykání obchodníka
    const pick = customer?.id
      ? await recipientsFor(db, "nabidka", { customerId: customer.id }, { email: job?.customer_contact_email, name: job?.customer_contact }).catch(() => null)
      : null;
    const target = (pick?.to[0] || job?.customer_contact_email || customer?.email || "").trim() || null;
    const ownerId = job?.owner_id ?? q.owner_id;
    const tone = target ? await toneFor(db, ownerId, [target], target === job?.customer_contact_email?.trim().toLowerCase() ? job?.customer_contact : null).catch(() => null) : null;
    const text = quoteReminderText({
      number: q.number, customerName: customer?.name ?? null, contact: job?.customer_contact ?? null, validUntil: q.valid_until, sentAt: q.sent_at,
      salutation: tone?.salutation ?? null, address: tone?.setting.address ?? null,
    });
    const days = q.sent_at ? Math.floor((now.getTime() - Date.parse(q.sent_at)) / DAY_MS) : QUOTE_REMINDER_DAYS;
    const { error } = await db.from("approval_queue").insert({
      type: "reminder",
      title: `Připomenout nabídku ${q.number}${customer?.name ? ` — ${customer.name}` : ""}`.slice(0, 120),
      summary: `Nabídka odeslaná před ${days} dny bez odezvy zákazníka${job ? ` (zakázka ${job.number})` : ""}.${target ? "" : " Doplň e-mail příjemce."}`,
      payload: { subject: text.subject, body: text.body },
      target,
      quote_id: q.id,
      order_id: job?.id ?? q.job_id,
      owner_id: job?.owner_id ?? q.owner_id,
      ai_confidence: 0.8,
    } as never);
    if (!error) out.reminders += 1;
  }
  return out;
}
