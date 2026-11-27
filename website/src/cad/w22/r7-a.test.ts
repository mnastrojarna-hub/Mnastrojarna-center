/**
 * Vlna 22, kolo 7, stopa a – regresní testy zbylých mezer (body 12, 15, 16, 20, 22h).
 * Každý případ padá na kódu před kolem 7 (origin/main 260ff8b).
 */
import { describe, expect, it } from "vitest";
import { setLang } from "../i18n";
import { createShareLink, openErrorText, openShareLink, parseShareHash } from "../share";
import { verifyShareLink } from "../share-verify";
import { emptyDoc, type CadDoc } from "../types";

setLang("cs");
const part = (name = "Deska A"): CadDoc => ({ ...emptyDoc(name), kind: "part", features: [{ id: "b1", name: "Kvádr 1", type: "box", size: [120, 80, 10], position: [0, 0, 0], centered: false, mode: "new" } as never] });
const BASE = "https://www.mnastrojarna.cz/cad";

describe("bod 16 (kolo 7): šifrovaný dlouhý odkaz – useknutý × změněný × špatné heslo se rozliší", () => {
  it("odkaz s heslem nese kontrolu úplnosti před daty (1dpk.<sůl>.<n>.<otisk>.<data>) a otevře se celý", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE, password: "tajne" });
    const hash = new URL(r.url).hash;
    const m = /^#s=1dpk\.[A-Za-z0-9_-]{22}\.(\d+)\.[A-Za-z0-9_-]{8}\.([A-Za-z0-9_-]+)$/.exec(hash);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(m![2].length);
    const ok = await openShareLink(parseShareHash(hash)!, "tajne");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.payload.doc.name).toBe("Deska A");
  });

  it("useknutý šifrovaný odkaz = truncated i BEZ hesla a se správným heslem (dřív „Nesprávné heslo – nebo useknutý“)", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE, password: "tajne" });
    const hash = new URL(r.url).hash;
    for (const cut of [hash.slice(0, -8), hash.slice(0, Math.floor(hash.length * 0.6))]) {
      for (const pw of [undefined, "tajne"]) {
        const o = await openShareLink(parseShareHash(cut)!, pw);
        expect(o).toMatchObject({ ok: false, reason: "invalid", damage: "truncated" });
        if (!o.ok) {
          expect(o.expected).toBeGreaterThan(o.chars!);
          expect(openErrorText(o.reason, o.exp, "link", o)).toMatch(/^Odkaz je useknutý – .* má \d+ z \d+ znaků/);
        }
      }
    }
    // useknutý hned v hlavičce kontroly (za solí) – také useknutý, ne heslo
    const head = hash.slice(0, hash.indexOf(".", hash.indexOf(".") + 1) + 3);
    expect(await openShareLink(parseShareHash(head)!, "tajne")).toMatchObject({ ok: false, reason: "invalid", damage: "truncated" });
  });

  it("změněný znak v datech = corrupt (bez hesla i s ním); znaky přilepené za odkaz nevadí", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE, password: "tajne" });
    const hash = new URL(r.url).hash;
    const i = hash.length - 20;
    const bad = hash.slice(0, i) + (hash[i] === "A" ? "B" : "A") + hash.slice(i + 1);
    for (const pw of [undefined, "tajne"]) {
      const c = await openShareLink(parseShareHash(bad)!, pw);
      expect(c).toMatchObject({ ok: false, reason: "invalid", damage: "corrupt" });
      if (!c.ok) expect(openErrorText(c.reason, c.exp, "link", c)).toMatch(/^Odkaz je poškozený/);
    }
    // messenger přilepí za odkaz „.“ nebo „)“ – kontrola úplnosti je odřízne
    for (const tail of [".", ")", "-x"]) {
      const o = await openShareLink(parseShareHash(hash + tail)!, "tajne");
      expect(o.ok).toBe(true);
    }
  });

  it("celý odkaz a špatné heslo = jen „Nesprávné heslo.“ (bez dohadu o useknutí); verifyShareLink totéž", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE, password: "tajne" });
    const hash = new URL(r.url).hash;
    const w = await openShareLink(parseShareHash(hash)!, "spatne");
    expect(w).toEqual({ ok: false, reason: "password" });
    if (!w.ok) expect(openErrorText(w.reason, w.exp, "link", w)).toBe("Nesprávné heslo.");
    expect(await verifyShareLink(r.url, { password: "spatne" })).toMatchObject({ ok: false, reason: "password", text: "Nesprávné heslo." });
    expect(await verifyShareLink(r.url.slice(0, -10), { password: "tajne" })).toMatchObject({ ok: false, reason: "truncated" });
    expect(await verifyShareLink(r.url, { password: "tajne" })).toMatchObject({ ok: true, mode: "link" });
  });

  it("odkaz bez hesla má tvar beze změny (1d.<data>) – návod pro AI a starší stránky ho čtou dál", async () => {
    const r = await createShareLink(part(), { days: 10, mode: "link", base: BASE });
    expect(new URL(r.url).hash).toMatch(/^#s=1d\.[A-Za-z0-9_-]+$/);
  });
});

describe("bod 23 (kolo 7): cad-w22-m pouští průchod bez WebGL ve výchozím běhu", () => {
  it("sada čte průchody ze společného glPasses (výchozí = WebGL i bez WebGL), ne z jednoprůchodového E2E_NOGL === '1'", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "../../../e2e/cad-w22-m.e2e.cjs"), "utf8");
    expect(src).toMatch(/require\('\.\/lib\/gl-passes\.cjs'\)/);
    expect(src).toMatch(/for \(const ps of PASSES\)/);
    expect(src).not.toMatch(/const NOGL = process\.env\.E2E_NOGL === '1'/);
    // přípona průchodu u každé kontroly a kontrola, že průchod opravdu je / není s WebGL (žádná falešná zelená)
    expect(src).toMatch(/m \+ tag\)/);
    expect(src).toMatch(/průchod: WebGL v prohlížeči/);
    const { glPasses } = (await import(path.resolve(__dirname, "../../../e2e/lib/gl-passes.cjs"))) as { glPasses: (e: Record<string, string>) => { id: string }[] };
    expect(glPasses({}).map((x) => x.id)).toEqual(["webgl", "nogl"]);
  });
});
