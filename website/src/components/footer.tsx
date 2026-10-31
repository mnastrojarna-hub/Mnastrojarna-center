import Link from "next/link";
import { SERVICES, SITE, TEAM } from "@/content/site";
import { Icon } from "./icons";
import { Logo } from "./logo";

export function Footer() {
  return (
    <footer className="noise relative overflow-hidden bg-ink text-white/70">
      <div className="bg-grid mask-fade absolute inset-0 opacity-50" />
      <div className="container relative grid gap-12 py-16 md:grid-cols-12 md:py-20">
        <div className="md:col-span-4">
          <Logo tone="light" glow className="h-9 w-auto" />
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed">
            {SITE.slogan}. Moderní nástrojárna s tradicí od roku {SITE.founded}. Přesné obrábění, nástroje a stroje pro výrobní
            firmy v Česku i v zahraničí.
          </p>
          <div className="mt-6 flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-widest">
            <span className="rounded-full border border-white/15 px-3 py-1.5">ISO 9001</span>
            <span className="rounded-full border border-white/15 px-3 py-1.5">ISO 14001</span>
            <span className="rounded-full border border-white/15 px-3 py-1.5">B2B od 50 000 Kč</span>
          </div>
        </div>

        <div className="md:col-span-3">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">Služby</h3>
          <ul className="space-y-2 text-[14px]">
            {SERVICES.map((s) => (
              <li key={s.slug}>
                <Link className="transition hover:text-white" href={`/sluzby/${s.slug}`}>
                  {s.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-2">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">Firma</h3>
          <ul className="space-y-2 text-[14px]">
            {[
              ["/o-nas", "O nás"],
              ["/strojovy-park", "Strojový park"],
              ["/kvalita", "Kvalita a certifikáty"],
              ["/3d-prohlizec", "3D prohlížeč STEP"],
              ["/kariera", "Kariéra"],
              ["/kontakt", "Kontakt"],
              ["/poptavka", "Poptávka"],
            ].map(([h, l]) => (
              <li key={h}>
                <Link className="transition hover:text-white" href={h}>
                  {l}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-3">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-white/40">Kontakt</h3>
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
              <a className="hover:text-white" href={`mailto:${TEAM[1].email}`}>
                {TEAM[1].email}
              </a>
            </p>
            <p className="flex gap-2">
              <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <span>{SITE.hours}</span>
            </p>
          </address>
          <p className="mt-5 text-[12px] leading-relaxed text-white/45">
            IČO {SITE.ico} · DIČ {SITE.dic} · Datová schránka {SITE.dataBox}
            <br />
            Fakturační adresa: {SITE.billing.street}, {SITE.billing.zip} {SITE.billing.city}
          </p>
        </div>
      </div>
      <div className="relative border-t border-white/10">
        <div className="container flex flex-col gap-3 py-6 text-[12px] text-white/40 md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.name} · {SITE.registry}
          </p>
          <div className="flex gap-5">
            <Link href="/ochrana-osobnich-udaju" className="hover:text-white">
              Ochrana osobních údajů
            </Link>
            <Link href="/o-nas#eu-projekty" className="hover:text-white">
              Projekty EU
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
