import "server-only";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { getSetting } from "@/lib/settings";
import { logAudit } from "@/lib/audit";
import { sendMail, senderSignatureText, type SmtpPreference } from "@/lib/email/send";
import { logJobEvent, type JobsDb } from "@/lib/jobs/events";
import { registerJobFileCore } from "@/lib/jobs/job-files-store";
import { cleanText, isUuid, jobFilePath, one, personRef, type PersonEmbed } from "@/lib/jobs/mapping";
import {
  ourDeliveryAddressOf, parseEmailList, purchaseOrderCancelEmail, purchaseOrderChangeEmail, purchaseOrderEmail,
  purchaseOrderFileName, purchaseOrderHoldEmail, supplierNotesOfItems,
} from "@/lib/jobs/purchasing";
import type { PurchaseItem, PurchaseOrderMail, PurchaseOrderView } from "@/lib/jobs/purchasing-types";
import type { PurchaseItemRowInput } from "@/lib/jobs/purchasing";
import type { JobDetail } from "@/lib/jobs/types";
import { fetchProfileContact, fetchPurchaseOrder } from "@/lib/data/purchasing";
import { buildPurchaseOrderDoc } from "@/lib/pdf/purchase-docs";
import { renderPurchaseOrderPdf } from "@/lib/pdf/render-purchase";
import type { ActorContext } from "@/lib/supabase/actor-headers";
import { isOperationKind, type OperationKind } from "@/lib/jobs/operations";
import { operationFamily } from "@/lib/jobs/production-suggest";
import { pragueToday } from "@/lib/jobs/flow-status";
import { czDate } from "@/lib/pdf/types";
import { recipientsFor, toneFor } from "@/lib/contacts/server";

/**
 * Objednávka dodavateli — jádro PDF a odeslání bez session (sdílí akce Nákupu, předání do výroby,
 * schvalování ve frontě a automatika). Oprávnění hlídá volající. Do historie zakázky nikdy nejdou ceny.
 *  • storePurchaseOrderPdfCore — PDF „Objednávka" (firemní hlavička, položky s čísly výkresů, množství,
 *    nákupní ceny, požadovaný termín, dodací adresa, poznámka) do Dokumentů zakázky jako
 *    „objednavka_vydana" (vystavil „my"; nákupní doklad → obsah vidí jen obchodník a super admin);
 *  • sendPurchaseOrderCore — e-mail dodavateli s PDF v příloze (vystavení / změna / storno / pozastavení).
 */

const BUCKET = "job-files";

export interface DocAuthor { id: string; fullName: string }

/** Co PDF objednávky potřebuje ze zakázky (bez session — servisní klient). */
export type DocJob = Pick<JobDetail, "number" | "items" | "owner">;

type Row = Record<string, unknown>;

/** Zakázka pro PDF objednávky: číslo, položky (revize a materiál podle čísla výkresu), obchodník. */
export async function loadJobForDoc(db: JobsDb, jobId: string): Promise<DocJob | null> {
  if (!isUuid(jobId)) return null;
  const [{ data: job }, { data: items }] = await Promise.all([
    db.from("orders").select("id, number, title, owner:profiles!owner_id(id, full_name, email)").eq("id", jobId).maybeSingle(),
    db.from("order_items").select("id, drawing_number, revision, material, material_designation, name, quantity, unit").eq("order_id", jobId).order("position"),
  ]);
  const j = job as (Row & { owner?: PersonEmbed | PersonEmbed[] | null }) | null;
  if (!j) return null;
  const list = ((items ?? []) as Row[]).map((r) => ({
    id: String(r.id),
    drawingNumber: (r.drawing_number as string | null) ?? null,
    revision: (r.revision as string | null) ?? null,
    material: cleanText(r.material_designation, 200) ?? (r.material as string | null) ?? null,
  }));
  return { number: String(j.number ?? ""), items: list as unknown as DocJob["items"], owner: personRef(one(j.owner) ?? null) };
}

