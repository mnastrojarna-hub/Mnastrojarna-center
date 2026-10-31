import Image from "next/image";
import Link from "next/link";
import { CtaBand, FaqList, FitBlock, MachinesGrid, PageHero, ProcessSteps, ReferencesBlock, SectionHeading, ServiceCard, ServicesGrid, TeamGrid } from "@/components/blocks";
import { Icon, type AnyIcon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { fill, getDict } from "@/content";
import { SALES, SERVICE_FACTS, SERVICE_ORDER, SITE, TEAM, TECH } from "@/content/site";
import { href, type Locale, type ServiceId } from "@/i18n/config";
import { ORG_ID, breadcrumbJsonLd, faqJsonLd, pageMeta } from "@/lib/seo";

type P = { locale: Locale };

// ---------------- Služby ----------------

export function servicesMeta(locale: Locale) {
  const p = getDict(locale).pages.services;
  return pageMeta({ locale, page: "services", title: p.metaTitle, description: p.metaDescription });
}
export function ServicesView({ locale }: P) {
  const t = getDict(locale);
  const p = t.pages.services;
  const crumbs = [{ name: t.nav.services, path: href(locale, "services") }];
  return (
    <>
      <PageHero locale={locale} eyebrow={p.eyebrow} crumbs={crumbs} title={p.title} lead={p.lead} sheet="02" />
      <section className="section bg-steel-100">
        <div className="container">
          <ServicesGrid locale={locale} />
        </div>
      </section>
      <section className="section">
        <div className="container">
          <SectionHeading eyebrow={p.processEyebrow} title={p.processTitle} />
          <div className="mt-14">
            <ProcessSteps locale={locale} />
          </div>
        </div>
      </section>
      <section className="section bg-steel-100">
        <div className="container">
          <FitBlock locale={locale} />
        </div>
      </section>
      <CtaBand locale={locale} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: SERVICE_ORDER.map((id, i) => ({ "@type": "ListItem", position: i + 1, url: `${SITE.url}${href(locale, "service", id)}`, name: t.services[id].title })),
        }}
      />
    </>
  );
}

// ---------------- Detail služby ----------------

