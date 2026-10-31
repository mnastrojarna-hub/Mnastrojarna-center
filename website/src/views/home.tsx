import Image from "next/image";
import Link from "next/link";
import { CtaBand, FaqList, FitBlock, MachineCard, ProcessSteps, ReferencesBlock, SectionHeading, ServicesGrid, TeamGrid } from "@/components/blocks";
import { Counter } from "@/components/counter";
import { DowntimeCalc } from "@/components/downtime-calc";
import { HeroSheet } from "@/components/hero-sheet";
import { Icon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { MachiningStory } from "@/components/machining-story";
import { getDict } from "@/content";
import { SITE } from "@/content/site";
import { href, type Locale } from "@/i18n/config";
import { faqJsonLd, pageMeta } from "@/lib/seo";

export function homeMeta(locale: Locale) {
  const t = getDict(locale);
  return { ...pageMeta({ locale, page: "home", title: t.meta.title, description: t.meta.description, keywords: t.meta.keywords }), title: { absolute: t.meta.title } };
}

export function HomeView({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const h = t.home;
  return (
    <>
      {/* ---------- HERO ---------- */}
      <section className="paper relative overflow-hidden pb-16 pt-28 md:pb-24 md:pt-36">
        <div className="bg-grid-light absolute inset-0" />
        <div className="absolute -left-40 top-20 h-[520px] w-[520px] rounded-full bg-brand/10 blur-[150px]" />
        <div className="container relative grid items-center gap-12 lg:grid-cols-12 lg:gap-8">
          <div className="lg:col-span-6">
            <p className="eyebrow animate-fade-up">{h.eyebrow}</p>
            <h1 className="h-display line-reveal mt-6 text-[3.1rem] text-ink-700 sm:text-7xl lg:text-[clamp(3.6rem,5.4vw,5.9rem)]">
              <span>
                <span style={{ ["--l" as string]: 0 }}>{h.h1a}</span>
              </span>
              <br />
              <span>
                <span style={{ ["--l" as string]: 1 }} className="text-brand">
                  {h.h1b}
                </span>
              </span>
            </h1>
            <p className="mt-7 max-w-xl animate-fade-up text-lg leading-relaxed text-ink-700/70 [animation-delay:300ms] md:text-xl">{h.lead}</p>
            <div className="mt-10 flex animate-fade-up flex-col gap-3 [animation-delay:420ms] sm:flex-row">
              <Link href={href(locale, "rfq")} className="btn-primary !px-8 !py-4 !text-base">
                <Icon name="upload" className="h-5 w-5" /> {t.common.uploadAndQuote}
              </Link>
              <Link href="/cad" className="btn-ghost !px-8 !py-4 !text-base">
                <Icon name="cube" className="h-5 w-5 text-brand" /> {t.common.cadFree}
              </Link>
            </div>
            <dl className="mt-12 grid max-w-xl animate-fade-up grid-cols-3 border-t border-ink-700/10 pt-6 [animation-delay:540ms]">
              {h.facts.map(([v, l]) => (
                <div key={l}>
                  <dt className="font-display text-3xl font-bold text-ink-700">{v}</dt>
                  <dd className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-700/45">{l}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="animate-fade-up [animation-delay:200ms] lg:col-span-6">
            <HeroSheet t={t.heroSheet} slogan={t.slogan} />
          </div>
        </div>
      </section>

      {/* ---------- MARQUEE ---------- */}
      <div className="overflow-hidden border-y border-ink-700/10 bg-white py-5" aria-hidden>
        <div className="marquee-track flex w-max gap-10 whitespace-nowrap">
          {[...h.marquee, ...h.marquee].map((x, i) => (
            <span key={i} className="flex items-center gap-10 font-display text-2xl font-bold uppercase text-ink-700/20">
              {x} <span className="h-2 w-2 rotate-45 bg-brand" />
            </span>
          ))}
        </div>
      </div>

      {/* ---------- PROSTOJ ---------- */}
      <section className="section relative">
        <div className="container grid gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHeading eyebrow={h.whyEyebrow} title={h.whyTitle} lead={h.whyLead} />
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {t.promises.map((p, i) => (
                <div key={p.t} data-reveal style={{ ["--d" as string]: `${i * 80}ms` }} className="border-t border-ink-700/15 pt-4">
                  <p className="font-mono text-[11px] text-brand">0{i + 1}</p>
                  <h3 className="mt-1 font-display text-xl font-bold uppercase text-ink-700">{p.t}</h3>
                  <p className="mt-1 text-[14px] leading-relaxed text-ink-700/60">{p.d}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="lg:col-span-7" data-reveal>
            <DowntimeCalc t={t.calc} ctaHref={`${href(locale, "rfq")}?sluzba=nahradni-dily-pro-vyrobni-linky`} locale={locale} />
          </div>
        </div>
      </section>

      {/* ---------- SLUŽBY ---------- */}
      <section className="section bg-steel-100" id="sluzby">
        <div className="container">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading eyebrow={h.servicesEyebrow} title={h.servicesTitle} lead={h.servicesLead} />
            <Link href={href(locale, "services")} className="btn-ghost shrink-0" data-reveal>
              {t.common.allServices} <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-14">
            <ServicesGrid locale={locale} limit={6} />
          </div>
        </div>
      </section>

      {/* ---------- PŘÍBĚH DÍLU (scroll 3D) ---------- */}
      <MachiningStory t={t.story} />

      {/* ---------- ČÍSLA jako kóty ---------- */}
      <section className="border-y border-ink-700/10 bg-white py-20">
        <div className="container grid gap-12 md:grid-cols-2 lg:grid-cols-4">
          {t.stats.map((s, i) => (
            <div key={s.label} data-reveal style={{ ["--d" as string]: `${i * 120}ms` }}>
              <p className="font-display text-5xl font-bold text-ink-700 md:text-6xl">
                <Counter value={s.value} prefix={s.prefix} suffix={s.suffix} locale={locale} />
              </p>
              <div className="dim mt-4 text-brand" />
              <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-700/50">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- REFERENCE ---------- */}
      <section className="section">
        <div className="container">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading eyebrow={h.refsEyebrow} title={h.refsTitle} lead={h.refsLead} />
            <Link href={href(locale, "references")} className="btn-ghost shrink-0" data-reveal>
              {h.refsMore} <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-14">
            <ReferencesBlock locale={locale} compact />
          </div>
        </div>
      </section>

      {/* ---------- ONLINE CAD ---------- */}
      <section className="section relative overflow-hidden bg-steel-100">
        <div className="bg-grid-light absolute inset-0 opacity-70" />
        <div className="container relative grid items-center gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionHeading eyebrow={h.cadEyebrow} title={h.cadTitle} lead={h.cadLead} />
            <ul className="mt-8 space-y-5" data-reveal>
              {h.cadFeatures.map(([ft, d]) => (
                <li key={ft} className="flex gap-4">
                  <span className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white">
                    <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} />
                  </span>
                  <span>
                    <strong className="block text-[16px] text-ink-700">{ft}</strong>
                    <span className="text-[14px] text-ink-700/60">{d}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-10 flex flex-wrap items-center gap-3" data-reveal>
              <Link href="/cad" className="btn-primary !px-7 !py-3.5">
                <Icon name="cube" className="h-5 w-5" /> {h.cadOpen}
              </Link>
              <span className="font-mono text-[11px] uppercase tracking-widest text-ink-700/45">{h.cadNote}</span>
            </div>
            {h.cadLangNote && <p className="mt-4 text-[13px] text-ink-700/50">{h.cadLangNote}</p>}
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
                <Image src="/img/cad-screen.png" alt={h.cadAlt} fill sizes="(min-width:1024px) 58vw, 100vw" className="object-cover object-left-top transition-transform duration-700 group-hover:scale-[1.02]" />
              </div>
              <span className="absolute bottom-6 right-6 rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-white opacity-0 shadow-lg transition group-hover:opacity-100">{h.cadHover}</span>
            </Link>
          </div>
        </div>
      </section>

      {/* ---------- PROCES ---------- */}
      <section className="section">
        <div className="container">
          <SectionHeading eyebrow={h.processEyebrow} title={h.processTitle} lead={h.processLead} />
          <div className="mt-16">
            <ProcessSteps locale={locale} />
          </div>
        </div>
      </section>

      {/* ---------- STROJOVÝ PARK ---------- */}
      <section className="section bg-steel-100">
        <div className="container">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <SectionHeading eyebrow={h.machinesEyebrow} title={h.machinesTitle} lead={h.machinesLead} />
            <Link href={href(locale, "machinery")} className="btn-ghost shrink-0" data-reveal>
              {h.machinesAll} <Icon name="arrow" className="h-4 w-4" />
            </Link>
          </div>
          <div className="mt-14 grid gap-5 lg:grid-cols-2">
            <MachineCard locale={locale} id="axile-g8" i={0} />
            <MachineCard locale={locale} id="hypertun-65" i={1} />
          </div>
        </div>
      </section>

      {/* ---------- ODVĚTVÍ ---------- */}
      <section className="section">
        <div className="container">
          <SectionHeading eyebrow={h.industriesEyebrow} title={h.industriesTitle} lead={h.industriesLead} />
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-ink-700/10 bg-ink-700/10 md:grid-cols-2 lg:grid-cols-3">
            {t.industries.map((x, i) => (
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
      <section className="section bg-steel-100">
        <div className="container grid items-center gap-14 lg:grid-cols-2">
          <div data-reveal className="relative">
            <div className="crop p-4">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-ink-700/10 bg-white">
                <Image src="/img/hypertun-65.jpg" alt={h.aboutAlt} fill sizes="(min-width:1024px) 50vw, 100vw" className="object-cover" />
              </div>
            </div>
            <div className="absolute -bottom-4 -right-2 hidden rounded-2xl bg-brand p-6 text-white shadow-2xl md:block">
              <p className="font-display text-5xl font-bold">{new Date().getFullYear() - SITE.founded}+</p>
              <p className="text-sm text-white/85">{t.common.yearsExperience}</p>
            </div>
          </div>
          <div>
            <SectionHeading eyebrow={h.aboutEyebrow} title={h.aboutTitle} lead={h.aboutLead} />
            <ul className="mt-8 grid gap-3 text-[15px] text-ink-700/80 sm:grid-cols-2" data-reveal>
              {h.aboutBullets.map((x) => (
                <li key={x} className="flex gap-2.5">
                  <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-brand" /> {x}
                </li>
              ))}
            </ul>
            <div className="mt-10" data-reveal>
              <Link href={href(locale, "about")} className="btn-ghost">
                {h.aboutMore} <Icon name="arrow" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- TÝM ---------- */}
      <section className="section">
        <div className="container">
          <SectionHeading eyebrow={h.teamEyebrow} title={h.teamTitle} lead={h.teamLead} />
          <div className="mt-14">
            <TeamGrid locale={locale} />
          </div>
        </div>
      </section>

      {/* ---------- PRO KOHO ---------- */}
      <section className="section bg-steel-100">
        <div className="container">
          <SectionHeading eyebrow={h.fitEyebrow} title={h.fitTitle} />
          <div className="mt-12">
            <FitBlock locale={locale} />
          </div>
        </div>
      </section>

      {/* ---------- FAQ ---------- */}
      <section className="section">
        <div className="container grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <SectionHeading eyebrow="FAQ" title={h.faqTitle} lead={h.faqLead} />
          </div>
          <div className="lg:col-span-8" data-reveal>
            <FaqList items={t.faq} />
          </div>
        </div>
      </section>

      <CtaBand locale={locale} />
      <JsonLd data={faqJsonLd(t.faq)} />
    </>
  );
}