/** Naše dodací adresa (Nastavení → „Dodací adresa (provozovna)", jinak provozovna Mezná, jinak sídlo). */
export async function ourDeliveryAddressCore(): Promise<string> {
  await refreshCompanyFromSettings();
  return ourDeliveryAddressOf(COMPANY, await getSetting("company_delivery_address"));
}

/**
 * PDF objednávky → úložiště + Dokumenty zakázky (druh „objednavka_vydana", vystavil „my", náš doklad).
 * `replaceFileId` = nová verze existujícího PDF. `onlyIfMissing` = jen když objednávka PDF ještě nemá
 * (souběh dvou volání: vyhraje první zápis file_id, druhý svůj soubor i řádek dokumentu smaže → { skipped }).
 */
const PRICE_ROLES = new Set(["super_admin", "obchodnik"]);

/** Smí uživatel ceny a potvrzení dodavatele (role s právem „margins", aktivní)? */
export async function hasPriceRole(db: JobsDb, userId: string | null | undefined): Promise<boolean> {
  if (!isUuid(userId)) return false;
  const { data } = await db.from("profiles").select("role, active").eq("id", userId).maybeSingle();
  const p = data as { role: string | null; active: boolean | null } | null;
  return Boolean(p && p.active !== false && PRICE_ROLES.has(String(p.role)));
}

/**
 * Kdo je na PDF „Vyřizuje / Vystavil" a kam má dodavatel posílat potvrzení (s cenami): autor objednávky
 * s právem na ceny, jinak obchodník zakázky s tímto právem, jinak null = firemní kontakt. Zaměstnanec,
 * který díl předal do výroby, na objednávce nikdy není.
 */
export async function purchaseOrderContactId(db: JobsDb, po: Pick<PurchaseOrderView, "jobId" | "createdBy">): Promise<string | null> {
  const creator = po.createdBy?.id ?? null;
  if (await hasPriceRole(db, creator)) return creator;
  const { data } = await db.from("orders").select("owner_id").eq("id", po.jobId).maybeSingle();
  const owner = (data as { owner_id: string | null } | null)?.owner_id ?? null;
  return (await hasPriceRole(db, owner)) ? owner : null;
}

/** Úvod a pokyn k provedení podle druhu kroků objednávky (tepelné zpracování / povrch ≠ „výroba"). */
export function purchaseOrderKindTexts(
  kinds: OperationKind[],
  quote: { number: string | null; quoteDate: string | null } | null,
): { intro?: string; workInstruction?: string } {
  if (!kinds.length) return {};
  const fams = new Set(kinds.map(operationFamily));
  if ([...fams].some((f) => f !== "tepelne" && f !== "povrch")) return {};
  const q = quote?.number ? `na základě Vaší nabídky č. ${quote.number}${quote.quoteDate ? ` ze dne ${czDate(quote.quoteDate)}` : ""} ` : "";
  if (fams.size === 1 && fams.has("tepelne")) {
    return {
      intro: `Dobrý den, ${q}u Vás závazně objednáváme tepelné zpracování níže uvedených dílů. Prosíme o jeho provedení dle výkresové dokumentace (předepsaná tvrdost) a dodání v požadovaném termínu.`,
      workInstruction: "Tepelné zpracování proveďte dle výkresové dokumentace v uvedené revizi (tvrdost, hloubka vrstvy), odchylky předem konzultujte.",
    };
  }
  if (fams.size === 1 && fams.has("povrch")) {
    return {
      intro: `Dobrý den, ${q}u Vás závazně objednáváme povrchovou úpravu níže uvedených dílů. Prosíme o její provedení dle výkresové dokumentace a dodání v požadovaném termínu.`,
      workInstruction: "Povrchovou úpravu proveďte dle výkresové dokumentace v uvedené revizi, odchylky předem konzultujte.",
    };
  }
  return {
    intro: `Dobrý den, ${q}u Vás závazně objednáváme níže uvedené operace. Prosíme o jejich provedení dle výkresové dokumentace a dodání v požadovaném termínu.`,
    workInstruction: "Operace proveďte dle výkresové dokumentace v uvedené revizi, odchylky předem konzultujte.",
  };
}

