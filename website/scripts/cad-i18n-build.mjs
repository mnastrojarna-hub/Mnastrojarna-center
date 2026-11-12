#!/usr/bin/env node
/**
 * Sestaví slovníky rozhraní CADu: scripts/i18n/<lang>/*.tsv → src/cad/i18n/<lang>.ts
 *
 * TSV: `klíč<TAB>překlad` na řádek; řádky začínající # a prázdné se přeskočí; `\n` v klíči i překladu = nový řádek.
 * Klíče se párují s klíči skutečně použitými v kódu (tr("…")): nejdřív přesně, pak po ořezání mezer (když je jednoznačné).
 * Vypíše nespárované překlady a klíče bez překladu; `--check` skončí chybou, chybí-li překlad.
 * Za řádkem `#!dynamic` se klíče berou i bez výskytu v kódu (texty překládané dynamicky, např. tr(family.name)).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const CHECK = process.argv.includes("--check");
const LANGS = ["en", "de"];

// klíče použité v kódu
const keysFile = path.join(ROOT, ".next-i18n-keys.json");
execFileSync(process.execPath, [path.join(ROOT, "scripts/cad-i18n-codemod.mjs"), "--extract", "--keys", keysFile], { stdio: "ignore" });
const used = Object.keys(JSON.parse(fs.readFileSync(keysFile, "utf8")));
fs.unlinkSync(keysFile);
const usedSet = new Set(used);
const byTrim = new Map();
for (const k of used) {
  const t = k.trim();
  if (!byTrim.has(t)) byTrim.set(t, []);
  byTrim.get(t).push(k);
}
/** klíče bez významu pro překlad (kódy, normy) – nemusí být ve slovníku */
const SKIP = (k) => !/\p{L}{3,}/u.test(k.replace(/\{\d+\}/g, " ")) || /^(DIN|ISO|ČSN|EN|ANSI|JIS) [\d/ A-Z-]+$/.test(k) || /^[A-Z]{1,4}\d[\w ×x./-]*$/.test(k);
const unesc = (s) => s.replace(/\\n/g, "\n").replace(/\\t/g, "\t");

let fail = false;
for (const lang of LANGS) {
  const dir = path.join(ROOT, "scripts/i18n", lang);
  const dict = {};
  const unmatched = [];
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".tsv")).sort()) {
      const lines = fs.readFileSync(path.join(dir, f), "utf8").split("\n");
      let dynamic = false;
      lines.forEach((line, i) => {
        if (line.startsWith("#!dynamic")) dynamic = true;
        if (!line.trim() || line.startsWith("#")) return;
        const tab = line.indexOf("\t");
        if (tab < 0) return unmatched.push(`${f}:${i + 1}: chybí tabulátor`);
        const key = unesc(line.slice(0, tab));
        const val = unesc(line.slice(tab + 1));
        let real = usedSet.has(key) ? key : null;
        if (!real) {
          const cands = byTrim.get(key.trim()) ?? [];
          if (cands.length === 1) real = cands[0];
          else if (cands.length > 1) {
            // více variant (s mezerou / bez) – přiřadit všem s odpovídajícím okolím mezer
            for (const c of cands) if (!(c in dict)) dict[c] = c.replace(c.trim(), val.trim());
            return;
          }
        }
        if (!real && dynamic) real = key;
        if (!real) return unmatched.push(`${f}:${i + 1}: ${JSON.stringify(key).slice(0, 90)}`);
        // zachovat okolní mezery klíče
        const lead = real.match(/^\s*/)[0];
        const trail = real.match(/\s*$/)[0];
        dict[real] = lead + val.trim() + trail;
      });
    }
  }
  const missing = used.filter((k) => !(k in dict) && !SKIP(k));
  const identical = Object.entries(dict).filter(([k, v]) => k === v && !SKIP(k)).length;
  console.log(`${lang}: překladů ${Object.keys(dict).length}, klíčů v kódu ${used.length}, chybí ${missing.length}, nespárováno ${unmatched.length}, shodných s originálem ${identical}`);
  if (unmatched.length) console.log("  nespárované:\n   " + unmatched.slice(0, 40).join("\n   "));
  if (missing.length) {
    fs.writeFileSync(path.join(ROOT, `.i18n-missing-${lang}.txt`), missing.join("\n"));
    console.log(`  chybějící klíče uloženy do .i18n-missing-${lang}.txt (prvních 15):\n   ` + missing.slice(0, 15).map((k) => JSON.stringify(k)).join("\n   "));
    if (CHECK) fail = true;
  }
  const out = `/** ${lang === "en" ? "Anglický" : "Německý"} slovník rozhraní CADu – klíč = český zdrojový text. GENEROVÁNO scripts/cad-i18n-build.mjs ze scripts/i18n/${lang}/*.tsv – needitovat ručně. */\nexport const ${lang.toUpperCase()}: Record<string, string> = ${JSON.stringify(Object.fromEntries(Object.entries(dict).sort((a, b) => a[0].localeCompare(b[0], "cs"))), null, 1)};\n`;
  fs.writeFileSync(path.join(ROOT, `src/cad/i18n/${lang}.ts`), out);
}
if (fail) process.exit(1);
