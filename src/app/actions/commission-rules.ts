"use server";

import { revalidatePath } from "next/cache";
import { createOperatorClient, hasServiceKey, isSupabaseConfigured } from "@/lib/supabase/server";
import { checkFeature } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit";
import { cleanDate, isUuid, todayIso, translateDbError } from "@/lib/jobs/mapping";
import { fetchCommissionRules } from "@/lib/data/commissions";
import {
  validateCommissionRuleInput, type CommissionRuleInput, type CommissionRuleView,
} from "@/components/commissions/model";
import type { ActionResult } from "@/lib/jobs/types";
import type { Feature } from "@/lib/auth/permissions";

/**
 * Smlouvy obchodníků (commission_rules) a výplata měsíčních vyúčtování.
 * Jen super admin. Provize NEpočítáme — po změně smlouvy přepočítá DB trigger
 * všechny zakázky obchodníka i jeho měsíční vyúčtování.
 */

async function begin(feature: Feature = "users") {
  if (!isSupabaseConfigured()) return { error: "Supabase není nakonfigurováno." } as const;
  const access = await checkFeature(feature);
  if ("error" in access) return { error: access.error } as const;
  return { db: await createOperatorClient(), user: access.user } as const;
}

function fail(err: unknown): { ok: false; error: string } {
  if (typeof err === "string") return { ok: false, error: translateDbError(err) };
  return { ok: false, error: err instanceof Error ? translateDbError(err.message) : "Neočekávaná chyba." };
}

function revalidateCommissions() {
  revalidatePath("/commissions");
  revalidatePath("/users");
  revalidatePath("/orders");
}

const NOT_FOUND = "Smlouva nenalezena.";

/** Smlouvy obchodníka (historie, nejnovější první). */
export async function listCommissionRules(ownerId: string): Promise<ActionResult<{ rules: CommissionRuleView[] }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(ownerId)) return fail("Uživatel nenalezen.");
  try {
    return { ok: true, rules: await fetchCommissionRules(c.db, [ownerId], { withAuthors: true }) };
  } catch (err) {
    return fail(err);
  }
}

/** Založí / upraví smlouvu. Sazby přicházejí v procentech, do DB jdou zlomky. */
export async function saveCommissionRule(input: CommissionRuleInput): Promise<ActionResult<{ id: string }>> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  const valid = validateCommissionRuleInput(input, todayIso());
  if ("error" in valid) return fail(valid.error);
  const v = valid.value;
  try {
    const { db } = c;
    const { data: owner } = await db.from("profiles").select("id, full_name, role").eq("id", v.ownerId).maybeSingle();
    if (!owner) return fail("Uživatel nenalezen.");

    const row = {
      owner_id: v.ownerId,
      name: v.name,
      base: v.base,
      basis: v.basis,
      rate: v.rate,
      tiers: v.tiers,
      valid_from: v.validFrom,
      payout_days: v.payoutDays,
      note: v.note,
    };

    let id = v.id;
    let before: Record<string, unknown> | null = null;
    if (id) {
      const { data: old } = await db.from("commission_rules").select("*").eq("id", id).maybeSingle();
      if (!old) return fail(NOT_FOUND);
      before = old as Record<string, unknown>;
      if (before.owner_id !== v.ownerId) return fail("Smlouva patří jinému obchodníkovi.");
      const { error } = await db.from("commission_rules").update(row as never).eq("id", id);
      if (error) return fail(error.message);
    } else {
      const { data, error } = await db.from("commission_rules").insert(row as never).select("id").single();
      if (error || !data) return fail(error?.message ?? "Smlouvu se nepodařilo uložit.");
      id = (data as { id: string }).id;
    }

    await logAudit({
      action: before ? "commission_rule_updated" : "commission_rule_created",
      entity: "commission_rules",
      entityId: id,
      diff: {
        ownerId: v.ownerId, owner: (owner as { full_name?: string | null }).full_name ?? null,
        by: c.user.id, byName: c.user.fullName,
        ...row, ...(before ? { before: { name: before.name, base: before.base, rate: before.rate, tiers: before.tiers, valid_from: before.valid_from, payout_days: before.payout_days } } : {}),
      },
    });
    revalidateCommissions();
    return { ok: true, id };
  } catch (err) {
    return fail(err);
  }
}

/** Smaže smlouvu — obchodníkovi pak platí předchozí smlouva, jinak sazba z profilu. */
export async function deleteCommissionRule(id: string): Promise<ActionResult> {
  const c = await begin();
  if ("error" in c) return fail(c.error);
  if (!isUuid(id)) return fail(NOT_FOUND);
  try {
    const { data: old } = await c.db.from("commission_rules").select("*").eq("id", id).maybeSingle();
    if (!old) return fail(NOT_FOUND);
    const { error } = await c.db.from("commission_rules").delete().eq("id", id);
    if (error) return fail(error.message);
    await logAudit({
      action: "commission_rule_deleted", entity: "commission_rules", entityId: id,
      diff: { ...(old as Record<string, unknown>), by: c.user.id, byName: c.user.fullName },
    });
    revalidateCommissions();
    return { ok: true };
  } catch (err) {
    return fail(err);
  }
}

