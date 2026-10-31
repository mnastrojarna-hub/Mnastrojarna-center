"use client";

import dynamic from "next/dynamic";

const CadApp = dynamic(() => import("./cad-app").then((m) => m.CadApp), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 grid place-items-center bg-white">
      <span className="h-10 w-10 animate-spin rounded-full border-2 border-ink-700/10 border-t-brand" />
    </div>
  ),
});

export function CadLoader() {
  return (
    <>
      <CadApp />
      <noscript>Mnástrojárna CAD vyžaduje JavaScript.</noscript>
    </>
  );
}
