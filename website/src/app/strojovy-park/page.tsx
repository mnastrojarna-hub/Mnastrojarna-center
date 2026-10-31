import { CtaBand, MachineCard, PageHero, SectionHeading } from "@/components/blocks";
import { JsonLd } from "@/components/json-ld";
import { MACHINES } from "@/content/site";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Strojový park – 5osá centra, soustružení, drátořez",
  description:
    "Strojový park Mnástrojárny: pětiosé centrum AXILE G8 (Ø 1 000 mm, 3 000 kg), HYPERTUN 65 Powermill, drátořez FANUC ROBOCUT α-C800iB, MCV 754Q, VMCA 760 a další.",
  path: "/strojovy-park",
});

const SOFTWARE = ["ZW3D", "Esprit", "NCG CAM", "Cami"];
const CONTROLS = ["HEIDENHAIN iTNC640", "HEIDENHAIN iTNC530", "Sinumerik 840D", "Fagor"];

export default function MachinesPage() {
  return (
    <>
      <PageHero
        eyebrow="Strojový park"
        crumbs={[{ name: "Strojový park", path: "/strojovy-park" }]}
        title={
          <>
            Technologie, na které se <span className="text-brand">dá spolehnout</span>
          </>
        }
        lead="Moderní a vysoce přesná obráběcí a měřicí centra. Obrábíme v pěti i více osách současně, soustružíme a frézujeme v jednom upnutí a drátem řežeme velké díly."
      />
      <section className="noise relative overflow-hidden bg-ink pb-24 text-white">
        <div className="container relative grid gap-5 lg:grid-cols-2">
          {MACHINES.map((m, i) => (
            <MachineCard key={m.id} m={m} i={i} />
          ))}
        </div>
      </section>
      <section className="section">
        <div className="container grid gap-12 md:grid-cols-2">
          <div data-reveal>
            <SectionHeading eyebrow="CAD / CAM" title="Software" lead="Od roku 2013 programujeme v ZW3D, dále v Esprit, NCG CAM a Cami (drátové řezání)." />
            <div className="mt-8 flex flex-wrap gap-2">
              {SOFTWARE.map((s) => (
                <span key={s} className="rounded-full border border-ink-700/15 px-4 py-2 font-mono text-sm text-ink-700">
                  {s}
                </span>
              ))}
            </div>
          </div>
          <div data-reveal>
            <SectionHeading eyebrow="Řídicí systémy" title="Řízení strojů" lead="Pravítka zpětného odměřování, automatické sondy a laserové měření nástrojů přímo ve stroji." />
            <div className="mt-8 flex flex-wrap gap-2">
              {CONTROLS.map((s) => (
                <span key={s} className="rounded-full border border-ink-700/15 px-4 py-2 font-mono text-sm text-ink-700">
                  {s}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>
      <CtaBand title="Váš díl se na naše stroje vejde." lead="Obrobky do Ø 1 000 mm a 3 000 kg, drátem až 1 250 × 975 × 500 mm. Pošlete výkres a ověříme to." />
      <JsonLd data={breadcrumbJsonLd([{ name: "Strojový park", path: "/strojovy-park" }])} />
    </>
  );
}
