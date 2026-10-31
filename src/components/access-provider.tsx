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
  /** Nabídky přihlášeného musí schválit super admin (profil, 31. 10.). Neuvedeno = ano (kromě super admina). */
  quoteNeedsApproval?: boolean;
  /** 31. 10.: schvalovatelé nabídek, kteří nejsou super admin (texty „čeká na schválení (V. Volný nebo super admin)“). */
  quoteApprovers?: { id: string; name: string }[];
}

const EMPTY: ClientAccess = { features: [], role: null, userId: null };

/**
 * Oprávnění drží malý „store", ne stav v kontextu: hodnota kontextu (store) se po načtení stránky
 * NEMĚNÍ. Změna hodnoty kontextu nad streamovanou, ještě neodhalenou částí stránky (React 19.2
 * odhaluje další Suspense hranice dávkově až po ~300 ms — např. obsah karty zakázky za její
 * loading.tsx) totiž donutí React tu část zahodit a vykreslit znovu na klientu — karta otevřená
 * přes ?tab= pak místo serverem vykreslené záložky bliká kostrou, než se dotáhne JS záložky.
 */
interface AccessStore {
  get: () => ClientAccess;
  set: (a: ClientAccess) => void;
  subscribe: (cb: () => void) => () => void;
}

function createAccessStore(initial: ClientAccess): AccessStore {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (a) => {
      if (a === value) return;
      value = a;
      subs.forEach((cb) => cb());
    },
    subscribe: (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

const AccessContext = React.createContext<AccessStore>(createAccessStore(EMPTY));

/** Kořen (nad ⌘K) — oprávnění sem dosadí AccessBridge z layoutu aplikace. */
export function AccessProvider({ children }: { children: React.ReactNode }) {
  const [store] = React.useState(() => createAccessStore(EMPTY));
  return <AccessContext.Provider value={store}>{children}</AccessContext.Provider>;
}

/**
 * Vloží oprávnění ze serveru (obaluje layout aplikace): obsah aplikace je dostane už při vykreslení
 * na serveru i při hydrataci (žádná změna po načtení), ⌘K v kořeni přes store po připojení.
 */
export function AccessBridge({ children, ...props }: ClientAccess & { children?: React.ReactNode }) {
  const root = React.useContext(AccessContext);
  const key = props.features.join(",") + "|" + props.role + "|" + props.userId + "|" + props.quoteNeedsApproval
    + "|" + (props.quoteApprovers ?? []).map((a) => `${a.id}:${a.name}`).join(",");
  const access = React.useMemo<ClientAccess>(
    () => ({
      features: props.features, role: props.role, userId: props.userId, quoteNeedsApproval: props.quoteNeedsApproval,
      quoteApprovers: props.quoteApprovers ?? [],
    }),
    // klíč pokrývá všechny vstupy
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  const store = React.useMemo(() => createAccessStore(access), [access]);
  React.useEffect(() => root.set(access), [root, access]);
  return <AccessContext.Provider value={store}>{children}</AccessContext.Provider>;
}

export function useAccess(): ClientAccess & { can: (f: Feature) => boolean } {
  const store = React.useContext(AccessContext);
  const access = React.useSyncExternalStore(store.subscribe, store.get, store.get);
  return { ...access, can: (f: Feature) => access.features.includes(f) };
}
