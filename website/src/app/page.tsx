import Image from "next/image";
import Link from "next/link";
import { CtaBand, FaqList, FitBlock, MachineCard, ProcessSteps, SectionHeading, ServicesGrid, TeamGrid } from "@/components/blocks";
import { Counter } from "@/components/counter";
import { HeroCanvas } from "@/components/hero-canvas";
import { Icon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { FAQ, INDUSTRIES, MACHINES, PROMISES, SITE, STATS } from "@/content/site";
import { faqJsonLd } from "@/lib/seo";

const MARQUEE = [
  "CNC frézování",
  "5osé obrábění",
  "Soustružení",
  "Drátové řezání EDM",
  "Nástrojářství",
  "Jednoúčelové stroje",
  "Prototypy",
  "Náhradní díly linek",
  "3D měření",
  "Konsignační sklad",
];

export default function HomePage() {
  return (
    <>
      {/* ---------- HERO ---------- */}
      <section className="noise relative flex min-h-[100svh] items-center overflow-hidden bg-ink text-white">
        <HeroCanvas className="absolute inset-0" />
        <div className="bg-grid mask-fade pointer-events-none absolute inset-0" />
        <div className="pointer-events-none absolute -left-40 top-1/3 h-[520px] w-[520px] rounded-full bg-brand/20 blur-[160px]" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/30 to-transparent md:bg-gradient-to-r md:from-ink/80 md:via-ink/10 md:to-transparent" />

        <div className="container relative z-10 pb-24 pt-36 md:pb-28">
          <div className="max-w-3xl">
            <p className="eyebrow animate-fade-up">Nástrojárna · CNC obrábění · Stroje na míru</p>
            <h1 className="h-display mt-6 animate-fade-up text-[3.2rem] [animation-delay:120ms] sm:text-7xl lg:text-[6.2rem]">
              Váš partner
              <br />
              ve <span className="text-glow text-brand">strojírenství</span>
            </h1>
            <p className="mt-7 max-w-xl animate-fade-up text-lg leading-relaxed text-white/70 [animation-delay:240ms] md:text-xl">
              Přesné díly, nástroje a jednoúčelové stroje pro firmy, jejichž výroba nesmí stát. Od výkresu po měřicí protokol –
              ve vlastní výrobě, v termínu a pod jednou odpovědností.
            </p>
            <div className="mt-10 flex animate-fade-up flex-col gap-3 [animation-delay:360ms] sm:flex-row">
              <Link href="/poptavka" className="btn-primary !px-8 !py-4 !text-base">
                <Icon name="upload" className="h-5 w-5" /> Nahrát výkres a poptat
              </Link>
              <Link href="/strojovy-park" className="btn-ghost-dark !px-8 !py-4 !text-base">
                Strojový park <Icon name="arrow" className="h-5 w-5" />
              </Link>
            </div>
            <ul className="mt-12 flex animate-fade-up flex-wrap gap-x-6 gap-y-3 font-mono text-[11px] uppercase tracking-[0.18em] text-white/50 [animation-delay:480ms]">
              <li className="flex items-center gap-2">
                <Icon name="shield" className="h-4 w-4 text-brand" /> ISO 9001 & 14001
              </li>
              <li className="flex items-center gap-2">
                <Icon name="clock" className="h-4 w-4 text-brand" /> Od roku {SITE.founded}
              </li>
              <li className="flex items-center gap-2">
                <Icon name="pin" className="h-4 w-4 text-brand" /> Pelhřimov, střed ČR
              </li>
              <li className="flex items-center gap-2">
                <Icon name="check" className="h-4 w-4 text-brand" /> B2B od 50 000 Kč
              </li>
            </ul>
          </div>
        </div>

        <div className="absolute bottom-8 left-1/2 z-10 hidden -translate-x-1/2 flex-col items-center gap-2 font-mono text-[10px] uppercase tracking-[0.3em] text-white/35 md:flex">
          Scroll
          <span className="relative h-10 w-px overflow-hidden bg-white/15">
            <span className="absolute inset-x-0 top-0 h-1/2 animate-scan bg-brand" />
          </span>
        </div>
      </section>

      {/* ---------- MARQUEE ---------- */}
      <div className="overflow-hidden border-y border-white/10 bg-ink-900 py-5" aria-hidden>
        <div className="marquee-track flex w-max gap-10 whitespace-nowrap">
          {[...MARQUEE, ...MARQUEE].map((t, i) => (
            <span key={i} className="flex items-center gap-10 font-display text-2xl font-bold uppercase text-white/25">
              {t} <span className="h-2 w-2 rotate-45 bg-brand" />
            </span>
          ))}
        </div>
      </div>

      {/* ---------- PROBLÉM / HODNOTA ---------- */}
      <section className="section bg-grid-light relative">
        <div className="container grid gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHeading
              eyebrow="Proč Mnástrojárna"
              title={
                <>
                  Prostoj linky stojí víc <span className="text-brand">než díl.</span>
                </>
              }
              lead="Vyrábíte pleny, obaly, desky nebo potraviny – ne hřídele. Přesto na přesných dílech závisí každá vaše směna. My jsme ta strojírna, kterou nemusíte mít: konstrukce, výroba, kontrola i sklad pod jednou střechou."
            />
            <div className="mt-8 flex gap-3" data-reveal>
              <Link href="/sluzby/nahradni-dily-pro-vyrobni-linky" className="btn-ghost">
                Náhradní díly pro linky <Icon name="arrow" className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:col-span-7">
            {PROMISES.map((p, i) => (
              <div key={p.t} data-reveal style={{ ["--d" as string]: `${i * 90}ms` }} className="spot card hover:-translate-y-1 hover:shadow-[0_30px_60px_-30px_rgba(39,36,37,.3)]">
                <span className="font-mono text-xs text-brand">0{i + 1}</span>
                <h3 className="mt-3 font-display text-2xl font-bold uppercase text-ink-700">{p.t}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-700/65">{p.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- ČÍSLA ---------- */}
      <section className="noise relative overflow-hidden bg-ink py-20 text-white">
        <div className="bg-grid absolute inset-0 opacity-50" />
        <div className="container relative grid grid-cols-2 gap-y-12 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <div key={s.label} data-reveal style={{ ["--d" as string]: `${i * 100}ms` }} className="border-l border-white/10 pl-6">
              <p className="font-display text-4xl font-bold text-white md:text-6xl">
                <Counter value={s.value} prefix={s.prefix} suffix={s.suffix} decimals={s.decimals} />
              </p>
              <p className="mt-2 text-[14px] text-white/50">{s.label}</p>
            </div>
          ))}
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

      {/* ---------- 3D PROHLÍŽEČ (přidaná hodnota) ---------- */}
      <section className="noise relative overflow-hidden bg-ink py-24 text-white md:py-32">
        <div className="bg-grid mask-fade absolute inset-0" />
        <div className="absolute right-0 top-0 h-[500px] w-[500px] rounded-full bg-brand/20 blur-[150px]" />
        <div className="container relative grid items-center gap-14 lg:grid-cols-2">
          <div>
            <SectionHeading
              dark
              eyebrow="Zdarma pro konstruktéry"
              title={
                <>
                  Online 3D prohlížeč <span className="text-brand">STEP</span>
                </>
              }
              lead="Otevřete model přímo v prohlížeči – bez instalace a bez nahrávání na server. Okamžitě uvidíte rozměry, objem a odhad hmotnosti v různých materiálech. Jedním klikem z něj pošlete poptávku."
            />
            <ul className="mt-8 space-y-3 text-[15px] text-white/75" data-reveal>
              {["Soubory STEP / STP / IGES zpracované lokálně ve vašem prohlížeči", "Gabarity, objem, povrch a hmotnost (ocel, nerez, hliník…)", "Rovnou připojit k poptávce – bez e-mailů a přeposílání"].map((t) => (
                <li key={t} className="flex gap-3">
                  <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-brand" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-10 flex flex-wrap gap-3" data-reveal>
              <Link href="/3d-prohlizec" className="btn-primary !px-7 !py-3.5">
                <Icon name="cube" className="h-5 w-5" /> Otevřít 3D prohlížeč
              </Link>
            </div>
          </div>
          <div data-reveal className="relative">
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-white/[0.06] to-transparent p-6">
              <div className="bg-grid absolute inset-0 opacity-70" />
              <div className="relative flex h-full flex-col justify-between">
                <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-widest text-white/40">
                  <span>priruba_DN80.step</span>
                  <span className="text-brand">● živý náhled</span>
                </div>
                <svg viewBox="0 0 400 240" className="mx-auto w-4/5 drop-shadow-[0_0_30px_rgba(224,57,48,.35)]">
                  <g fill="none" stroke="#E03930" strokeWidth="1.4">
                    <ellipse cx="200" cy="80" rx="150" ry="42" />
                    <path d="M50 80v40M350 80v40" />
                    <path d="M50 120c0 23 67 42 150 42s150-19 150-42" />
                    <ellipse cx="200" cy="80" rx="60" ry="17" />
                    <path d="M140 80v90M260 80v90" opacity=".7" />
                    <path d="M140 170c0 9 27 17 60 17s60-8 60-17" opacity=".7" />
                  </g>
                  <g fill="#fff" opacity=".85">
                    {Array.from({ length: 8 }).map((_, i) => {
                      const a = (i / 8) * Math.PI * 2;
                      return <ellipse key={i} cx={200 + Math.cos(a) * 105} cy={80 + Math.sin(a) * 29} rx="7" ry="3" />;
                    })}
                  </g>
                  <g stroke="#fff" strokeOpacity=".35" strokeDasharray="3 4">
                    <path d="M50 215h300M50 205v20M350 205v20" />
                  </g>
                  <text x="200" y="232" textAnchor="middle" fill="#fff" fillOpacity=".7" fontFamily="monospace" fontSize="12">
                    Ø 300.00 mm
                  </text>
                </svg>
                <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 font-mono text-[12px]">
                  {[
                    ["Gabarit", "300×300×82"],
                    ["Objem", "3 412 cm³"],
                    ["Ocel", "26,8 kg"],
                  ].map(([k, v]) => (
                    <div key={k} className="bg-ink-900 p-3">
                      <p className="text-white/40">{k}</p>
                      <p className="mt-1 text-white">{v}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- PROCES ---------- */}
      <section className="section">
        <div className="container">
          <SectionHeading eyebrow="Jak spolupracujeme" title="Pět kroků k hotovému dílu" lead="Jasný proces, jedna kontaktní osoba a žádná překvapení." />
          <div className="mt-16">
            <ProcessSteps />
          </div>
        </div>
      </section>

      {/* ---------- STROJOVÝ PARK ---------- */}
      <section className="noise relative overflow-hidden bg-ink py-24 text-white md:py-32">
        <div className="bg-grid absolute inset-0 opacity-50" />
        <div className="container relative">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading
              dark
              eyebrow="Strojový park"
              title="Velké díly. Mikronové tolerance."
              lead="Pětiosá centra s řízením HEIDENHAIN a Sinumerik, multifunkční soustružnicko-frézovací centrum a velký drátořez FANUC."
            />
            <Link href="/strojovy-park" className="btn-ghost-dark shrink-0" data-reveal>
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
              <div key={x.t} data-reveal style={{ ["--d" as string]: `${(i % 3) * 90}ms` }} className="group relative bg-white p-8 transition-colors duration-500 hover:bg-ink">
                <span className="font-mono text-xs text-brand">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="mt-3 font-display text-2xl font-bold uppercase text-ink-700 transition-colors group-hover:text-white">{x.t}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-700/65 transition-colors group-hover:text-white/60">{x.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- O FIRMĚ ---------- */}
      <section className="section">
        <div className="container grid items-center gap-14 lg:grid-cols-2">
          <div data-reveal className="relative">
            <div className="relative aspect-[4/3] overflow-hidden rounded-3xl">
              <Image src="/img/hypertun-65.jpg" alt="Multifunkční soustružnicko-frézovací centrum HYPERTUN 65 v Mnástrojárně" fill sizes="(min-width:1024px) 50vw, 100vw" className="object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-ink/70 to-transparent" />
              <p className="absolute bottom-5 left-5 font-mono text-[11px] uppercase tracking-widest text-white/80">Provozovna Pelhřimov</p>
            </div>
            <div className="absolute -bottom-6 -right-3 hidden rounded-2xl bg-brand p-6 text-white shadow-2xl md:block">
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
              {[
                "Vlastní kmenoví odborníci",
                "Spolupráce s univerzitami a výzkumem",
                "Konstrukce, výroba i montáž in-house",
                "Urgentní výroba pro stálé partnery",
                "Konsignační sklad a logistika",
                "Programování i pro externí firmy",
              ].map((t) => (
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
