import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANY } from "@/lib/company";
import { refreshCompanyFromSettings } from "@/lib/company-server";
import { getSetting } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/server";
import { SIGNATURE_LOGO_PNG_BASE64 } from "@/lib/email/signature-logo-data";
import {
  SIGNATURE_LOGO_CID, defaultSignatureFor, htmlBodyWithSignature, locateSignature, mailboxKey, normalizeSignature, pickStoredSignature,
  putStoredSignature, renderSignature, signatureCompanyFrom, signatureLogoSrc, stripClosing,
  type RenderedSignature, type SignatureCompany, type SignatureSettings,
} from "@/lib/email/signature";

/**
 * Podpis e-mailu na serveru: načtení (uživatel × schránka), uložení, podpis k odeslání a logo
 * jako vložená příloha (cid). Úložiště: profiles.mail_signatures (jsonb, migrace
 * 20261030110000_mail_podpisy) — bez migrace se čte jen starý textový podpis profiles.mail_signature
 * a výchozí podpis z profilu; uložení vrátí srozumitelnou chybu.
 *
 * Pořadí: podpis schránky → společný podpis → starý textový podpis → výchozí (z profilu).
 */

type Db = SupabaseClient;
function adminDb(): Db {
  return createAdminClient() as unknown as Db;
}

export type SignatureSource = "mailbox" | "default" | "legacy" | "auto";

export interface ResolvedSignature {
  /** Podpis k úpravě / vykreslení. */
  settings: SignatureSettings;
  /** Výchozí podpis pro tuto schránku (profil + adresa schránky + firma). */
  defaults: SignatureSettings;
  /** Výslovně uložený podpis (schránky nebo společný); null = nic uloženo. */
  saved: SignatureSettings | null;
  source: SignatureSource;
  /** Starý textový podpis (Můj účet) — platí, dokud si uživatel neuloží grafický. */
  legacyText: string;
}

interface ProfileRow {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  position: string | null;
  mail_signature: string | null;
  mail_signatures?: unknown;
}

/** Sloupec mail_signatures zatím v DB není (migrace neproběhla)? */
function missingColumn(error: { message?: string; code?: string } | null): boolean {
  return Boolean(error && (error.code === "42703" || error.code === "PGRST204" || /mail_signatures/.test(error.message ?? "")));
}

async function profileRow(db: Db, userId: string): Promise<ProfileRow | null> {
  const full = await db.from("profiles").select("full_name, email, phone, position, mail_signature, mail_signatures").eq("id", userId).maybeSingle();
  if (!full.error) return (full.data as ProfileRow | null) ?? null;
  if (!missingColumn(full.error)) throw new Error(full.error.message);
  const basic = await db.from("profiles").select("full_name, email, phone, position, mail_signature").eq("id", userId).maybeSingle();
  if (basic.error) throw new Error(basic.error.message);
  return (basic.data as ProfileRow | null) ?? null;
}

/** Firemní blok podpisu — živě z Nastavení (+ navržená nastavení adresy pro poštu a certifikací). */
export async function loadSignatureCompany(): Promise<SignatureCompany> {
  await refreshCompanyFromSettings();
  const [correspondence, certifications] = await Promise.all([
    getSetting("company_correspondence_address"),
    getSetting("company_certifications"),
  ]);
  return signatureCompanyFrom(COMPANY, { correspondenceAddress: correspondence, certifications: certifications ?? null });
}

/** Podpis uživatele pro schránku (adresa; null = bez schránky / společný). */
export async function resolveSignature(input: { userId: string; mailboxEmail?: string | null; company?: SignatureCompany; db?: Db }): Promise<ResolvedSignature> {
  const db = input.db ?? adminDb();
  const [row, company] = await Promise.all([profileRow(db, input.userId), input.company ?? loadSignatureCompany()]);
  const defaults = defaultSignatureFor(
    { fullName: row?.full_name, phone: row?.phone, position: row?.position, email: row?.email },
    input.mailboxEmail ?? null,
    company,
  );
  const legacyText = (row?.mail_signature ?? "").trim();
  const picked = pickStoredSignature(row?.mail_signatures, input.mailboxEmail ?? null, defaults);
  if (picked) return { settings: picked.settings, defaults, saved: picked.settings, source: picked.source, legacyText };
  return { settings: defaults, defaults, saved: null, source: legacyText ? "legacy" : "auto", legacyText };
}

/** Uložit podpis schránky (`settings` null = smazat → zase výchozí). Vstup se vždy normalizuje. */
export async function saveSignature(input: {
  userId: string; mailboxEmail: string | null; settings: unknown | null; db?: Db;
}): Promise<{ ok: true; settings: SignatureSettings } | { ok: false; error: string }> {
  const db = input.db ?? adminDb();
  const resolved = await resolveSignature({ userId: input.userId, mailboxEmail: input.mailboxEmail, db, company: await loadSignatureCompany() });
  const settings = input.settings === null ? null : normalizeSignature(input.settings, resolved.defaults);
  const cur = await db.from("profiles").select("mail_signatures").eq("id", input.userId).maybeSingle();
  if (cur.error) {
    return { ok: false, error: missingColumn(cur.error) ? "Uložení podpisu ještě není v databázi připravené (chybí migrace podpisů) — dej vědět správci." : cur.error.message };
  }
  const next = putStoredSignature((cur.data as { mail_signatures?: unknown } | null)?.mail_signatures, input.mailboxEmail, settings);
  const { error } = await db.from("profiles").update({ mail_signatures: next }).eq("id", input.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, settings: settings ?? resolved.defaults };
}

