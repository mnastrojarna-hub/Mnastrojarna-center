import Image from "next/image";
import Link from "next/link";
import { getDict } from "@/content";
import { MACHINES, REFERENCES, SALES, SERVICE_FACTS, SERVICE_ORDER, TEAM, type Person } from "@/content/site";
import { href, type Locale, type ServiceId } from "@/i18n/config";
import { cn } from "@/lib/cn";
import { Accent } from "./accent";
import { Icon } from "./icons";

export function SectionHeading({ eyebrow, title, lead, center, className }: { eyebrow?: string; title: React.ReactNode; lead?: React.ReactNode; center?: boolean; className?: string }) {
  return (
    <div className={cn("max-w-3xl", center && "mx-auto text-center", className)} data-reveal>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 className="h-display mt-4 text-4xl text-ink-700 md:text-6xl">{typeof title === "string" ? <Accent text={title} /> : title}</h2>
      {lead && <p className="mt-5 text-[17px] leading-relaxed text-ink-700/70 md:text-lg">{lead}</p>}
    </div>
  );
}

/** Záhlaví podstránek — světlý výkresový list s číslem listu a ořezovými značkami. */
export function PageHero({
  locale,
  eyebrow,
  title,
  lead,
  children,
  crumbs,
  sheet,
}: {
  locale: Locale;
  eyebrow?: string;
  title: string;
  lead?: React.ReactNode;
  children?: React.ReactNode;
  crumbs?: { name: string; path: string }[];
  sheet?: string;
}) {
  const t = getDict(locale);
  return (
    <section className="paper relative overflow-hidden pb-16 pt-32 md:pb-24 md:pt-40">
      <div className="bg-grid-light absolute inset-0" />
      <div className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-brand/10 blur-[140px]" />
      <div className="container relative">
        <div className="crop px-5 py-8 md:px-10 md:py-12">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-700/45">
            {crumbs ? (
              <nav aria-label={t.nav.breadcrumb}>
                <ol className="flex flex-wrap items-center gap-2">
                  <li>
                    <Link href={href(locale, "home")} className="hover:text-brand">
                      {t.nav.home}
                    </Link>
                  </li>
                  {crumbs.map((c, i) => (
                    <li key={c.path} className="flex items-center gap-2">
                      <span className="text-brand">/</span>
                      {i === crumbs.length - 1 ? (
                        <span className="text-ink-700/70" aria-current="page">
                          {c.name}
                        </span>
                      ) : (
                        <Link href={c.path} className="hover:text-brand">
                          {c.name}
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
            ) : (
              <span />
            )}
            <span>
              {t.nav.sheet} {sheet ?? "01"} · Mnástrojárna s.r.o.
            </span>
          </div>
          <div className="max-w-4xl animate-fade-up">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h1 className="h-display mt-5 text-5xl text-ink-700 md:text-7xl">
              <Accent text={title} />
            </h1>
            {lead && <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-700/70">{lead}</p>}
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ServiceCard({ locale, id, i }: { locale: Locale; id: ServiceId; i: number }) {
  const t = getDict(locale);
  const s = t.services[id];
  return (
    <Link
      href={href(locale, "service", id)}
      data-reveal
      style={{ ["--d" as string]: `${(i % 3) * 90}ms` }}
      className="spot group flex flex-col rounded-2xl border border-ink-700/10 bg-white p-7 transition-all duration-500 hover:-translate-y-1 hover:shadow-[0_30px_60px_-30px_rgba(39,36,37,.35)]"
    >
      <div className="flex items-start justify-between">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand/10 text-brand transition-colors duration-500 group-hover:bg-brand group-hover:text-white">
          <Icon name={SERVICE_FACTS[id].icon} className="h-6 w-6" />
        </span>
        <span className="font-mono text-xs text-ink-700/30">{String(i + 1).padStart(2, "0")}</span>
      </div>
      <h3 className="mt-6 font-display text-2xl font-bold uppercase tracking-tight text-ink-700">{s.title}</h3>
      <p className="mt-3 flex-1 text-[15px] leading-relaxed text-ink-700/65">{s.short}</p>
      <span className="mt-6 inline-flex items-center gap-2 text-[14px] font-semibold text-brand">
        {t.common.moreAboutService} <Icon name="arrow" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
      </span>
    </Link>
  );
}

export function ServicesGrid({ locale, limit }: { locale: Locale; limit?: number }) {
  const list = limit ? SERVICE_ORDER.slice(0, limit) : SERVICE_ORDER;
  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {list.map((id, i) => (
        <ServiceCard key={id} locale={locale} id={id} i={i} />
      ))}
    </div>
  );
}

export function ProcessSteps({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  return (
    <ol className="relative grid gap-6 md:grid-cols-5">
      <div className="absolute left-0 right-0 top-7 hidden h-px overflow-hidden bg-ink-700/10 md:block">
        <div className="scanx h-full w-1/3 bg-gradient-to-r from-transparent via-brand to-transparent" />
      </div>
      {t.process.map((p, i) => (
        <li key={p.t} data-reveal style={{ ["--d" as string]: `${i * 110}ms` }} className="relative">
          <span className="relative z-10 grid h-14 w-14 place-items-center rounded-full border border-ink-700/15 bg-white font-mono text-sm font-medium text-ink-700">
            <span className="absolute inset-0 rounded-full bg-brand/20 blur-md" />
            <span className="relative">{String(i + 1).padStart(2, "0")}</span>
          </span>
          <h3 className="mt-5 font-display text-xl font-bold uppercase text-ink-700">{p.t}</h3>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-700/65">{p.d}</p>
        </li>
      ))}
    </ol>
  );
}

export function PersonCard({ locale, p, i }: { locale: Locale; p: Person; i: number }) {
  const r = getDict(locale).team[p.id];
  return (
    <article data-reveal style={{ ["--d" as string]: `${i * 100}ms` }} className="spot group overflow-hidden rounded-2xl border border-ink-700/10 bg-white">
      <div className="relative aspect-[4/3] overflow-hidden bg-steel-100">
        {p.photo ? (
          <Image src={p.photo} alt={`${p.name} – ${r.role}`} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : (
          <div className="bg-grid-light absolute inset-0 grid place-items-center">
            <div className="absolute h-40 w-40 rounded-full bg-brand/15 blur-3xl transition-all duration-700 group-hover:bg-brand/30" />
            <span className="relative font-display text-7xl font-bold text-ink-700/80">{p.initials}</span>
          </div>
        )}
        <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-ink-700 shadow-sm backdrop-blur">{r.role}</span>
      </div>
      <div className="p-6">
        <h3 className="font-display text-2xl font-bold uppercase text-ink-700">{p.name}</h3>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-700/65">{r.focus}</p>
        <div className="mt-5 space-y-2 text-[14px]">
          {p.phone && (
            <a href={p.phoneHref} className="flex items-center gap-2 text-ink-700 hover:text-brand">
              <Icon name="phone" className="h-4 w-4 text-brand" /> {p.phone}
            </a>
          )}
          <a href={`mailto:${p.email}`} className="flex items-center gap-2 break-all text-ink-700 hover:text-brand">
            <Icon name="mail" className="h-4 w-4 shrink-0 text-brand" /> {p.email}
          </a>
        </div>
      </div>
    </article>
  );
}

export function TeamGrid({ locale }: { locale: Locale }) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {TEAM.map((p, i) => (
        <PersonCard key={p.id} locale={locale} p={p} i={i} />
      ))}
    </div>
  );
}

export function FaqList({ items }: { items: { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-ink-700/10 rounded-2xl border border-ink-700/10 bg-white">
      {items.map((f) => (
        <details key={f.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-semibold text-ink-700">
            {f.q}
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-current/20 text-brand transition-transform duration-300 group-open:rotate-45">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
          </summary>
          <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink-700/70">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

export function MachineCard({ locale, id, i = 0 }: { locale: Locale; id: string; i?: number }) {
  const t = getDict(locale);
  const f = MACHINES.find((m) => m.id === id);
  const m = t.machines[id];
  if (!f || !m) return null;
  const name = t.machineNames[id] ?? f.name;
  return (
    <article data-reveal style={{ ["--d" as string]: `${(i % 2) * 120}ms` }} className="spot group overflow-hidden rounded-2xl border border-ink-700/10 bg-white transition-shadow duration-500 hover:shadow-[0_40px_80px_-40px_rgba(39,36,37,.35)]">
      {f.image && (
        <div className="relative aspect-[16/10] overflow-hidden border-b border-ink-700/10 bg-white">
          <div className="bg-grid-light absolute inset-0" />
          <Image src={f.image} alt={`${name} – ${m.type}, ${t.common.machineAlt}`} fill sizes="(min-width: 1024px) 50vw, 100vw" className="object-contain p-4 transition-transform duration-700 group-hover:scale-[1.04]" />
        </div>
      )}
      <div className="p-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-brand">{m.type}</p>
        <h3 className="mt-2 font-display text-3xl font-bold uppercase text-ink-700">{name}</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-700/65">{m.description}</p>
        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-700/10 bg-ink-700/10">
          {m.specs.map(([k, v]) => (
            <div key={k} className="bg-white p-3">
              <dt className="text-[11px] uppercase tracking-wider text-ink-700/45">{k}</dt>
              <dd className="mt-1 font-mono text-[14px] text-ink-700">{v}</dd>
            </div>
          ))}
        </dl>
        {m.euProject && (
          <p className="mt-4 text-[12px] leading-relaxed text-ink-700/40">
            {t.common.euFrom} {m.euProject}.
          </p>
        )}
      </div>
    </article>
  );
}

export function MachinesGrid({ locale, ids }: { locale: Locale; ids?: string[] }) {
  const list = ids ?? MACHINES.map((m) => m.id);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {list.map((id, i) => (
        <MachineCard key={id} locale={locale} id={id} i={i} />
      ))}
    </div>
  );
}

/** Kvalifikace — komu pomůžeme nejlépe (a komu ne). */
export function FitBlock({ locale }: { locale: Locale }) {
  const c = getDict(locale).common;
  return (
    <div className="grid gap-5 md:grid-cols-5">
      <div data-reveal className="rounded-2xl border border-ink-700/10 bg-white p-8 md:col-span-3">
        <p className="eyebrow">{c.fitYesTitle}</p>
        <ul className="mt-6 space-y-4">
          {c.fitYes.map((x) => (
            <li key={x} className="flex gap-3 text-[16px] text-ink-700">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white">
                <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} />
              </span>
              {x}
            </li>
          ))}
        </ul>
      </div>
      <div data-reveal style={{ ["--d" as string]: "120ms" }} className="rounded-2xl border border-dashed border-ink-700/20 bg-steel-100 p-8 md:col-span-2">
        <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-steel-500">{c.fitNoTitle}</p>
        <ul className="mt-6 space-y-4">
          {c.fitNo.map((x) => (
            <li key={x} className="flex gap-3 text-[15px] text-ink-700/60">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-ink-700/20 text-ink-700/40">
                <Icon name="x" className="h-3 w-3" strokeWidth={2.4} />
              </span>
              {x}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[13px] leading-relaxed text-ink-700/50">{c.fitNote}</p>
      </div>
    </div>
  );
}

/** Reference: loga a případové studie (jen schválené), jinak „reference na vyžádání“ + obory. */
export function ReferencesBlock({ locale, compact }: { locale: Locale; compact?: boolean }) {
  const t = getDict(locale);
  const r = t.pages.references;
  const withLogo = REFERENCES.filter((x) => x.logo);
  const cases = REFERENCES.filter((x) => x.text?.[locale]);
  return (
    <div className="space-y-12">
      {withLogo.length > 0 && (
        <div data-reveal>
          <p className="eyebrow">{r.clientsTitle}</p>
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-ink-700/10 bg-ink-700/10 sm:grid-cols-3 lg:grid-cols-6">
            {withLogo.map((x) => (
              <div key={x.id} className="relative grid h-28 place-items-center bg-white p-6">
                <Image src={x.logo!} alt={x.client} fill sizes="200px" className="object-contain p-6 opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0" />
              </div>
            ))}
          </div>
        </div>
      )}
      {!compact && cases.length > 0 && (
        <div className="grid gap-5 md:grid-cols-2">
          {cases.map((x, i) => {
            const c = x.text![locale]!;
            return (
              <article key={x.id} data-reveal style={{ ["--d" as string]: `${(i % 2) * 100}ms` }} className="spot rounded-2xl border border-ink-700/10 bg-white p-8">
                <p className="font-mono text-[11px] uppercase tracking-widest text-brand">
                  {x.client}
                  {x.country ? ` · ${x.country}` : ""}
                </p>
                <h3 className="mt-3 font-display text-2xl font-bold uppercase text-ink-700">{c.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-ink-700/65">{c.summary}</p>
                {c.result && <p className="mt-4 border-t border-ink-700/10 pt-4 text-[14px] font-medium text-ink-700">{c.result}</p>}
                <div className="mt-5 flex flex-wrap gap-2">
                  {x.services.map((s) => (
                    <Link key={s} href={href(locale, "service", s)} className="rounded-full border border-ink-700/15 px-3 py-1 text-[12px] text-ink-700/70 hover:border-brand hover:text-brand">
                      {t.services[s].title}
                    </Link>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="grid gap-px overflow-hidden rounded-2xl border border-ink-700/10 bg-ink-700/10 sm:grid-cols-2 lg:col-span-3" data-reveal>
          {t.industries.map((x, i) => (
            <div key={x.t} className="bg-white p-6">
              <span className="font-mono text-[11px] text-brand">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-2 font-display text-lg font-bold uppercase text-ink-700">{x.t}</h3>
              {!compact && <p className="mt-1 text-[14px] leading-relaxed text-ink-700/60">{x.d}</p>}
            </div>
          ))}
        </div>
        <div className="crop flex flex-col justify-between rounded-2xl bg-white p-8 lg:col-span-2" data-reveal style={{ ["--d" as string]: "120ms" }}>
          <div>
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-brand/10 text-brand">
              <Icon name="lock" />
            </span>
            <h3 className="mt-5 font-display text-2xl font-bold uppercase text-ink-700">{r.onRequestTitle}</h3>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-700/65">{r.onRequestText}</p>
          </div>
          <a href={`mailto:${SALES.email}?subject=${encodeURIComponent(r.onRequestSubject)}`} className="btn-primary mt-8 self-start">
            {r.onRequestCta} <Icon name="arrow" className="h-4 w-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

/** Závěrečná výzva k akci — světlý výkresový list s velkou typografií. */
export function CtaBand({ locale, title, lead }: { locale: Locale; title?: string; lead?: string }) {
  const c = getDict(locale).common;
  return (
    <section className="paper relative overflow-hidden py-24 md:py-32">
      <div className="bg-grid-light absolute inset-0" />
      <div className="absolute left-1/2 top-1/2 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/10 blur-[140px]" />
      <div className="container relative">
        <div className="crop px-6 py-14 text-center md:px-16 md:py-20" data-reveal>
          <p className="eyebrow justify-center">{c.ctaEyebrow}</p>
          <h2 className="h-display mx-auto mt-5 max-w-4xl text-5xl text-ink-700 md:text-7xl">
            <Accent text={title ?? c.ctaTitle} />
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-700/65">{lead ?? c.ctaLead}</p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href={href(locale, "rfq")} className="btn-primary !px-8 !py-4 !text-base">
              <Icon name="upload" className="h-5 w-5" /> {c.uploadAndQuote}
            </Link>
            <Link href="/cad" className="btn-ghost !px-8 !py-4 !text-base">
              <Icon name="cube" className="h-5 w-5" /> {c.cadDrawPart}
            </Link>
          </div>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-700/40">{c.ctaFoot}</p>
        </div>
      </div>
    </section>
  );
}