export function serviceMeta(locale: Locale, id: ServiceId) {
  const s = getDict(locale).services[id];
  return pageMeta({ locale, page: "service", serviceId: id, title: s.seoTitle, description: s.seoDescription, keywords: s.keywords });
}
export function ServiceView({ locale, id }: P & { id: ServiceId }) {
  const t = getDict(locale);
  const p = t.pages.service;
  const s = t.services[id];
  const facts = SERVICE_FACTS[id];
  const others = SERVICE_ORDER.filter((x) => x !== id).slice(0, 3);
  const rfq = `${href(locale, "rfq")}?sluzba=${id}`;
  const crumbs = [
    { name: t.nav.services, path: href(locale, "services") },
    { name: s.title, path: href(locale, "service", id) },
  ];
  const techRole = t.team.sponer.role;
  return (
    <>
      <PageHero locale={locale} eyebrow={p.eyebrow} crumbs={crumbs} title={s.title} lead={s.lead} sheet={String(SERVICE_ORDER.indexOf(id) + 10)}>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link href={rfq} className="btn-primary !px-7 !py-3.5">
            <Icon name="upload" className="h-5 w-5" /> {t.common.quoteNow}
          </Link>
          <a href={`mailto:${TECH.email}?subject=${encodeURIComponent(`${p.techSubject} – ${s.title}`)}`} className="btn-ghost !px-7 !py-3.5">
            {p.techQuestion}
          </a>
        </div>
      </PageHero>

      <section className="section">
        <div className="container grid gap-14 lg:grid-cols-12">
          <div className="prose-mn lg:col-span-7" data-reveal>
            <h2 className="h-display mb-8 text-4xl text-ink-700 md:text-5xl">{p.whatTitle}</h2>
            {s.body.map((x) => (
              <p key={x.slice(0, 24)}>{x}</p>
            ))}
          </div>
          <aside className="lg:col-span-5">
            <div className="sticky top-28 rounded-2xl border border-ink-700/10 bg-steel-100 p-8" data-reveal>
              <p className="eyebrow">{p.summary}</p>
              <ul className="mt-6 space-y-4">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-3 text-[15px] text-ink-700">
                    <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                    {b}
                  </li>
                ))}
              </ul>
              <div className="mt-8 rounded-xl bg-white p-5">
                <p className="text-[13px] text-ink-700/60">{p.assessedBy}</p>
                <p className="mt-1 font-semibold text-ink-700">
                  {TECH.name}, {techRole}
                </p>
                <a href={`mailto:${TECH.email}`} className="mt-1 block break-all text-[14px] text-brand hover:underline">
                  {TECH.email}
                </a>
              </div>
              <Link href={rfq} className="btn-primary mt-6 w-full">
                {t.common.quoteNow} <Icon name="arrow" className="h-4 w-4" />
              </Link>
              <p className="mt-3 text-center text-[12px] text-ink-700/50">{t.minOrderNoVat}</p>
            </div>
          </aside>
        </div>
      </section>

      {facts.machines && (
        <section className="relative overflow-hidden bg-steel-100 py-24">
          <div className="container relative">
            <SectionHeading eyebrow={p.machinesEyebrow} title={p.machinesTitle} />
            <div className="mt-12">
              <MachinesGrid locale={locale} ids={facts.machines} />
            </div>
          </div>
        </section>
      )}

      {s.faq && (
        <section className="section">
          <div className="container max-w-4xl">
            <SectionHeading eyebrow="FAQ" title={p.faqTitle} />
            <div className="mt-10">
              <FaqList items={s.faq} />
            </div>
          </div>
        </section>
      )}

      <section className="section bg-steel-100">
        <div className="container">
          <SectionHeading eyebrow={p.otherEyebrow} title={p.otherTitle} />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {others.map((o) => (
              <ServiceCard key={o} locale={locale} id={o} i={SERVICE_ORDER.indexOf(o)} />
            ))}
          </div>
        </div>
      </section>

      <CtaBand locale={locale} title={`${s.title}${p.ctaSuffix}`} />

      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: s.title,
          serviceType: s.title,
          description: s.seoDescription,
          url: `${SITE.url}${href(locale, "service", id)}`,
          inLanguage: locale,
          provider: { "@id": ORG_ID },
          areaServed: [{ "@type": "Country", name: "Czech Republic" }, { "@type": "Place", name: "Europe" }],
          audience: { "@type": "BusinessAudience", audienceType: p.audience },
        }}
      />
      {s.faq && <JsonLd data={faqJsonLd(s.faq)} />}
    </>
  );
}

// ---------------- Strojový park ----------------

export function machineryMeta(locale: Locale) {
  const p = getDict(locale).pages.machinery;
  return pageMeta({ locale, page: "machinery", title: p.metaTitle, description: p.metaDescription });
}
export function MachineryView({ locale }: P) {
  const t = getDict(locale);
  const p = t.pages.machinery;
  const crumbs = [{ name: t.nav.machinery, path: href(locale, "machinery") }];
  return (
    <>
      <PageHero locale={locale} eyebrow={p.eyebrow} crumbs={crumbs} title={p.title} lead={p.lead} sheet="03" />
      <section className="relative overflow-hidden bg-steel-100 py-20">
        <div className="container relative">
          <MachinesGrid locale={locale} />
        </div>
      </section>
      <section className="section">
        <div className="container grid gap-12 md:grid-cols-2">
          <div data-reveal>
            <SectionHeading eyebrow="CAD / CAM" title={p.swTitle} lead={p.swLead} />
            <Chips items={["ZW3D", "Esprit", "NCG CAM", "Cami"]} />
          </div>
          <div data-reveal>
            <SectionHeading eyebrow={p.ctrlEyebrow} title={p.ctrlTitle} lead={p.ctrlLead} />
            <Chips items={["HEIDENHAIN iTNC640", "HEIDENHAIN iTNC530", "Sinumerik 840D", "Fagor"]} />
          </div>
        </div>
      </section>
      <CtaBand locale={locale} title={p.ctaTitle} lead={p.ctaLead} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
    </>
  );
}
function Chips({ items }: { items: string[] }) {
  return (
    <div className="mt-8 flex flex-wrap gap-2">
      {items.map((s) => (
        <span key={s} className="rounded-full border border-ink-700/15 bg-white px-4 py-2 font-mono text-sm text-ink-700">
          {s}
        </span>
      ))}
    </div>
  );
}

