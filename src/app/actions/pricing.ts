"use server";

import { revalidatePath } from "next/cache";
import { correctPricingCalculation } from "@/lib/data/pricing-data";
import { recordCorrection } from "@/app/actions/corrections";

export type PricingFeedbackResult = { ok: boolean; error?: string };

/**
 * Korekce kalkulace (samoučení): uloží opravenou cenu/termín/marži ke
 * konkrétní kalkulaci v historii a zároveň jako naučenou korekci agenta
 * „pricing", aby se promítla do dalších naceňování.
 */
export async function submitPricingFeedback(input: {
  calculationId?: string | null;
  context: string;          // popis dílu (výkres, materiál, ks)
  aiUnitPrice?: number;
  aiLeadTimeDays?: number;
  aiMarginPercent?: number;
  userUnitPrice?: number;
  userLeadTimeDays?: number;
  userMarginPercent?: number;
  note?: string;
}): Promise<PricingFeedbackResult> {
  const changes: string[] = [];
  if (input.userUnitPrice != null) changes.push(`cena/ks ${input.userUnitPrice} Kč (AI: ${input.aiUnitPrice ?? "?"} Kč)`);
  if (input.userMarginPercent != null) changes.push(`marže ${input.userMarginPercent} % (AI: ${input.aiMarginPercent ?? "?"} %)`);
  if (input.userLeadTimeDays != null) changes.push(`termín ${input.userLeadTimeDays} dní (AI: ${input.aiLeadTimeDays ?? "?"} dní)`);
  if (!changes.length && !input.note?.trim()) {
    return { ok: false, error: "Vyplň alespoň jednu opravenou hodnotu nebo poznámku." };
  }

  // 1) Korekce v historii kalkulací (vstup pro vyhlazení dalších cen)
  if (input.calculationId) {
    await correctPricingCalculation({
      id: input.calculationId,
      userUnitPrice: input.userUnitPrice,
      userLeadTimeDays: input.userLeadTimeDays,
      userMarginPercent: input.userMarginPercent,
      note: input.note,
    });
  }

  // 2) Naučená korekce agenta pricing (vstup do promptů)
  const res = await recordCorrection({
    agentKey: "pricing",
    field: "price",
    context: input.context,
    aiValue: [
      input.aiUnitPrice != null ? `cena/ks ${input.aiUnitPrice} Kč` : null,
      input.aiMarginPercent != null ? `marže ${input.aiMarginPercent} %` : null,
      input.aiLeadTimeDays != null ? `termín ${input.aiLeadTimeDays} dní` : null,
    ].filter(Boolean).join(", "),
    correctedValue: changes.join(", ") || (input.note ?? ""),
    note: input.note,
  });
  if (!res.ok) return res;

  revalidatePath("/pricing");
  return { ok: true };
}
