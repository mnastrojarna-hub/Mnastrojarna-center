import { CtaBand, PageHero, SectionHeading } from "@/components/blocks";
import { Icon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { SITE } from "@/content/site";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Kvalita a certifikáty ISO 9001, ISO 14001",
  description:
    "Certifikace ISO 9001 a ISO 14001 od roku 2017, 100% výstupní kontrola, měřicí protokol ke každému dílu a 3D měření s přesností až 2 µm. Kontrola dvěma nezávislými osobami.",
  path: "/kvalita",
});

const PILLARS = [
  { icon: "shield" as const, t: "ISO 9001", d: `Systém managementu kvality certifikovaný od roku ${SITE.isoSince}.` },
  { icon: "sparkle" as const, t: "ISO 14001", d: `Systém environmentálního managementu certifikovaný od roku ${SITE.isoSince}.` },
  { icon: "measure" as const, t: "100% kontrola", d: "Každý vyrobený díl prochází výstupní kontrolou – bez výjimek." },
  { icon: "file" as const, t: "Měřicí protokol", d: "Ke každému dílu z kusové a prototypové výroby. Dohledatelný i měsíce zpětně." },
  { icon: "axes" as const, t: "3D měření ±2 µm", d: "Automatické 3D sondy s řádnými výstupními protokoly na vyžádání." },
  { icon: "check" as const, t: "Čtyři oči", d: "Měření provádějí dvě nezávislé osoby – eliminace selhání lidského faktoru." },
];

export default function QualityPage() {
  return (
    <>
      <PageHero
        eyebrow="Kvalita"
        crumbs={[{ name: "Kvalita a certifikáty", path: "/kvalita" }]}
        title={
          <>
            Každý díl <span className="text-brand">změřený</span>
          </>
        }
        lead="Kvalitu nedeklarujeme, ale dokládáme. Ke každému dílu máme měřicí protokol, a proto můžeme kdykoli zpětně doložit skutečnou hodnotu každého rozměru."
      />
      <section className="section">
        <div className="container grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p, i) => (
            <div key={p.t} data-reveal style={{ ["--d" as string]: `${(i % 3) * 90}ms` }} className="spot card">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand/10 text-brand">
                <Icon name={p.icon} />
              </span>
              <h2 className="mt-5 font-display text-2xl font-bold uppercase text-ink-700">{p.t}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-700/65">{p.d}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="section bg-steel-100">
        <div className="container max-w-4xl">
          <SectionHeading
            eyebrow="Metrologie"
            title="Kalibrovaná měřidla, externí laboratoře"
            lead="Kromě 3D měření máme k dispozici mnoho kalibrů, měrek a speciálních měřidel, která pravidelně kalibrujeme v externích kalibračních laboratořích. Obráběcí centra jsou vybavena sondami pro měření obrobků přímo ve stroji a laserovým měřením nástrojů."
          />
          <p className="mt-8 rounded-2xl border border-ink-700/10 bg-white p-6 text-[15px] text-ink-700/70" data-reveal>
            Certifikáty ISO 9001 a ISO 14001 vám rádi zašleme v PDF pro schválení dodavatele (supplier audit).
          </p>
        </div>
      </section>
      <CtaBand />
      <JsonLd data={breadcrumbJsonLd([{ name: "Kvalita a certifikáty", path: "/kvalita" }])} />
    </>
  );
}
