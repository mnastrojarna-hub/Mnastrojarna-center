import type { FlowScope } from "@/lib/auth/flow-scope";

/** Co lišta rozsahu potřebuje vědět (serializovatelné — bez množiny zakázek). Server i klient. */
export type FlowScopeBarData = Pick<FlowScope, "canToggle" | "who" | "error" | "mailboxEmails">;

/** Z rozsahu serveru jen to, co smí na klienta (volá stránka na serveru). */
export function scopeBarData(scope: FlowScope | null | undefined): FlowScopeBarData | null {
  if (!scope) return null;
  return { canToggle: scope.canToggle, who: scope.who, error: scope.error, mailboxEmails: [...scope.mailboxEmails] };
}

export const SCOPE_ERROR_TEXT = "Tvoje zakázky se nepodařilo načíst — obnov stránku.";

/** Poznámka „Vidíš jen svoje…“ (§13) podle toho, zda má uživatel schránku. */
export function scopeNoteText(mailboxEmails: readonly string[]): string {
  if (mailboxEmails.length) {
    return `Vidíš jen svoje: zakázky, kde jsi obchodník nebo je zpracováváš, které jsi založil(a), a vše, co přišlo do tvé schránky ${mailboxEmails.join(", ")}. Všechny zakázky najdeš v Knize zakázek.`;
  }
  return "Vidíš jen svoje: zakázky, kde jsi obchodník nebo je zpracováváš, a ty, které jsi založil(a). Nemáš přiřazenou e-mailovou schránku — požádej super admina.";
}
