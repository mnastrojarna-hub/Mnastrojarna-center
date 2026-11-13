import type { Metadata } from "next";
import { CadLoader } from "@/components/cad/cad-loader";
import { JsonLd } from "@/components/json-ld";
import { SITE } from "@/content/site";

export const metadata: Metadata = {
  title: "Mnástrojárna CAD – online 3D/2D CAD zdarma",
  description:
    "Profesionální parametrický 3D CAD v prohlížeči zdarma: díly, sestavy, rámy forem, výkresy s kusovníkem (PDF/DXF), proměnné a stavy. Import a export STEP, IGES, BREP, STL, 3MF, glTF, OBJ, DXF. Jádro OpenCascade, bez instalace.",
  alternates: { canonical: "/cad", languages: { cs: "/cad", en: "/en/cad", de: "/de/cad" } },
  openGraph: { url: `${SITE.url}/cad`, title: "Mnástrojárna CAD – online 3D/2D CAD zdarma", siteName: SITE.name, locale: "cs_CZ", type: "website" },
};

export default function CadPage() {
  // Sdílený odkaz (#q=… / #s=… / #r=…): část za # se hned odloží do sessionStorage a z adresy odstraní, aby se nedostala
  // do historie prohlížeče ani do měření návštěvnosti (dokument pod NDA). Skript běží už při načtení HTML.
  const shareScript = "try{var h=location.hash;if(/^#[sqr]=/.test(h)){sessionStorage.setItem('mn-cad-share',h);history.replaceState(null,'',location.pathname+location.search)}}catch(e){}";
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: shareScript }} />
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
          softwareHelp: { "@type": "CreativeWork", name: "Dokumentace Mnástrojárna CAD", url: `${SITE.url}/cad/dokumentace` },
          softwareVersion: "5. vlna (listopad 2026)",
        }}
      />
    </>
  );
}
