import Link from "next/link";
import { CtaBand, PageHero, SectionHeading } from "@/components/blocks";
import { JsonLd } from "@/components/json-ld";
import { CAD_LINKS, cadAppHref, cadDocsHref } from "@/content/cad-links";
import { SITE } from "@/content/site";
import { breadcrumbJsonLd } from "@/lib/seo";

type L = "en" | "de";

/** Anglická a německá stránka dokumentace CADu: shrnutí ovládání, textové příkazy, zkratky; úplná příručka (26 kapitol) je zatím česky. */
const T = {
  en: {
    eyebrow: "Online CAD",
    crumb: "CAD documentation",
    title: "Mnástrojárna CAD – documentation",
    lead: "Free parametric 3D/2D CAD that runs in your browser with an English interface. This page summarises how to work with it; the complete 26-chapter manual is currently available in Czech.",
    open: "Open the CAD (English)",
    full: "Full documentation (Czech)",
    pdf: "Manual as PDF (Czech)",
    start: {
      h: "Getting started",
      items: [
        "Open **/en/cad**. The start screen offers a new part, a new assembly, a drawing of an existing model and a **new 2D drawing**, plus example parts. By default nothing is stored in the browser – your work lives in the open tab and in the files you save.",
        "The ribbon has the tabs **Create, Surfaces, Sheet metal, Weldments, Tools, View, Drawing, Data** and, for assemblies, **Assembly**. While a sketch is open, the **Sketch** tab appears.",
        "**Micro-guides:** hover over any ribbon icon (long-press on touch screens) to see what the tool does, when to use it, what to select, the steps, the matching text command and a tip; a disabled button also says why it is disabled. Switch them off in Settings → General → Micro-guides on icons.",
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
        "**Weldments** – structural profiles along sketch lines (hollow sections, tubes, L, U, IPE/HEB), end caps, gussets, plates; fillet, butt (edge preparation to ISO 9692-1), plug and spot welds as weld-metal bodies with mass, automatic ISO 2553 symbols on drawings, cut list and weld table.",
        "**Assemblies** – components from files or the library, mates, interference check, bill of materials with balloons on drawings, injection mould base generator.",
        "**Drawings** – views, sections, details, dimensions, notes, surface finish, geometric tolerances, hole tables, A4–A0 sheets with a title block; export to PDF and DXF/DWG, all sheets at once as a multi-page PDF or ZIP.",
        "**2D drafting** – a separate 2D drawing document like in AutoCAD: command line with AutoCAD aliases (L, C, PL, TR…), absolute, relative and polar coordinates, object snaps, layers, linetypes and lineweights, dimensions with dimension styles, text, hatches, leaders, tolerances, blocks with attributes, layouts with scaled viewports and PDF printing; opens and saves DWG (R2000–R2018) and DXF (R12–R2018).",
        "**Library** – screws, nuts, washers, pins, keys, bearings, gears, pulleys, sprockets, springs, profiles, linear guides, pneumatics, mould parts.",
        "**Data** – import and export STEP, IGES, BREP, STL, OBJ, 3MF, glTF/GLB, PLY, DXF and DWG; documents in the `.mncad` format; short share links `mnastrojarna.cz/s#CODE` (10-character code, document encrypted in your browser, valid 1–90 days, optional password).",
      ],
    },
    text: {
      h: "Text commands and AI",
      lead: "Open the console with **Ctrl+Shift+K** (or the Program menu → Text commands). Commands are accepted in English, German and Czech; JSON in the `.mncad` format can be mixed in.",
      sample: ["new part Plate", "box 100 60 12", "hole 8.5 depth 10 at 20 30 12", "fillet 2 edges vertical", "pattern 4 spacing 25 direction X", "sketch XY: rect 60 40; circle 20 at 10 5", "extrude 20 symmetric cut", "thread M18×1.5 length 20 at 0 0 12 internal", "status"],
      after: "Edge rules: `all, top, bottom, +Z/-Z, vertical, horizontal, circular, straight, radius N, longer N, shorter N`; face rules: `top, bottom, side, cylindrical, planar, largest`. Automation uses `window.mncad` (run, status, getDocument, exportFile, hints) – see the schema for AI agents linked below.",
      more: [
        "**Outputs without dialogs** – `save`, `export step|stl|brep|obj|glb|3mf`, `drawing export pdf|dxf|dwg|svg [all]` and `sketch export dxf` download the file straight away and report its name and size in the log; STEP and BREP files are read back and compared with the model. `share [days N] [password X]` creates a share link – it is printed on a `URL:` line of the log and returned by `window.mncad.share()`.",
        "**Automation mode** – when the browser is driven by Playwright or Selenium (or the address contains `?agent=1`) the CAD never opens a system dialog: saving and exporting download directly, questions are in-page dialogs (Enter / Esc), closing the tab does not prompt and Print in a drawing downloads a PDF. Faces, edges and vertices can be clicked even in the software preview without WebGL.",
        "**2D drawings by text** – lines starting with `2d` (or `draft`): `2d line 0,0 100,0 @0,50`, `2d circle 50,25 20`, `2d export dwg version R2013`; scripts call `window.mncad.draft()`.",
        "**Without a browser (CLI, phase A)** – `mncad run script.txt --open part.mncad --out dir` (Node.js 22 or newer, bundle published under `/cad/cli/`) opens saved `.mncad` documents, rebuilds them with the same kernel and writes STEP, STL and drawing PDF / DXF / DWG / SVG files plus a short `MNCAD/1` log (at most 2 kB) with exit codes for scripts. Text commands in the script are not executed by the CLI yet – each one is reported as browser-only; modelling by text currently runs in the browser app.",
      ],
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
        ["2D drawing: F3 · F7 · F8 · F9 · F10", "Object snap · grid · ortho · grid snap · polar tracking"],
        ["2D drawing: L C A PL REC TR EX F …", "Command aliases as in AutoCAD – type and confirm with Enter or Space"],
        ["Enter · Esc · Delete", "Confirm · cancel / close · delete"],
      ],
    },
    lang: {
      h: "Interface language",
      text: "The CAD is available in Czech (/cad), English (/en/cad) and German (/de/cad). Switch the language in **Settings → Interface language**; the choice is remembered in your browser. Kernel messages, the drawing title block, the library and the text-command console follow the chosen language.",
    },
    docs: {
      h: "Full documentation",
      text: "The complete manual with 26 chapters, step-by-step procedures and FAQ is currently in Czech. Browser translation (Chrome, Edge) works well on it. There is also a printable PDF and a Markdown version for AI tools.",
      links: [
        { href: CAD_LINKS.docs, label: "Documentation on the web (Czech)" },
        { href: CAD_LINKS.pdf, label: "Manual as PDF (Czech)" },
        { href: CAD_LINKS.md, label: "Documentation as Markdown" },
        { href: CAD_LINKS.agent, label: "Schema and guide for AI agents" },
      ],
    },
    privacy: {
      h: "Your data",
      text: "By default nothing is stored in the browser: your work lives in the open tab and in the files you save (an optional password-encrypted storage keeps recent files). Nothing is uploaded automatically and no account is needed. A share link uploads only a copy encrypted in your browser – the key is the code after `#`, which is never sent to the server – and the copy is deleted when the link expires. The CAD is free for both personal and commercial use.",
    },
  },
  de: {
    eyebrow: "Online-CAD",
    crumb: "CAD-Dokumentation",
    title: "Mnástrojárna CAD – Dokumentation",
    lead: "Kostenloses parametrisches 3D/2D-CAD im Browser mit deutscher Oberfläche. Diese Seite fasst die Bedienung zusammen; das vollständige Handbuch mit 26 Kapiteln ist derzeit auf Tschechisch verfügbar.",
    open: "CAD öffnen (Deutsch)",
    full: "Vollständige Dokumentation (Tschechisch)",
    pdf: "Handbuch als PDF (Tschechisch)",
    start: {
      h: "Erste Schritte",
      items: [
        "Öffnen Sie **/de/cad**. Der Startbildschirm bietet ein neues Teil, eine neue Baugruppe, eine Zeichnung eines vorhandenen Modells und eine **neue 2D-Zeichnung** sowie Beispielteile. Standardmäßig wird nichts im Browser gespeichert – Ihre Arbeit liegt im geöffneten Tab und in den Dateien, die Sie speichern.",
        "Das Menüband hat die Registerkarten **Erstellen, Flächen, Blech, Schweißkonstruktion, Werkzeuge, Ansicht, Zeichnung, Daten** und bei Baugruppen **Baugruppe**. Bei geöffneter Skizze erscheint die Registerkarte **Skizze**.",
        "**Kurzanleitungen:** Zeigen Sie mit der Maus auf ein Symbol im Menüband (auf Touch-Geräten lange drücken) – Sie sehen, was der Befehl tut, wann man ihn verwendet, was auszuwählen ist, die Schritte, den passenden Textbefehl und einen Tipp; bei einer deaktivierten Schaltfläche auch den Grund. Abschalten unter Einstellungen → Allgemein → Kurzanleitungen an Symbolen.",
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
        "**Schweißkonstruktionen** – Konstruktionsprofile entlang von Skizzenlinien (Hohlprofile, Rohre, L, U, IPE/HEB), Deckel, Knotenbleche, Platten; Kehl-, Stumpf- (Nahtvorbereitung nach ISO 9692-1), Loch- und Punktnähte als Schweißgut-Körper mit Masse, automatische Symbole nach ISO 2553 in Zeichnungen, Zuschnittliste und Schweißtabelle.",
        "**Baugruppen** – Komponenten aus Dateien oder der Bibliothek, Verknüpfungen, Kollisionsprüfung, Stückliste mit Positionsnummern auf Zeichnungen, Generator für Spritzgießformen.",
        "**Zeichnungen** – Ansichten, Schnitte, Details, Bemaßungen, Anmerkungen, Oberflächenangaben, Form- und Lagetoleranzen, Bohrungstabellen, Blätter A4–A0 mit Schriftfeld; Export als PDF und DXF/DWG, auch alle Blätter auf einmal als mehrseitiges PDF oder ZIP.",
        "**2D-Zeichnen** – ein eigenes Dokument 2D-Zeichnung wie in AutoCAD: Befehlszeile mit AutoCAD-Kürzeln (L, C, PL, TR…), absolute, relative und polare Koordinaten, Objektfang, Ebenen (Layer), Linientypen und Linienstärken, Bemaßungen mit Bemaßungsstilen, Text, Schraffuren, Führungslinien, Toleranzen, Blöcke mit Attributen, Layouts mit maßstäblichen Ansichtsfenstern und PDF-Druck; öffnet und speichert DWG (R2000–R2018) und DXF (R12–R2018).",
        "**Bibliothek** – Schrauben, Muttern, Scheiben, Stifte, Passfedern, Lager, Zahnräder, Riemenscheiben, Kettenräder, Federn, Profile, Linearführungen, Pneumatik, Formenbauteile.",
        "**Daten** – Import und Export STEP, IGES, BREP, STL, OBJ, 3MF, glTF/GLB, PLY, DXF und DWG; Dokumente im Format `.mncad`; kurze Freigabelinks `mnastrojarna.cz/s#CODE` (10-stelliger Code, Dokument im Browser verschlüsselt, 1–90 Tage gültig, optionales Passwort).",
      ],
    },
    text: {
      h: "Textbefehle und KI",
      lead: "Die Konsole öffnen Sie mit **Strg+Umschalt+K** (oder Menü Programm → Textbefehle). Befehle werden auf Deutsch, Englisch und Tschechisch angenommen; JSON im Format `.mncad` lässt sich beimischen.",
      sample: ["neues teil Platte", "quader 100 60 12", "bohrung 8,5 tiefe 10 bei 20 30 12", "verrunden 2 kanten senkrecht", "muster 4 abstand 25 richtung X", "skizze XY: rechteck 60 40; kreis 20 bei 10 5", "extrudieren 20 symmetrisch abziehen", "gewinde M18×1,5 länge 20 bei 0 0 12 innen", "status"],
      after: "Kantenregeln: `alle, oben, unten, +Z/-Z, senkrecht, waagerecht, rund, gerade, radius N, länger N, kürzer N`; Flächenregeln: `oben, unten, seitlich, zylindrisch, eben, grösste`. Für Automatisierung steht `window.mncad` bereit (run, status, getDocument, exportFile, hints) – siehe das Schema für KI-Agenten unten.",
      more: [
        "**Ausgaben ohne Dialoge** – `speichern`, `exportieren step|stl|brep|obj|glb|3mf`, `zeichnung export pdf|dxf|dwg|svg [alle]` und `skizze export dxf` laden die Datei sofort herunter und melden Name und Größe im Protokoll; STEP- und BREP-Dateien werden wieder eingelesen und mit dem Modell verglichen. `freigeben [tage N] [passwort X]` erzeugt einen Freigabelink – er steht im Protokoll in der Zeile `URL:` und wird von `window.mncad.share()` zurückgegeben.",
        "**Automatisierungsmodus** – steuert Playwright oder Selenium den Browser (oder enthält die Adresse `?agent=1`), öffnet das CAD nie einen Systemdialog: Speichern und Export laden direkt herunter, Rückfragen sind Dialoge auf der Seite (Enter / Esc), beim Schließen des Tabs wird nicht gefragt und Drucken in der Zeichnung lädt ein PDF. Flächen, Kanten und Punkte lassen sich auch in der Software-Vorschau ohne WebGL anklicken.",
        "**2D-Zeichnungen per Text** – Zeilen mit `2d` (oder `zeichnen`): `2d linie 0,0 100,0 @0,50`, `2d kreis 50,25 20`, `2d exportieren dwg version R2013`; Skripte rufen `window.mncad.draft()` auf.",
        "**Ohne Browser (CLI, Phase A)** – `mncad run skript.txt --open teil.mncad --out ordner` (Node.js 22 oder neuer, Paket unter `/cad/cli/`) öffnet gespeicherte `.mncad`-Dokumente, baut sie mit demselben Kern neu auf und schreibt STEP, STL und Zeichnungen als PDF / DXF / DWG / SVG sowie ein kurzes Protokoll `MNCAD/1` (höchstens 2 kB) mit Exit-Codes für Skripte. Textbefehle im Skript führt die CLI noch nicht aus – jeder wird als „nur in der Browser-App“ gemeldet; Modellieren per Text läuft derzeit in der Browser-App.",
      ],
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
        ["2D-Zeichnung: F3 · F7 · F8 · F9 · F10", "Objektfang · Raster · Ortho · Rasterfang · Polarfang"],
        ["2D-Zeichnung: L C A PL REC TR EX F …", "Befehlskürzel wie in AutoCAD – eintippen und mit Enter oder Leertaste bestätigen"],
        ["Enter · Esc · Entf", "Bestätigen · Abbrechen / Schließen · Löschen"],
      ],
    },
    lang: {
      h: "Sprache der Oberfläche",
      text: "Das CAD gibt es auf Tschechisch (/cad), Englisch (/en/cad) und Deutsch (/de/cad). Die Sprache wechseln Sie unter **Einstellungen → Sprache der Oberfläche**; die Wahl wird im Browser gespeichert. Kernmeldungen, das Schriftfeld der Zeichnung, die Bibliothek und die Befehlskonsole folgen der gewählten Sprache.",
    },
    docs: {
      h: "Vollständige Dokumentation",
      text: "Das vollständige Handbuch mit 26 Kapiteln, Schritt-für-Schritt-Anleitungen und FAQ ist derzeit auf Tschechisch. Die Browser-Übersetzung (Chrome, Edge) funktioniert damit gut. Außerdem gibt es ein druckbares PDF und eine Markdown-Fassung für KI-Werkzeuge.",
      links: [
        { href: CAD_LINKS.docs, label: "Dokumentation im Web (Tschechisch)" },
        { href: CAD_LINKS.pdf, label: "Handbuch als PDF (Tschechisch)" },
        { href: CAD_LINKS.md, label: "Dokumentation als Markdown" },
        { href: CAD_LINKS.agent, label: "Schema und Anleitung für KI-Agenten" },
      ],
    },
    privacy: {
      h: "Ihre Daten",
      text: "Standardmäßig wird nichts im Browser gespeichert: Ihre Arbeit liegt im geöffneten Tab und in den Dateien, die Sie speichern (ein optionaler passwortverschlüsselter Speicher behält die letzten Dateien). Nichts wird automatisch hochgeladen, ein Konto ist nicht nötig. Ein Freigabelink lädt nur eine in Ihrem Browser verschlüsselte Kopie hoch – der Schlüssel ist der Code hinter `#`, der nie an den Server gesendet wird – und die Kopie wird nach Ablauf des Links gelöscht. Das CAD ist für private und gewerbliche Nutzung kostenlos.",
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
          <Li items={t.text.more} />
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
