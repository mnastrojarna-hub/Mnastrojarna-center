import type { Metadata } from "next";
import { CadDocsIntlView, cadDocsIntlMeta } from "@/views/cad-docs-intl";

export const metadata: Metadata = cadDocsIntlMeta("de");

export default function Page() {
  return <CadDocsIntlView locale="de" />;
}
