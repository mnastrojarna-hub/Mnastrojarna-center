import { SITE } from "@/content/site";
import { pageMeta } from "@/lib/seo";

export const metadata = { ...pageMeta({ title: "Ochrana osobních údajů", description: "Zásady zpracování osobních údajů a cookies na webu Mnástrojárna s.r.o.", path: "/ochrana-osobnich-udaju" }), robots: { index: false } };

export default function PrivacyPage() {
  return (
    <section className="pb-24 pt-36 md:pt-44">
      <div className="container max-w-3xl">
        <p className="eyebrow">GDPR</p>
        <h1 className="h-display mt-5 text-5xl text-ink-700">Ochrana osobních údajů</h1>
        <div className="mt-10 space-y-6 text-[16px] leading-relaxed text-ink-700/80">
          <p>
            Správcem osobních údajů je {SITE.name}, IČO {SITE.ico}, se sídlem {SITE.billing.street}, {SITE.billing.zip} {SITE.billing.city}. Kontakt:{" "}
            <a className="text-brand underline" href={`mailto:${SITE.email}`}>
              {SITE.email}
            </a>
            , datová schránka {SITE.dataBox}.
          </p>
          <h2 className="font-display text-2xl font-bold uppercase text-ink-700">Jaké údaje zpracováváme a proč</h2>
          <p>
            Při odeslání poptávkového formuláře zpracováváme identifikační a kontaktní údaje (jméno, pozice, firma, IČO, e-mail,
            telefon) a technickou dokumentaci, kterou nám poskytnete. Údaje používáme výhradně k vyřízení poptávky, přípravě nabídky
            a navazující obchodní komunikaci (právní základ: jednání o smlouvě a oprávněný zájem). IČO ověřujeme ve veřejném registru
            ARES.
          </p>
          <h2 className="font-display text-2xl font-bold uppercase text-ink-700">Jak dlouho</h2>
          <p>
            Údaje z poptávek, které nevedou ke spolupráci, uchováváme nejdéle 3 roky. Údaje související s realizovanými zakázkami po
            dobu stanovenou právními předpisy.
          </p>
          <h2 className="font-display text-2xl font-bold uppercase text-ink-700">3D prohlížeč</h2>
          <p>Soubory otevřené v online 3D prohlížeči se zpracovávají pouze ve vašem prohlížeči a na náš server se neodesílají, pokud je sami nepřipojíte k poptávce.</p>
          <h2 className="font-display text-2xl font-bold uppercase text-ink-700">Cookies</h2>
          <p>
            Bez vašeho souhlasu používáme pouze technicky nezbytné úložiště. Analytické a marketingové cookies (Google Analytics /
            Google Ads) spouštíme jen po udělení souhlasu, který můžete kdykoli odvolat vymazáním dat webu ve vašem prohlížeči.
          </p>
          <h2 className="font-display text-2xl font-bold uppercase text-ink-700">Vaše práva</h2>
          <p>
            Máte právo na přístup k údajům, jejich opravu, výmaz, omezení zpracování, přenositelnost a vznesení námitky. Stížnost
            můžete podat u Úřadu pro ochranu osobních údajů (www.uoou.cz).
          </p>
        </div>
      </div>
    </section>
  );
}
