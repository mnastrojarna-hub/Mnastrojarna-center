import type { Metadata } from "next";
import { CadLoader } from "@/components/cad/cad-loader";
import { JsonLd } from "@/components/json-ld";
import { SITE } from "@/content/site";

export const metadata: Metadata = {
  title: "Mnástrojárna CAD – free online 3D/2D CAD",
  description:
    "Professional parametric 3D CAD in your browser, free: parts, assemblies, mould bases, drawings with bill of materials (PDF/DXF), variables and configurations. Import and export STEP, IGES, BREP, STL, 3MF, glTF, OBJ, DXF. OpenCascade kernel, no installation.",
  alternates: { canonical: "/en/cad", languages: { cs: "/cad", en: "/en/cad", de: "/de/cad" } },
  openGraph: { url: `${SITE.url}/en/cad`, title: "Mnástrojárna CAD – free online 3D/2D CAD", siteName: SITE.name, locale: "en_GB", type: "website" },
};

export default function CadPage() {
  // Shared link (#q=… / #s=… / #r=…): the part after # is stashed in sessionStorage and removed from the address at once (NDA documents).
  const shareScript = "try{var h=location.hash;if(/^#[sqr]=/.test(h)){sessionStorage.setItem('mn-cad-share',h);history.replaceState(null,'',location.pathname+location.search)}}catch(e){}";
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: shareScript }} />
      <CadLoader lang="en" />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Mnástrojárna CAD",
          url: `${SITE.url}/en/cad`,
          applicationCategory: "DesignApplication",
          applicationSubCategory: "CAD",
          operatingSystem: "Web browser",
          inLanguage: "en",
          offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
          featureList: ["Parametric 3D modelling", "Assemblies and mates", "Injection mould base generator", "Drawings with BOM, PDF/DXF", "Variables and configurations", "Import and export STEP, IGES, BREP, STL, 3MF, glTF, OBJ, DXF"],
          provider: { "@type": "Organization", name: SITE.name, url: SITE.url },
          softwareHelp: { "@type": "CreativeWork", name: "Mnástrojárna CAD documentation", url: `${SITE.url}/en/cad/documentation` },
        }}
      />
    </>
  );
}
