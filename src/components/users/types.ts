import type { UserRole } from "@/lib/supabase/database.types";

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