/** Schránky, pro které si uživatel nastavuje podpis: vlastní + firemní (odpovídá z nich). */
export async function signatureMailboxes(userId: string, db: Db = adminDb()): Promise<{ key: string; label: string; own: boolean }[]> {
  const { data, error } = await db.from("mailboxes").select("email, owner_id, active").order("email", { ascending: true });
  if (error) return [];
  const out: { key: string; label: string; own: boolean }[] = [];
  for (const m of (data ?? []) as { email: string; owner_id: string | null; active: boolean | null }[]) {
    const key = mailboxKey(m.email);
    if (!key || m.active === false || out.some((o) => o.key === key)) continue;
    if (m.owner_id === userId) out.push({ key, label: key, own: true });
    else if (!m.owner_id) out.push({ key, label: `${key} · firemní`, own: false });
  }
  return out.sort((a, b) => Number(b.own) - Number(a.own));
}

// ── Odeslání ─────────────────────────────────────────────────────────────────────────────────

/** Logo pro vložení do zprávy (nodemailer: `cid`; Graph: isInline + contentId). */
export interface InlineImage {
  filename: string;
  content: Buffer;
  contentType: string;
  cid: string;
}

export function signatureLogoAttachment(): InlineImage {
  return { filename: "mnastrojarna-logo.png", content: Buffer.from(SIGNATURE_LOGO_PNG_BASE64, "base64"), contentType: "image/png", cid: SIGNATURE_LOGO_CID };
}

export interface OutgoingSignature {
  /** Text podpisu do textu zprávy (okno psaní, dokumenty). Prázdný = bez podpisu. */
  text: string;
  /** Grafický podpis; null = jen text (starý textový podpis / vypnutý). */
  rendered: RenderedSignature | null;
}

/**
 * Podpis pro odchozí zprávu ze schránky `mailboxEmail`. Logo: „cid" (výchozí — vložené do zprávy,
 * Outlook ho neblokuje) nebo „url" (APP_URL / NEXT_PUBLIC_APP_URL + /brand/…).
 */
export async function outgoingSignature(input: { userId: string; mailboxEmail?: string | null; logo?: "cid" | "url"; db?: Db }): Promise<OutgoingSignature> {
  const company = await loadSignatureCompany();
  const r = await resolveSignature({ userId: input.userId, mailboxEmail: input.mailboxEmail, db: input.db, company });
  if (r.source === "legacy") return { text: r.legacyText, rendered: null };
  const rendered = renderSignature(r.settings, { company, logoSrc: signatureLogoSrc(input.logo ?? "cid") });
  return rendered.text ? { text: rendered.text, rendered } : { text: "", rendered: null };
}

/**
 * HTML zprávy + vložené logo z textu, ve kterém je podpis (okno psaní: „-- " + text podpisu;
 * dokumenty: text podpisu na konci). Podpis v textu není → null (odešle se jen text jako dosud).
 */
export function signedHtml(body: string, sig: OutgoingSignature): { html: string; inline: InlineImage[] } | null {
  if (!sig.rendered) return null;
  const html = htmlBodyWithSignature(body, sig.rendered);
  if (!html) return null;
  return { html, inline: html.includes(`cid:${SIGNATURE_LOGO_CID}`) ? [signatureLogoAttachment()] : [] };
}

/**
 * Text s podpisem na konci (e-mail, který aplikace posílá ve jménu uživatele — schválená odpověď AI,
 * automatická odpověď, AI nabídka): je-li podpis v textu už, nic se nemění; jinak se odstraní
 * závěrečný pozdrav (AI / stará šablona) a připojí se podpis — vždy jen jednou.
 */
export function appendSignatureText(body: string, signatureText: string): string {
  const sig = String(signatureText ?? "").trim();
  if (!sig || locateSignature(body, sig)) return body;
  const text = stripClosing(body);
  return `${text ? `${text}\n\n` : ""}${sig}\n`;
}

/**
 * Podpis do odchozí zprávy: „inline" = podpis je v textu (okno psaní, dialog dokladu — uživatel ho
 * viděl a mohl upravit) → jen převést na grafický; „append" = připojit, není-li v textu.
 * Výsledek: text (případně s připojeným podpisem), HTML s grafickým podpisem (null = jen text)
 * a vložené logo (cid).
 */
export function applySignature(body: string, sig: OutgoingSignature, mode: "inline" | "append"): { text: string; html: string | null; inline: InlineImage[] } {
  if (!sig.text) return { text: body, html: null, inline: [] };
  const text = mode === "append" ? appendSignatureText(body, sig.text) : body;
  const signed = signedHtml(text, sig);
  return { text, html: signed?.html ?? null, inline: signed?.inline ?? [] };
}
