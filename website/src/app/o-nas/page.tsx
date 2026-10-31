import Image from "next/image";
import { CtaBand, PageHero, SectionHeading, TeamGrid } from "@/components/blocks";
import { Counter } from "@/components/counter";
import { JsonLd } from "@/components/json-ld";
import { SITE } from "@/content/site";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "O nás – moderní nástrojárna z Pelhřimova",
  description: `Mnástrojárna s.r.o. – moderní nástrojárna s tradicí od roku ${SITE.founded}. Vlastní tým, konstrukce, výroba i montáž pod jednou střechou, spolupráce s univerzitami. Seznamte se s námi.`,
  path: "/o-nas",
});

const TIMELINE = [
  { y: "2012", t: "Začátek tradice", d: "Začínáme s precizní nástrojářskou výrobou a obráběním." },
  { y: "2013", t: "CAD/CAM ZW3D", d: "Vlastní konstrukce a programování obráběcích center." },
  { y: "2015", t: "Mnástrojárna s.r.o.", d: "Zápis společnosti u Městského soudu v Praze." },
  { y: "2017", t: "ISO 9001 a 14001", d: "Certifikace systému řízení kvality a environmentu." },
  { y: "EU", t: "Prototypové centrum", d: "Investice do pětiosého centra AXILE G8, HYPERTUN 65 a drátořezu FANUC." },
  { y: "Dnes", t: "Váš partner ve strojírenství", d: "Rozšířený tým obchodu a technologie pro větší projekty." },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="O nás"
        crumbs={[{ name: "O nás", path: "/o-nas" }]}
        title={
          <>
            Vaše výroba. <span className="text-brand">Naše zodpovědnost.</span>
          </>
        }
        lead="Jsme moderní nástrojárna z Pelhřimova. Sami si realizujeme veškerou konstrukci, výrobu dílů a montáž sestav – a proto za kvalitu i termín můžeme vždy ručit."
      />

      <section className="section">
        <div className="container grid items-center gap-14 lg:grid-cols-2">
          <div className="prose-mn" data-reveal>
            <h2 className="h-display mb-8 text-4xl text-ink-700 md:text-5xl">Kdo jsme</h2>
            <p>
              Hlavní činností našeho týmu je precizní nástrojářská CNC výroba prototypů a komplexní obrábění – kusové i sériové.
              Zpracováváme všechny druhy dostupných materiálů a zaměřujeme se na výrobu a vývoj nových prototypových i mechanických
              součástí v souladu s nejnovějšími technologickými trendy.
            </p>
            <p>
              Specializujeme se také na výrobu jednoúčelových strojů a náhradních dílů, u kterých zajišťujeme kompletní povrchové a
              tepelné úpravy. Disponujeme vlastním týmem kmenových zaměstnanců s dlouholetými zkušenostmi v precizním strojírenství,
              doplněným o úzkou spolupráci s univerzitami a výzkumnými institucemi.
            </p>
            <p>
              Realizujeme projekty v oblastech výroby, automatizace, konstrukce strojů, robotiky a vývoje pokročilých technologií.
              Stálým odběratelům nabízíme urgentní výrobu, konsignační skladování i logistickou podporu.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4" data-reveal>
            <div className="relative col-span-2 aspect-[16/9] overflow-hidden rounded-2xl">
              <Image src="/img/axile-g8.png" alt="Pětiosé obráběcí centrum AXILE G8" fill sizes="(min-width:1024px) 50vw, 100vw" className="bg-white object-contain p-4" />
            </div>
            <div className="rounded-2xl bg-ink p-6 text-white">
              <p className="font-display text-5xl font-bold">
                <Counter value={SITE.founded} />
              </p>
              <p className="mt-1 text-sm text-white/60">tradice od roku</p>
            </div>
            <div className="rounded-2xl bg-brand p-6 text-white">
              <p className="font-display text-5xl font-bold">ISO</p>
              <p className="mt-1 text-sm text-white/85">9001 & 14001 od {SITE.isoSince}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="noise relative overflow-hidden bg-ink py-24 text-white md:py-32">
        <div className="bg-grid absolute inset-0 opacity-50" />
        <div className="container relative">
          <SectionHeading dark eyebrow="Příběh" title="Cesta k partnerovi ve strojírenství" />
          <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-3">
            {TIMELINE.map((x, i) => (
              <li key={x.y + x.t} data-reveal style={{ ["--d" as string]: `${(i % 3) * 100}ms` }} className="bg-ink p-8">
                <p className="font-display text-5xl font-bold text-brand">{x.y}</p>
                <h3 className="mt-4 font-display text-xl font-bold uppercase">{x.t}</h3>
                <p className="mt-2 text-[15px] text-white/60">{x.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section bg-steel-100">
        <div className="container">
          <SectionHeading eyebrow="Tým" title="Lidé, se kterými budete mluvit" />
          <div className="mt-14">
            <TeamGrid />
          </div>
        </div>
      </section>

      <section className="section" id="eu-projekty">
        <div className="container max-w-4xl">
          <SectionHeading eyebrow="Projekty EU" title="Spolufinancováno Evropskou unií" />
          <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-ink-700/75" data-reveal>
            <p>
              Pětiosé obráběcí centrum AXILE G8 s vybavením a drátořez FANUC byly pořízeny z projektu „Vybavení nového prototypového
              centra společnosti MNástrojárna s.r.o.“, reg. č. CZ.01.1.02/0.0/0.0/17_093/0012410.
            </p>
            <p>
              Stroj HYPERTUN 65 Powermill a programovací software byly pořízeny z projektu „Vybavení prototypové dílny společnosti
              Mnástrojárna s.r.o.“, reg. č. CZ.01.1.02/0.0/0.0/16_092/0010019.
            </p>
            <p>
              Na těchto strojích nabízíme provádění zkoušek externím subjektům za tržních, transparentních a nediskriminačních
              podmínek: ověření konstrukce (výroba prototypů), měření složitých tvarů, měření průchozích děr a profilů a ověření
              technologické obrobitelnosti.
            </p>
          </div>
        </div>
      </section>

      <CtaBand />
      <JsonLd data={breadcrumbJsonLd([{ name: "O nás", path: "/o-nas" }])} />
    </>
  );
}
