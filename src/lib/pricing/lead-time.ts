import type { LeadTimeMode, LeadTimeResult, PricingParams } from "./types";

/**
 * Termín dodání: výpočet z technologie, složitosti, množství, dostupnosti
 * materiálu, vytížení výroby a kooperací. Režimy expres / rychlý / standard /
 * dlouhý s automatickou přirážkou za zkrácení.
 */

export const LEAD_MODE_LABEL: Record<LeadTimeMode, string> = {
  expres: "Expres (1–2 týdny)",
  rychly: "Rychlý (2–4 týdny)",
  standard: "Standard (4–8 týdnů)",
  dlouhy: "Dlouhý (8–24 týdnů)",
};

const MODE_MAX_DAYS: Record<LeadTimeMode, number> = {
  expres: 14, rychly: 28, standard: 56, dlouhy: 168,
};

export function modeForDays(days: number): LeadTimeMode {
  if (days <= MODE_MAX_DAYS.expres) return "expres";
  if (days <= MODE_MAX_DAYS.rychly) return "rychly";
  if (days <= MODE_MAX_DAYS.standard) return "standard";
  return "dlouhy";
}

export interface LeadTimeInput {
  totalMachineHours: number;       // čistý strojní čas na zakázku
  complexityCoefficient: number;
  materialAvailability: "bezna" | "omezena" | "specialni";
  hasHeatTreatment: boolean;
  hasSurfaceTreatment: boolean;
  hasOtherCooperation?: boolean;
  utilizationPercent: number;      // vytížení výroby
  requestedMode?: LeadTimeMode;    // požadavek zákazníka (volitelné)
  params: PricingParams;
}

export function computeLeadTime(input: LeadTimeInput): LeadTimeResult {
  const notes: string[] = [];

  // Výroba: efektivně ~6 strojohodin denně na zakázku + příprava
  let days = 3 + Math.ceil(input.totalMachineHours / 6);
  days = Math.ceil(days * (0.8 + 0.2 * input.complexityCoefficient));

  // Materiál
  if (input.materialAvailability === "omezena") { days += 7; notes.push("hůře dostupný materiál +7 dní"); }
  else if (input.materialAvailability === "specialni") { days += 21; notes.push("speciálně objednávaný materiál +21 dní"); }
  else { days += 3; notes.push("běžný materiál ze skladu/velkoobchodu +3 dny"); }

  // Kooperace
  if (input.hasHeatTreatment) { days += 7; notes.push("tepelné zpracování (kooperace) +7 dní"); }
  if (input.hasSurfaceTreatment) { days += 5; notes.push("povrchová úprava (kooperace) +5 dní"); }
  if (input.hasOtherCooperation) { days += 7; notes.push("další kooperace +7 dní"); }

  // Vytížení výroby
  if (input.utilizationPercent >= 90) { days = Math.ceil(days * 1.4); notes.push("výroba vytížená ≥90 % (×1,4)"); }
  else if (input.utilizationPercent >= 75) { days = Math.ceil(days * 1.2); notes.push("výroba vytížená ≥75 % (×1,2)"); }

  const standardDays = days;
  const naturalMode = modeForDays(standardDays);

  // Požadovaný režim: zkrácení = přirážka; expres pod fyzikální limit nejde
  let mode = input.requestedMode ?? naturalMode;
  let offeredDays = standardDays;
  let surcharge = 0;

  if (input.requestedMode && MODE_MAX_DAYS[input.requestedMode] < standardDays) {
    const minDays = Math.max(5, Math.ceil(standardDays * 0.55));
    offeredDays = Math.max(minDays, Math.min(MODE_MAX_DAYS[input.requestedMode], standardDays));
    if (offeredDays > MODE_MAX_DAYS[input.requestedMode]) {
      mode = modeForDays(offeredDays);
      notes.push(`požadovaný režim ${LEAD_MODE_LABEL[input.requestedMode]} není reálný — nejdříve ${offeredDays} dní`);
    }
    const m = modeForDays(offeredDays);
    if (m === "expres") { surcharge = input.params.expressSurchargePct; notes.push(`expresní termín +${surcharge} % k ceně`); }
    else if (m === "rychly" && naturalMode !== "rychly") { surcharge = input.params.fastSurchargePct; notes.push(`zkrácený termín +${surcharge} % k ceně`); }
    mode = m;
  } else if (input.requestedMode && MODE_MAX_DAYS[input.requestedMode] >= standardDays) {
    mode = input.requestedMode;
    offeredDays = standardDays;
  }

  return { mode, days: offeredDays, standardDays, surchargePercent: surcharge, notes };
}
