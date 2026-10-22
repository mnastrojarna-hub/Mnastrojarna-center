"use client";

import * as React from "react";
import type { Feature } from "@/lib/auth/permissions";
import type { UserRole } from "@/lib/supabase/database.types";

/**
 * Oprávnění přihlášeného uživatele na klientu (navigace, ⌘K, skrytí tlačítek).
 * Skutečnou ochranu dělá server — tohle jen neukazuje, co uživatel stejně nesmí.
 */

export interface ClientAccess {
  features: Feature[];
  role: UserRole | null;
  userId: string | null;
}

const EMPTY: ClientAccess = { features: [], role: null, userId: null };

const AccessContext = React.createContext<{
  access: ClientAccess;
  setAccess: (a: ClientAccess) => void;
}>({ access: EMPTY, setAccess: () => {} });

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const [access, setAccess] = React.useState<ClientAccess>(EMPTY);
  const value = React.useMemo(() => ({ access, setAccess }), [access]);
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>;
}

/** Vloží oprávnění ze serveru (renderuje se v layoutu aplikace). */
export function AccessBridge(props: ClientAccess) {
  const { setAccess } = React.useContext(AccessContext);
  const key = props.features.join(",") + "|" + props.role + "|" + props.userId;
  React.useEffect(() => {
    setAccess({ features: props.features, role: props.role, userId: props.userId });
    // klíč pokrývá všechny vstupy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setAccess]);
  return null;
}

export function useAccess(): ClientAccess & { can: (f: Feature) => boolean } {
  const { access } = React.useContext(AccessContext);
  return { ...access, can: (f: Feature) => access.features.includes(f) };
}
