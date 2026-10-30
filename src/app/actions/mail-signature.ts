"use server";

import { revalidatePath } from "next/cache";
import { checkFeature } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { userActor } from "@/lib/supabase/actor-headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createOperatorClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { mailboxKey, type SignatureCompany, type SignatureSettings } from "@/lib/email/signature";
import { loadSignatureCompany, resolveSignature, saveSignature, signatureMailboxes, type SignatureSource } from "@/lib/email/signature-server";

/**
 * Pošta → Nastavení pošty → Podpis: načtení a uložení grafického podpisu pro uživatele × schránku.
 * Podpis si každý nastavuje jen sám sobě a jen pro schránky, ze kterých může psát (vlastní
 * a firemní); klíč = adresa schránky (null = bez schránky / společný podpis).
 */

export interface SignatureEditorState {
  ok: true;
  /** Schránky pro přepínač (vlastní první). */
  mailboxes: { key: string | null; label: string }[];
  /** Vybraná schránka. */
  mailbox: string | null;
  value: SignatureSettings;
  defaults: SignatureSettings;
  /** Uložený podpis (null = zatím výchozí). */
  saved: SignatureSettings | null;
  source: SignatureSource;
  /** Starý textový podpis (Můj účet) — editor může nabídnout, že ho grafický nahradí. */
  legacyText: string;
  company: SignatureCompany;
}

type Fail = { ok: false; error: string };

async function allowedMailbox(userId: string, mailbox: string | null | undefined): Promise<{ keys: { key: string; label: string }[]; key: string | null } | Fail> {
  const boxes = await signatureMailboxes(userId);
  if (mailbox === null || mailbox === undefined || mailbox === "") return { keys: boxes, key: boxes[0]?.key ?? null };
  const key = mailboxKey(mailbox);
  if (!key || !boxes.some((b) => b.key === key)) return { ok: false, error: "Podpis lze nastavit jen pro vlastní nebo firemní schránku." };
  return { keys: boxes, key };
}

/** Stav editoru pro schránku (bez zadání: první vlastní schránka). */
export async function signatureEditorAction(input?: { mailbox?: string | null }): Promise<SignatureEditorState | Fail> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isSupabaseConfigured() || !hasServiceKey()) return { ok: false, error: "Supabase není nakonfigurováno." };
  const box = await allowedMailbox(access.user.id, input?.mailbox);
  if ("ok" in box) return box;
  try {
    const company = await loadSignatureCompany();
    const r = await resolveSignature({ userId: access.user.id, mailboxEmail: box.key, company });
    return {
      ok: true,
      mailboxes: box.keys.map((b) => ({ key: b.key, label: b.label })),
      mailbox: box.key,
      value: r.settings,
      defaults: r.defaults,
      saved: r.saved,
      source: r.source,
      legacyText: r.legacyText,
      company,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Podpis se nepodařilo načíst." };
  }
}

/** Uložit podpis schránky (`settings` null = obnovit výchozí — smaže uložený podpis schránky). */
export async function saveSignatureSettingsAction(input: { mailbox: string | null; settings: SignatureSettings | null }): Promise<{ ok: true; settings: SignatureSettings } | Fail> {
  const access = await checkFeature("mail");
  if ("error" in access) return { ok: false, error: access.error };
  if (!isSupabaseConfigured() || !hasServiceKey()) return { ok: false, error: "Supabase není nakonfigurováno." };
  if (!input || typeof input !== "object") return { ok: false, error: "Chybí podpis." };
  const box = await allowedMailbox(access.user.id, input.mailbox);
  if ("ok" in box) return box;
  // operátorský klient nese autora změny (historie / audit), stejně jako uložení textového podpisu
  const db = (await createOperatorClient()) as unknown as SupabaseClient;
  const res = await saveSignature({ userId: access.user.id, mailboxEmail: box.key, settings: input.settings ?? null, db });
  if (!res.ok) return res;
  await logAudit({
    action: input.settings ? "mail_signature_saved" : "mail_signature_reset",
    entity: "profiles",
    entityId: access.user.id,
    diff: { mailbox: box.key, variant: res.settings.variant, enabled: res.settings.enabled },
    actor: userActor(access.user),
  });
  revalidatePath("/inbox");
  revalidatePath("/account");
  return res;
}
