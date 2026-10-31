import Link from "next/link";
import { getDict } from "@/content";
import { SALES, SERVICE_ORDER, SITE } from "@/content/site";
import { href, type Locale } from "@/i18n/config";
import { Icon } from "./icons";
import { Logo } from "./logo";

export function Footer({ locale }: { locale: Locale }) {
  const t = getDict(locale);
  const f = t.footer;
  const links: [string, string][] = [
    [href(locale, "about"), f.links.about],
    [href(locale, "machinery"), f.links.machinery],
    [href(locale, "quality"), f.links.quality],
    [href(locale, "references"), f.links.references],
    ["/cad", f.links.cad],
    [href(locale, "careers"), f.links.careers],
    [href(locale, "contact"), f.links.contact],
    [href(locale, "rfq"), f.links.rfq],
  ];
  return (
    <footer className="relative overflow-hidden border-t border-ink-700/10 bg-white text-ink-700/70">
      <div className="bg-grid-light absolute inset-0 opacity-60" />
      <div className="container relative grid gap-12 py-16 md:grid-cols-12 md:py-20">
        <div className="md:col-span-4">
          <Logo tone="dark" className="h-9 w-auto" />
          <p className="mt-5 max-w-sm text-[15px] leading-relaxed">
            {t.slogan}. {f.about}
          </p>
          <div className="mt-6 flex flex-wrap gap-2 font-mono text-[11px] uppercase tracking-widest">
            <span className="rounded-full border border-ink-700/15 px-3 py-1.5">ISO 9001</span>
            <span className="rounded-full border border-ink-700/15 px-3 py-1.5">ISO 14001</span>
            <span className="rounded-full border border-ink-700/15 px-3 py-1.5">{t.minOrderShort}</span>
          </div>
        </div>

        <div className="md:col-span-3">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-700/40">{f.services}</h3>
          <ul className="space-y-2 text-[14px]">
            {SERVICE_ORDER.map((id) => (
              <li key={id}>
                <Link className="transition hover:text-brand" href={href(locale, "service", id)}>
                  {t.services[id].title}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-2">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-700/40">{f.company}</h3>
          <ul className="space-y-2 text-[14px]">
            {links.map(([h, l]) => (
              <li key={h}>
                <Link className="transition hover:text-brand" href={h}>
                  {l}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="md:col-span-3">
          <h3 className="mb-4 font-mono text-[11px] uppercase tracking-[0.22em] text-ink-700/40">{f.contact}</h3>
          <address className="space-y-3 text-[14px] not-italic">
            <p className="flex gap-2">
              <Icon name="pin" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <span>
                {SITE.name}
                <br />
                {SITE.workshop.street}, {SITE.workshop.zip} {SITE.workshop.city}
                {locale !== "cs" && (
                  <>
                    <br />
                    {t.country}
                  </>
                )}
              </span>
            </p>
            <p className="flex gap-2">
              <Icon name="mail" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <a className="hover:text-brand" href={`mailto:${SALES.email}`}>
                {SALES.email}
              </a>
            </p>
            {SALES.phone && (
              <p className="flex gap-2">
                <Icon name="phone" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <a className="hover:text-brand" href={SALES.phoneHref}>
                  {SALES.phone}
                </a>
              </p>
            )}
            <p className="flex gap-2">
              <Icon name="clock" className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
              <span>{t.hours}</span>
            </p>
          </address>
          <p className="mt-5 text-[12px] leading-relaxed text-ink-700/45">
            {f.id} {SITE.ico} · {f.vat} {SITE.dic} · {f.dataBox} {SITE.dataBox}
            <br />
            {f.billing}: {SITE.billing.street}, {SITE.billing.zip} {t.addresses.billingCity}
          </p>
        </div>
      </div>
      <div className="pointer-events-none relative select-none overflow-hidden" aria-hidden>
        <p className="h-display -mb-[0.18em] whitespace-nowrap text-center text-[17vw] leading-none text-ink-700/[0.05]">Mnástrojárna</p>
      </div>
      <div className="relative border-t border-ink-700/10">
        <div className="container flex flex-col gap-3 py-6 text-[12px] text-ink-700/40 md:flex-row md:items-center md:justify-between">
          <p>
            © {new Date().getFullYear()} {SITE.name} · {t.registry}
          </p>
          <div className="flex gap-5">
            <Link href={href(locale, "privacy")} className="hover:text-brand">
              {f.privacy}
            </Link>
            <Link href={`${href(locale, "about")}#eu-projekty`} className="hover:text-brand">
              {f.eu}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
