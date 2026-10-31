import Link from "next/link";
import { Icon } from "@/components/icons";
import { getDict } from "@/content";
import { href, type Locale } from "@/i18n/config";

/** Stránka 404 v daném jazyce. */
export function NotFoundView({ locale }: { locale: Locale }) {
  return <NotFoundInner locale={locale} />;
}
function NotFoundInner({ locale }: { locale: Locale }) {
  const p = getDict(locale).pages.notFound;
  return (
    <section className="paper relative grid min-h-[80vh] place-items-center overflow-hidden">
      <div className="bg-grid-light absolute inset-0" />
      <div className="container relative text-center">
        <p className="font-mono text-sm text-brand">{p.code}</p>
        <h1 className="h-display mt-4 text-6xl text-ink-700 md:text-8xl">{p.title}</h1>
        <p className="mx-auto mt-6 max-w-lg text-ink-700/60">{p.lead}</p>
        <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href={href(locale, "home")} className="btn-ghost">
            {p.home}
          </Link>
          <Link href={href(locale, "contact")} className="btn-primary">
            {getDict(locale).nav.contact} <Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
