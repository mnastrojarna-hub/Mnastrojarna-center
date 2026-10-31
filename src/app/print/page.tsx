import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/session";
import { PrintPage } from "@/components/print/print-page";

// Mimo skupinu (app): žádná lišta, menu ani navigace — jen dokument k tisku.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Tisk dokumentu" };

/** Tisková stránka (/print?src=/api/…&name=…[&embed=1]) — dokument stahuje stejnými routami jako prohlížeč. */
export default async function Page(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  await requireUser();
  const sp = (await props.searchParams) ?? {};
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
  return <PrintPage src={one(sp.src)} name={one(sp.name)} embed={one(sp.embed) === "1"} />;
}
