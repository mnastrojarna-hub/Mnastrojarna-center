import { getDict } from "@/content";
import type { Locale } from "@/i18n/config";
import { Footer } from "./footer";
import { Header } from "./header";

export function SiteChrome({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = getDict(locale);
  return (
    <>
      <Header locale={locale} t={t.nav} note={`${t.minOrderShort} · ${t.hours}`} />
      <main id="obsah">{children}</main>
      <Footer locale={locale} />
    </>
  );
}
