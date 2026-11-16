/**
 * Efektivní režim automatiky (čistá logika, testy automation-mode.test.ts).
 *
 * Majitel 16. 11.: „najednou mi to běží bez schvalování, i když je nahoře plná automatika vypnutá".
 * Přepínač nahoře (automation_global) je HLAVNÍ VYPÍNAČ: „Se schválením" = všechno se schválením, bez ohledu
 * na nastavení modulů. Jen při „Plná automatika" platí nastavení jednotlivých modulů (Ladění → Automatizace),
 * které může vybrané moduly ponechat se schválením.
 */
export type AutomationModeValue = "full" | "approval";

export function effectiveAutomationMode(
  global: AutomationModeValue | null | undefined,
  module: { mode?: AutomationModeValue | null; enabled?: boolean | null } | null | undefined,
): AutomationModeValue {
  if (global !== "full") return "approval";
  if (module && module.enabled === false) return "approval";
  return module?.mode ?? "full";
}
