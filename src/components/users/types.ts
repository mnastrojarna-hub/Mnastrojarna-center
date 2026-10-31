import type { UserRole } from "@/lib/supabase/database.types";
import type { CommissionRuleView } from "@/components/commissions/model";

/** Uživatel ve správě uživatelů (jen pro super admina). */
export interface ManagedUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  aiAccess: boolean;
  phone: string | null;
  position: string | null;
  /** Provize v procentech (8.5 = 8,5 %). */
  commissionPercent: number;
  lastSeenAt: string | null;
  createdAt: string;
  /** Smlouvy o provizi (historie, nejnovější první); prázdné = sazba z profilu. */
  commissionRules?: CommissionRuleView[];
  /** Nabídky musí před odesláním schválit super admin (profil; u super admina se ignoruje). Výchozí ano. */
  quoteNeedsApproval?: boolean;
  /** Kdo a kdy nastavení schvalování naposledy změnil. */
  quoteApprovalChangedBy?: string | null;
  quoteApprovalChangedAt?: string | null;
}

/** Schránka k přiřazení uživateli. */
export interface MailboxOption {
  id: string;
  email: string;
  displayName: string | null;
  ownerId: string | null;
  active: boolean;
  provider: string;
}

export interface UsersPageData {
  users: ManagedUser[];
  mailboxes: MailboxOption[];
  /** Je k dispozici servisní klíč (správa uživatelů funguje). */
  ready: boolean;
  error?: string;
}
