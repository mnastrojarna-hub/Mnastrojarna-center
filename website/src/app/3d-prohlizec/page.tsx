import { CtaBand, PageHero, SectionHeading } from "@/components/blocks";
import { CadTool } from "@/components/cad-tool";
import { Icon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { SITE } from "@/content/site";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Online 3D prohlížeč STEP zdarma – rozměry, objem, hmotnost",
  description:
    "Zdarma otevřete STEP, IGES nebo STL přímo v prohlížeči. Bez instalace a bez nahrávání na server: gabarit, objem, povrch a hmotnost dílu v oceli, nerezu nebo hliníku.",
  path: "/3d-prohlizec",
});

const ROADMAP = [
  { t: "2D výkresy", d: "Prohlížení PDF a DXF výkresů s měřením přímo v prohlížeči." },
  { t: "Konverze formátů", d: "STEP ↔ STL ↔ IGES, export náhledů a výkresových pohledů." },
  { t: "Online CAD studio", d: "Plnohodnotné 2D/3D modelování dílů pro naše zákazníky." },
  { t: "Zákaznický portál", d: "Stav zakázek, měřicí protokoly a historie výkresů na jednom místě." },
];

export default function CadViewerPage() {
  return (
    <>
      <PageHero
        eyebrow="Nástroj zdarma"
        crumbs={[{ name: "3D prohlížeč STEP", path: "/3d-prohlizec" }]}
        title={
          <>
            Online 3D prohlížeč <span className="text-brand">STEP</span>
          </>
        }
        lead="Otevřete 3D model přímo v prohlížeči a okamžitě zjistěte rozměry, objem a hmotnost. Bez registrace, bez instalace, bez nahrávání dat."
      >
        <div className="mt-12">
          <CadTool />
        </div>
      </PageHero>

      <section className="section">
        <div className="container grid gap-5 md:grid-cols-3">
          {[
            { i: "lock" as const, t: "Vaše data zůstávají u vás", d: "Model zpracuje OpenCascade (WebAssembly) lokálně ve vašem počítači. Na server se nic neodesílá." },
            { i: "measure" as const, t: "Měření na jedno kliknutí", d: "Gabarit X × Y × Z, objem, povrch a orientační hmotnost v sedmi běžných materiálech." },
            { i: "arrow" as const, t: "Rovnou do poptávky", d: "Model jedním tlačítkem připojíte k poptávce – technolog ho uvidí i s rozměry." },
          ].map((x, k) => (
            <div key={x.t} className="spot card" data-reveal style={{ ["--d" as string]: `${k * 90}ms` }}>
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand/10 text-brand">
                <Icon name={x.i} />
              </span>
              <h2 className="mt-5 font-display text-2xl font-bold uppercase text-ink-700">{x.t}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-700/65">{x.d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="section bg-steel-100">
        <div className="container">
          <SectionHeading eyebrow="Připravujeme" title="Digitální služby pro naše zákazníky" lead="3D prohlížeč je první krok. Postupně přidáváme nástroje, které vám ušetří čas při vývoji a nákupu dílů." />
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {ROADMAP.map((r, i) => (
              <div key={r.t} className="card" data-reveal style={{ ["--d" as string]: `${i * 90}ms` }}>
                <span className="rounded-full bg-ink px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-white">Brzy</span>
                <h3 className="mt-5 font-display text-xl font-bold uppercase text-ink-700">{r.t}</h3>
                <p className="mt-2 text-[15px] text-ink-700/65">{r.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
      <JsonLd data={breadcrumbJsonLd([{ name: "3D prohlížeč STEP", path: "/3d-prohlizec" }])} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Online 3D prohlížeč STEP",
          url: `${SITE.url}/3d-prohlizec`,
          applicationCategory: "DesignApplication",
          operatingSystem: "Any (webový prohlížeč)",
          offers: { "@type": "Offer", price: "0", priceCurrency: "CZK" },
          provider: { "@type": "Organization", name: SITE.name },
        }}
      />
    </>
  );
}
