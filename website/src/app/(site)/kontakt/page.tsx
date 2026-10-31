import Link from "next/link";
import { SectionHeading, TeamGrid } from "@/components/blocks";
import { Icon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { SITE } from "@/content/site";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Kontakt – Mnástrojárna Pelhřimov",
  description: `Kontakt na Mnástrojárnu s.r.o.: provozovna ${SITE.workshop.street}, ${SITE.workshop.zip} ${SITE.workshop.city}. Obchod, technologie a vedení firmy. IČO ${SITE.ico}.`,
  path: "/kontakt",
});

export default function ContactPage() {
  const w = SITE.workshop;
  const mapUrl = `https://mapy.cz/zakladni?q=${encodeURIComponent(`${w.street}, ${w.city}`)}&x=${w.lng}&y=${w.lat}&z=16`;
  return (
    <>
      <section className="bg-grid-light relative pb-16 pt-36 md:pt-44">
        <div className="container">
          <p className="eyebrow">Kontakt</p>
          <h1 className="h-display mt-5 max-w-4xl text-5xl text-ink-700 md:text-7xl">
            Pojďme probrat <span className="text-brand">váš projekt</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-ink-700/70">
            Nejrychlejší cesta k nabídce je poptávkový formulář s výkresem. Pro konzultace volejte nebo pište přímo našim lidem.
          </p>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row">
            <Link href="/poptavka" className="btn-primary !px-7 !py-3.5">
              <Icon name="upload" className="h-5 w-5" /> Poslat poptávku s výkresem
            </Link>
          </div>
        </div>
      </section>

      <section className="pb-20">
        <div className="container">
          <TeamGrid />
        </div>
      </section>

      <section className="section bg-steel-100">
        <div className="container grid gap-5 md:grid-cols-3">
          <div className="card" data-reveal>
            <p className="eyebrow">{w.label}</p>
            <p className="mt-5 text-lg font-semibold text-ink-700">{SITE.name}</p>
            <p className="text-ink-700/70">
              {w.street}
              <br />
              {w.zip} {w.city}
            </p>
            <p className="mt-3 font-mono text-[12px] text-ink-700/50">
              GPS {w.lat.toFixed(5)}N, {w.lng.toFixed(5)}E
            </p>
            <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-2 text-[14px] font-semibold text-brand">
              Navigovat (Mapy.cz) <Icon name="arrow" className="h-4 w-4" />
            </a>
          </div>
          <div className="card" data-reveal style={{ ["--d" as string]: "90ms" }}>
            <p className="eyebrow">{SITE.billing.label}</p>
            <p className="mt-5 text-lg font-semibold text-ink-700">{SITE.name}</p>
            <p className="text-ink-700/70">
              {SITE.billing.street}
              <br />
              {SITE.billing.zip} {SITE.billing.city}
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
              <dt className="text-ink-700/50">IČO</dt>
              <dd className="font-mono">{SITE.ico}</dd>
              <dt className="text-ink-700/50">DIČ</dt>
              <dd className="font-mono">{SITE.dic}</dd>
              <dt className="text-ink-700/50">Datová schránka</dt>
              <dd className="font-mono">{SITE.dataBox}</dd>
            </dl>
          </div>
          <div className="card" data-reveal style={{ ["--d" as string]: "180ms" }}>
            <p className="eyebrow">Obecné</p>
            <p className="mt-5 flex items-center gap-2 text-ink-700">
              <Icon name="mail" className="h-4 w-4 text-brand" />
              <a href={`mailto:${SITE.email}`} className="hover:text-brand">
                {SITE.email}
              </a>
            </p>
            <p className="mt-2 flex items-center gap-2 text-ink-700">
              <Icon name="clock" className="h-4 w-4 text-brand" /> {SITE.hours}
            </p>
            <p className="mt-5 text-[13px] leading-relaxed text-ink-700/55">{SITE.registry}</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading
            eyebrow="Kde nás najdete"
            title="Uprostřed České republiky"
            lead="Pelhřimov leží na Vysočině mezi Prahou a Brnem – s dobrou dostupností do celé ČR i střední Evropy."
          />
        </div>
      </section>
      <JsonLd data={breadcrumbJsonLd([{ name: "Kontakt", path: "/kontakt" }])} />
    </>
  );
}