// ---------------- Kvalita ----------------

const PILLAR_ICONS: AnyIcon[] = ["shield", "sparkle", "measure", "file", "axes", "check"];
export function qualityMeta(locale: Locale) {
  const p = getDict(locale).pages.quality;
  return pageMeta({ locale, page: "quality", title: p.metaTitle, description: p.metaDescription });
}
export function QualityView({ locale }: P) {
  const t = getDict(locale);
  const p = t.pages.quality;
  const crumbs = [{ name: p.crumb, path: href(locale, "quality") }];
  return (
    <>
      <PageHero locale={locale} eyebrow={p.eyebrow} crumbs={crumbs} title={p.title} lead={p.lead} sheet="04" />
      <section className="section">
        <div className="container grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {p.pillars.map((x, i) => (
            <div key={x.t} data-reveal style={{ ["--d" as string]: `${(i % 3) * 90}ms` }} className="spot card">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand/10 text-brand">
                <Icon name={PILLAR_ICONS[i]} />
              </span>
              <h2 className="mt-5 font-display text-2xl font-bold uppercase text-ink-700">{x.t}</h2>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-700/65">{x.d}</p>
            </div>
          ))}
        </div>
      </section>
      <section className="section bg-steel-100">
        <div className="container max-w-4xl">
          <SectionHeading eyebrow={p.metroEyebrow} title={p.metroTitle} lead={p.metroLead} />
          <p className="mt-8 rounded-2xl border border-ink-700/10 bg-white p-6 text-[15px] text-ink-700/70" data-reveal>
            {p.certNote}
          </p>
        </div>
      </section>
      <CtaBand locale={locale} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
    </>
  );
}

// ---------------- Reference ----------------

export function referencesMeta(locale: Locale) {
  const p = getDict(locale).pages.references;
  return pageMeta({ locale, page: "references", title: p.metaTitle, description: p.metaDescription });
}
export function ReferencesView({ locale }: P) {
  const t = getDict(locale);
  const p = t.pages.references;
  const crumbs = [{ name: t.nav.references, path: href(locale, "references") }];
  return (
    <>
      <PageHero locale={locale} eyebrow={p.eyebrow} crumbs={crumbs} title={p.title} lead={p.lead} sheet="05" />
      <section className="section">
        <div className="container">
          <SectionHeading eyebrow={p.industriesEyebrow} title={p.industriesTitle} />
          <div className="mt-12">
            <ReferencesBlock locale={locale} />
          </div>
        </div>
      </section>
      <section className="section bg-steel-100">
        <div className="container">
          <FitBlock locale={locale} />
        </div>
      </section>
      <CtaBand locale={locale} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
    </>
  );
}

// ---------------- O nás ----------------

