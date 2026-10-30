import type { FileLock } from "@/lib/jobs/types";

/** Texty zamčených řádků dokumentů (#25, §13) — řádek je vidět, obsah ne. */
export const FILE_LOCK_TEXT: Record<Exclude<FileLock, null>, string> = {
  price: "Nákupní doklad — obsah vidí obchodník a super admin.",
  unapproved: "Neplatné — čeká na schválení",
  stale: "Neplatné — vzniklo před schválením",
};

/** Naše faktura zamčená pro roli bez práva na marže (A2: „Faktury asi ne" pro ostatní). */
export const INVOICE_LOCK_TEXT = "Faktura — obsah vidí obchodník a super admin.";

export function fileLockText(lock: FileLock | undefined, file?: { kind: string; issuer?: string | null }): string | null {
  if (lock === "price" && file?.kind === "faktura" && file.issuer !== "dodavatel") return INVOICE_LOCK_TEXT;
  return lock ? FILE_LOCK_TEXT[lock] : null;
}

/** Poznámka nad Dokumenty pro uživatele bez práva na marže (§13). */
export const PRICE_DOCS_NOTE =
  "Nákupní doklady (objednávky dodavatelům, nabídky, potvrzení, dodací listy a faktury dodavatelů) vidí celé jen obchodník a super admin.";
