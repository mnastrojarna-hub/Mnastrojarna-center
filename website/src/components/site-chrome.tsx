import { getDict } from "@/content";
import { SALES } from "@/content/site";
import { mailToSales } from "@/lib/contact";
import type { Locale } from "@/i18n/config";
import { Footer } from "./footer";
import { Header } from "./header";
import { Motion } from "./motion";

export function SiteChrome({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = getDict(locale);
  return (
    <>
      <Header locale={locale} t={t.nav} note={`${t.minOrderShort} · ${t.hours}`} mailHref={mailToSales(t.common.mailSubject, t.common.mailBody)} phone={SALES.phone} phoneHref={SALES.phoneHref} />
      <main id="obsah">{children}</main>
      <Footer locale={locale} />
      <Motion />
    </>
  );
}
