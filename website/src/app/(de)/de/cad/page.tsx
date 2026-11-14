import type { Metadata } from "next";
import { SHARE_STASH_SCRIPT } from "@/cad/share-code";
import { CadLoader } from "@/components/cad/cad-loader";
import { JsonLd } from "@/components/json-ld";
import { SITE } from "@/content/site";

export const metadata: Metadata = {
  title: "Mnástrojárna CAD – kostenloses Online-3D/2D-CAD",
  description:
    "Professionelles parametrisches 3D-CAD im Browser, kostenlos: Teile, Baugruppen, Formaufbauten, Zeichnungen mit Stückliste (PDF/DXF), Variablen und Konfigurationen. Import und Export STEP, IGES, BREP, STL, 3MF, glTF, OBJ, DXF. OpenCascade-Kern, ohne Installation.",
  alternates: { canonical: "/de/cad", languages: { cs: "/cad", en: "/de/cad", de: "/de/cad" } },
  openGraph: { url: `${SITE.url}/de/cad`, title: "Mnástrojárna CAD – kostenloses Online-3D/2D-CAD", siteName: SITE.name, locale: "de_DE", type: "website" },
};

export default function CadPage() {
  // Geteilter Link (#<CODE> / #q=… / #s=… / #r=…): der Teil nach # wird sofort in sessionStorage abgelegt und aus der Adresse entfernt (NDA-Dokumente).
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: SHARE_STASH_SCRIPT }} />
      <CadLoader lang="de" />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Mnástrojárna CAD",
          url: `${SITE.url}/de/cad`,
          applicationCategory: "DesignApplication",
          applicationSubCategory: "CAD",
          operatingSystem: "Webbrowser",
          inLanguage: "de",
          offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
          featureList: ["Parametrische 3D-Modellierung", "Baugruppen und Verknüpfungen", "Generator für Spritzgieß-Formaufbauten", "Zeichnungen mit Stückliste, PDF/DXF", "Variablen und Konfigurationen", "Import und Export STEP, IGES, BREP, STL, 3MF, glTF, OBJ, DXF"],
          provider: { "@type": "Organization", name: SITE.name, url: SITE.url },
          softwareHelp: { "@type": "CreativeWork", name: "Mnástrojárna CAD – Dokumentation", url: `${SITE.url}/de/cad/dokumentation` },
        }}
      />
    </>
  );
}
