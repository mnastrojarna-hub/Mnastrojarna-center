import Link from "next/link";
import type { ReactNode } from "react";
import { CtaBand, FaqList, SectionHeading } from "@/components/blocks";
import { JsonLd } from "@/components/json-ld";
import { CAD_DOCS, CAD_DOCS_META, CAD_FAQ, CAD_FEATURES, CAD_HOWTO, type DocBlock } from "@/content/cad-docs";
import { SITE } from "@/content/site";
import { ORG_ID, breadcrumbJsonLd, faqJsonLd } from "@/lib/seo";

/** Jednoduché značky v textu: **tučně** a `kód`. */
export function rich(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={k++}>{m[1]}</strong>);
    else out.push(<code key={k++}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Block({ b, print }: { b: DocBlock; print?: boolean }) {
  switch (b.t) {
    case "p":
      return <p>{rich(b.text)}</p>;
    case "h3":
      return <h3>{b.text}</h3>;
    case "ul":
      return (
        <ul>
          {b.items.map((x, i) => (
            <li key={i}>{rich(x)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol>
          {b.items.map((x, i) => (
            <li key={i}>{rich(x)}</li>
          ))}
        </ol>
      );
    case "table":
      return (
        <div className="doc-table">
          <table>
            <thead>
              <tr>
                {b.head.map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j}>{rich(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "kbd":
      return (
        <div className="doc-table">
          <table>
            <tbody>
              {b.rows.map(([k, v]) => (
                <tr key={k}>
                  <td className="whitespace-nowrap">
                    <kbd>{k}</kbd>
                  </td>
                  <td>{rich(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "img":
      return (
        <figure>
          {/* snímky obrazovky mají pevný poměr 1600×950 nebo výřez pásu; <img> kvůli tisku do PDF bez optimalizační služby */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={print ? b.src.replace(/\.webp$/, "-print.jpg") : b.src} alt={b.alt} loading={print ? "eager" : "lazy"} decoding="async" />
          {b.caption && <figcaption>{rich(b.caption)}</figcaption>}
        </figure>
      );
    case "note":
      return <aside className="doc-note">{rich(b.text)}</aside>;
  }
}

function wordCount() {
  const text = CAD_DOCS.flatMap((s) => [s.title, s.lead ?? "", ...s.blocks.map((b) => ("text" in b ? b.text : "items" in b ? b.items.join(" ") : "rows" in b ? b.rows.flat().join(" ") : ""))]).join(" ");
  return text.split(/\s+/).filter(Boolean).length;
}

export function cadDocsJsonLd() {
  const url = `${SITE.url}${CAD_DOCS_META.docsUrl}`;
  const app = {
    "@type": "SoftwareApplication",
    "@id": `${SITE.url}/cad#app`,
    name: "Mnástrojárna CAD",
    url: `${SITE.url}/cad`,
    applicationCategory: "DesignApplication",
    applicationSubCategory: "CAD",
    operatingSystem: "Webový prohlížeč (Chrome, Edge, Firefox, Safari)",
    softwareVersion: CAD_DOCS_META.version,
    inLanguage: "cs",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "CZK" },
    featureList: CAD_FEATURES,
    softwareHelp: { "@type": "CreativeWork", url, name: CAD_DOCS_META.shortTitle },
    screenshot: `${SITE.url}/cad/docs/og.jpg`,
    provider: { "@id": ORG_ID },
  };
  return [
    {
      "@context": "https://schema.org",
      "@type": "TechArticle",
      "@id": `${url}#article`,
      headline: CAD_DOCS_META.title,
      description: CAD_DOCS_META.description,
      inLanguage: "cs",
      datePublished: CAD_DOCS_META.updated,
      dateModified: CAD_DOCS_META.updated,
      wordCount: wordCount(),
      image: `${SITE.url}/cad/docs/og.jpg`,
      mainEntityOfPage: url,
      author: { "@id": ORG_ID },
      publisher: { "@id": ORG_ID },
      about: app,
      articleSection: CAD_DOCS.map((s) => s.title),
      proficiencyLevel: "Beginner",
      encoding: [
        { "@type": "MediaObject", encodingFormat: "application/pdf", contentUrl: `${SITE.url}${CAD_DOCS_META.pdfUrl}`, name: "Příručka PDF" },
        { "@type": "MediaObject", encodingFormat: "text/markdown", contentUrl: `${SITE.url}${CAD_DOCS_META.mdUrl}`, name: "Textová verze" },
      ],
    },
    { "@context": "https://schema.org", ...app },
    {
      "@context": "https://schema.org",
      "@type": "HowTo",
      name: "První díl v Mnástrojárna CAD za pět minut",
      inLanguage: "cs",
      totalTime: "PT5M",
      tool: { "@type": "HowToTool", name: "Mnástrojárna CAD (webový prohlížeč)" },
      step: CAD_HOWTO.map((s, i) => ({ "@type": "HowToStep", position: i + 1, name: s.name, text: s.text, url: `${url}#rychly-start` })),
    },
    faqJsonLd(CAD_FAQ),
    breadcrumbJsonLd([
      { name: "Mnástrojárna CAD", path: "/cad" },
      { name: "Dokumentace", path: CAD_DOCS_META.docsUrl },
    ]),
  ];
}

/** Webová verze dokumentace (v rámci webu: hlavička, patička, CTA). */
export function CadDocsView() {
  return (
    <>
      <section className="paper relative overflow-hidden pb-14 pt-32 md:pb-20 md:pt-40">
        <div className="bg-grid-light absolute inset-0" />
        <div className="container relative">
          <nav aria-label="Drobečková navigace" className="mb-6 flex flex-wrap items-center gap-2 text-[13px] text-ink-700/60">
            <Link href="/" className="hover:text-brand">
              Domů
            </Link>
            <span>/</span>
            <Link href="/cad" className="hover:text-brand">
              Mnástrojárna CAD
            </Link>
            <span>/</span>
            <span className="text-ink-700">Dokumentace</span>
          </nav>
          <p className="eyebrow">Návod k obsluze · verze {CAD_DOCS_META.version}</p>
          <h1 className="h-display mt-5 max-w-5xl text-5xl text-ink-700 md:text-7xl">Mnástrojárna CAD – kompletní dokumentace</h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-ink-700/70 md:text-xl">{CAD_DOCS_META.description}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/cad" className="btn-primary">
              Spustit CAD zdarma
            </Link>
            <a href={CAD_DOCS_META.pdfUrl} className="btn-ghost" download>
              Stáhnout příručku PDF
            </a>
            <a href={CAD_DOCS_META.mdUrl} className="btn-ghost">
              Textová verze (Markdown)
            </a>
          </div>
          <p className="mt-4 text-[13px] text-ink-700/55">
            {CAD_DOCS.length} kapitol · {CAD_FAQ.length} otázek a odpovědí · aktualizováno {CAD_DOCS_META.updated.split("-").reverse().join(". ")} · česky
          </p>
        </div>
      </section>

      <section className="section">
        <div className="container grid gap-12 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-28 lg:self-start">
            <p className="eyebrow">Obsah</p>
            <ol className="mt-4 space-y-1.5 text-[14px] leading-snug">
              {CAD_DOCS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-ink-700/75 hover:text-brand">
                    {s.title}
                  </a>
                </li>
              ))}
              <li>
                <a href="#faq" className="text-ink-700/75 hover:text-brand">
                  Časté otázky
                </a>
              </li>
            </ol>
          </aside>
          <article className="doc min-w-0">
            {CAD_DOCS.map((s) => (
              <section key={s.id} id={s.id} className="doc-section">
                <h2>{s.title}</h2>
                {s.lead && <p className="doc-lead">{rich(s.lead)}</p>}
                {s.blocks.map((b, i) => (
                  <Block key={i} b={b} />
                ))}
              </section>
            ))}
            <section id="faq" className="doc-section">
              <SectionHeading eyebrow="FAQ" title="Časté otázky k Mnástrojárna CAD" />
              <div className="mt-8">
                <FaqList items={CAD_FAQ} />
              </div>
            </section>
          </article>
        </div>
      </section>
      <CtaBand locale="cs" title="Vymodelováno? Vyrobíme to." lead="Prototypy, náhradní díly, nástroje a přípravky od 1 kusu. Pošlete STEP tlačítkem Poptat výrobu přímo z CADu." />
      <JsonLd data={cadDocsJsonLd()} />
    </>
  );
}

/** Tisková verze (→ PDF přes Playwright): titulní strana, obsah, kapitoly, FAQ. Bez webové hlavičky a patičky. */
export function CadDocsPrint() {
  const date = CAD_DOCS_META.updated.split("-").reverse().join(". ");
  return (
    <main className="doc doc-print">
      <section className="doc-cover">
        <p className="doc-cover-brand">Mnástrojárna s.r.o. · místo pro Vaši kooperaci…</p>
        <h1>Mnástrojárna CAD</h1>
        <p className="doc-cover-sub">Kompletní dokumentace a návod k obsluze online 3D/2D CADu</p>
        <p className="doc-cover-meta">
          Verze {CAD_DOCS_META.version} · {date}
          <br />
          {SITE.url}/cad · {SITE.url}
          {CAD_DOCS_META.docsUrl}
        </p>
        <p className="doc-cover-abstract">{CAD_DOCS_META.description}</p>
      </section>
      <section className="doc-toc">
        <h2>Obsah</h2>
        <ol>
          {CAD_DOCS.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`}>{s.title}</a>
            </li>
          ))}
          <li>
            <a href="#faq">24. Časté otázky</a>
          </li>
        </ol>
      </section>
      {CAD_DOCS.map((s) => (
        <section key={s.id} id={s.id} className="doc-section">
          <h2>{s.title}</h2>
          {s.lead && <p className="doc-lead">{rich(s.lead)}</p>}
          {s.blocks.map((b, i) => (
            <Block key={i} b={b} print />
          ))}
        </section>
      ))}
      <section id="faq" className="doc-section">
        <h2>24. Časté otázky</h2>
        {CAD_FAQ.map((f) => (
          <div key={f.q} className="doc-faq">
            <h3>{f.q}</h3>
            <p>{f.a}</p>
          </div>
        ))}
      </section>
      <footer className="doc-end">
        © {new Date().getFullYear()} Mnástrojárna s.r.o. · {SITE.url} · Dokumentace je volně šiřitelná pro potřeby uživatelů programu.
      </footer>
    </main>
  );
}
