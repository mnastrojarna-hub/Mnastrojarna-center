import type { Metadata } from "next";
import { CadLoader } from "@/components/cad/cad-loader";
import { JsonLd } from "@/components/json-ld";
import { SITE } from "@/content/site";

export const metadata: Metadata = {
  title: "Mnástrojárna CAD – online 3D/2D CAD zdarma",
  description:
    "Plnohodnotný parametrický 3D/2D CAD v prohlížeči zdarma: skici, vysunutí, rotace, díry, zaoblení, skořepiny, pole. Export STEP, STL a 2D výkresů DXF/PDF. Jádro OpenCascade, bez instalace.",
  alternates: { canonical: "/cad" },
  openGraph: { url: `${SITE.url}/cad`, title: "Mnástrojárna CAD – online 3D/2D CAD zdarma", siteName: SITE.name, locale: "cs_CZ", type: "website" },
};

export default function CadPage() {
  return (
    <>
      <CadLoader />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Mnástrojárna CAD",
          url: `${SITE.url}/cad`,
          applicationCategory: "DesignApplication",
          applicationSubCategory: "CAD",
          operatingSystem: "Webový prohlížeč",
          inLanguage: "cs",
          offers: { "@type": "Offer", price: "0", priceCurrency: "CZK" },
          featureList: ["Parametrické 3D modelování", "2D skici", "Export STEP a STL", "2D výkresy DXF a PDF", "Import STEP"],
          provider: { "@type": "Organization", name: SITE.name, url: SITE.url },
        }}
      />
    </>
  );
}
