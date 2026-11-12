import Link from "next/link";
import { CtaBand, PageHero, SectionHeading } from "@/components/blocks";
import { JsonLd } from "@/components/json-ld";
import { CAD_LINKS, cadAppHref, cadDocsHref } from "@/content/cad-links";
import { SITE } from "@/content/site";
import { breadcrumbJsonLd } from "@/lib/seo";

type L = "en" | "de";

/** Anglická a německá stránka dokumentace CADu: shrnutí ovládání, textové příkazy, zkratky; úplná příručka (24 kapitol) je zatím česky. */
const T = {
  en: {
    eyebrow: "Online CAD",
    crumb: "CAD documentation",
    title: "Mnástrojárna CAD – documentation",
    lead: "Free parametric 3D/2D CAD that runs in your browser with an English interface. This page summarises how to work with it; the complete 24-chapter manual is currently available in Czech.",
    open: "Open the CAD (English)",
    full: "Full documentation (Czech)",
    pdf: "Manual as PDF (Czech)",
    start: {
      h: "Getting started",
      items: [
        "Open **/en/cad**. The start screen offers a new part, a new assembly, example parts and your recent documents (they are stored in your browser, nothing is uploaded).",
        "The ribbon has the tabs **Create, Surfaces, Sheet metal, Weldments, Tools, View, Drawing, Data** and, for assemblies, **Assembly**. While a sketch is open, the **Sketch** tab appears.",
        "A typical part: **Sketch** on a base plane → draw with constraints and dimensions → **Extrude** / **Revolve** → holes, fillets, chamfers, patterns → **Drawing** with views, sections and a title block → export **STEP**, **STL** or **PDF**.",
        "Everything is parametric: every feature in the history on the left can be edited, suppressed or reordered; values may be expressions and variables (`=d*2`).",
      ],
    },
    tools: {
      h: "What the CAD can do",
      items: [
        "**Sketching** – lines, rectangles, circles, arcs, slots, polygons, splines, points; constraints (horizontal, vertical, coincident, tangent, equal, symmetric…) and driving dimensions; numeric input at the cursor (Tab/Enter).",
        "**Solids** – extrude, revolve, sweep, loft, holes (simple, counterbored, countersunk, tapped), fillets (constant, variable, full round), chamfers, shell, draft, rib, linear/circular/curve/fill patterns, mirror, threads (cosmetic or modelled, M2–M48 incl. fine pitch), text, push/pull and other direct edits.",
        "**Surfaces** – planar, extruded and revolved surfaces, loft, sweep, helix sweep (threads, springs), offset, extend, trim, sew, patch, thicken, close into a solid.",
        "**Sheet metal** – base flange, edge and sketched bends, hems, cut-outs, beads, corner reliefs, bend table and a flat pattern exported to DXF/SVG.",
        "**Weldments** – structural profiles along sketch lines (hollow sections, tubes, L, U, IPE/HEB), end caps, gussets, plates, weld beads and weld symbols, cut list and weld table.",
        "**Assemblies** – components from files or the library, mates, interference check, bill of materials with balloons on drawings, injection mould base generator.",
        "**Drawings** – views, sections, details, dimensions, notes, surface finish, geometric tolerances, hole tables, A4–A0 sheets with a title block; export to PDF and DXF/DWG.",
        "**Library** – screws, nuts, washers, pins, keys, bearings, gears, pulleys, sprockets, springs, profiles, linear guides, pneumatics, mould parts.",
        "**Data** – import and export STEP, IGES, BREP, STL, OBJ, 3MF, glTF/GLB, PLY, DXF; documents in the `.mncad` format; share links with optional password.",
      ],
    },
    text: {
      h: "Text commands and AI",
      lead: "Open the console with **Ctrl+Shift+K** (or the Program menu → Text commands). Commands are accepted in English, German and Czech; JSON in the `.mncad` format can be mixed in.",
      sample: ["new part Plate", "box 100 60 12", "hole 8.5 depth 10 at 20 30 12", "fillet 2 edges vertical", "pattern 4 spacing 25 direction X", "sketch XY: rect 60 40; circle 20 at 10 5", "extrude 20 symmetric cut", "thread M18×1.5 length 20 at 0 0 12 internal", "status"],
      after: "Edge rules: `all, top, bottom, +Z/-Z, vertical, horizontal, circular, straight, radius N, longer N, shorter N`; face rules: `top, bottom, side, cylindrical, planar, largest`. Automation uses `window.mncad` (run, status, getDocument, exportFile, hints) – see the schema for AI agents linked below.",
    },
    keys: {
      h: "Keyboard shortcuts",
      rows: [
        ["0 … 6", "Isometric, front, top, right, back, bottom, left view"],
        ["F / P", "Fit view / perspective"],
        ["S · E · H · B · N", "New sketch · extrude · hole · fillet · chamfer"],
        ["M · X", "Measure · section view"],
        ["Ctrl+K", "Command palette (search every button)"],
        ["Ctrl+S · Ctrl+O", "Save · open"],
        ["Ctrl+Z · Ctrl+Y", "Undo · redo"],
        ["Ctrl+, · Ctrl+L", "Settings · library"],
        ["Ctrl+Shift+K · Ctrl+Shift+L", "Text commands · entity labels for AI (F1, E2, V3)"],
        ["Sketch: L R C A E N B P S T O D", "Line, rectangle, circle, arc, ellipse, spline, point, polygon, slot, trim, offset, dimension"],
        ["Enter · Esc · Delete", "Confirm · cancel / close · delete"],
      ],
    },
    lang: {
      h: "Interface language",
      text: "The CAD is available in Czech (/cad), English (/en/cad) and German (/de/cad). Switch the language in **Settings → Interface language**; the choice is remembered in your browser. Kernel messages, the drawing title block, the library and the text-command console follow the chosen language.",
    },
    docs: {
      h: "Full documentation",
      text: "The complete manual with 24 chapters, step-by-step procedures and FAQ is currently in Czech. Browser translation (Chrome, Edge) works well on it. There is also a printable PDF and a Markdown version for AI tools.",
      links: [
        { href: CAD_LINKS.docs, label: "Documentation on the web (Czech)" },
        { href: CAD_LINKS.pdf, label: "Manual as PDF (Czech)" },
        { href: CAD_LINKS.md, label: "Documentation as Markdown" },
        { href: CAD_LINKS.agent, label: "Schema and guide for AI agents" },
      ],
    },
    privacy: {
      h: "Your data",
      text: "Documents stay in your browser (local storage) unless you save a file or create a share link. Nothing is uploaded automatically and no account is needed. The CAD is free for both personal and commercial use.",
    },
  },
  de: {
    eyebrow: "Online-CAD",
    crumb: "CAD-Dokumentation",
    title: "Mnástrojárna CAD – Dokumentation",
    lead: "Kostenloses parametrisches 3D/2D-CAD im Browser mit deutscher Oberfläche. Diese Seite fasst die Bedienung zusammen; das vollständige Handbuch mit 24 Kapiteln ist derzeit auf Tschechisch verfügbar.",
    open: "CAD öffnen (Deutsch)",
    full: "Vollständige Dokumentation (Tschechisch)",
    pdf: "Handbuch als PDF (Tschechisch)",
    start: {
      h: "Erste Schritte",
      items: [
        "Öffnen Sie **/de/cad**. Der Startbildschirm bietet ein neues Teil, eine neue Baugruppe, Beispielteile und Ihre letzten Dokumente (sie liegen in Ihrem Browser, nichts wird hochgeladen).",
        "Das Menüband hat die Registerkarten **Erstellen, Flächen, Blech, Schweißkonstruktion, Werkzeuge, Ansicht, Zeichnung, Daten** und bei Baugruppen **Baugruppe**. Bei geöffneter Skizze erscheint die Registerkarte **Skizze**.",
        "Ein typisches Teil: **Skizze** auf einer Grundebene → Zeichnen mit Beziehungen und Bemaßungen → **Extrudieren** / **Drehen** → Bohrungen, Verrundungen, Fasen, Muster → **Zeichnung** mit Ansichten, Schnitten und Schriftfeld → Export als **STEP**, **STL** oder **PDF**.",
        "Alles ist parametrisch: jedes Feature in der Historie links lässt sich bearbeiten, unterdrücken oder umsortieren; Werte dürfen Ausdrücke und Variablen sein (`=d*2`).",
      ],
    },
    tools: {
      h: "Was das CAD kann",
      items: [
        "**Skizzieren** – Linien, Rechtecke, Kreise, Bögen, Langlöcher, Vielecke, Splines, Punkte; Beziehungen (horizontal, vertikal, koinzident, tangential, gleich, symmetrisch…) und treibende Bemaßungen; Zahleneingabe am Cursor (Tab/Enter).",
        "**Volumenkörper** – Extrudieren, Drehen, Austragung, Ausformung, Bohrungen (einfach, Senkung, Kegelsenkung, Gewinde), Verrundungen (konstant, variabel, Vollverrundung), Fasen, Schale, Formschräge, Rippe, lineare/kreisförmige/Kurven-/Füllmuster, Spiegeln, Gewinde (kosmetisch oder modelliert, M2–M48 inkl. Feingewinde), Text, Ziehen/Drücken und weitere Direktbearbeitungen.",
        "**Flächen** – ebene, extrudierte und gedrehte Flächen, Ausformung, Austragung, Helix-Austragung (Gewinde, Federn), Versetzen, Verlängern, Trimmen, Nähen, Flicken, Verdicken, zu Körper schließen.",
        "**Blech** – Grundblech, Kanten- und Skizzenbiegungen, Falze, Ausschnitte, Sicken, Eckfreistiche, Biegetabelle und Abwicklung mit Export nach DXF/SVG.",
        "**Schweißkonstruktionen** – Konstruktionsprofile entlang von Skizzenlinien (Hohlprofile, Rohre, L, U, IPE/HEB), Deckel, Knotenbleche, Platten, Schweißraupen und Schweißsymbole, Zuschnittliste und Schweißtabelle.",
        "**Baugruppen** – Komponenten aus Dateien oder der Bibliothek, Verknüpfungen, Kollisionsprüfung, Stückliste mit Positionsnummern auf Zeichnungen, Generator für Spritzgießformen.",
        "**Zeichnungen** – Ansichten, Schnitte, Details, Bemaßungen, Anmerkungen, Oberflächenangaben, Form- und Lagetoleranzen, Bohrungstabellen, Blätter A4–A0 mit Schriftfeld; Export als PDF und DXF/DWG.",
        "**Bibliothek** – Schrauben, Muttern, Scheiben, Stifte, Passfedern, Lager, Zahnräder, Riemenscheiben, Kettenräder, Federn, Profile, Linearführungen, Pneumatik, Formenbauteile.",
        "**Daten** – Import und Export STEP, IGES, BREP, STL, OBJ, 3MF, glTF/GLB, PLY, DXF; Dokumente im Format `.mncad`; Freigabelinks mit optionalem Passwort.",
      ],
    },
    text: {
      h: "Textbefehle und KI",
      lead: "Die Konsole öffnen Sie mit **Strg+Umschalt+K** (oder Menü Programm → Textbefehle). Befehle werden auf Deutsch, Englisch und Tschechisch angenommen; JSON im Format `.mncad` lässt sich beimischen.",
      sample: ["neues teil Platte", "quader 100 60 12", "bohrung 8,5 tiefe 10 bei 20 30 12", "verrunden 2 kanten senkrecht", "muster 4 abstand 25 richtung X", "skizze XY: rechteck 60 40; kreis 20 bei 10 5", "extrudieren 20 symmetrisch abziehen", "gewinde M18×1,5 länge 20 bei 0 0 12 innen", "status"],
      after: "Kantenregeln: `alle, oben, unten, +Z/-Z, senkrecht, waagerecht, rund, gerade, radius N, länger N, kürzer N`; Flächenregeln: `oben, unten, seitlich, zylindrisch, eben, grösste`. Für Automatisierung steht `window.mncad` bereit (run, status, getDocument, exportFile, hints) – siehe das Schema für KI-Agenten unten.",
    },
    keys: {
      h: "Tastenkürzel",
      rows: [
        ["0 … 6", "Isometrie, Vorder-, Drauf-, Rechts-, Rück-, Unter-, Linksansicht"],
        ["F / P", "Ansicht einpassen / Perspektive"],
        ["S · E · H · B · N", "Neue Skizze · Extrudieren · Bohrung · Verrundung · Fase"],
        ["M · X", "Messen · Schnittansicht"],
        ["Strg+K", "Befehlspalette (Suche über alle Schaltflächen)"],
        ["Strg+S · Strg+O", "Speichern · Öffnen"],
        ["Strg+Z · Strg+Y", "Rückgängig · Wiederholen"],
        ["Strg+, · Strg+L", "Einstellungen · Bibliothek"],
        ["Strg+Umschalt+K · Strg+Umschalt+L", "Textbefehle · Beschriftungen für KI (F1, E2, V3)"],
        ["Skizze: L R C A E N B P S T O D", "Linie, Rechteck, Kreis, Bogen, Ellipse, Spline, Punkt, Vieleck, Langloch, Trimmen, Versetzen, Bemaßung"],
        ["Enter · Esc · Entf", "Bestätigen · Abbrechen / Schließen · Löschen"],
      ],
    },
    lang: {
      h: "Sprache der Oberfläche",
      text: "Das CAD gibt es auf Tschechisch (/cad), Englisch (/en/cad) und Deutsch (/de/cad). Die Sprache wechseln Sie unter **Einstellungen → Sprache der Oberfläche**; die Wahl wird im Browser gespeichert. Kernmeldungen, das Schriftfeld der Zeichnung, die Bibliothek und die Befehlskonsole folgen der gewählten Sprache.",
    },
    docs: {
      h: "Vollständige Dokumentation",
      text: "Das vollständige Handbuch mit 24 Kapiteln, Schritt-für-Schritt-Anleitungen und FAQ ist derzeit auf Tschechisch. Die Browser-Übersetzung (Chrome, Edge) funktioniert damit gut. Außerdem gibt es ein druckbares PDF und eine Markdown-Fassung für KI-Werkzeuge.",
      links: [
        { href: CAD_LINKS.docs, label: "Dokumentation im Web (Tschechisch)" },
        { href: CAD_LINKS.pdf, label: "Handbuch als PDF (Tschechisch)" },
        { href: CAD_LINKS.md, label: "Dokumentation als Markdown" },
        { href: CAD_LINKS.agent, label: "Schema und Anleitung für KI-Agenten" },
      ],
    },
    privacy: {
      h: "Ihre Daten",
      text: "Dokumente bleiben in Ihrem Browser (lokaler Speicher), sofern Sie keine Datei speichern oder keinen Freigabelink erstellen. Nichts wird automatisch hochgeladen, ein Konto ist nicht nötig. Das CAD ist für private und gewerbliche Nutzung kostenlos.",
    },
  },
} as const;

