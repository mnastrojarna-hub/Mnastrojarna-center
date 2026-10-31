import Image from "next/image";
import Link from "next/link";
import { CtaBand, FaqList, FitBlock, MachineCard, ProcessSteps, SectionHeading, ServicesGrid, TeamGrid } from "@/components/blocks";
import { Counter } from "@/components/counter";
import { DowntimeCalc } from "@/components/downtime-calc";
import { HeroSheet } from "@/components/hero-sheet";
import { Icon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { MachiningStory } from "@/components/machining-story";
import { FAQ, INDUSTRIES, MACHINES, PROMISES, SITE, STATS } from "@/content/site";
import { faqJsonLd } from "@/lib/seo";

const MARQUEE = ["CNC frézování", "5osé obrábění", "Soustružení", "Drátové řezání EDM", "Nástrojářství", "Jednoúčelové stroje", "Prototypy", "Náhradní díly linek", "3D měření", "Konsignační sklad"];

const CAD_FEATURES = [
  ["Skici a profily", "Úsečky, oblouky, kružnice, drážky, mnohoúhelníky. Přesné rozměry číslem."],
  ["Parametrický model", "Vysunutí, rotace, díry se zahloubením, zaoblení, sražení, skořepina, pole, zrcadlení."],
  ["Strom prvků", "Každou operaci kdykoli upravíte – model se přepočítá jako v Inventoru."],
  ["Export pro výrobu", "STEP pro CAD/CAM, STL, 2D výkres s kótami a razítkem v PDF a DXF."],
] as const;

export default function HomePage() {
  return (
    <>
      {/* ---------- HERO ---------- */}
      <section className="paper relative overflow-hidden pb-16 pt-28 md:pb-24 md:pt-36">
        <div className="bg-grid-light absolute inset-0" />
        <div className="absolute -left-40 top-20 h-[520px] w-[520px] rounded-full bg-brand/10 blur-[150px]" />
        <div className="container relative grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-6">
            <p className="eyebrow animate-fade-up">Nástrojárna · CNC obrábění · Stroje na míru</p>
            <h1 className="h-display line-reveal mt-6 text-[3.1rem] text-ink-700 sm:text-7xl lg:text-[clamp(3.6rem,5.4vw,5.9rem)]">
              <span>
                <span style={{ ["--l" as string]: 0 }}>Váš partner ve</span>
              </span>
              <br />
              <span>
                <span style={{ ["--l" as string]: 1 }} className="text-brand">
                  strojírenství
                </span>
              </span>
            </h1>
            <p className="mt-7 max-w-xl animate-fade-up text-lg leading-relaxed text-ink-700/70 [animation-delay:300ms] md:text-xl">
              Přesné díly, nástroje a jednoúčelové stroje pro firmy, jejichž výroba nesmí stát. Od výkresu po měřicí protokol – ve vlastní
              výrobě, v termínu a pod jednou odpovědností.
            </p>
            <div className="mt-10 flex animate-fade-up flex-col gap-3 [animation-delay:420ms] sm:flex-row">
              <Link href="/poptavka" className="btn-primary !px-8 !py-4 !text-base">
                <Icon name="upload" className="h-5 w-5" /> Nahrát výkres a poptat
              </Link>
              <Link href="/cad" className="btn-ghost !px-8 !py-4 !text-base">
                <Icon name="cube" className="h-5 w-5 text-brand" /> Online CAD zdarma
              </Link>
            </div>
            <dl className="mt-12 grid max-w-xl animate-fade-up grid-cols-3 border-t border-ink-700/10 pt-6 [animation-delay:540ms]">
              {[
                ["ISO", "9001 & 14001"],
                [`${SITE.founded}`, "tradice od roku"],
                ["50 000+", "Kč – B2B zakázky"],
              ].map(([v, l]) => (
                <div key={l}>
                  <dt className="font-display text-3xl font-bold text-ink-700">{v}</dt>
                  <dd className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-700/45">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="animate-fade-up [animation-delay:200ms] lg:col-span-6">
            <HeroSheet />
          </div>
        </div>
      </section>

      {/* ---------- MARQUEE ---------- */}
      <div className="overflow-hidden border-y border-ink-700/10 bg-white py-5" aria-hidden>
        <div className="marquee-track flex w-max gap-10 whitespace-nowrap">
          {[...MARQUEE, ...MARQUEE].map((t, i) => (
            <span key={i} className="flex items-center gap-10 font-display text-2xl font-bold uppercase text-ink-700/20">
              {t} <span className="h-2 w-2 rotate-45 bg-brand" />
            </span>
          ))}
        </div>
      </div>

      {/* ---------- PROSTOJ ---------- */}
      <section className="section relative">
        <div className="container grid gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Proč Mnástrojárna"
              title={
                <>
                  Prostoj linky stojí víc <span className="text-brand">než díl.</span>
                </>
              }
              lead="Vyrábíte pleny, obaly, desky nebo potraviny – ne hřídele. Přesto na přesných dílech závisí každá vaše směna. My jsme strojírna, kterou nemusíte mít: konstrukce, výroba, kontrola i sklad pod jednou střechou."
            />
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {PROMISES.map((p, i) => (
                <div key={p.t} data-reveal style={{ ["--d" as string]: `${i * 80}ms` }} className="border-t border-ink-700/15 pt-4">
                  <p className="font-mono text-[11px] text-brand">0{i + 1}</p>
                  <h3 className="mt-1 font-display text-xl font-bold uppercase text-ink-700">{p.t}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink-700/60">{p.d}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-7" data-reveal>
            <DowntimeCalc />
          </div>
        </div>
      </section>

      {/* ---------- SLUŽBY ---------- */}
      <section className="section bg-steel-100" id="sluzby">
        <div className="container">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading
              eyebrow="Služby"
              title="Od výkresu po hotový stroj"
              lead="Kusová i sériová výroba, nástroje, prototypy a celé stroje. Vše, co výrobní firma potřebuje od strojírenského partnera."
            />
            <Link href="/sluzby" className="btn-ghost shrink-0" data-reveal>
              Všechny služby <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-14">
            <ServicesGrid limit={6} />
          </div>
        </div>
      </section>

      {/* ---------- PŘÍBĚH DÍLU (scroll 3D) ---------- */}
      <MachiningStory />

      {/* ---------- ČÍSLA jako kóty ---------- */}
      <section className="border-y border-ink-700/10 bg-white py-20">
        <div className="container grid gap-12 md:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <div key={s.label} data-reveal style={{ ["--d" as string]: `${i * 120}ms` }}>
              <p className="font-display text-5xl font-bold text-ink-700 md:text-6xl">
                <Counter value={s.value} prefix={s.prefix} suffix={s.suffix} decimals={s.decimals} />
              </p>
              <div className="dim mt-4 text-brand" />
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-700/50">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- ONLINE CAD ---------- */}
      <section className="section relative overflow-hidden">
        <div className="bg-grid-light absolute inset-0 opacity-70" />
        <div className="container relative grid items-center gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Pro konstruktéry · zdarma"
              title={
                <>
                  Mnástrojárna <span className="text-brand">CAD</span>
                </>
              }
              lead="Plnohodnotný parametrický 3D/2D CAD přímo v prohlížeči. Nakreslete díl, upravte ho ve stromu prvků, vygenerujte výkres a uložte si STEP nebo DXF do počítače. Bez instalace, bez registrace."
            />
            <ul className="mt-8 space-y-5" data-reveal>
              {CAD_FEATURES.map(([t, d]) => (
                <li key={t} className="flex gap-4">
                  <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white">
                    <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} />
                  </span>
                  <span>
                    <strong className="block text-[16px] text-ink-700">{t}</strong>
                    <span className="text-[14px] text-ink-700/60">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-10 flex flex-wrap gap-3" data-reveal>
              <Link href="/cad" className="btn-primary !px-7 !py-3.5">
                <Icon name="cube" className="h-5 w-5" /> Spustit CAD
              </Link>
              <span className="self-center font-mono text-[11px] uppercase tracking-widest text-ink-700/45">Jádro OpenCascade · běží lokálně</span>
            </div>
          </div>
          <div className="lg:col-span-7" data-reveal>
            <Link href="/cad" className="group relative block overflow-hidden rounded-[24px] border border-ink-700/10 bg-white p-2 shadow-[0_60px_120px_-60px_rgba(39,36,37,.5)]">
              <div className="flex items-center gap-1.5 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-ink-700/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-ink-700/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-ink-700/15" />
                <span className="ml-3 font-mono text-[11px] text-ink-700/40">mnastrojarna.cz/cad</span>
              </div>
              <div className="relative aspect-[16/10] overflow-hidden rounded-[16px] border border-ink-700/10">
                <Image src="/img/cad-screen.png" alt="Mnástrojárna CAD – parametrický model příruby v prohlížeči" fill sizes="(min-width:1024px) 58vw, 100vw" className="object-cover object-left-top transition-transform duration-700 group-hover:scale-[1.02]" />
              </div>
              <span className="absolute bottom-6 right-6 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-white opacity-0 shadow-lg transition group-hover:opacity-100">
                Otevřít CAD →
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- PROCES ---------- */}
      <section className="section bg-steel-100">
        <div className="container">
          <SectionHeading eyebrow="Jak spolupracujeme" title="Pět kroků k hotovému dílu" lead="Jasný proces, jedna kontaktní osoba a žádná překvapení." />
          <div className="mt-16">
            <ProcessSteps />
          </div>
        </div>
      </section>

      {/* ---------- STROJOVÝ PARK ---------- */}
      <section className="section">
        <div className="container">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading
              eyebrow="Strojový park"
              title="Velké díly. Mikronové tolerance."
              lead="Pětiosá centra s řízením HEIDENHAIN a Sinumerik, multifunkční soustružnicko-frézovací centrum a velký drátořez FANUC."
            />
            <Link href="/strojovy-park" className="btn-ghost shrink-0" data-reveal>
              Celý strojový park <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-2">
            {MACHINES.slice(0, 2).map((m, i) => (
              <MachineCard key={m.id} m={m} i={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ---------- ODVĚTVÍ ---------- */}
      <section className="section bg-steel-100">
        <div className="container">
          <SectionHeading
            eyebrow="Pro koho pracujeme"
            title="Strojírna pro firmy, které strojírnou nejsou"
            lead="Naši klienti mají vlastní výrobu – a potřebují partnera, který jim bez starostí dodá přesné díly, nástroje a stroje."
          />
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-ink-700/10 bg-ink-700/10 md:grid-cols-2 lg:grid-cols-3">
            {INDUSTRIES.map((x, i) => (
              <div key={x.t} data-reveal style={{ ["--d" as string]: `${(i % 3) * 90}ms` }} className="group relative bg-white p-8 transition-colors duration-500 hover:bg-[#fff7f6]">
                <span className="absolute right-6 top-6 font-mono text-xs text-ink-700/25 transition-colors group-hover:text-brand">{String(i + 1).padStart(2, "0")}</span>
                <span className="block h-px w-8 bg-brand transition-all duration-500 group-hover:w-16" />
                <h3 className="mt-5 font-display text-2xl font-bold uppercase text-ink-700">{x.t}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-700/65">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- O FIRMĚ ---------- */}
      <section className="section">
        <div className="container grid items-center gap-14 lg:grid-cols-2">
          <div data-reveal className="relative">
            <div className="crop p-4">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-ink-700/10 bg-white">
                <Image src="/img/hypertun-65.jpg" alt="Multifunkční soustružnicko-frézovací centrum HYPERTUN 65 v Mnástrojárně" fill sizes="(min-width:1024px) 50vw, 100vw" className="object-cover" />
              </div>
            </div>
            <div className="absolute -bottom-4 -right-2 hidden rounded-2xl bg-brand p-6 text-white shadow-2xl md:block">
              <p className="font-display text-5xl font-bold">{new Date().getFullYear() - SITE.founded}+</p>
              <p className="text-sm text-white/85">let zkušeností</p>
            </div>
          </div>
          <div>
            <SectionHeading
              eyebrow="O nás"
              title="Moderní nástrojárna s vlastním týmem"
              lead={`Od roku ${SITE.founded} se specializujeme na kovoobrábění, nástrojářskou výrobu a vývoj a výrobu prototypů pro různá průmyslová odvětví. Z Pelhřimova dodáváme českým i zahraničním partnerům.`}
            />
            <ul className="mt-8 grid gap-3 text-[15px] text-ink-700/80 sm:grid-cols-2" data-reveal>
              {["Vlastní kmenoví odborníci", "Spolupráce s univerzitami a výzkumem", "Konstrukce, výroba i montáž in-house", "Urgentní výroba pro stálé partnery", "Konsignační sklad a logistika", "Programování i pro externí firmy"].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-brand" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-10" data-reveal>
              <Link href="/o-nas" className="btn-ghost">
                Více o nás <Icon name="arrow" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- TÝM ---------- */}
      <section className="section bg-steel-100">
        <div className="container">
          <SectionHeading eyebrow="Kontaktní osoby" title="Mluvíte přímo s lidmi, kteří rozhodují" lead="Žádné call centrum. Obchod, technologie i vedení firmy na jeden e-mail nebo telefon." />
          <div className="mt-14">
            <TeamGrid />
          </div>
        </div>
      </section>

      {/* ---------- PRO KOHO ---------- */}
      <section className="section">
        <div className="container">
          <SectionHeading eyebrow="Férově na rovinu" title="Komu pomůžeme nejvíc" />
          <div className="mt-12">
            <FitBlock />
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="section bg-steel-100">
        <div className="container grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <SectionHeading eyebrow="FAQ" title="Časté otázky" lead="Nenašli jste odpověď? Napište našemu obchodnímu zástupci." />
          </div>
          <div className="lg:col-span-8" data-reveal>
            <FaqList />
          </div>
        </div>
      </section>

      <CtaBand />
      <JsonLd data={faqJsonLd(FAQ)} />
    </>
  );
}