export async function storePurchaseOrderPdfCore(
  db: JobsDb,
  author: DocAuthor,
  po: PurchaseOrderView,
  opts: { replaceFileId?: string | null; onlyIfMissing?: boolean; contactId?: string | null } = {},
): Promise<{ fileId: string } | { error: string } | { skipped: true; fileId: string | null }> {
  if (opts.onlyIfMissing && po.fileId) return { skipped: true, fileId: po.fileId };
  const job = await loadJobForDoc(db, po.jobId);
  if (!job) return { error: "Zakázka nenalezena." };
  const contactId = opts.contactId !== undefined ? opts.contactId : await purchaseOrderContactId(db, po);
  const contact = contactId ? await fetchProfileContact(db, contactId) : { name: null, email: null, phone: null };
  const [{ data: opRows }, { data: poRow }] = await Promise.all([
    db.from("job_operations").select("kind, status").eq("purchase_order_id", po.id),
    db.from("purchase_orders").select("revision").eq("id", po.id).maybeSingle(),
  ]);
  const kinds = ((opRows ?? []) as { kind: string; status: string }[])
    .filter((o) => o.status !== "preskoceno" && isOperationKind(o.kind)).map((o) => o.kind as OperationKind);
  const revision = Number((poRow as { revision?: number | null } | null)?.revision ?? 1) || 1;
  const data = await buildPurchaseOrderDoc(job, po, po.supplier, {
    // bez kontaktu s právem na ceny = firma (nikdy autor bez práva — zaměstnanec)
    preparedBy: contactId ? contact.name ?? author.fullName : "Obchodní oddělení",
    contactEmail: contact.email,
    contactPhone: contact.phone,
    ...purchaseOrderKindTexts(kinds, po.supplierQuote),
    ...(revision > 1 ? { revision, revisionDate: pragueToday() } : {}),
  });
  const buffer = await renderPurchaseOrderPdf(data);
  const filename = purchaseOrderFileName(po.number);
  const path = jobFilePath(po.jobId, crypto.randomUUID(), filename);
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: "application/pdf", upsert: false });
  if (upErr) return { error: `Uložení PDF selhalo: ${upErr.message}` };

  const reg = await registerJobFileCore(db, author.id, {
    jobId: po.jobId,
    path,
    filename,
    mimeType: "application/pdf",
    size: buffer.length,
    kind: "objednavka_vydana",
    title: `Objednávka ${po.number}${po.supplier ? ` — ${po.supplier.name}` : ""}`,
    replaceFileId: opts.replaceFileId ?? undefined,
    origin: "generated",
    issuer: "my",
    // souběh: samostatný řádek (bez automatické verze podle názvu) — prohraný se smaže beze stopy
    ...(opts.onlyIfMissing ? { noAutoVersion: true, silent: true } : {}),
  });
  if (!reg.ok || !reg.file) {
    await db.storage.from(BUCKET).remove([path]);
    return { error: reg.error ?? "PDF se nepodařilo zařadit do dokumentů." };
  }
  const fileId = reg.file.id;
  let upd = db.from("purchase_orders").update({ file_id: fileId } as never).eq("id", po.id);
  if (opts.onlyIfMissing) upd = upd.is("file_id", null);
  const { data: won, error } = await upd.select("id");
  if (error) return { error: error.message };
  if (opts.onlyIfMissing && !((won ?? []) as unknown[]).length) {
    await db.from("job_files").delete().eq("id", fileId);
    await db.storage.from(BUCKET).remove([path]);
    const { data: cur } = await db.from("purchase_orders").select("file_id").eq("id", po.id).maybeSingle();
    return { skipped: true, fileId: ((cur as { file_id: string | null } | null)?.file_id) ?? null };
  }
  return { fileId };
}