/** **tučně** a `kód` v textu. */
function rich(text: string) {
  const out: React.ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(m[1] ? <strong key={k++}>{m[1]}</strong> : <code key={k++} className="rounded bg-ink-700/5 px-1 py-0.5 font-mono text-[0.92em]">{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function cadDocsIntlMeta(locale: L) {
  const t = T[locale];
  return {
    title: t.title,
    description: t.lead,
    alternates: { canonical: cadDocsHref(locale), languages: { cs: CAD_LINKS.docs, en: cadDocsHref("en"), de: cadDocsHref("de") } },
    openGraph: { url: `${SITE.url}${cadDocsHref(locale)}`, title: t.title, description: t.lead, siteName: SITE.name, locale: locale === "en" ? "en_GB" : "de_DE", type: "article" as const },
  };
}

export function CadDocsIntlView({ locale }: { locale: L }) {
  const t = T[locale];
  const crumbs = [{ name: "CAD", path: cadAppHref(locale) }, { name: t.crumb, path: cadDocsHref(locale) }];
  const Li = ({ items }: { items: readonly string[] }) => (
    <ul className="mt-6 space-y-3 text-[16px] leading-relaxed text-ink-700/80">
      {items.map((x) => (
        <li key={x} className="flex gap-3">
          <span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
          <span>{rich(x)}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <PageHero locale={locale} eyebrow={t.eyebrow} crumbs={crumbs} title={t.title} lead={t.lead} sheet="CAD">
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href={cadAppHref(locale)} className="inline-flex items-center rounded-full bg-brand px-5 py-2.5 text-[14px] font-semibold text-white hover:bg-brand/90">
            {t.open}
          </Link>
          <Link href={CAD_LINKS.docs} className="inline-flex items-center rounded-full border border-ink-700/15 px-5 py-2.5 text-[14px] font-medium text-ink-700 hover:bg-ink-700/5">
            {t.full}
          </Link>
          <a href={CAD_LINKS.pdf} className="inline-flex items-center rounded-full border border-ink-700/15 px-5 py-2.5 text-[14px] font-medium text-ink-700 hover:bg-ink-700/5">
            {t.pdf}
          </a>
        </div>
      </PageHero>
      <section className="section">
        <div className="container max-w-4xl">
          <SectionHeading title={t.start.h} />
          <Li items={t.start.items} />
        </div>
      </section>
      <section className="section bg-steel-100">
        <div className="container max-w-4xl">
          <SectionHeading title={t.tools.h} />
          <Li items={t.tools.items} />
        </div>
      </section>
      <section className="section">
        <div className="container max-w-4xl">
          <SectionHeading title={t.text.h} lead={rich(t.text.lead)} />
          <pre className="mt-6 overflow-x-auto rounded-2xl bg-ink-700 p-5 font-mono text-[14px] leading-relaxed text-white">{t.text.sample.join("\n")}</pre>
          <p className="mt-5 text-[16px] leading-relaxed text-ink-700/80">{rich(t.text.after)}</p>
        </div>
      </section>
      <section className="section bg-steel-100">
        <div className="container max-w-4xl">
          <SectionHeading title={t.keys.h} />
          <div className="mt-6 overflow-x-auto rounded-2xl border border-ink-700/10 bg-white">
            <table className="w-full text-[15px]">
              <tbody>
                {t.keys.rows.map(([k, d]) => (
                  <tr key={k} className="border-b border-ink-700/10 last:border-0">
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-[13px] font-semibold text-ink-700">{k}</td>
                    <td className="px-5 py-3 text-ink-700/80">{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container grid max-w-5xl gap-8 md:grid-cols-3">
          {[t.lang, t.docs, t.privacy].map((b) => (
            <div key={b.h} className="rounded-2xl border border-ink-700/10 bg-white p-6">
              <h2 className="font-display text-xl font-bold uppercase text-ink-700">{b.h}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-700/75">{rich(b.text)}</p>
              {"links" in b && (
                <ul className="mt-4 space-y-2 text-[15px]">
                  {b.links.map((l) => (
                    <li key={l.href}>
                      <Link href={l.href} className="font-medium text-brand underline-offset-2 hover:underline">
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>
      <CtaBand locale={locale} />
      <JsonLd data={breadcrumbJsonLd(crumbs)} />
    </>
  );
}
