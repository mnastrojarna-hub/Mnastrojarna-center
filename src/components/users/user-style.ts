import type { UserRole } from "@/lib/supabase/database.types";

/**
 * Barvy rolí a avatarů ve správě uživatelů — každá role má svou barvu,
 * avatar dostane stálou barvu podle uživatele (orientace bez čtení).
 */

export interface RoleStyle {
  /** Odznak role. */
  badge: string;
  /** Barevná tečka / proužek. */
  dot: string;
  /** Jemné pozadí karty role. */
  soft: string;
  /** Text v barvě role. */
  text: string;
}

export const ROLE_STYLES: Record<UserRole, RoleStyle> = {
  super_admin: {
    badge: "border-transparent bg-primary/10 text-primary",
    dot: "bg-primary",
    soft: "bg-primary/5 border-primary/20",
    text: "text-primary",
  },
  obchodnik: {
    badge: "border-transparent bg-blue-500/10 text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
    soft: "bg-blue-500/5 border-blue-500/20",
    text: "text-blue-600 dark:text-blue-400",
  },
  zamestnanec: {
    badge: "border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
    soft: "bg-emerald-500/5 border-emerald-500/20",
    text: "text-emerald-700 dark:text-emerald-400",
  },
};

export const ROLE_ORDER: UserRole[] = ["super_admin", "obchodnik", "zamestnanec"];

const AVATAR_COLORS = [
  "bg-rose-500 text-white",
  "bg-orange-500 text-white",
  "bg-amber-500 text-white",
  "bg-lime-600 text-white",
  "bg-emerald-500 text-white",
  "bg-teal-500 text-white",
  "bg-sky-500 text-white",
  "bg-blue-500 text-white",
  "bg-indigo-500 text-white",
  "bg-violet-500 text-white",
  "bg-fuchsia-500 text-white",
  "bg-pink-500 text-white",
];

/** Stálá barva avatara podle id / e-mailu (stejný člověk = stejná barva). */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

/** Iniciály ze jména, jinak z e-mailu. */
export function initialsFor(name: string | null | undefined, email: string | null | undefined): string {
  const source = (name ?? "").trim() || (email ?? "").trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}