export function aboutMeta(locale: Locale) {
  const p = getDict(locale).pages.about;
  return pageMeta({ locale, page: "about", title: p.metaTitle, description: p.metaDescription });
}
export function AboutView({ locale }: P) {
  const t = getDict(locale);
  const p = t.pages.about;
  const crumbs = [{ name: t.nav.about, path: href(locale, "about") }];
  return (
    <>
      <PageHero locale={locale} eyebrow={p.eyebrow} crumbs={crumbs} title={p.title} lead={p.lead} sheet="06" />
      <section className="section">
        <div className="container grid items-center gap-14 lg:grid-cols-2">
          <div className="prose-mn" data-reveal>
            <h2 className="h-display mb-8 text-4xl text-ink-700 md:text-5xl">{p.whoTitle}</h2>
            {p.who.map((x) => (
              <p key={x.slice(0, 20)}>{x}</p>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4" data-reveal>
            <div className="relative col-span-2 aspect-[16/9] overflow-hidden rounded-2xl border border-ink-700/10">
              <Image src="/img/axile-g8.png" alt={p.axileAlt} fill sizes="(min-width:1024px) 50vw, 100vw" className="bg-white object-contain p-4" />
            </div>
            <div className="rounded-2xl border border-ink-700/10 bg-white p-6 text-ink-700">
              <p className="font-display text-5xl font-bold">{SITE.founded}</p>
              <p className="mt-1 text-sm text-ink-700/55">{p.foundedLabel}</p>
            </div>
            <div className="rounded-2xl bg-brand p-6 text-white">
              <p className="font-display text-5xl font-bold">ISO</p>
              <p className="mt-1 text-sm text-white/85">{p.isoLabel}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-steel-100 py-24 md:py-32">
        <div className="bg-grid-light absolute inset-0" />
        <div className="container relative">
          <SectionHeading eyebrow={p.storyEyebrow} title={p.storyTitle} />
          <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-ink-700/10 bg-ink-700/10 md:grid-cols-3">
            {p.timeline.map((x, i) => (
              <li key={x.y + x.t} data-reveal style={{ ["--d" as string]: `${(i % 3) * 100}ms` }} className="bg-white p-8">
                <p className="font-display text-5xl font-bold text-brand">{x.y}</p>
                <h3 className="mt-4 font-display text-xl font-bold uppercase text-ink-700">{x.t}</h3>
                <p className="mt-2 text-[15px] text-ink-700/60">{x.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading eyebrow={p.teamEyebrow} title={p.teamTitle} />
          <div className="mt-14">
            <TeamGrid locale={locale} />
          </div>
        </div>
      </section>

      <section className="section bg-steel-100" id="eu-projekty">
        <div className="container max-w-4xl">
          <SectionHeading eyebrow={p.euEyebrow} title={p.euTitle} />
          <div className="mt-8 space-y-4 text-[15px] leading-relaxed text-ink-700/75" data-reveal>
            {p.eu.map((x) => (
              <p key={x.slice(0, 30)}>{x}</p>
            ))}
          </div>
        </div>
      </section>

      <CtaBand locale={locale} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
    </>
  );
}

// ---------------- Kontakt ----------------

export function contactMeta(locale: Locale) {
  const p = getDict(locale).pages.contact;
  return pageMeta({ locale, page: "contact", title: p.metaTitle, description: p.metaDescription });
}
export function ContactView({ locale }: P) {
  const t = getDict(locale);
  const p = t.pages.contact;
  const w = SITE.workshop;
  const mapUrl = `https://mapy.cz/zakladni?q=${encodeURIComponent(`${w.street}, ${w.city}`)}&x=${w.lng}&y=${w.lat}&z=16`;
  return (
    <>
      <PageHero locale={locale} eyebrow={p.eyebrow} crumbs={[{ name: t.nav.contact, path: href(locale, "contact") }]} title={p.title} lead={p.lead} sheet="07">
        <div className="mt-10">
          <Link href={href(locale, "rfq")} className="btn-primary !px-7 !py-3.5">
            <Icon name="upload" className="h-5 w-5" /> {p.cta}
          </Link>
        </div>
      </PageHero>

      <section className="section">
        <div className="container">
          <TeamGrid locale={locale} />
        </div>
      </section>

      <section className="section bg-steel-100">
        <div className="container grid gap-5 md:grid-cols-3">
          <div className="card" data-reveal>
            <p className="eyebrow">{t.addresses.workshop}</p>
            <p className="mt-5 text-lg font-semibold text-ink-700">{SITE.name}</p>
            <p className="text-ink-700/70">
              {w.street}
              <br />
              {w.zip} {w.city}
              <br />
              {t.country}
            </p>
            <p className="mt-3 font-mono text-[12px] text-ink-700/50">
              GPS {w.lat.toFixed(5)}N, {w.lng.toFixed(5)}E
            </p>
            <a href={mapUrl} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-2 text-[14px] font-semibold text-brand">
              {p.navigate} <Icon name="arrow" className="h-4 w-4" />
            </a>
          </div>
          <div className="card" data-reveal style={{ ["--d" as string]: "90ms" }}>
            <p className="eyebrow">{t.addresses.billing}</p>
            <p className="mt-5 text-lg font-semibold text-ink-700">{SITE.name}</p>
            <p className="text-ink-700/70">
              {SITE.billing.street}
              <br />
              {SITE.billing.zip} {t.addresses.billingCity}
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[14px]">
              <dt className="text-ink-700/50">{t.footer.id}</dt>
              <dd className="font-mono">{SITE.ico}</dd>
              <dt className="text-ink-700/50">{t.footer.vat}</dt>
              <dd className="font-mono">{SITE.dic}</dd>
              <dt className="text-ink-700/50">{t.footer.dataBox}</dt>
              <dd className="font-mono">{SITE.dataBox}</dd>
            </dl>
          </div>
          <div className="card" data-reveal style={{ ["--d" as string]: "180ms" }}>
            <p className="eyebrow">{p.general}</p>
            <p className="mt-5 flex items-center gap-2 text-ink-700">
              <Icon name="mail" className="h-4 w-4 text-brand" />
              <a href={`mailto:${SITE.email}`} className="hover:text-brand">
                {SITE.email}
              </a>
            </p>
            <p className="mt-2 flex items-center gap-2 text-ink-700">
              <Icon name="clock" className="h-4 w-4 text-brand" /> {t.hours}
            </p>
            <p className="mt-5 text-[13px] leading-relaxed text-ink-700/55">{t.registry}</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHeading eyebrow={p.whereEyebrow} title={p.whereTitle} lead={p.whereLead} />
        </div>
      </section>
      <JsonLd data={breadcrumbJsonLd([{ name: t.nav.contact, path: href(locale, "contact") }])} />
    </>
  );
}

// ---------------- Kariéra ----------------

export function careersMeta(locale: Locale) {
  const p = getDict(locale).pages.careers;
  return pageMeta({ locale, page: "careers", title: p.metaTitle, description: p.metaDescription });
}
export function CareersView({ locale }: P) {
  const t = getDict(locale);
  const p = t.pages.careers;
  return (
    <PageHero locale={locale} eyebrow={p.eyebrow} crumbs={[{ name: p.eyebrow, path: href(locale, "careers") }]} title={p.title} lead={p.lead} sheet="08">
      <div className="mt-10 flex flex-wrap gap-3">
        <a href={`mailto:${TEAM[0].email}?subject=${encodeURIComponent(p.subject)}`} className="btn-primary !px-7 !py-3.5">
          {p.cta}
        </a>
        <span className="btn-ghost pointer-events-none !px-7 !py-3.5">
          {SITE.workshop.street}, {SITE.workshop.city}
        </span>
      </div>
    </PageHero>
  );
}

// ---------------- Ochrana osobních údajů ----------------

export function privacyMeta(locale: Locale) {
  const p = getDict(locale).pages.privacy;
  return pageMeta({ locale, page: "privacy", title: p.metaTitle, description: p.metaDescription, noindex: true });
}
export function PrivacyView({ locale }: P) {
  const t = getDict(locale);
  const p = t.pages.privacy;
  return (
    <section className="pb-24 pt-36 md:pt-44">
      <div className="container max-w-3xl">
        <p className="eyebrow">GDPR</p>
        <h1 className="h-display mt-5 text-5xl text-ink-700">{p.title}</h1>
        <div className="mt-10 space-y-6 text-[16px] leading-relaxed text-ink-700/80">
          <p>
            {fill(p.controller, {
              name: SITE.name,
              ico: SITE.ico,
              address: `${SITE.billing.street}, ${SITE.billing.zip} ${t.addresses.billingCity}`,
              email: SITE.email,
              dataBox: SITE.dataBox,
            })}
          </p>
          {p.sections.map((x) => (
            <div key={x.h}>
              <h2 className="mb-2 font-display text-2xl font-bold uppercase text-ink-700">{x.h}</h2>
              <p>{x.p}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
