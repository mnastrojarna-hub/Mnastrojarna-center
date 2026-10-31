import * as React from "react";

/**
 * next/dynamic pro testy (vitest alias): renderToString neumí čekat na líně načtenou komponentu
 * (vykreslil by jen „Načítám…"). Modul se začne načítat hned při volání dynamic() a setup testů
 * (src/test/setup.ts) před testy počká, až jsou všechny načtené — pak se komponenta vykreslí synchronně.
 */
const pending: Promise<unknown>[] = [];

type Loaded = React.ComponentType<Record<string, unknown>>;

export default function dynamic(loader: () => Promise<unknown>): React.ComponentType<Record<string, unknown>> {
  let Component: Loaded | null = null;
  pending.push(
    loader().then((m) => {
      Component = (m && typeof m === "object" && "default" in m ? (m as { default: Loaded }).default : m) as Loaded;
    }),
  );
  function DynamicStub(props: Record<string, unknown>) {
    if (!Component) throw new Error("next/dynamic (test): modul ještě není načtený — chybí await dynamicReady()");
    return <Component {...props} />;
  }
  return DynamicStub;
}

/** Počká na všechny moduly načítané přes dynamic(). */
export function dynamicReady(): Promise<unknown> {
  return Promise.all(pending);
}
