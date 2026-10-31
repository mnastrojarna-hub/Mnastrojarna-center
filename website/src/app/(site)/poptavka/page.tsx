import { Suspense } from "react";
import { Icon } from "@/components/icons";
import { JsonLd } from "@/components/json-ld";
import { RfqForm } from "@/components/rfq-form";
import { SITE, TEAM } from "@/content/site";
import { breadcrumbJsonLd, pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Poptávka výroby – nahrajte výkres",
  description:
    "Nezávazná poptávka CNC obrábění, nástrojů, náhradních dílů nebo jednoúčelového stroje. Nahrajte výkres nebo STEP model, technolog posoudí vyrobitelnost a připravíme nabídku.",
  path: "/poptavka",
});

export default function RfqPage() {
  const c = TEAM[1];
  return (
    <>
      <section className="bg-grid-light relative overflow-hidden pb-24 pt-32 md:pt-40">
        <div className="absolute -right-40 top-0 h-[420px] w-[420px] rounded-full bg-brand/10 blur-[120px]" />
        <div className="container relative grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <p className="eyebrow">Nezávazná poptávka</p>
            <h1 className="h-display mt-5 text-5xl text-ink-700 md:text-6xl">
              Pošlete výkres, <span className="text-brand">my to vyrobíme</span>
            </h1>
            <p className="mt-6 text-lg text-ink-700/70">
              Tři krátké kroky. Technolog posoudí vyrobitelnost a obchodní zástupce vám pošle nabídku s cenou a termínem.
            </p>
            <ul className="mt-8 space-y-4 text-[15px] text-ink-700/80">
              {[
                ["shield", "ISO 9001 a 14001, 100% výstupní kontrola"],
                ["lock", "Důvěrné zpracování dat, NDA na vyžádání"],
                ["clock", "Vždy v termínu – vlastní výroba"],
                ["check", `B2B zakázky od ${SITE.minOrderCzk.toLocaleString("cs-CZ")} Kč bez DPH`],
              ].map(([i, t]) => (
                <li key={t} className="flex gap-3">
                  <Icon name={i as "check"} className="mt-0.5 h-5 w-5 shrink-0 text-brand" /> {t}
                </li>
              ))}
            </ul>
            <div className="mt-10 rounded-2xl border border-ink-700/10 bg-white p-6">
              <p className="text-[13px] text-ink-700/50">Raději e-mailem nebo telefonem?</p>
              <p className="mt-2 font-semibold text-ink-700">
                {c.name} · {c.role}
              </p>
              <a href={`mailto:${c.email}`} className="mt-1 block text-[14px] text-brand hover:underline">
                {c.email}
              </a>
              {c.phone && (
                <a href={c.phoneHref} className="block text-[14px] text-ink-700/70 hover:text-brand">
                  {c.phone}
                </a>
              )}
            </div>
          </div>
          <div className="lg:col-span-8">
            <Suspense fallback={<div className="h-[640px] animate-pulse rounded-3xl bg-white" />}>
              <RfqForm />
            </Suspense>
          </div>
        </div>
      </section>
      <JsonLd data={breadcrumbJsonLd([{ name: "Poptávka", path: "/poptavka" }])} />
    </>
  );
}
