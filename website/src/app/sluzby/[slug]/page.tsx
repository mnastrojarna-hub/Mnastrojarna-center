import Link from "next/link";
import { notFound } from "next/navigation";
import { CtaBand, FaqList, MachinesForService, PageHero, SectionHeading, ServiceCard } from "@/components/blocks";
import { Icon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { SERVICES, SITE, TEAM, serviceBySlug } from "@/content/site";
import { ORG_ID, breadcrumbJsonLd, faqJsonLd, pageMeta } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return SERVICES.map((s) => ({ slug: s.slug }));
}
export const dynamicParams = false;

export async function generateMetadata({ params }: Props) {
  const s = serviceBySlug((await params).slug);
  if (!s) return {};
  return { ...pageMeta({ title: s.seoTitle, description: s.seoDescription, path: `/sluzby/${s.slug}` }), keywords: s.keywords };
}

export default async function ServicePage({ params }: Props) {
  const s = serviceBySlug((await params).slug);
  if (!s) notFound();
  const others = SERVICES.filter((x) => x.slug !== s.slug).slice(0, 3);
  const tech = TEAM[2];
  const crumbs = [
    { name: "Služby", path: "/sluzby" },
    { name: s.title, path: `/sluzby/${s.slug}` },
  ];

  return (
    <>
      <PageHero eyebrow="Služba" crumbs={crumbs} title={s.title} lead={s.lead}>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link href={`/poptavka?sluzba=${s.slug}`} className="btn-primary !px-7 !py-3.5">
            <Icon name="upload" className="h-5 w-5" /> Nezávazně poptat
          </Link>
          <a href={`mailto:${tech.email}?subject=${encodeURIComponent("Technický dotaz – " + s.title)}`} className="btn-ghost-dark !px-7 !py-3.5">
            Technický dotaz technologovi
          </a>
        </div>
      </PageHero>

      <section className="section">
        <div className="container grid gap-14 lg:grid-cols-12">
          <div className="prose-mn lg:col-span-7" data-reveal>
            <h2 className="h-display mb-8 text-4xl text-ink-700 md:text-5xl">Co pro vás uděláme</h2>
            {s.body.map((p) => (
              <p key={p.slice(0, 24)}>{p}</p>
            ))}
          </div>
          <aside className="lg:col-span-5">
            <div className="sticky top-28 rounded-2xl border border-ink-700/10 bg-steel-100 p-8" data-reveal>
              <p className="eyebrow">V kostce</p>
              <ul className="mt-6 space-y-4">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-3 text-[15px] text-ink-700">
                    <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
                    {b}
                  </li>
                ))}
              </ul>
              <div className="mt-8 rounded-xl bg-white p-5">
                <p className="text-[13px] text-ink-700/60">Technickou proveditelnost posoudí</p>
                <p className="mt-1 font-semibold text-ink-700">
                  {tech.name}, {tech.role.toLowerCase()}
                </p>
                <a href={`mailto:${tech.email}`} className="mt-1 block break-all text-[14px] text-brand hover:underline">
                  {tech.email}
                </a>
              </div>
              <Link href={`/poptavka?sluzba=${s.slug}`} className="btn-primary mt-6 w-full">
                Nezávazně poptat <Icon name="arrow" className="h-4 w-4" />
              </Link>
              <p className="mt-3 text-center text-[12px] text-ink-700/50">B2B zakázky od {SITE.minOrderCzk.toLocaleString("cs-CZ")} Kč bez DPH</p>
            </div>
          </aside>
        </div>
      </section>

      {s.machines && s.machines.length > 0 && (
        <section className="noise relative overflow-hidden bg-ink py-24 text-white">
          <div className="bg-grid absolute inset-0 opacity-50" />
          <div className="container relative">
            <SectionHeading dark eyebrow="Technologie" title="Na čem to vyrobíme" />
            <div className="mt-12">
              <MachinesForService ids={s.machines} />
            </div>
          </div>
        </section>
      )}

      {s.faq && (
        <section className="section bg-steel-100">
          <div className="container max-w-4xl">
            <SectionHeading eyebrow="FAQ" title="Časté otázky" />
            <div className="mt-10">
              <FaqList items={s.faq} />
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="container">
          <SectionHeading eyebrow="Další služby" title="Mohlo by vás zajímat" />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {others.map((o) => (
              <ServiceCard key={o.slug} s={o} i={SERVICES.indexOf(o)} />
            ))}
          </div>
        </div>
      </section>

      <CtaBand title={`${s.title}? Pošlete výkres.`} />

      <JsonLd data={breadcrumbJsonLd(crumbs)} />
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Service",
          name: s.title,
          serviceType: s.title,
          description: s.seoDescription,
          url: `${SITE.url}/sluzby/${s.slug}`,
          provider: { "@id": ORG_ID },
          areaServed: { "@type": "Country", name: "Česká republika" },
          audience: { "@type": "BusinessAudience", audienceType: "Výrobní firmy (B2B)" },
        }}
      />
      {s.faq && <JsonLd data={faqJsonLd(s.faq)} />}
    </>
  );
}
