// Textová verze dokumentace CADu pro vyhledávače a AI: public/cad/dokumentace.md + public/llms.txt
// Spuštění: node --experimental-strip-types scripts/cad-docs-text.mjs
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const mod = await import(new URL("../src/content/cad-docs.ts", import.meta.url).href);
const { CAD_DOCS, CAD_DOCS_META, CAD_FAQ, CAD_FEATURES } = mod;
const SITE = "https://www.mnastrojarna.cz";
const strip = (s) => s.replace(/\*\*(.+?)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
const md = [];
md.push(`# ${CAD_DOCS_META.title}`, "");
md.push(`> ${CAD_DOCS_META.description}`, "");
md.push(`- Aplikace: ${SITE}/cad`, `- Webová dokumentace: ${SITE}${CAD_DOCS_META.docsUrl}`, `- Příručka PDF: ${SITE}${CAD_DOCS_META.pdfUrl}`, `- Verze: ${CAD_DOCS_META.version}, aktualizováno ${CAD_DOCS_META.updated}`, `- Jazyk: čeština · Licence: zdarma, bez registrace · Vydavatel: Mnástrojárna s.r.o., ${SITE}`, "");
md.push("## Hlavní funkce", "", ...CAD_FEATURES.map((f) => `- ${f}`), "");
md.push("## Obsah", "", ...CAD_DOCS.map((s) => `- ${s.title}`), "- Časté otázky", "");
for (const s of CAD_DOCS) {
  md.push(`## ${s.title}`, "");
  if (s.lead) md.push(strip(s.lead), "");
  for (const b of s.blocks) {
    if (b.t === "p") md.push(strip(b.text), "");
    else if (b.t === "h3") md.push(`### ${b.text}`, "");
    else if (b.t === "note") md.push(`> ${strip(b.text)}`, "");
    else if (b.t === "ul") md.push(...b.items.map((x) => `- ${strip(x)}`), "");
    else if (b.t === "ol") md.push(...b.items.map((x, i) => `${i + 1}. ${strip(x)}`), "");
    else if (b.t === "img") md.push(`![${b.alt}](${SITE}${b.src})${b.caption ? `\n\n*${strip(b.caption)}*` : ""}`, "");
    else if (b.t === "table") md.push(`| ${b.head.join(" | ")} |`, `| ${b.head.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${r.map((c) => strip(c).replace(/\|/g, "\\|")).join(" | ")} |`), "");
    else if (b.t === "kbd") md.push("| Zkratka | Akce |", "| --- | --- |", ...b.rows.map(([k, v]) => `| ${k} | ${strip(v)} |`), "");
  }
}
md.push("## Časté otázky", "");
for (const f of CAD_FAQ) md.push(`**${f.q}**`, "", f.a, "");
mkdirSync(resolve("public/cad"), { recursive: true });
writeFileSync(resolve("public/cad/dokumentace.md"), md.join("\n"), "utf8");

const llms = [
  "# Mnástrojárna s.r.o. – nástrojárna a online CAD",
  "",
  `> Mnástrojárna s.r.o. je česká nástrojárna (prototypy, náhradní díly do jednoúčelových strojů, nástroje, přípravky, 1–99 ks, konsignace) a autor bezplatného online 3D/2D CADu Mnástrojárna CAD, který běží v prohlížeči na jádru OpenCascade.`,
  "",
  "## Mnástrojárna CAD",
  `- [Aplikace](${SITE}/cad): spuštění bez instalace a registrace, česky.`,
  `- [Kompletní dokumentace (HTML)](${SITE}${CAD_DOCS_META.docsUrl}): ${CAD_DOCS.length} kapitol – ovládání, skica, prvky, plochy, plech, svařence, knihovna normálií, sestavy, výkresy, formáty, nastavení, zkratky, FAQ.`,
  `- [Dokumentace jako Markdown](${SITE}${CAD_DOCS_META.mdUrl}): stejný obsah v prostém textu pro strojové zpracování.`,
  `- [Příručka PDF](${SITE}${CAD_DOCS_META.pdfUrl}): tisková verze s obrázky.`,
  `- [Rozhraní pro AI agenty a automatizaci](${SITE}/cad/schema-pro-ai.md): CAD lze celý ovládat textem – konzole Textové příkazy (Ctrl+Shift+K), JSON formát dokumentu se schématem, JavaScript API window.mncad; zpětná vazba jako text.`,
  "",
  "## Web",
  `- [Úvod](${SITE}/), [Pro údržbu](${SITE}/pro-udrzbu), [Služby](${SITE}/sluzby), [Zakázky](${SITE}/zakazky), [Strojový park](${SITE}/strojovy-park), [Kvalita](${SITE}/kvalita), [Kontakt](${SITE}/kontakt).`,
  `- Jazykové verze: ${SITE}/en, ${SITE}/de.`,
  "",
  "## Krátce o CADu",
  ...CAD_FEATURES.map((f) => `- ${f}`),
  "",
].join("\n");
writeFileSync(resolve("public/llms.txt"), llms, "utf8");

// Návod pro AI agenty + úplné schéma (TypeScript typy přímo ze zdrojového kódu – vždy platné)
const guide = (await import(new URL("../src/cad/agent-guide.ts", import.meta.url).href)).AGENT_GUIDE;
const cut = (file, from, to) => {
  const src = readFileSync(new URL(file, import.meta.url), "utf8");
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  return a >= 0 && b > a ? src.slice(a, b).trimEnd() : "";
};
const schema = [
  guide.trimEnd(),
  "",
  "## Úplné schéma (TypeScript typy ze zdrojového kódu)",
  "",
  "Dokument `.mncad` je `CadDoc`; `features` je pole `Feature`. Volitelná pole lze vynechat.",
  "",
  "```ts",
  cut("../src/cad/types.ts", "export type Vec2", "export type FeatureType"),
  "",
  cut("../src/cad/types.ts", "export type CadDoc", "export type BodyMeta"),
  "",
  cut("../src/cad/refs.ts", "export type Sig", "export type ResolvedPlane"),
  "```",
  "",
].join("\n");
writeFileSync(resolve("public/cad/schema-pro-ai.md"), schema, "utf8");
console.log(`schema-pro-ai.md: ${schema.length} znaků`);
console.log(`dokumentace.md: ${md.join("\n").length} znaků, llms.txt: ${llms.length} znaků`);