/**
 * Položky z formuláře u odeslané objednávky: jen když jde o tytéž položky (číslo výkresu, název, materiál,
 * množství, MJ, poznámka v tomtéž pořadí) a liší se nanejvýš cena → změny cen; jinak null (položky nelze měnit).
 */
export function purchasePriceOnlyChanges(
  current: Pick<PurchaseItem, "id" | "drawingNumber" | "name" | "material" | "quantity" | "unit" | "note">[],
  rows: Pick<PurchaseItemRowInput, "drawing_number" | "name" | "material" | "quantity" | "unit" | "note" | "unit_price">[],
): { itemId: string; unitPrice: number | null }[] | null {
  if (current.length !== rows.length || current.some((it) => !it.id)) return null;
  const t = (v: string | null | undefined) => (v ?? "").trim();
  const out: { itemId: string; unitPrice: number | null }[] = [];
  for (let i = 0; i < rows.length; i++) {
    const a = current[i];
    const b = rows[i];
    if (t(a.drawingNumber) !== t(b.drawing_number) || t(a.name) !== t(b.name) || t(a.material) !== t(b.material)
        || Math.abs(a.quantity - b.quantity) > 1e-9 || (t(a.unit) || "ks") !== (t(b.unit) || "ks") || t(a.note) !== t(b.note)) return null;
    out.push({ itemId: a.id as string, unitPrice: b.unit_price });
  }
  return out;
}

export type PoMailKind = "issue" | "change" | "cancel" | "hold";

/** Návrh e-mailu dodavateli s podpisem skutečného odesílatele (jméno, telefon, e-mail z profilu). */
export async function purchaseOrderMailFor(
  db: JobsDb,
  po: Pick<PurchaseOrderView, "number" | "supplierQuote" | "requiredDate" | "confirmedDate" | "supplier"> & {
    revision?: number | null;
    /** Položky (poznámky pro dodavatele → souhrn v e-mailu). */
    items?: Pick<PurchaseOrderView["items"][number], "drawingNumber" | "name" | "note">[];
  },
  signerId: string | null,
  kind: PoMailKind = "issue",
  extra: { previousRequiredDate?: string | null; reason?: string | null; fallbackName?: string | null; fallbackEmail?: string | null } = {},
): Promise<PurchaseOrderMail & { attachmentName: string; recipientReason: string }> {
  await refreshCompanyFromSettings();
  const [me, signatureText, pick] = await Promise.all([
    signerId ? fetchProfileContact(db, signerId) : Promise.resolve({ name: null, email: null, phone: null }),
    // podpis podepisujícího z Nastavení pošty (při odeslání z jeho schránky → grafický s logem)
    senderSignatureText(signerId, { ownerId: signerId ?? "" }),
    // dodavatel → e-mail pro objednávky (karta dodavatele → E-maily podle účelu), jinak e-mail firmy / kontakt
    recipientsFor(db, "objednavka_dodavateli", { supplierId: po.supplier?.id ?? null }).catch(() => null),
  ]);
  const to = pick?.to[0] ?? po.supplier?.email ?? "";
  // tykání / vykání podepisujícího s dodavatelem
  const tone = to ? await toneFor(db, signerId, [to]).catch(() => null) : null;
  const sender = {
    number: po.number,
    companyName: COMPANY.name,
    senderName: me.name ?? extra.fallbackName ?? null,
    senderEmail: me.email ?? extra.fallbackEmail ?? null,
    senderPhone: me.phone ?? COMPANY.phone,
    companyWeb: COMPANY.web,
    signatureText,
    address: tone?.setting.address ?? null,
    salutation: tone?.salutation ?? null,
  };
  const mail = kind === "change"
    ? purchaseOrderChangeEmail({ ...sender, revision: Math.max(2, po.revision ?? 2), requiredDate: po.requiredDate, previousRequiredDate: extra.previousRequiredDate, reason: extra.reason })
    : kind === "cancel"
      ? purchaseOrderCancelEmail({ ...sender, reason: extra.reason })
      : kind === "hold"
        ? purchaseOrderHoldEmail({ ...sender, reason: extra.reason })
        : purchaseOrderEmail({
          ...sender, supplierQuoteNumber: po.supplierQuote?.number, requiredDate: po.confirmedDate ?? po.requiredDate, drawingsSeparately: !po.supplierQuote,
          itemNotes: supplierNotesOfItems(po.items ?? []),
        });
  return {
    to, ...(pick?.cc.length ? { cc: pick.cc.join(", ") } : {}), ...mail,
    attachmentName: purchaseOrderFileName(po.number), recipientReason: pick?.to.length ? pick.reason : to ? "E-mail dodavatele" : "",
  };
}

