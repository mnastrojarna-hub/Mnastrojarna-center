import type { Metadata } from "next";
import { CAD_DOCS_META } from "@/content/cad-docs";
import { CadDocsPrint } from "@/views/cad-docs";

/** Tisková podoba dokumentace – zdroj pro PDF příručku (scripts/cad-docs-pdf.mjs). Neindexuje se; PDF a web ano. */
export const metadata: Metadata = {
  title: `${CAD_DOCS_META.shortTitle} – tisková verze`,
  robots: { index: false, follow: true },
  alternates: { canonical: CAD_DOCS_META.docsUrl },
};

export default function Page() {
  return <CadDocsPrint />;
}