interface StatementRow {
  id: string;
  owner_id: string;
  period: string;
  basis: string;
  status: string;
  commission: number | string;
  paid_at: string | null;
}

/**
 * Vyúčtování → vyplaceno (k datu výplaty); jeho provize zakázek také → vyplaceno
 * (DB je pak už nepřepočítává). paidAt = null vrátí výplatu zpět a nechá DB
 * vyúčtování i provize zakázek znovu přepočítat.
 */
export async function markStatementPaid(statementId: string, paidAt: string | null): Promise<ActionResult<{ status: string }>> {
  const c = await begin("commissions_all");
  if ("error" in c) return fail(c.error);
  if (!isUuid(statementId)) return fail("Vyúčtování nenalezeno.");
  const undo = paidAt === null;
  const date = undo ? null : cleanDate(paidAt) ?? (paidAt === "" ? todayIso() : null);
  if (!undo && !date) return fail("Neplatné datum výplaty.");
  if (date && date > todayIso()) return fail("Datum výplaty nemůže být v budoucnu.");
  try {
    const { db } = c;
    const { data, error: loadErr } = await db.from("commission_statements").select("*").eq("id", statementId).maybeSingle();
    if (loadErr) return fail(loadErr.message);
    const st = data as StatementRow | null;
    if (!st) return fail("Vyúčtování nenalezeno.");

    const entries = () => {
      let q = db.from("commission_entries").select("id, order_id").eq("owner_id", st.owner_id).eq("period", st.period);
      if (st.basis === "collected") q = q.eq("collected", true);
      return q;
    };

    if (!undo) {
      if (st.status === "otevrena") return fail("Měsíc ještě neskončil — vyúčtování půjde vyplatit po jeho konci.");
      const { error } = await db.from("commission_statements").update({ status: "vyplaceno", paid_at: date } as never).eq("id", st.id);
      if (error) return fail(error.message);
      const { data: list } = await entries();
      const ids = ((list ?? []) as { id: string }[]).map((e) => e.id);
      if (ids.length) {
        const { error: entErr } = await db.from("commission_entries").update({ status: "vyplaceno" } as never).in("id", ids);
        if (entErr) return fail(entErr.message);
      }
      await logAudit({
        action: "commission_statement_paid", entity: "commission_statements", entityId: st.id,
        // kdo výplatu označil (sloupec paid_by zatím v DB není → audit log)
        diff: {
          ownerId: st.owner_id, period: st.period, commission: st.commission, paidAt: date, entries: ids.length,
          by: c.user.id, byName: c.user.fullName,
        },
      });
      revalidateCommissions();
      return { ok: true, status: "vyplaceno" };
    }

    if (st.status !== "vyplaceno") return { ok: true, status: st.status };
    // přepočet provizí smí jen servisní role (DB je přihlášeným odebrala) — bez klíče nic neodemykat
    if (!hasServiceKey()) return fail("Vrátit výplatu jde jen se servisním klíčem Supabase (SUPABASE_SERVICE_ROLE_KEY) — provize by zůstaly nepřepočtené.");
    // zpět: odemknout vyúčtování i zakázky a nechat DB vše znovu spočítat
    const { error } = await db.from("commission_statements").update({ status: "otevrena", paid_at: null } as never).eq("id", st.id);
    if (error) return fail(error.message);
    const { data: list } = await entries();
    const rows = (list ?? []) as { id: string; order_id: string | null }[];
    if (rows.length) {
      const { error: entErr } = await db.from("commission_entries").update({ status: "predbezna" } as never).in("id", rows.map((r) => r.id));
      if (entErr) return fail(entErr.message);
    }
    for (const r of rows) {
      if (!r.order_id) continue;
      const { error: rpcErr } = await db.rpc("recompute_job_commission", { p_job: r.order_id } as never);
      if (rpcErr) console.error(`[commission-rules] Přepočet provize zakázky ${r.order_id} selhal: ${rpcErr.message}`);
    }
    // bez zakázek (nebo jen smazané) — přepočítat aspoň samotný měsíc
    const { error: monthErr } = await db.rpc("recompute_owner_month" as never, { p_owner: st.owner_id, p_period: st.period } as never);
    if (monthErr) console.error(`[commission-rules] Přepočet vyúčtování selhal: ${monthErr.message}`);
    const { data: fresh } = await db.from("commission_statements").select("status").eq("id", st.id).maybeSingle();
    await logAudit({
      action: "commission_statement_unpaid", entity: "commission_statements", entityId: st.id,
      diff: { ownerId: st.owner_id, period: st.period, previousPaidAt: st.paid_at, by: c.user.id, byName: c.user.fullName },
    });
    revalidateCommissions();
    return { ok: true, status: (fresh as { status?: string } | null)?.status ?? "k_vyplate" };
  } catch (err) {
    return fail(err);
  }
}
