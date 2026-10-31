import Image from "next/image";
import Link from "next/link";
import { CtaBand, PageHero } from "@/components/blocks";
import { CasesGrid } from "@/components/cases-grid";
import { Gallery } from "@/components/gallery";
import { Icon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { getDict } from "@/content";
import { CASES, type CaseStudy } from "@/content/cases";
import { SITE } from "@/content/site";
import { href, type Locale } from "@/i18n/config";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";

export function casesMeta(locale: Locale) {
  const p = getDict(locale).pages.cases;
  return pageMeta({ locale, page: "cases", title: p.metaTitle, description: p.metaDescription });
}

export function CasesView({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const p = t.pages.cases;
  const crumbs = [{ name: t.nav.cases, path: href(locale, "cases") }];
  return (
    <>
      <PageHero locale={locale} eyebrow={p.eyebrow} crumbs={crumbs} title={p.title} lead={p.lead} sheet="20" />
      <section className="pb-28">
        <div className="container">
          <CasesGrid
            items={CASES.map((c) => ({
              href: href(locale, "case", c.slug.cs),
              title: c.text[locale].title,
              summary: c.text[locale].summary,
              year: c.year,
              kind: c.kind,
              photo: c.photos[0].src,
              photos: c.photos.length,
            }))}
            kinds={p.kinds}
            all={p.all}
            photosLabel={p.photos}
            openLabel={t.home.casesOpen}
          />
        </div>
      </section>
      <CtaBand locale={locale} title={p.ctaTitle} lead={p.ctaLead} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
    </>
  );
}

export function caseMeta(locale: Locale, c: CaseStudy) {
  const tx = c.text[locale];
  const m = pageMeta({ locale, page: "case", serviceId: c.slug.cs, title: tx.title, description: tx.summary.slice(0, 160) });
  return { ...m, openGraph: { ...m.openGraph, images: [{ url: c.photos[0].src }] } };
}

export function CaseView({ locale, c }: { locale: Locale; c: CaseStudy }) {
  const t = getDict(locale);
  const p = t.pages.cases;
  const tx = c.text[locale];
  const i = CASES.indexOf(c);
  const next = CASES[(i + 1) % CASES.length];
  const crumbs = [
    { name: t.nav.cases, path: href(locale, "cases") },
    { name: tx.title, path: href(locale, "case", c.slug.cs) },
  ];
  const [hero, ...rest] = c.photos;
  return (
    <>
      <section className="relative pt-28 md:pt-32">
        <div className="container">
          <nav aria-label={t.nav.breadcrumb} className="mb-8 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-700/45">
            <Link href={href(locale, "cases")} className="inline-flex items-center gap-2 hover:text-brand">
              <span className="rotate-180">
                <Icon name="arrow" className="h-3.5 w-3.5" />
              </span>
              {p.back}
            </Link>
          </nav>
          <div className="grid gap-10 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-7">
              <p className="eyebrow">
                {p.eyebrow} · {String(i + 1).padStart(2, "0")}
              </p>
              <h1 data-split className="h-display mt-5 text-5xl text-ink-700 md:text-7xl">
                {tx.title}
              </h1>
            </div>
            <div className="lg:col-span-5">
              <p className="text-lg leading-relaxed text-ink-700/70">{tx.summary}</p>
            </div>
          </div>
          <dl className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-ink-700/10 bg-ink-700/10 sm:grid-cols-3">
            <div className="bg-white p-5">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-700/45">{p.kinds[c.kind]}</dt>
              <dd className="mt-1 text-[15px] font-medium text-ink-700">{c.year ? `${p.year} ${c.year}` : "—"}</dd>
            </div>
            <div className="bg-white p-5 sm:col-span-2">
              <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-700/45">{p.tech}</dt>
              <dd className="mt-1 flex flex-wrap gap-2">
                {c.services.map((s) => (
                  <Link key={s} href={href(locale, "service", s)} className="rounded-full border border-ink-700/15 px-3 py-1 text-[13px] text-ink-700 hover:border-brand hover:text-brand">
                    {t.services[s].title}
                  </Link>
                ))}
              </dd>
            </div>
          </dl>
          <div data-img className="relative mt-10 aspect-[16/10] overflow-hidden rounded-3xl bg-steel-200 md:aspect-[16/8]">
            <Image src={hero.src} alt={tx.title} fill priority sizes="100vw" className="object-cover" />
          </div>
        </div>
      </section>

      {(tx.brief || tx.solution || tx.result) && (
        <section className="py-20">
          <div className="container grid gap-10 md:grid-cols-3">
            {(
              [
                [p.brief, tx.brief],
                [p.solution, tx.solution],
                [p.result, tx.result],
              ] as const
            )
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="border-t-2 border-brand pt-5">
                  <h2 className="font-display text-xl font-bold uppercase text-ink-700">{k}</h2>
                  <p className="mt-3 text-[16px] leading-relaxed text-ink-700/75">{v}</p>
                </div>
              ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section className="py-20">
          <div className="container">
            <Gallery items={rest} alt={tx.title} />
          </div>
        </section>
      )}

      <Link href={href(locale, "case", next.slug.cs)} className="group block border-y border-ink-700/10 bg-steel-100" data-cursor={p.next}>
        <div className="container grid items-center gap-8 py-14 md:grid-cols-12">
          <div className="md:col-span-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-700/45">{p.next}</p>
            <p className="h-display mt-3 text-4xl text-ink-700 transition-colors group-hover:text-brand md:text-6xl">{next.text[locale].title}</p>
          </div>
          <div className="relative aspect-[4/3] overflow-hidden rounded-2xl md:col-span-4">
            <Image src={next.photos[0].src} alt="" fill sizes="33vw" className="object-cover transition-transform duration-700 group-hover:scale-105" />
          </div>
        </div>
      </Link>

      <CtaBand locale={locale} title={p.ctaTitle} lead={p.ctaLead} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "CreativeWork",
          name: tx.title,
          description: tx.summary,
          inLanguage: locale,
          image: c.photos.map((x) => `${SITE.url}${x.src}`),
          creator: { "@type": "Organization", name: SITE.name, url: SITE.url },
          ...(c.year ? { dateCreated: String(c.year) } : {}),
        }}
      />
    </>
  );
}
