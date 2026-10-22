import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/data/current-user";
import { getSetting, getAiConfig } from "@/lib/settings";
import {
  can, allowedFeatures, DEFAULT_ACCESS_CONTEXT,
  type AccessContext, type Feature,
} from "@/lib/auth/permissions";

/**
 * Serverová vrstva oprávnění. Data se čtou servisním klíčem (RLS obchází),
 * proto KAŽDÁ stránka, akce i API route musí přístup hlídat sama přes tyto funkce.
 */

/** Přihlášený uživatel (jednou za request). */
export const getSessionUser = cache(async (): Promise<CurrentUser | null> => getCurrentUser());

function truthy(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined || v === null || v === "") return fallback;
  return ["1", "true", "ano", "yes", "on"].includes(v.trim().toLowerCase());
}

/** Nastavení AI přístupu (hlavní vypínač, AI pro všechny, klíč). */
export const getAccessContext = cache(async (): Promise<AccessContext> => {
  try {
    const [enabled, forAll, ai] = await Promise.all([
      getSetting("ai_enabled"),
      getSetting("ai_capture_for_all"),
      getAiConfig(),
    ]);
    return {
      aiEnabled: truthy(enabled, DEFAULT_ACCESS_CONTEXT.aiEnabled),
      aiCaptureForAll: truthy(forAll, DEFAULT_ACCESS_CONTEXT.aiCaptureForAll),
      aiConfigured: Boolean(ai.apiKey),
    };
  } catch {
    return DEFAULT_ACCESS_CONTEXT;
  }
});

export interface Access {
  user: CurrentUser | null;
  ctx: AccessContext;
  features: Feature[];
  can: (feature: Feature) => boolean;
}

/** Uživatel + kontext + seznam povolených funkcí. */
export const getAccess = cache(async (): Promise<Access> => {
  const [user, ctx] = await Promise.all([getSessionUser(), getAccessContext()]);
  const features = allowedFeatures(user, ctx);
  return { user, ctx, features, can: (f: Feature) => can(user, f, ctx) };
});

/** Stránky: vyžaduje přihlášeného aktivního uživatele, jinak přesměruje na přihlášení. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.active) redirect("/login?error=" + encodeURIComponent("Účet není aktivní. Požádej super admina o aktivaci."));
  return user;
}

/** Stránky: vyžaduje funkci, jinak přesměruje do Knihy zakázek s vysvětlením. */
export async function requireFeature(feature: Feature): Promise<CurrentUser> {
  const user = await requireUser();
  const { can: allowed } = await getAccess();
  if (!allowed(feature)) redirect(`/orders?pristup=${feature}`);
  return user;
}

/** Server actions: vrátí chybu místo přesměrování. */
export async function checkFeature(feature: Feature): Promise<{ user: CurrentUser } | { error: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "Nejsi přihlášen — přihlas se znovu." };
  if (!user.active) return { error: "Účet není aktivní." };
  const { can: allowed } = await getAccess();
  if (!allowed(feature)) return { error: "K této akci nemáš oprávnění." };
  return { user };
}

/** API routes: 401 / 403 jako JSON, jinak uživatel. */
export async function apiRequire(feature?: Feature): Promise<{ user: CurrentUser } | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Nepřihlášen." }, { status: 401 });
  if (!user.active) return NextResponse.json({ error: "Účet není aktivní." }, { status: 403 });
  if (feature) {
    const { can: allowed } = await getAccess();
    if (!allowed(feature)) return NextResponse.json({ error: "Bez oprávnění." }, { status: 403 });
  }
  return { user };
}
