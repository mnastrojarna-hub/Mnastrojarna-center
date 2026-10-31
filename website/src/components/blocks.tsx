import Image from "next/image";
import Link from "next/link";
import { FAQ, MACHINES, PROCESS, SERVICES, SITE, TEAM, type Machine, type Person, type Service } from "@/content/site";
import { cn } from "@/lib/cn";
import { Icon } from "./icons";

export function SectionHeading({
  eyebrow,
  title,
  lead,
  dark,
  center,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  dark?: boolean;
  center?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("max-w-3xl", center && "mx-auto text-center", className)} data-reveal>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2 className={cn("h-display mt-4 text-4xl md:text-6xl", dark ? "text-white" : "text-ink-700")}>{title}</h2>
      {lead && <p className={cn("mt-5 text-[17px] leading-relaxed md:text-lg", dark ? "text-white/65" : "text-ink-700/70")}>{lead}</p>}
    </div>
  );
}

/** Záhlaví podstránek — světlý výkresový list s číslem listu a ořezovými značkami. */
export function PageHero({
  eyebrow,
  title,
  lead,
  children,
  crumbs,
  sheet,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  children?: React.ReactNode;
  crumbs?: { name: string; path: string }[];
  sheet?: string;
}) {
  return (
    <section className="paper relative overflow-hidden pb-16 pt-32 md:pb-24 md:pt-40">
      <div className="bg-grid-light absolute inset-0" />
      <div className="absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-brand/10 blur-[140px]" />
      <div className="container relative">
        <div className="crop px-5 py-8 md:px-10 md:py-12">
          <div className="mb-8 flex flex-wrap items-center justify-between gap-4 font-mono text-[11px] uppercase tracking-[0.18em] text-ink-700/45">
            {crumbs ? (
              <nav aria-label="Drobečková navigace">
                <ol className="flex flex-wrap items-center gap-2">
                  <li>
                    <Link href="/" className="hover:text-brand">
                      Úvod
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
            <span>List {sheet ?? "01"} · Mnástrojárna s.r.o.</span>
          </div>
          <div className="max-w-4xl animate-fade-up">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h1 className="h-display mt-5 text-5xl text-ink-700 md:text-7xl">{title}</h1>
            {lead && <p className="mt-6 max-w-2xl text-lg leading-relaxed text-ink-700/70">{lead}</p>}
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

export function ServiceCard({ s, i, dark }: { s: Service; i: number; dark?: boolean }) {
  return (
    <Link
      href={`/sluzby/${s.slug}`}
      data-reveal
      style={{ ["--d" as string]: `${(i % 3) * 90}ms` }}
      className={cn(
        "spot group flex flex-col rounded-2xl border p-7 transition-all duration-500 hover:-translate-y-1",
        dark ? "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]" : "border-ink-700/10 bg-white hover:shadow-[0_30px_60px_-30px_rgba(39,36,37,.35)]",
      )}
    >
      <div className="flex items-start justify-between">
        <span className={cn("grid h-12 w-12 place-items-center rounded-xl transition-colors duration-500", dark ? "bg-white/5 text-brand group-hover:bg-brand group-hover:text-white" : "bg-brand/10 text-brand group-hover:bg-brand group-hover:text-white")}>
          <Icon name={s.icon} className="h-6 w-6" />
        </span>
        <span className={cn("font-mono text-xs", dark ? "text-white/30" : "text-ink-700/30")}>{String(i + 1).padStart(2, "0")}</span>
      </div>
      <h3 className={cn("mt-6 font-display text-2xl font-bold uppercase tracking-tight", dark ? "text-white" : "text-ink-700")}>{s.title}</h3>
      <p className={cn("mt-3 flex-1 text-[15px] leading-relaxed", dark ? "text-white/60" : "text-ink-700/65")}>{s.short}</p>
      <span className="mt-6 inline-flex items-center gap-2 text-[14px] font-semibold text-brand">
        Více o službě <Icon name="arrow" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" />
      </span>
    </Link>
  );
}

export function ServicesGrid({ dark, limit }: { dark?: boolean; limit?: number }) {
  const list = limit ? SERVICES.slice(0, limit) : SERVICES;
  return (
    <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
      {list.map((s, i) => (
        <ServiceCard key={s.slug} s={s} i={i} dark={dark} />
      ))}
    </div>
  );
}

export function ProcessSteps({ dark }: { dark?: boolean }) {
  return (
    <ol className="relative grid gap-6 md:grid-cols-5">
      <div className={cn("absolute left-0 right-0 top-7 hidden h-px overflow-hidden md:block", dark ? "bg-white/10" : "bg-ink-700/10")}>
        <div className="scanx h-full w-1/3 bg-gradient-to-r from-transparent via-brand to-transparent" />
      </div>
      {PROCESS.map((p, i) => (
        <li key={p.t} data-reveal style={{ ["--d" as string]: `${i * 110}ms` }} className="relative">
          <span
            className={cn(
              "relative z-10 grid h-14 w-14 place-items-center rounded-full border font-mono text-sm font-medium",
              dark ? "border-white/15 bg-ink text-white" : "border-ink-700/15 bg-white text-ink-700",
            )}
          >
            <span className="absolute inset-0 rounded-full bg-brand/20 blur-md" />
            <span className="relative">{String(i + 1).padStart(2, "0")}</span>
          </span>
          <h3 className={cn("mt-5 font-display text-xl font-bold uppercase", dark ? "text-white" : "text-ink-700")}>{p.t}</h3>
          <p className={cn("mt-2 text-[15px] leading-relaxed", dark ? "text-white/60" : "text-ink-700/65")}>{p.d}</p>
        </li>
      ))}
    </ol>
  );
}

export function PersonCard({ p, i, dark }: { p: Person; i: number; dark?: boolean }) {
  return (
    <article
      data-reveal
      style={{ ["--d" as string]: `${i * 100}ms` }}
      className={cn("spot group overflow-hidden rounded-2xl border", dark ? "border-white/10 bg-white/[0.03]" : "border-ink-700/10 bg-white")}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-steel-100">
        {p.photo ? (
          <Image src={p.photo} alt={p.name} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover transition-transform duration-700 group-hover:scale-105" />
        ) : (
          <div className="bg-grid-light absolute inset-0 grid place-items-center">
            <div className="absolute h-40 w-40 rounded-full bg-brand/15 blur-3xl transition-all duration-700 group-hover:bg-brand/30" />
            <span className="relative font-display text-7xl font-bold text-ink-700/80">{p.initials}</span>
          </div>
        )}
        <span className="absolute left-4 top-4 rounded-full bg-white/90 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-ink-700 shadow-sm backdrop-blur">
          {p.role}
        </span>
      </div>
      <div className="p-6">
        <h3 className={cn("font-display text-2xl font-bold uppercase", dark ? "text-white" : "text-ink-700")}>{p.name}</h3>
        <p className={cn("mt-2 text-[15px] leading-relaxed", dark ? "text-white/60" : "text-ink-700/65")}>{p.focus}</p>
        <div className="mt-5 space-y-2 text-[14px]">
          {p.phone && (
            <a href={p.phoneHref} className={cn("flex items-center gap-2 hover:text-brand", dark ? "text-white/80" : "text-ink-700")}>
              <Icon name="phone" className="h-4 w-4 text-brand" /> {p.phone}
            </a>
          )}
          <a href={`mailto:${p.email}`} className={cn("flex items-center gap-2 break-all hover:text-brand", dark ? "text-white/80" : "text-ink-700")}>
            <Icon name="mail" className="h-4 w-4 shrink-0 text-brand" /> {p.email}
          </a>
        </div>
      </div>
    </article>
  );
}

export function TeamGrid({ dark }: { dark?: boolean }) {
  return (
    <div className="grid gap-5 md:grid-cols-3">
      {TEAM.map((p, i) => (
        <PersonCard key={p.email} p={p} i={i} dark={dark} />
      ))}
    </div>
  );
}

export function FaqList({ items = FAQ, dark }: { items?: { q: string; a: string }[]; dark?: boolean }) {
  return (
    <div className={cn("divide-y rounded-2xl border", dark ? "divide-white/10 border-white/10" : "divide-ink-700/10 border-ink-700/10 bg-white")}>
      {items.map((f) => (
        <details key={f.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className={cn("flex cursor-pointer list-none items-center justify-between gap-6 text-[17px] font-semibold", dark ? "text-white" : "text-ink-700")}>
            {f.q}
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-current/20 text-brand transition-transform duration-300 group-open:rotate-45">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
          </summary>
          <p className={cn("mt-3 max-w-3xl text-[15px] leading-relaxed", dark ? "text-white/65" : "text-ink-700/70")}>{f.a}</p>
        </details>
      ))}
    </div>
  );
}

export function MachineCard({ m, i = 0 }: { m: Machine; i?: number }) {
  return (
    <article data-reveal style={{ ["--d" as string]: `${(i % 2) * 120}ms` }} className="spot group overflow-hidden rounded-2xl border border-ink-700/10 bg-white transition-shadow duration-500 hover:shadow-[0_40px_80px_-40px_rgba(39,36,37,.35)]">
      {m.image && (
        <div className="relative aspect-[16/10] overflow-hidden border-b border-ink-700/10 bg-white">
          <div className="bg-grid-light absolute inset-0" />
          <Image
            src={m.image}
            alt={`${m.name} – ${m.type}, Mnástrojárna`}
            fill
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-contain p-4 transition-transform duration-700 group-hover:scale-[1.04]"
          />
        </div>
      )}
      <div className="p-7">
        <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-brand">{m.type}</p>
        <h3 className="mt-2 font-display text-3xl font-bold uppercase text-ink-700">{m.name}</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-700/65">{m.description}</p>
        <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-700/10 bg-ink-700/10">
          {m.specs.map(([k, v]) => (
            <div key={k} className="bg-white p-3">
              <dt className="text-[11px] uppercase tracking-wider text-ink-700/45">{k}</dt>
              <dd className="mt-1 font-mono text-[14px] text-ink-700">{v}</dd>
            </div>
          ))}
        </dl>
        {m.euProject && <p className="mt-4 text-[12px] leading-relaxed text-ink-700/40">Pořízeno z projektu {m.euProject}.</p>}
      </div>
    </article>
  );
}

export function MachinesForService({ ids }: { ids: string[] }) {
  const list = ids.map((id) => MACHINES.find((m) => m.id === id)).filter(Boolean) as Machine[];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {list.map((m, i) => (
        <MachineCard key={m.id} m={m} i={i} />
      ))}
    </div>
  );
}

/** Kvalifikace — komu pomůžeme nejlépe (a komu ne). Šetří čas oběma stranám. */
export function FitBlock() {
  const yes = [
    "Výrobní firmy a korporace s vlastní výrobou",
    "Opakované dodávky, rámcové smlouvy, náhradní díly linek",
    "Projekty od 50 000 Kč – ideálně stovky tisíc až miliony",
    "Prototypy a jednoúčelové stroje pro průmysl",
  ];
  const no = ["Zakázky pro soukromé osoby", "Drobné opravy a jednorázové kusy za pár stovek", "Nabídky reklamy, leasingu a obchodních služeb"];
  return (
    <div className="grid gap-5 md:grid-cols-5">
      <div data-reveal className="rounded-2xl border border-ink-700/10 bg-white p-8 md:col-span-3">
        <p className="eyebrow">Pro koho jsme</p>
        <ul className="mt-6 space-y-4">
          {yes.map((t) => (
            <li key={t} className="flex gap-3 text-[16px] text-ink-700">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white">
                <Icon name="check" className="h-3.5 w-3.5" strokeWidth={2.4} />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </div>
      <div data-reveal style={{ ["--d" as string]: "120ms" }} className="rounded-2xl border border-dashed border-ink-700/20 bg-steel-100 p-8 md:col-span-2">
        <p className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-steel-500">Co neděláme</p>
        <ul className="mt-6 space-y-4">
          {no.map((t) => (
            <li key={t} className="flex gap-3 text-[15px] text-ink-700/60">
              <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-ink-700/20 text-ink-700/40">
                <Icon name="x" className="h-3 w-3" strokeWidth={2.4} />
              </span>
              {t}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-[13px] leading-relaxed text-ink-700/50">
          Soustředíme kapacitu tam, kde přinášíme největší hodnotu – díky tomu držíme termíny i kvalitu.
        </p>
      </div>
    </div>
  );
}

/** Závěrečná výzva k akci — světlý výkresový list s velkou typografií. */
export function CtaBand({ title = "Pošlete výkres. Zbytek vyřešíme my.", lead }: { title?: string; lead?: string }) {
  return (
    <section className="paper relative overflow-hidden py-24 md:py-32">
      <div className="bg-grid-light absolute inset-0" />
      <div className="absolute left-1/2 top-1/2 h-[500px] w-[800px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/10 blur-[140px]" />
      <div className="container relative">
        <div className="crop px-6 py-14 text-center md:px-16 md:py-20" data-reveal>
          <p className="eyebrow justify-center">Nezávazná poptávka</p>
          <h2 className="h-display mx-auto mt-5 max-w-4xl text-5xl text-ink-700 md:text-7xl">{title}</h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-ink-700/65">
            {lead ?? "Technolog posoudí vyrobitelnost, obchodník připraví nabídku s cenou a termínem. Data zpracováváme důvěrně."}
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/poptavka" className="btn-primary !px-8 !py-4 !text-base">
              <Icon name="upload" className="h-5 w-5" /> Nahrát výkres a poptat
            </Link>
            <Link href="/cad" className="btn-ghost !px-8 !py-4 !text-base">
              <Icon name="cube" className="h-5 w-5" /> Nakreslit díl v online CAD
            </Link>
          </div>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.2em] text-ink-700/40">
            B2B zakázky od 50 000 Kč · ISO 9001 & 14001 · {SITE.workshop.city}, střed ČR
          </p>
        </div>
      </div>
    </section>
  );
}
