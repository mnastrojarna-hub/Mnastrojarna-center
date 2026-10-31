import Link from "next/link";
import { SERVICES, SITE, TEAM } from "@/content/site";
import { Icon } from "./icons";
import { Logo } from "./logo";

export function Footer() {
  return (
    <footer className="relative overflow-hidden border-t border-ink-700/10 bg-white text-ink-700/70">
      <div className="bg-grid-light absolute inset-0 opacity-60" />
      <div className="container relative grid gap-12 py-16 md:grid-cols-12 md:py-20">
        <div className="md:col-span-4">
          <Logo tone="dark" className="h-9 w-auto" />
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed">
            {SITE.slogan}. Moderní nástrojárna s tradicí od roku {SITE.founded}. Přesné obrábění, nástroje a stroje pro výrobní
            firmy v Česku i v zahraničí.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-widest">
            <span className="rounded-full border border-ink-700/15 px-3 py-1.5">ISO 9001</span>
            <span className="rounded-full border border-ink-700/15 px-3 py-1.5">ISO 14001</span>
            <span className="rounded-full border border-ink-700/15 px-3 py-1.5">B2B od 50 000 Kč</span>
          </div>
        </div>

        <div className="md:col-span-3">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-700/40">Služby</h3>
          <ul className="space-y-2 text-[14px]">
            {SERVICES.map((s) => (
              <li key={s.slug}>
                <Link className="transition hover:text-brand" href={`/sluzby/${s.slug}`}>
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-2">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-700/40">Firma</h3>
          <ul className="space-y-2 text-[14px]">
            {[
              ["/o-nas", "O nás"],
              ["/strojovy-park", "Strojový park"],
              ["/kvalita", "Kvalita a certifikáty"],
              ["/cad", "Online CAD zdarma"],
              ["/kariera", "Kariéra"],
              ["/kontakt", "Kontakt"],
              ["/poptavka", "Poptávka"],
            ].map(([h, l]) => (
              <li key={h}>
                <Link className="transition hover:text-brand" href={h}>
                  {l}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-3">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-700/40">Kontakt</h3>
          <address className="space-y-3 text-[14px] not-italic">
            <p className="flex gap-2">
              <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <span>
                {SITE.name}
                <br />
                {SITE.workshop.street}, {SITE.workshop.zip} {SITE.workshop.city}
              </span>
            </p>
            <p className="flex gap-2">
              <Icon name="mail" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <a className="hover:text-brand" href={`mailto:${TEAM[1].email}`}>
                {TEAM[1].email}
              </a>
            </p>
            <p className="flex gap-2">
              <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <span>{SITE.hours}</span>
            </p>
          </address>
          <p className="mt-5 text-[12px] leading-relaxed text-ink-700/45">
            IČO {SITE.ico} · DIČ {SITE.dic} · Datová schránka {SITE.dataBox}
            <br />
            Fakturační adresa: {SITE.billing.street}, {SITE.billing.zip} {SITE.billing.city}
          </p>
        </div>
      </div>
      <div className="pointer-events-none relative select-none overflow-hidden" aria-hidden>
        <p className="h-display -mb-[0.18em] whitespace-nowrap text-center text-[17vw] leading-none text-ink-700/[0.05]">Mnástrojárna</p>
      </div>
      <div className="relative border-t border-ink-700/10">
        <div className="container flex flex-col gap-3 py-6 text-[12px] text-ink-700/40 md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.name} · {SITE.registry}
          </p>
          <div className="flex gap-5">
            <Link href="/ochrana-osobnich-udaju" className="hover:text-brand">
              Ochrana osobních údajů
            </Link>
            <Link href="/o-nas#eu-projekty" className="hover:text-brand">
              Projekty EU
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