export interface SendPoOptions {
  from: SmtpPreference;
  via?: "rucne" | "automaticky";
  kind?: PoMailKind;
  /** Důvod storna (kind cancel) — do objednávky i historie. */
  reason?: string | null;
  /** Doplňkové údaje do události v historii (handoffId, queueId…). */
  eventData?: Row;
  /** Autor auditu (výchozí přihlášený uživatel požadavku). */
  auditActor?: ActorContext | null;
}

const KIND_TEXT: Record<PoMailKind, string> = {
  issue: "odeslána dodavateli",
  change: "— změna odeslána dodavateli",
  cancel: "— storno odesláno dodavateli",
  hold: "— pozastavení odesláno dodavateli",
};

/**
 * Odešle objednávku dodavateli e-mailem (PDF v příloze; u storna / pozastavení bez přílohy).
 * Vystavení → stav „Odeslána", čas odeslání a schránka (sent_mailbox_id). Storno → „Zrušena" s důvodem.
 * Schránka podle `from` (vždy výslovně — nikdy systémová ani cizí bez vlastníka).
 */
export async function sendPurchaseOrderCore(
  db: JobsDb,
  sender: DocAuthor,
  poId: string,
  mail: PurchaseOrderMail,
  opts: SendPoOptions,
): Promise<{ ok: true; emailId?: string; mailboxId?: string | null } | { ok: false; error: string }> {
  const kind = opts.kind ?? "issue";
  if (!mail || typeof mail !== "object") return { ok: false, error: "Chybí e-mail." };
  const to = parseEmailList(mail.to);
  if (!to || !to.length) return { ok: false, error: "Zadej platný e-mail dodavatele." };
  const cc = parseEmailList(mail.cc);
  if (!cc) return { ok: false, error: "Neplatná adresa v kopii." };
  const subject = cleanText(mail.subject, 300);
  if (!subject) return { ok: false, error: "Chybí předmět e-mailu." };
  const body = cleanText(mail.body, 20_000);
  if (!body) return { ok: false, error: "Chybí text e-mailu." };

  let po = await fetchPurchaseOrder(db, poId);
  if (!po) return { ok: false, error: "Objednávka nenalezena." };
  // storno smí odejít i u objednávky, kterou už zrušil server (ukončení výroby, výměna dodavatele)
  if (po.status === "zrusena" && kind !== "cancel") return { ok: false, error: "Zrušenou objednávku nelze odeslat." };
  if (kind === "cancel" && po.status === "dodana") return { ok: false, error: "Objednávka je dodaná — storno už nejde poslat." };
  if (kind === "change" && po.status === "dodana") {
    return { ok: false, error: "Objednávka je dodaná — změnu už nejde poslat." };
  }

  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  if (kind === "issue" || kind === "change") {
    if (!po.fileId) {
      const stored = await storePurchaseOrderPdfCore(db, sender, po, { onlyIfMissing: true });
      if ("error" in stored) return { ok: false, error: stored.error };
      po = { ...po, fileId: stored.fileId };
    }
    const { data: file } = await db.from("job_files").select("id, filename, storage_path").eq("id", po.fileId as string).maybeSingle();
    const f = file as { filename: string; storage_path: string | null } | null;
    if (!f?.storage_path) return { ok: false, error: "PDF objednávky nenalezeno — přegeneruj ho." };
    const { data: blob, error: dlErr } = await db.storage.from(BUCKET).download(f.storage_path);
    if (dlErr || !blob) return { ok: false, error: `PDF objednávky se nepodařilo načíst: ${dlErr?.message ?? "prázdný soubor"}` };
    attachments.push({ filename: f.filename || purchaseOrderFileName(po.number), content: Buffer.from(await blob.arrayBuffer()), contentType: "application/pdf" });
  }

  const copies = cc.filter((x) => !to.some((t) => t.toLowerCase() === x.toLowerCase()));
  const recipients = [...to, ...copies];
  const res = await sendMail({
    to: to.join(", "),
    cc: copies.length ? copies.join(", ") : undefined,
    subject,
    text: body,
    ...(attachments.length ? { attachments } : {}),
    from: opts.from,
    jobId: po.jobId,
    senderId: sender.id,
    // podpis vlastníka schránky (podepisující návrhu) je v textu → grafický s logem; systém bez podpisu
    signature: "ownerId" in opts.from && opts.from.ownerId ? { userId: opts.from.ownerId, mode: "inline" } : null,
    category: "objednavka",
  });
  if (!res.sent) return { ok: false, error: res.reason ?? "E-mail se nepodařilo odeslat." };

  let mailboxId: string | null = null;
  let mailboxEmail: string | null = null;
  if (res.emailId) {
    const { data: em } = await db.from("emails").select("mailbox_id").eq("id", res.emailId).maybeSingle();
    mailboxId = (em as { mailbox_id: string | null } | null)?.mailbox_id ?? null;
  }
  if (!mailboxId && "mailboxId" in opts.from && opts.from.mailboxId) mailboxId = opts.from.mailboxId;
  if (mailboxId) {
    const { data: box } = await db.from("mailboxes").select("email").eq("id", mailboxId).maybeSingle();
    mailboxEmail = (box as { email: string } | null)?.email ?? null;
  }

  const update: Row = {};
  if (kind === "issue") {
    update.sent_at = new Date().toISOString();
    if (po.status === "navrh" || po.status === "vystavena") update.status = "odeslana";
    if (mailboxId) update.sent_mailbox_id = mailboxId;
  } else if (kind === "cancel" && po.status !== "zrusena") {
    update.status = "zrusena";
    update.cancel_reason = cleanText(opts.reason, 500) ?? "Storno objednávky";
  } else if (kind === "change" && mailboxId) {
    update.sent_mailbox_id = mailboxId;
  }
  if (Object.keys(update).length) {
    const { error } = await db.from("purchase_orders").update(update as never).eq("id", poId);
    if (error) console.error(`[purchase-order] Stav objednávky po odeslání se nepodařilo uložit: ${error.message}`);
  }

  const supplier = po.supplier?.name ?? "";
  await logJobEvent(db, {
    jobId: po.jobId, type: "email",
    message: `Objednávka ${po.number} ${KIND_TEXT[kind]}${kind === "issue" && supplier ? ` ${supplier}` : ""} (${recipients.join(", ")})${mailboxEmail ? ` z ${mailboxEmail}` : ""}`.replace(/\s{2,}/g, " "),
    data: {
      purchaseOrderId: poId, number: po.number, to: recipients, emailId: res.emailId ?? null, fileId: po.fileId,
      mailKind: kind, mailboxId, ...(opts.via ? { via: opts.via } : {}), ...(opts.eventData ?? {}),
    },
    actorId: sender.id, entity: "purchase_order", entityId: poId,
  });
  await logAudit({
    action: kind === "issue" ? "purchase_order_sent" : `purchase_order_${kind}_sent`, entity: "purchase_orders", entityId: poId,
    diff: { jobId: po.jobId, number: po.number, to: recipients, emailId: res.emailId ?? null, mailboxId, via: opts.via ?? "rucne" },
    ...(opts.auditActor !== undefined ? { actor: opts.auditActor } : {}),
  });
  return { ok: true, ...(res.emailId ? { emailId: res.emailId } : {}), mailboxId };
}
