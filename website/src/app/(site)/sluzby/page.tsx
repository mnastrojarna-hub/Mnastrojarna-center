import { CtaBand, FitBlock, PageHero, ProcessSteps, SectionHeading, ServicesGrid } from "@/components/blocks";
import { JsonLd } from "@/components/json-ld";
import { SERVICES, SITE } from "@/content/site";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Služby – CNC obrábění, nástrojářství, stroje na míru",
  description:
    "Kompletní strojírenské služby pro výrobní firmy: CNC a pětiosé obrábění, drátové řezání, náhradní díly linek, nástroje, jednoúčelové stroje, prototypy a 3D měření.",
  path: "/sluzby",
});

export default function ServicesPage() {
  return (
    <>
      <PageHero
        eyebrow="Služby"
        crumbs={[{ name: "Služby", path: "/sluzby" }]}
        title={
          <>
            Vše, co vaše výroba <span className="text-brand">potřebuje</span>
          </>
        }
        lead="Navrhujeme a vyrábíme speciální stroje, přípravky a komponenty přesně podle vašich představ. Od prvního prototypu po opakované dodávky – s jednou odpovědností."
      />
      <section className="section bg-steel-100">
        <div className="container">
          <ServicesGrid />
        </div>
      </section>
      <section className="section">
        <div className="container">
          <SectionHeading eyebrow="Postup" title="Jak probíhá zakázka" />
          <div className="mt-14">
            <ProcessSteps />
          </div>
        </div>
      </section>
      <section className="section bg-steel-100">
        <div className="container">
          <FitBlock />
        </div>
      </section>
      <CtaBand />
      <JsonLd data={breadcrumbJsonLd([{ name: "Služby", path: "/sluzby" }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: SERVICES.map((s, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}/sluzby/${s.slug}`, name: s.title })),
        }}
      />
    </>
  );
}
