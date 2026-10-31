import { PageHero } from "@/components/blocks";
import { SITE, TEAM } from "@/content/site";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Kariéra – práce v nástrojárně",
  description: "Kariéra v Mnástrojárně Pelhřimov – CNC obráběč, programátor, nástrojař. Pošlete nám otevřenou přihlášku.",
  path: "/kariera",
});

export default function CareerPage() {
  return (
    <PageHero
      eyebrow="Kariéra"
      crumbs={[{ name: "Kariéra", path: "/kariera" }]}
      title={
        <>
          Pracujte s <span className="text-brand">nejmodernější technikou</span>
        </>
      }
      lead={`Aktuálně nevypisujeme žádné konkrétní pozice. Jste zkušený CNC obráběč, programátor nebo nástrojař z okolí Pelhřimova? Pošlete nám otevřenou přihlášku – ozveme se, jakmile se otevře vhodná pozice.`}
    >
      <div className="mt-10 flex flex-wrap gap-3">
        <a href={`mailto:${TEAM[0].email}?subject=${encodeURIComponent("Otevřená přihláška")}`} className="btn-primary !px-7 !py-3.5">
          Poslat přihlášku
        </a>
        <span className="btn-ghost pointer-events-none !px-7 !py-3.5">
          {SITE.workshop.street}, {SITE.workshop.city}
        </span>
      </div>
    </PageHero>
  );
}
