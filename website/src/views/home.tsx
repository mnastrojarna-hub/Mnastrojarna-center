import Image from "next/image";
import Link from "next/link";
import { Accent } from "@/components/accent";
import { TeamGrid } from "@/components/blocks";
import { Icon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { MachiningStory } from "@/components/machining-story";
import { ServicesIndex } from "@/components/services-index";
import { VideoShowcase } from "@/components/video-showcase";
import { getDict } from "@/content";
import { ALL_PHOTOS, CASES } from "@/content/cases";
import { REFERENCES, SALES, SERVICE_FACTS, SERVICE_ORDER, VIDEOS, YOUTUBE_CHANNEL } from "@/content/site";
import { href, type Locale } from "@/i18n/config";
import { mailToSales } from "@/lib/contact";
import { faqJsonLd, pageMeta, videoJsonLd } from "@/lib/seo";

export function homeMeta(locale: Locale) {
  const t = getDict(locale);
  return { ...pageMeta({ locale, page: "home", title: t.meta.title, description: t.meta.description, keywords: t.meta.keywords }), title: { absolute: t.meta.title } };
}

/** Fotky pro „živou stěnu“ v hero — jen formáty 4:3, aby sloupce plynuly. */
const WALL = ALL_PHOTOS.filter((p) => p.h / p.w > 0.7);
const cols = [0, 1, 2].map((c) => WALL.filter((_, i) => i % 3 === c));

export function HomeView({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const h = t.home;
  const env = t.pages.machinery.envelope;
  const clients = REFERENCES.filter((r) => r.kind === "client" && r.logo);
  const caseCode = (i: number, y?: number) => `№ ${String(i + 1).padStart(2, "0")}${y ? ` · ${y}` : ""}`;

  return (
    <>
      {/* ================= HERO: živá stěna skutečných zakázek ================= */}
      <section className="relative flex min-h-[100svh] items-center overflow-hidden">
        <div className="bg-grid-light absolute inset-0" />
        <div className="marquee-pause absolute inset-y-0 right-0 hidden w-[54%] gap-4 overflow-hidden pr-4 lg:flex" aria-hidden>
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-40 bg-gradient-to-r from-[#fbfbfa] to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-32 bg-gradient-to-b from-[#fbfbfa] to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-32 bg-gradient-to-t from-[#fbfbfa] to-transparent" />
          {cols.map((col, c) => (
            <div key={c} className="flex-1" data-speed={c === 1 ? "0.25" : "0.1"}>
              <div className={`photo-col flex flex-col gap-4 ${c === 1 ? "down" : ""}`} style={{ ["--dur" as string]: `${70 + c * 18}s` }}>
                {[...col, ...col].map((p, i) => (
                  <div key={p.src + i} className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-steel-200">
                    <Image src={p.src} alt="" fill sizes="20vw" className="object-cover" priority={i < 2} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="container relative z-10 pb-40 pt-32 lg:pb-20">
          <div className="max-w-3xl lg:max-w-[46%]">
            <p className="eyebrow animate-fade-up">{h.heroKicker}</p>
            <h1 className="h-display line-reveal mt-7 text-[clamp(3.2rem,7.4vw,8rem)] leading-[0.9] text-ink-700">
              {h.heroLines.map((l, i) => (
                <span key={i} className="block">
                  <span style={{ ["--l" as string]: i }}>
                    <Accent text={l} />
                  </span>
                </span>
              ))}
            </h1>
            <p className="mt-8 max-w-xl animate-fade-up text-lg leading-relaxed text-ink-700/70 [animation-delay:500ms] md:text-xl">{h.heroLead}</p>
            <div className="mt-10 flex animate-fade-up flex-col gap-3 [animation-delay:650ms] sm:flex-row">
              <a href={mailToSales(t.common.mailSubject, t.common.mailBody)} className="btn-primary !px-8 !py-4 !text-base" data-magnetic>
                <Icon name="mail" className="h-5 w-5" /> {t.common.emailCta}
              </a>
              <Link href={href(locale, "cases")} className="btn-ghost !px-8 !py-4 !text-base" data-magnetic>
                {h.heroScroll} <Icon name="arrow" className="h-5 w-5" />
              </Link>
            </div>
            <p className="mt-10 animate-fade-up font-mono text-[11px] uppercase tracking-[0.18em] text-ink-700/45 [animation-delay:800ms]">{h.heroClients}</p>
          </div>
        </div>

        {/* mobil: pás fotek */}
        <div className="absolute inset-x-0 bottom-0 flex gap-3 overflow-hidden pb-6 opacity-90 lg:hidden" aria-hidden>
          <div className="marquee-track flex w-max gap-3">
            {[...WALL.slice(0, 8), ...WALL.slice(0, 8)].map((p, i) => (
              <div key={i} className="relative h-24 w-32 shrink-0 overflow-hidden rounded-xl">
                <Image src={p.src} alt="" fill sizes="128px" className="object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================= MANIFEST ================= */}
      <section className="py-28 md:py-44">
        <div className="container max-w-6xl">
          <p className="eyebrow mb-10">Manifest</p>
          <p data-scrub-text className="font-display text-[clamp(1.9rem,4.4vw,4.4rem)] font-bold leading-[1.08] tracking-tight text-ink-700">
            {h.manifesto}
          </p>
        </div>
      </section>

      {/* ================= ARCHIV ZAKÁZEK (vodorovně) ================= */}
      <section data-hscroll className="relative overflow-hidden bg-steel-100 py-20 md:flex md:h-screen md:flex-col md:justify-center md:pb-0 md:pt-24">
        <div className="container flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="eyebrow">{h.casesEyebrow}</p>
            <h2 data-split className="h-display mt-4 text-4xl text-ink-700 md:text-6xl">
              <Accent text={h.casesTitle} />
            </h2>
            <p className="mt-4 max-w-xl text-[16px] text-ink-700/65">{h.casesLead}</p>
          </div>
          <Link href={href(locale, "cases")} className="btn-ghost shrink-0" data-magnetic>
            {h.casesAll} ({CASES.length}) <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
        <div className="mt-10 overflow-x-auto md:overflow-visible" style={{ scrollbarWidth: "none" }}>
          <div data-hscroll-track className="flex w-max gap-5 px-5 md:gap-7 md:pl-[max(2rem,calc((100vw-1320px)/2+2rem))] md:pr-12">
            {CASES.map((c, i) => {
              const tx = c.text[locale];
              const p = c.photos[0];
              return (
                <Link
                  key={c.slug.cs}
                  href={href(locale, "case", c.slug.cs)}
                  data-cursor={h.casesOpen}
                  className="group relative w-[78vw] shrink-0 snap-start sm:w-[46vw] md:w-[30vw] xl:w-[26vw]"
                >
                  <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-steel-200">
                    <Image src={p.src} alt={tx.title} fill sizes="(min-width:768px) 30vw, 78vw" className="object-cover transition-transform duration-[1.2s] ease-out group-hover:scale-[1.07]" />
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
                    <span className="absolute left-5 top-5 rounded-full bg-white/90 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-ink-700 backdrop-blur">
                      {caseCode(i, c.year)}
                    </span>
                    <span className="absolute right-5 top-5 rounded-full bg-black/40 px-3 py-1 font-mono text-[10px] text-white backdrop-blur">
                      {c.photos.length} {t.pages.cases.photos}
                    </span>
                    <h3 className="absolute inset-x-5 bottom-5 font-display text-2xl font-bold uppercase leading-tight text-white [hyphens:none]">{tx.title}</h3>
                  </div>
                  <p className="mt-4 line-clamp-2 text-[14px] leading-relaxed text-ink-700/60">{tx.summary}</p>
                </Link>
              );
            })}
            <Link
              href={href(locale, "cases")}
              data-cursor={h.casesAll}
              className="group grid aspect-[4/5] w-[60vw] shrink-0 place-items-center rounded-3xl border-2 border-dashed border-ink-700/20 text-center transition-colors hover:border-brand sm:w-[36vw] md:w-[22vw]"
            >
              <span>
                <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-brand text-white transition-transform duration-500 group-hover:scale-110">
                  <Icon name="arrow" className="h-7 w-7" />
                </span>
                <span className="mt-5 block font-display text-2xl font-bold uppercase text-ink-700">{h.casesAll}</span>
              </span>
            </Link>
          </div>
        </div>
        <div className="container mt-10 hidden md:block">
          <div className="h-px bg-ink-700/10">
            <div data-hscroll-bar className="h-px origin-left bg-brand" />
          </div>
        </div>
      </section>

      {/* ================= KLIENTI ================= */}
      <section className="overflow-hidden py-24 md:py-32">
        <div className="container mb-12 flex items-end justify-between gap-6">
          <div>
            <p className="eyebrow">{h.clientsEyebrow}</p>
            <h2 data-split className="h-display mt-4 text-4xl text-ink-700 md:text-6xl">
              {h.clientsTitle}
            </h2>
          </div>
          <Link href={href(locale, "references")} className="btn-ghost hidden shrink-0 md:inline-flex">
            {h.refsMore} <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
        <div className="marquee-pause space-y-4">
          {[clients.slice(0, 8), clients.slice(8)].map((row, r) => (
            <div key={r} className={`logo-row flex w-max gap-4 ${r ? "rev" : ""}`}>
              {[...row, ...row, ...row].map((c, i) => (
                <div key={c.id + i} className="group relative h-24 w-52 shrink-0 rounded-2xl border border-ink-700/10 bg-white" title={c.client}>
                  <Image src={c.logo!} alt={c.client} fill sizes="208px" className="object-contain p-6 opacity-60 grayscale transition duration-500 group-hover:opacity-100 group-hover:grayscale-0" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ================= NA HRANĚ MOŽNOSTÍ ================= */}
      <section className="paper relative overflow-hidden py-24 md:py-36">
        <div className="bg-grid-light absolute inset-0" />
        <div className="container relative">
          <p className="eyebrow">{h.limitsEyebrow}</p>
          <h2 data-split className="h-display mt-4 max-w-4xl text-4xl text-ink-700 md:text-7xl">
            <Accent text={h.limitsTitle} />
          </h2>
          <div className="mt-16 grid gap-x-10 gap-y-14 md:grid-cols-2 lg:grid-cols-3">
            {env.map((x) => (
              <div key={x.l}>
                <p className={`whitespace-nowrap font-display font-bold leading-none text-ink-700 ${x.v.length > 12 ? "text-[clamp(1.9rem,3.2vw,3.2rem)]" : "text-[clamp(2.6rem,5vw,4.6rem)]"}`}>{x.v}</p>
                <svg data-draw viewBox="0 0 300 16" className="mt-5 w-full text-brand" preserveAspectRatio="none" aria-hidden>
                  <line x1="1" y1="2" x2="1" y2="14" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="1" y1="8" x2="299" y2="8" stroke="currentColor" strokeWidth="1.5" />
                  <line x1="299" y1="2" x2="299" y2="14" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.16em] text-ink-700/50">{x.l}</p>
              </div>
            ))}
          </div>
          <Link href={`${href(locale, "machinery")}#vejde-se`} className="btn-primary mt-16 !px-8 !py-4" data-magnetic>
            {h.limitsCta} <Icon name="arrow" className="h-5 w-5" />
          </Link>
        </div>
      </section>

      {/* ================= DÍLNA NAŽIVO (YouTube) ================= */}
      <section className="bg-steel-100 py-24 md:py-32">
        <div className="container">
          <div className="mb-12 flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <p className="eyebrow">{h.videoEyebrow}</p>
              <h2 data-split className="h-display mt-4 text-4xl text-ink-700 md:text-6xl">
                <Accent text={h.videoTitle} />
              </h2>
              <p className="mt-4 text-[16px] text-ink-700/65">{h.videoLead}</p>
            </div>
            <a href={YOUTUBE_CHANNEL} target="_blank" rel="noopener noreferrer" className="btn-ghost shrink-0" data-magnetic>
              <svg viewBox="0 0 24 24" className="h-5 w-5 text-brand" fill="currentColor" aria-hidden>
                <path d="M23 7.2a3 3 0 0 0-2.1-2.1C19 4.6 12 4.6 12 4.6s-7 0-8.9.5A3 3 0 0 0 1 7.2 31 31 0 0 0 .5 12a31 31 0 0 0 .5 4.8 3 3 0 0 0 2.1 2.1c1.9.5 8.9.5 8.9.5s7 0 8.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .5-4.8 31 31 0 0 0-.5-4.8zM9.75 15.02V8.98L15.5 12z" />
              </svg>
              {h.videoChannel}
            </a>
          </div>
          <VideoShowcase videos={VIDEOS} locale={locale} play={h.videoPlay} note={h.videoNote} />
        </div>
      </section>

      {/* ================= JAK VZNIKÁ DÍL (3D) ================= */}
      <MachiningStory t={t.story} />

      {/* ================= INDEX SLUŽEB ================= */}
      <section className="py-24 md:py-36">
        <div className="container">
          <p className="eyebrow">{h.indexEyebrow}</p>
          <h2 data-split className="h-display mt-4 max-w-4xl text-4xl text-ink-700 md:text-7xl">
            <Accent text={h.indexTitle} />
          </h2>
          <div className="mt-14">
            <ServicesIndex
              cursorLabel={t.common.moreAboutService}
              rows={SERVICE_ORDER.map((id) => ({ href: href(locale, "service", id), title: t.services[id].title, short: t.services[id].short, photo: SERVICE_FACTS[id].photo }))}
            />
          </div>
        </div>
      </section>

      {/* ================= TÝM ================= */}
      <section className="bg-steel-100 py-24 md:py-32">
        <div className="container">
          <p className="eyebrow">{h.teamEyebrow}</p>
          <h2 data-split className="h-display mt-4 max-w-3xl text-4xl text-ink-700 md:text-6xl">
            {h.teamTitle}
          </h2>
          <p className="mt-5 max-w-2xl text-[17px] text-ink-700/65">{h.teamLead}</p>
          <div className="mt-14">
            <TeamGrid locale={locale} />
          </div>
        </div>
      </section>

      {/* ================= CAD pás ================= */}
      <Link href="/cad" className="group block border-y border-ink-700/10 bg-white py-8 transition-colors hover:bg-[#fff7f6]" data-cursor="CAD">
        <div className="container flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <p className="flex items-center gap-4 font-display text-2xl font-bold uppercase text-ink-700 md:text-3xl">
            <span className="rounded-full bg-brand px-3 py-1 font-mono text-[11px] tracking-widest text-white">{t.nav.cadBadge}</span>
            Mnástrojárna CAD
          </p>
          <p className="flex items-center gap-3 text-[15px] text-ink-700/65">
            {h.cadStrip} <Icon name="arrow" className="h-5 w-5 text-brand transition-transform duration-500 group-hover:translate-x-2" />
          </p>
        </div>
      </Link>

      {/* ================= FINÁLNÍ VÝZVA ================= */}
      <section className="relative overflow-hidden py-28 md:py-44">
        <div className="bg-grid-light absolute inset-0" />
        <div className="container relative grid items-center gap-14 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <h2 data-split className="h-display text-[clamp(2.8rem,6.5vw,7rem)] leading-[0.92] text-ink-700">
              <Accent text={h.finalTitle} />
            </h2>
            <p className="mt-8 max-w-xl text-lg text-ink-700/65">{h.finalLead}</p>
            <p className="mt-6 text-[15px] text-ink-700/70">
              {t.common.primaryContact}: <strong className="text-ink-700">{SALES.name}</strong> ·{" "}
              <a href={SALES.phoneHref} className="text-brand hover:underline">
                {SALES.phone}
              </a>{" "}
              ·{" "}
              <a href={`mailto:${SALES.email}`} className="text-brand hover:underline">
                {SALES.email}
              </a>
            </p>
            <p className="mt-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-700/40">{t.common.ctaFoot}</p>
          </div>
          <div className="flex justify-center lg:col-span-4">
            <a
              href={mailToSales(t.common.mailSubject, t.common.mailBody)}
              data-magnetic
              className="group relative grid h-56 w-56 place-items-center rounded-full bg-brand text-center text-white shadow-[0_40px_80px_-30px_rgba(224,57,48,.8)] transition-transform duration-500 hover:scale-105 md:h-64 md:w-64"
            >
              <span className="absolute inset-0 animate-ping rounded-full bg-brand/30 [animation-duration:2.4s]" />
              <span className="relative font-display text-2xl font-bold uppercase leading-tight">
                {h.finalCta}
                <Icon name="arrow" className="mx-auto mt-3 h-7 w-7 transition-transform duration-500 group-hover:translate-x-1" />
              </span>
            </a>
          </div>
        </div>
      </section>

      <JsonLd data={faqJsonLd(t.faq)} />
      <JsonLd data={videoJsonLd(VIDEOS, locale)} />
    </>
  );
}
