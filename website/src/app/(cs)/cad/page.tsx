import type { Metadata } from "next";
import { CadLoader } from "@/components/cad/cad-loader";
import { JsonLd } from "@/components/json-ld";
import { SITE } from "@/content/site";

export const metadata: Metadata = {
  title: "Mnástrojárna CAD – online 3D/2D CAD zdarma",
  description:
    "Profesionální parametrický 3D CAD v prohlížeči zdarma: díly, sestavy, rámy forem, výkresy s kusovníkem (PDF/DXF), proměnné a stavy. Import a export STEP, IGES, BREP, STL, 3MF, glTF, OBJ, DXF. Jádro OpenCascade, bez instalace.",
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
          featureList: ["Parametrické 3D modelování", "Sestavy a vazby", "Generátor rámu vstřikovací formy", "Výkresy s kusovníkem PDF/DXF", "Proměnné a stavy (konfigurace)", "Import a export STEP, IGES, BREP, STL, 3MF, glTF, OBJ, DXF"],
          provider: { "@type": "Organization", name: SITE.name, url: SITE.url },
        }}
      />
    </>
  );
}
