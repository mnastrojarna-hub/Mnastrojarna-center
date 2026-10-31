import { Suspense } from "react";
import { Accent } from "@/components/accent";
import { Icon, type AnyIcon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { RfqForm } from "@/components/rfq-form";
import { getDict } from "@/content";
import { SALES } from "@/content/site";
import { href, type Locale } from "@/i18n/config";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";

type P = { locale: Locale };

// ---------------- Poptávka ----------------

export function rfqMeta(locale: Locale) {
  const p = getDict(locale).pages.rfq;
  return pageMeta({ locale, page: "rfq", title: p.metaTitle, description: p.metaDescription });
}
const RFQ_ICONS: AnyIcon[] = ["shield", "lock", "clock", "check"];
export function RfqView({ locale }: P) {
  const t = getDict(locale);
  const p = t.pages.rfq;
  return (
    <>
      <section className="paper relative overflow-hidden pb-24 pt-32 md:pt-40">
        <div className="bg-grid-light absolute inset-0" />
        <div className="absolute -right-40 top-0 h-[420px] w-[420px] rounded-full bg-brand/10 blur-[120px]" />
        <div className="container relative grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="eyebrow">{p.eyebrow}</p>
            <h1 className="h-display mt-5 text-5xl text-ink-700 md:text-6xl">
              <Accent text={p.title} />
            </h1>
            <p className="mt-6 text-lg text-ink-700/70">{p.lead}</p>
            <ul className="mt-8 space-y-4 text-[15px] text-ink-700/80">
              {p.points.map((x, i) => (
                <li key={x} className="flex gap-3">
                  <Icon name={RFQ_ICONS[i]} className="mt-0.5 h-5 w-5 shrink-0 text-brand" /> {x}
                </li>
              ))}
            </ul>
            <div className="mt-10 rounded-2xl border border-ink-700/10 bg-white p-6">
              <p className="text-[13px] text-ink-700/50">{p.prefer}</p>
              <p className="mt-2 font-semibold text-ink-700">
                {SALES.name} · {t.team.volny.role}
              </p>
              <a href={`mailto:${SALES.email}`} className="mt-1 block text-[14px] text-brand hover:underline">
                {SALES.email}
              </a>
              {SALES.phone && (
                <a href={SALES.phoneHref} className="block text-[14px] text-ink-700/70 hover:text-brand">
                  {SALES.phone}
                </a>
              )}
            </div>
          </div>
          <div className="lg:col-span-8">
            <Suspense fallback={<div className="h-[640px] animate-pulse rounded-3xl bg-white" />}>
              <RfqForm locale={locale} t={t.rfq} v={t.viewer} sales={{ name: SALES.name, role: t.team.volny.role, email: SALES.email, phone: SALES.phone, phoneHref: SALES.phoneHref }} privacyHref={href(locale, "privacy")} homeHref={href(locale, "home")} />
            </Suspense>
          </div>
        </div>
      </section>
      <JsonLd data={breadcrumbJsonLd([{ name: p.crumb, path: href(locale, "rfq") }])} />
    </>
  );
}
