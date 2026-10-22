import type { UserRole } from "@/lib/supabase/database.types";

/**
 * Pravidla správy uživatelů — čistá logika (testováno), používá ji server
 * (akce) i klient (zakázání nebezpečných voleb v UI).
 */

export const USER_ROLES: UserRole[] = ["super_admin", "obchodnik", "zamestnanec"];

export function isUserRole(v: unknown): v is UserRole {
  return typeof v === "string" && (USER_ROLES as string[]).includes(v);
}

export interface GuardTarget {
  id: string;
  role: UserRole;
  active: boolean;
}

export interface GuardChange {
  role?: UserRole;
  active?: boolean;
}

/**
 * Smí se změna provést? Vrací českou chybu, nebo null.
 *  - sám sobě nelze odebrat roli super admina ani účet deaktivovat
 *  - poslední aktivní super admin nesmí přijít o roli ani být deaktivován
 */
export function userChangeProblem(input: {
  actorId: string;
  target: GuardTarget;
  change: GuardChange;
  /** Počet aktivních super adminů včetně cíle. */
  activeSuperAdmins: number;
}): string | null {
  const { actorId, target, change, activeSuperAdmins } = input;
  const self = actorId === target.id;
  const losesAdmin = target.role === "super_admin" && change.role !== undefined && change.role !== "super_admin";
  const deactivates = change.active === false && target.active;

  if (self && losesAdmin) return "Sám sobě roli super admina odebrat nemůžeš — požádej jiného super admina.";
  if (self && deactivates) return "Sám sebe deaktivovat nemůžeš.";

  const isActiveAdmin = target.role === "super_admin" && target.active;
  if (isActiveAdmin && (losesAdmin || deactivates) && activeSuperAdmins <= 1) {
    return "Je to poslední aktivní super admin — nejdřív jmenuj jiného.";
  }
  return null;
}

/** Smí se uživatel smazat? */
export function deleteUserProblem(input: {
  actorId: string;
  target: GuardTarget;
  activeSuperAdmins: number;
}): string | null {
  if (input.actorId === input.target.id) return "Sám sebe smazat nemůžeš.";
  if (input.target.role === "super_admin" && input.target.active && input.activeSuperAdmins <= 1) {
    return "Je to poslední aktivní super admin — smazat ho nejde.";
  }
  return null;
}

/** Provize v procentech (0–100, čárka i tečka) → zlomek pro DB, nebo chyba. */
export function parseCommissionPercent(v: unknown): { rate: number } | { error: string } {
  if (v === undefined || v === null || v === "") return { rate: 0 };
  const n = typeof v === "number" ? v : Number(String(v).replace(",", ".").replace(/\s|%/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > 100) return { error: "Provize musí být číslo 0–100 %." };
  // numeric(5,4) → max. 4 desetinná místa zlomku
  return { rate: Math.round(n * 100) / 10000 };
}

/** Zlomek z DB → procenta pro formulář (0.085 → 8.5). */
export function commissionToPercent(rate: number | null | undefined): number {
  return Math.round(Number(rate ?? 0) * 10000) / 100;
}

export interface CleanText {
  value: string | null;
  error?: string;
}

/** Ořízne text, prázdný → null, kontrola délky. */
export function cleanText(v: unknown, label: string, max: number): CleanText {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  if (!s) return { value: null };
  if (s.length > max) return { value: null, error: `${label} je příliš dlouhé (max. ${max} znaků).` };
  return { value: s };
}

export function cleanPhone(v: unknown): CleanText {
  const r = cleanText(v, "Telefon", 40);
  if (r.error || !r.value) return r;
  if (!/^[+\d\s()/.-]+$/.test(r.value)) return { value: null, error: "Telefon smí obsahovat jen číslice, mezery a +()-/." };
  return r;
}
