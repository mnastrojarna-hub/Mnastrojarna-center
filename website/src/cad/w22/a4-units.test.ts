/**
 * Vlna 22, etapa A4 – čisté jednotky bez jádra (body 15, 16, 21):
 *  - share.ts: useknutý × změněný dlouhý odkaz (`damage`), `isJsonPrefix`, text chyby s délkou; heslo zvlášť;
 *  - share-verify.ts: `verifyShareLink` – funkční odkaz (režim, platnost, obsah), useknutý, změněný, chybí heslo, ne-odkaz;
 *  - entry-ids.ts: stabilní id (`L36.motion`, pořadí `#2`, `L-`), idempotence, reference `r3:L36.motion`;
 *  - console-view.ts: souhrn = stručný protokol, filtr úrovně / dokumentu / textu, řádek historie, JSON s id;
 *  - run-host.ts: historie běhů – nový běh předchozí nepřepíše, nejnovější první, nejvýš 20;
 *  - asm-bulk-text.ts: souhrn kopií pole;
 *  - soft-view.ts: každé omezení odpovídá vlastnosti 3D okna, kterou softwarový náhled NEMÁ (viewport.tsx × viewport-soft.tsx).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { createShareLink, isJsonPrefix, openErrorText, openShareLink, parseShareHash } from "../share";
import { verifyShareLink } from "../share-verify";
import { emptyDoc, type AsmComponent, type CadDoc } from "../types";
import { entryKey, entryRef, withEntryIds } from "../engine/entry-ids";
import { filterEntries, reportDocs, reportJson, runHeadline, summaryText } from "../engine/console-view";
import { ReportBuilder } from "../engine/protocol";
import { shareContent, shareContentText } from "../engine/share-content";
import { copiesText } from "../asm-bulk-text";
import { SOFT_LIMITS, softLimitsText, softStatusText } from "../soft-view";
import { consoleRuns, HISTORY_MAX } from "@/components/cad/run-host";

setLang("cs");
const part = (name = "Deska A"): CadDoc => ({ ...emptyDoc(name), kind: "part", features: [{ id: "b1", name: "Kvádr 1", type: "box", size: [120, 80, 10], position: [0, 0, 0], centered: false, mode: "new" } as never] });
const asm = (n: number): CadDoc => ({
  ...emptyDoc("Sestava A"),
  kind: "assembly",
  features: [],
  components: Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: i ? `Šroub (${i})` : "Deska A", source: { kind: "part", doc: part(i ? "Šroub" : "Deska A") }, placement: { position: [i * 10, 0, 0], rotation: [0, 0, 0] } }) as AsmComponent),
});
const BASE = "https://www.mnastrojarna.cz/cad";

describe("bod 16: useknutý × změněný odkaz, ověření odkazu", () => {
  it("isJsonPrefix: začátek JSON = true, úplný nebo chybný JSON = false", () => {
    expect(isJsonPrefix('{"v":1,"exp":null,"doc":{"name":"Des')).toBe(true);
    expect(isJsonPrefix('{"v":1,"a":[1,2,')).toBe(true);
    expect(isJsonPrefix('{"v":1,"a":tr')).toBe(true);
    expect(isJsonPrefix('{"v":1}')).toBe(false);
    expect(isJsonPrefix('{"v":1,}x')).toBe(false);
    expect(isJsonPrefix("Xyz")).toBe(false);
  });

  it("dlouhý odkaz: celý → ok; useknutý (60 %, −1 znak) → invalid + damage truncated; změněný znak → corrupt; text s délkou", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE });
    const hash = new URL(r.url).hash;
    const ok = await openShareLink(parseShareHash(hash)!);
    expect(ok.ok).toBe(true);
    for (const cut of [hash.slice(0, Math.floor(hash.length * 0.6)), hash.slice(0, -1)]) {
      const o = await openShareLink(parseShareHash(cut)!);
      expect(o).toMatchObject({ ok: false, reason: "invalid", damage: "truncated" });
      if (!o.ok) expect(openErrorText(o.reason, o.exp, "link", o)).toMatch(/^Odkaz je useknutý – .* má \d+ znaků/);
    }
    const i = hash.length - 30;
    const bad = hash.slice(0, i) + (hash[i] === "A" ? "B" : "A") + hash.slice(i + 1);
    const c = await openShareLink(parseShareHash(bad)!);
    expect(c).toMatchObject({ ok: false, reason: "invalid", damage: "corrupt" });
    if (!c.ok) expect(openErrorText(c.reason, c.exp, "link", c)).toMatch(/^Odkaz je poškozený/);
    // starší volání bez poškození – text beze změny
    expect(openErrorText("invalid")).toMatch(/^Odkaz není platný sdílený dokument/);
  });

  it("odkaz s heslem: bez hesla = password; useknutý šifrovaný = password s upozorněním na useknutí (nejde rozlišit)", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE, password: "tajne" });
    const hash = new URL(r.url).hash;
    expect(await openShareLink(parseShareHash(hash)!)).toMatchObject({ ok: false, reason: "password" });
    const cut = await openShareLink(parseShareHash(hash.slice(0, -8))!, "tajne");
    expect(cut).toMatchObject({ ok: false, reason: "password" });
    if (!cut.ok) expect(openErrorText(cut.reason, cut.exp, "link", cut)).toMatch(/useknutý či změněný/);
  });

  it("verifyShareLink: funkční (režim, platnost, obsah), useknutý, změněný, ne-odkaz – nic se neotevře", async () => {
    const r = await createShareLink(asm(4), { days: 7, mode: "link", base: BASE });
    const v = await verifyShareLink(r.url);
    expect(v).toMatchObject({ ok: true, mode: "link", view: "model", content: { doc: "Sestava A", kind: "assembly", comp: 4, parts: 2, sheets: 0, files: 0 } });
    if (v.ok) expect(v.exp).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const t = await verifyShareLink(r.url.slice(0, Math.floor(r.url.length * 0.7)));
    expect(t).toMatchObject({ ok: false, reason: "truncated" });
    const k = r.url.length - 25;
    const c = await verifyShareLink(r.url.slice(0, k) + (r.url[k] === "A" ? "B" : "A") + r.url.slice(k + 1));
    expect(c).toMatchObject({ ok: false, reason: "corrupt" });
    expect(await verifyShareLink("ahoj světe")).toMatchObject({ ok: false, reason: "unrecognized" });
    expect(await verifyShareLink(`${BASE}#s=`)).toMatchObject({ ok: false, reason: "truncated" });
  });

  it("obsah odkazu: díl / sestava – komponenty, různé díly, listy, přílohy (importy a podklady skic)", () => {
    expect(shareContent(part())).toEqual({ doc: "Deska A", kind: "part", comp: 0, parts: 0, sheets: 0, files: 0, features: 1 });
    const a = asm(5);
    a.drawings = [{ id: "d1", name: "List 1", options: {}, meta: {}, annotations: [] }, { id: "d2", name: "List 2", options: {}, meta: {}, annotations: [] }];
    (a.components![1].source as unknown) = { kind: "file", fileName: "ref.step", data: "U1RFUA==" };
    expect(shareContent(a)).toMatchObject({ kind: "assembly", comp: 5, sheets: 2, files: 1 });
    expect(shareContentText(shareContent(a))).toMatch(/^sestava „Sestava A“ – komponent 5, různých dílů \d+, listů výkresu 2, příloh 1$/);
  });
});

describe("bod 15: id záznamů, pohled konzole, historie, souhrn pole", () => {
  const report = () => {
    const rb = new ReportBuilder({ lang: "cs", lines: 6 });
    rb.ok(1, "nový díl", "Deska A");
    rb.ok(1, "druhý ✓ na řádku", "Deska A");
    rb.code("msg.error", { line: 3, doc: "Deska A", text: "chyba v díře" });
    rb.code("msg.warn" as never, { line: 4, doc: "Přidržovač", text: "pozor na vazbu 2" });
    rb.measure(5, "motion", "group=a:3", { doc: "Sestava A" });
    rb.code("share.rejected", { line: null, args: ["403"] });
    rb.run = { id: "r3", inputRev: "k@r·000000", state: "done" };
    return rb.finish({ docs: [{ ref: "a", name: "Deska A", kind: "part", main: true }] });
  };

  it("withEntryIds: L<řádek>.<kód>, druhý stejný #2, bez řádku L-, idempotentní, reference r3:…", () => {
    const r = report();
    const ids = r.entries.map((e) => e.id);
    expect(ids).toContain("L1.ok");
    expect(ids).toContain("L1.ok#2");
    expect(ids).toContain("L5.motion");
    expect(ids).toContain("L-.share.rejected");
    expect(withEntryIds(r.entries).map((e) => e.id)).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(entryRef("r3", "L5.motion")).toBe("r3:L5.motion");
    expect(entryKey({ line: 7, level: "ok", text: "x" })).toBe("L7.ok");
    // stejné záznamy v jiném běhu (jiné id běhu, jiný čas) → stejná id
    expect(report().entries.map((e) => e.id)).toEqual(ids);
  });

  it("souhrn = stručný protokol MNCAD/1; filtr úrovně, dokumentu a textu; JSON s id a plným protokolem", () => {
    const r = report();
    expect(summaryText(r).split("\n")[0]).toMatch(/^MNCAD\/1 FAIL /);
    expect(filterEntries(r, { level: "error" }).map((e) => e.level)).toEqual(["error", "error"]);
    expect(filterEntries(r, { level: "warn" }).every((e) => e.level === "warn")).toBe(true);
    expect(filterEntries(r, { level: "problems" }).length).toBe(filterEntries(r, { level: "error" }).length + filterEntries(r, { level: "warn" }).length);
    expect(filterEntries(r, { doc: "Přidržovač" }).length).toBe(1);
    expect(filterEntries(r, { q: "vazbu 2" }).length).toBe(1);
    expect(filterEntries(r, { q: "L5.motion" }).map((e) => e.id)).toEqual(["L5.motion"]);
    expect(reportDocs(r)).toEqual(expect.arrayContaining(["Deska A", "Přidržovač", "Sestava A"]));
    const j = JSON.parse(reportJson(r));
    expect(j.run.id).toBe("r3");
    expect(j.full).toMatch(/^MNCAD\/1/);
    expect(j.entries.every((e: { id?: string }) => typeof e.id === "string")).toBe(true);
  });

  it("historie běhů: nový běh předchozí protokol nepřepíše; nejnovější první; nejvýš 20", () => {
    const before = consoleRuns.list("console").length;
    consoleRuns.set("t1", "první", { source: "console", input: "nový díl A", label: "nový díl A", at: 1, report: report() });
    consoleRuns.set("t2", "druhý", { source: "console", input: "nový díl B", label: "nový díl B", at: 2 });
    const h = consoleRuns.list("console");
    expect(h.slice(0, 2).map((x) => x.id)).toEqual(["t2", "t1"]);
    expect(consoleRuns.get("t1")).toBe("první");
    expect(consoleRuns.record("t1")?.report?.run?.id).toBe("r3");
    expect(h.length).toBe(Math.min(HISTORY_MAX, before + 2));
    for (let i = 0; i < 30; i++) consoleRuns.set(`x${i}`, String(i), { source: "console" });
    expect(consoleRuns.list().length).toBe(HISTORY_MAX);
    expect(runHeadline({ id: "r3", at: new Date(2026, 10, 20, 12, 41, 5).getTime(), label: "nový díl A", report: report() })).toBe("r3 · 12:41:05 · ✓2 ⚠1 ✗2 · nový díl A");
  });

  it("sestava pole: do 3 kopií všechny, víc = počet, první, poslední a odkaz na úplný výpis", () => {
    const c = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `Šroub (${i + 2})`, pos: `[${10 + 9 * (i + 1)}; 10; 60]` }));
    expect(copiesText(c(2))).toBe("„Šroub (2)“ [19; 10; 60], „Šroub (3)“ [28; 10; 60]");
    const t = copiesText(c(18));
    expect(t).toBe("18 kopií: první „Šroub (2)“ [19; 10; 60] … poslední „Šroub (19)“ [172; 10; 60] (polohy všech: sestava komponenty)");
    expect(copiesText(c(57)).length).toBeLessThan(160);
  });
});

describe("bod 21: softwarové zobrazení – omezení odpovídají skutečnosti", () => {
  const src = (f: string) => fs.readFileSync(path.resolve(__dirname, "../../components/cad", f), "utf8");
  const viewportProps = src("viewport.tsx");
  const softScene = /export type SoftScene = \{([\s\S]*?)\n\};/.exec(src("viewport-soft.tsx"))![1];

  it("každé omezení = vlastnost 3D okna, kterou softwarový náhled nemá", () => {
    for (const l of SOFT_LIMITS) {
      expect(viewportProps, l.key).toMatch(new RegExp(`\\n\\s+${l.key}\\??:`));
      expect(softScene, l.key).not.toMatch(new RegExp(`\\n\\s+${l.key}\\??:`));
    }
  });

  it("seznam obsahuje analýzy ploch, stopu pohybu, duchy porovnání, mřížku; text stavu a alternativy výběru", () => {
    const keys = SOFT_LIMITS.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(["surface", "measure", "ghosts", "showGrid", "gizmo", "sketches", "datums", "ortho"]));
    expect(softStatusText()).toBe("Softwarové zobrazení – WebGL není dostupné");
    const t = softLimitsText();
    expect(t).toMatch(/stopa bodu pohybové studie/);
    expect(t).toMatch(/Ze seznamu…/);
    expect(t).toMatch(/vyber F3 E2/);
  });
});
