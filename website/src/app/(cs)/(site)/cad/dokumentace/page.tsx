import type { Metadata } from "next";
import { CAD_DOCS_META } from "@/content/cad-docs";
import { SITE } from "@/content/site";
import { CadDocsView } from "@/views/cad-docs";

export const metadata: Metadata = {
  title: CAD_DOCS_META.title,
  description: CAD_DOCS_META.description,
  keywords: CAD_DOCS_META.keywords,
  alternates: { canonical: CAD_DOCS_META.docsUrl, types: { "application/pdf": CAD_DOCS_META.pdfUrl, "text/markdown": CAD_DOCS_META.mdUrl } },
  openGraph: {
    type: "article",
    url: `${SITE.url}${CAD_DOCS_META.docsUrl}`,
    title: `${CAD_DOCS_META.title} | ${SITE.shortName}`,
    description: CAD_DOCS_META.description,
    siteName: SITE.name,
    locale: "cs_CZ",
    publishedTime: CAD_DOCS_META.updated,
    modifiedTime: CAD_DOCS_META.updated,
    images: [{ url: `${SITE.url}/cad/docs/og.jpg`, width: 1200, height: 630, alt: "Mnástrojárna CAD – online 3D CAD v prohlížeči" }],
  },
  twitter: { card: "summary_large_image", title: CAD_DOCS_META.title, description: CAD_DOCS_META.description, images: [`${SITE.url}/cad/docs/og.jpg`] },
};

export default function Page() {
  return <CadDocsView />;
}
