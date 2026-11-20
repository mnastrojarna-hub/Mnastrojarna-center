/**
 * Vlna 22, bod 22i zprávy majitele („Nejprve ✓ Zaoblení, následně ✗ Zaoblení nelze provést. Přijetí příkazu musí mít jiný
 * stav než geometrický úspěch.“) a úrovně stavu v protokolu: běhy skriptu se skutečným jádrem.
 * Repro: engine/__corpus__/55-status-edit.txt, 56-status-drawing.txt (majitelův vzor), S/w22/repro/22i.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { setLang, tr } from "../i18n";
import { isAcceptance } from "../engine/accept";
import { memoryFileSource, type EngineHost } from "../engine/host";
import { MemoryWorkspace } from "../engine/memory-workspace";
import { DEFAULT_BUDGET, finalizeReport, formatConsole, formatFull, GRAMMAR, grammarKind, utf8Bytes } from "../engine/protocol";
import type { Entry } from "../engine/protocol-types";
import { runReport } from "../engine/run-protocol";
import { runScript } from "../engine/run";
import { greenThenRed, realHost } from "./real-host";

let host: () => EngineHost;
beforeAll(async () => {
  setLang("cs");
  host = await realHost();
}, 120_000);

const at = (entries: readonly Entry[], line: number) => entries.filter((e) => e.line === line || e.lines?.includes(line));
const run = (text: string, ws = new MemoryWorkspace(), o: Parameters<typeof runScript>[3] = {}) => runScript(ws, text, host(), o);

describe("22i – úprava existujícího prvku: přijetí ℹ, výsledek po stavbě na řádku ÚPRAVY", () => {
  it("upravit na nemožný poloměr: žádné ✓ pro řádek úpravy, ✗ na řádku úpravy (ne na řádku vzniku)", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Plech"\nkvádr 20 20 10\nzaoblit 1 hrany svislé\nupravit "Zaoblení 1" radius=15');
    const l4 = at(r.entries, 4);
    expect(l4.map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "error:feature.failed"]);
    expect(l4[0].text).toBe("Zaoblení 1: radius 1 → 15 – výsledek po výpočtu níže");
    expect(l4[1].text).toMatch(/prvek „Zaoblení 1“ se nepostavil/);
    expect(l4[1].data).toEqual({ levels: { built: false } });
    // řádek vzniku prvku: stav po něm se samostatně nestavěl (hned ho změnila úprava) – přijetí + ℹ op.superseded,
    // výsledek prvku patří poslední úpravě
    expect(at(r.entries, 3).map((e) => e.code)).toEqual(["op.accepted", "op.superseded"]);
    expect(at(r.entries, 3)[1].text).toBe("stav modelu po tomto příkazu se samostatně nestavěl (následovala další změna) – ověřen je až stav po řádku 4");
    expect(r.entries.filter((e) => e.level === "ok" && /Zaoblení/.test(e.text))).toEqual([]);
    expect(greenThenRed(r.entries)).toEqual([]);
    const con = formatConsole(r).split("\n");
    expect(con).toContain("→ Zaoblení 1: radius 1 → 15 – výsledek po výpočtu níže");
    expect(con.filter((l) => l.startsWith("✓ Zaoblení"))).toEqual([]);
    expect(con.some((l) => l.startsWith("✗ Zaoblení 1 (fillet): Zaoblení R15 nelze provést"))).toBe(true);
  });
  it("dva běhy (vzor ze zprávy): první běh ✓ zaoblení, druhý běh úprava → ℹ + ✗ na řádku úpravy, žádné ✓", { timeout: 120_000 }, async () => {
    const ws = new MemoryWorkspace();
    const r1 = await run('nový díl "Deska A"\nkvádr 20 20 10\nzaoblit 1 hrany svislé', ws);
    expect(at(r1.entries, 3).map((e) => e.level)).toEqual(["note", "ok"]);
    expect(at(r1.entries, 3)[1].text).toMatch(/^Zaoblení 1 \(fillet\) · úběr 8,58 mm³ · těleso platné$/);
    const r2 = await run('# druhý běh\nupravit "Zaoblení 1" radius=15', ws);
    expect(at(r2.entries, 2).map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "error:feature.failed"]);
    expect(r2.entries.some((e) => e.level === "ok")).toBe(false);
  });
  it("úspěšná úprava: ℹ přijetí a ✓ s úrovněmi (účinek, těleso) na řádku úpravy", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 20 20 10\nzaoblit 1 hrany svislé\nupravit "Zaoblení 1" radius=2');
    const l4 = at(r.entries, 4);
    expect(l4.map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "ok:"]);
    expect(l4[1].text).toMatch(/^Zaoblení 1 \(fillet\) · úběr 34,34 mm³ · těleso platné$/);
    expect(l4[1].data).toMatchObject({ levels: { built: true, effect: { op: "modify", level: "changed" }, body: { solids: 1, free: 0, valid: true } } });
  });
  it("přejmenování model nemění – zůstává ✓ (hotový výsledek, nic se nepočítá)", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 20 20 10\npřejmenovat "Kvádr 1" na "Základ"');
    expect(at(r.entries, 3).map((e) => `${e.level}:${e.text}`)).toEqual(["ok:přejmenováno: Kvádr 1 → Základ"]);
  });
  it.each([
    ["smazání prvku, na který navazují další", 'nový díl "Deska A"\nkvádr 20 20 10\ndíra 4 skrz v 10 10\nsmazat "Kvádr 1"', 4, "Díra 1"],
    ["proměnná, která prvek rozbije", 'nový díl "Deska A"\nproměnná R = 1\nkvádr 20 20 10\nzaoblit 1 hrany svislé\nupravit "Zaoblení 1" radius==R\nproměnná R = 15', 6, "Zaoblení 1"],
    ["úprava jiného prvku (kvádr se zmenší pod zaoblení)", 'nový díl "Deska A"\nkvádr 20 20 10\nzaoblit 3 hrany svislé\nupravit "Kvádr 1" size=4;4;10', 4, "Zaoblení 1"],
    ["entita skici (profil se zmenší pod díru)", 'nový díl "Deska A"\nskica XY: obdélník 40 20\nvysunout 5\ndíra 4 skrz v 15 0\nskica "Skica 1"\nentita e1 w=10', 6, "Díra 1"],
    ["zpět (vrátí rozbitý stav z dřívějšího kroku)", 'nový díl "Deska A"\nkvádr 20 20 10\nzaoblit 15 hrany svislé\nvýkres\nupravit "Zaoblení 1" radius=1\nvýkres\nzpět', 7, "Zaoblení 1"],
  ])("%s: přijetí ℹ, ⚠/✗ dotčeného prvku na řádku úpravy, žádný řádek s ✓ i ✗", { timeout: 120_000 }, async (_name, text, line, feature) => {
    const r = await run(text);
    const here = at(r.entries, line);
    expect(here.filter((e) => e.code === "op.accepted").length, formatFull(finalizeReport(r))).toBeGreaterThanOrEqual(1);
    expect(here.filter((e) => (e.level === "error" || e.level === "warn") && e.text.includes(`„${feature}“`)).length, formatFull(finalizeReport(r))).toBe(1);
    expect(greenThenRed(r.entries)).toEqual([]);
    // řádek s ⚠/✗ není zelený ani za jiný prvek: prvek, který úprava sama nerozbila, je tam ℹ feature.built, ne ✓
    expect(here.some((e) => e.level === "ok")).toBe(false);
    // ✗/⚠ toho prvku není na žádném jiném řádku
    expect(r.entries.filter((e) => (e.level === "error" || e.level === "warn") && e.text.includes(`„${feature}“`) && e.line !== line)).toEqual([]);
  });
  it("přísný režim: prvek ✓ na svém řádku, pozdější úprava jiného prvku ho rozbije → ⚠ na řádku úpravy a STOP tam (dřív ⚠ L- až v souhrnu)", { timeout: 120_000 }, async () => {
    const r = await run('přísně\nnový díl "Deska A"\nkvádr 20 20 10\ndíra 4 skrz v 10 10\nupravit "Kvádr 1" size=5;5;10\nstav');
    expect(at(r.entries, 4).map((e) => e.level)).toEqual(["note", "ok"]);
    const w = r.entries.find((e) => e.code === "feature.warning")!;
    expect(w.line).toBe(5);
    expect(w.text).toMatch(/„Díra 1“: Prvek těleso nezměnil/);
    expect(w.data).toMatchObject({ levels: { built: true, effect: { level: "none" } } });
    expect(r.stopped).toEqual({ line: 5, code: "feature.warning" });
  });
  it("odchod z dokumentu a návrat: ✓ zaoblení při odchodu, po úpravě po návratu ✗ na řádku úpravy (dřív ✗ L-)", { timeout: 120_000 }, async () => {
    const ws = new MemoryWorkspace();
    const rep = await runReport(ws, 'nový díl "Deska A"\nkvádr 20 20 10\nzaoblit 1 hrany svislé\nnový díl "Deska B"\nkvádr 5 5 5\nzáložka "Deska A"\nupravit "Kvádr 1" size=1;1;10', host());
    const bad = rep.entries.filter((e) => e.code === "feature.failed");
    expect(bad.map((e) => e.line)).toEqual([7]);
    expect(at(rep.entries, 7).map((e) => e.code)).toEqual(["op.accepted", "feature.built", "feature.failed"]);
    expect(at(rep.entries, 3).some((e) => e.level === "ok")).toBe(true); // ✓ na řádku vzniku zůstává pravdivé pro tehdejší stavbu
    expect(greenThenRed(rep.entries)).toEqual([]);
  });
});

describe("22i – každé přijetí má výsledek; příkaz, po kterém se nic nepřepočítává, je hotový hned", () => {
  const codesAt = (entries: readonly Entry[], line: number) => at(entries, line).map((e) => `${e.level}:${e.code ?? ""}`);
  it("smazání prvku uprostřed historie, po kterém zbytek zůstane v pořádku: ℹ přijetí + ✓ „dokument … postaven“ na řádku smazání", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 20 20 10\nzaoblit 1 hrany svislé\ndíra 4 skrz v 10 10\nsmazat "Zaoblení 1"');
    expect(codesAt(r.entries, 5)).toEqual(["note:op.accepted", "ok:"]);
    expect(at(r.entries, 5).map((e) => e.text)).toEqual(["smazáno: Zaoblení 1 – výsledek po výpočtu níže", "dokument „Deska A“ postaven: prvků 2, bez ⚠ a ✗ · těleso platné"]);
    expect(greenThenRed(r.entries)).toEqual([]);
  });
  it("smazání posledního prvku a zpět o přidaný prvek nic nepřepočítají – ✓ hned, bez „výsledek po výpočtu níže“", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 20 20 10\nzaoblit 1 hrany svislé\nsmazat "Zaoblení 1"\ndíra 4 skrz v 10 10\nvýkres\nzpět');
    expect(at(r.entries, 4).map((e) => `${e.level}:${e.text}`)).toEqual(["ok:smazáno: Zaoblení 1"]);
    expect(at(r.entries, 7).map((e) => e.level)).toEqual(["ok"]);
    expect(at(r.entries, 7)[0].text).toMatch(/^zpět o 1 krok/);
    expect(r.entries.filter((e) => e.code === "op.accepted" && (e.line === 4 || e.line === 7))).toEqual([]);
  });
  it("proměnná: v dílu bez prvků ✓ hned; změna vázané proměnné = ℹ + ✓ vázaného prvku na řádku proměnné; úprava bez vlastního výsledku má ✓ „dokument … postaven“", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Deska A"\nproměnná R = 1\nproměnná H = 10\nkvádr 20 20 10\nzaoblit 1 hrany svislé\nupravit "Zaoblení 1" radius==R\nproměnná R = 2\nproměnná H = 12');
    expect(at(r.entries, 2).map((e) => `${e.level}:${e.text}`)).toEqual(["ok:proměnná R = 1 → 1"]);
    // řádek vazby parametru: prvek dostal výsledek až na řádku poslední změny (proměnná R); stav po řádku 6 se samostatně
    // nestavěl → ℹ op.superseded (nezkontrolováno), žádné ✓
    expect(at(r.entries, 6).map((e) => `${e.level}:${e.code}:${e.text}`)).toEqual([
      "note:op.accepted:Zaoblení 1: radius = R (= 1) – vazba na proměnné – výsledek po výpočtu níže",
      "note:op.superseded:stav modelu po tomto příkazu se samostatně nestavěl (následovala další změna) – ověřen je až stav po řádku 8",
    ]);
    expect(codesAt(r.entries, 7)).toEqual(["note:op.accepted", "ok:"]);
    expect(at(r.entries, 7)[1].text).toMatch(/^Zaoblení 1 \(fillet\) · úběr 34,34 mm³ · těleso platné$/);
    // proměnná, na kterou není nic vázané: prvky se přepočítají beze změny stavu → výsledek celého dokumentu
    expect(at(r.entries, 8).map((e) => `${e.level}:${e.text}`)).toEqual(["note:proměnná H = 12 → 12 (bylo 10 → 10) – výsledek po výpočtu níže", "ok:dokument „Deska A“ postaven: prvků 2, bez ⚠ a ✗ · těleso platné"]);
  });
  it("mezistav, který se nestavěl, nikdy nedostane ✓: úprava na nemožný poloměr, pak smazání prvku v témže běhu → řádek úpravy má ℹ op.superseded, ne „dokument … postaven“", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Plech"\nkvádr 20 20 10\nzaoblit 1 hrany svislé\nupravit "Zaoblení 1" radius=15\ndíra 4 skrz v 10 10\nsmazat "Zaoblení 1"');
    expect(codesAt(r.entries, 4)).toEqual(["note:op.accepted", "note:op.superseded"]);
    expect(at(r.entries, 4)[1].text).toMatch(/ověřen je až stav po řádku 6$/);
    expect(codesAt(r.entries, 3)).toEqual(["note:op.accepted", "note:op.superseded"]);
    // konečný stav (po smazání) je v pořádku: výsledek celého dokumentu jen na řádku poslední změny
    expect(at(r.entries, 6).map((e) => `${e.level}:${e.text}`)).toEqual(["note:smazáno: Zaoblení 1 – výsledek po výpočtu níže", "ok:dokument „Plech“ postaven: prvků 2, bez ⚠ a ✗ · těleso platné"]);
    expect(r.entries.filter((e) => e.level === "ok" && /postaven/.test(e.text)).map((e) => e.line)).toEqual([6]);
    // přísný režim staví po každé operaci – tam je ✗ na řádku úpravy a běh na něm stojí
    const st = await run('přísně\nnový díl "Plech"\nkvádr 20 20 10\nzaoblit 1 hrany svislé\nupravit "Zaoblení 1" radius=15\ndíra 4 skrz v 10 10\nsmazat "Zaoblení 1"');
    expect(st.stopped).toEqual({ line: 5, code: "feature.failed" });
    expect(st.entries.some((e) => e.code === "op.superseded")).toBe(false);
  });
  it("přejmenování po prvku, který se nepostaví: ✗ zůstane na řádku prvku (přejmenování stavbu neovlivní), řádek přejmenování má jen ✓", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 20 20 10\nzaoblit 15 hrany svislé\npřejmenovat "Kvádr 1" na "Základ"');
    expect(r.entries.filter((e) => e.code === "feature.failed").map((e) => e.line)).toEqual([3]);
    expect(codesAt(r.entries, 4)).toEqual(["ok:"]);
    expect(greenThenRed(r.entries)).toEqual([]);
  });
  it("úprava bez nového prvku v dokumentu, ze kterého běh odejde (konfigurace v kontextu sestavy, proměnná před `nový díl`): výsledek na řádku úpravy, ne nic", { timeout: 120_000 }, async () => {
    const ws = new MemoryWorkspace();
    await run('nový díl "Deska K"\nkvádr 60 40 10\nkvádr 10 10 30 v 40 10 10\nkonfigurace "Bez výstupku" potlačit "Kvádr 2"\nkonfigurace aktivní "Bez výstupku"\nnová sestava "Sestava K"\nvložit "Deska K" ukotvit', ws);
    // dřív: řádek 3 měl jen „→ … – výsledek po výpočtu níže“ a žádný výsledek (díl v kontextu se při návratu neověřil)
    const r = await run('sestava upravit "Deska K"\nkonfigurace aktivní žádná\nsestava hotovo', ws);
    expect(codesAt(r.entries, 2), formatFull(finalizeReport(r))).toEqual(["note:op.accepted", "ok:"]);
    expect(at(r.entries, 2)[1].text).toBe("dokument „Deska K“ postaven: prvků 2, bez ⚠ a ✗ · těleso platné");
    await run('nový díl "Deska B"\nproměnná H = 10\nkvádr 20 20 10', ws);
    const v = await run('záložka "Deska B"\nproměnná H = 12\nnový díl "Jiný"\nkvádr 5 5 5', ws);
    expect(codesAt(v.entries, 2), formatFull(finalizeReport(v))).toEqual(["note:op.accepted", "ok:"]);
    expect(at(v.entries, 2)[1].text).toBe("dokument „Deska B“ postaven: prvků 1, bez ⚠ a ✗ · těleso platné");
    // každý řádek s přijetím (op.accepted) má po běhu výsledek nebo výslovné „nestavěno“ (op.superseded)
    for (const res of [r, v]) {
      for (const e of res.entries.filter((x) => x.code === "op.accepted")) {
        const rest = at(res.entries, e.line!).filter((x) => x !== e);
        expect(rest.length, `L${e.line}: ${e.text}`).toBeGreaterThan(0);
      }
    }
  });
  it("úprava, po které jiný prvek zůstane ✗ beze změny: řádek úpravy nedostane ✓ „postaven“", { timeout: 120_000 }, async () => {
    const r = await run('přísně kromě feature.failed\nnový díl "Deska A"\nproměnná H = 10\nkvádr 20 20 10\nzaoblit 15 hrany svislé\nproměnná H = 12');
    expect(r.entries.filter((e) => e.code === "feature.failed").map((e) => e.line)).toEqual([5]);
    expect(codesAt(r.entries, 6)).toEqual(["note:op.accepted"]);
  });
});

describe("22i – načtený dokument (JSON na řádku, otevřít): přijetí ℹ, výsledek po ověřovací stavbě na řádku načtení", () => {
  /** JSON dokumentu, který vznikl skriptem (kvádr + zaoblení svislých hran daným poloměrem) */
  const docJson = async (radius: number, extra = "") => {
    const ws = new MemoryWorkspace();
    await run(`nový díl "Deska A"\nkvádr 20 20 10\nzaoblit ${radius} hrany svislé${extra}`, ws);
    return JSON.stringify(ws.present());
  };
  it("JSON s prvkem, který nejde postavit: ℹ přijetí + ✗ na řádku načtení, žádné ✓ (dřív „✓ dokument …“ a pak ✗)", { timeout: 120_000 }, async () => {
    const r = await run(`${await docJson(15)}\nstav`);
    expect(at(r.entries, 1).map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "error:feature.failed"]);
    expect(at(r.entries, 1)[0].text).toBe("dokument „Deska A“ (2 prvků) – otevře se v nové záložce – výsledek po výpočtu níže");
    expect(greenThenRed(r.entries)).toEqual([]);
    expect(formatConsole(r)).not.toMatch(/^✓ dokument/m);
  });
  it("JSON bez vady: ℹ přijetí a po stavbě ✓ „dokument … postaven: prvků 2, bez ⚠ a ✗ · těleso platné“", { timeout: 120_000 }, async () => {
    const r = await run(await docJson(1));
    expect(at(r.entries, 1).map((e) => `${e.level}:${e.code ?? ""}:${e.text}`)).toEqual([
      "note:op.accepted:dokument „Deska A“ (2 prvků) – otevře se v nové záložce – výsledek po výpočtu níže",
      "ok::dokument „Deska A“ postaven: prvků 2, bez ⚠ a ✗ · těleso platné",
    ]);
    expect(at(r.entries, 1)[1].data).toEqual({ loaded: { features: 2, unchecked: 0, body: { solids: 1, free: 0, valid: true } } });
    const con = formatConsole(r).split("\n");
    expect(con.indexOf("✓ dokument „Deska A“ postaven: prvků 2, bez ⚠ a ✗ · těleso platné")).toBeGreaterThan(con.findIndex((l) => l.startsWith("→ dokument „Deska A“")));
  });
  it("JSON s prvkem bez účinku: ℹ přijetí + ⚠ na řádku načtení, žádné ✓ „postaven“", { timeout: 120_000 }, async () => {
    const r = await run(await docJson(1, "\nkvádr 5 5 5 v 0 0 10 odebrat"));
    expect(at(r.entries, 1).map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "warn:feature.warning"]);
    expect(r.entries.some((e) => e.level === "ok" && /postaven/.test(e.text))).toBe(false);
  });
  it("otevřít \"soubor\": ℹ přijetí, ✗ prvku na řádku otevření (dřív ✓ otevřeno a ✗ bez řádku)", { timeout: 120_000 }, async () => {
    const files = { "deska.mncad": new TextEncoder().encode(await docJson(15)) };
    const h = { ...host(), inputs: memoryFileSource(files) };
    const r = await runScript(new MemoryWorkspace(), '# soubor s vadným prvkem\notevřít "deska.mncad"\nstav', h);
    expect(at(r.entries, 2).map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "error:feature.failed"]);
    expect(greenThenRed(r.entries)).toEqual([]);
  });
  it("načtený vadný dokument, který hned další řádek opraví: stav „po načtení“ se nestavěl → ℹ op.superseded na řádku načtení, ✓ až na řádku úpravy", { timeout: 120_000 }, async () => {
    const r = await run(`${await docJson(15)}\nupravit "Zaoblení 1" radius=1`);
    expect(at(r.entries, 1).map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "note:op.superseded"]);
    expect(at(r.entries, 2).map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "ok:"]);
    expect(r.entries.some((e) => e.level === "ok" && /postaven/.test(e.text))).toBe(false);
  });
  it("JSON dokument, ze kterého běh odešel (nový díl): ✗ prvku na řádku načtení, v konzoli s typem prvku jako dřív", { timeout: 120_000 }, async () => {
    const r = await run(`${await docJson(15)}\nnový díl "Deska K"\nkvádr 1 1 1`);
    expect(at(r.entries, 1).map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "error:feature.failed"]);
    expect(formatConsole(r)).toMatch(/^✗ Zaoblení 1 \(fillet\): Zaoblení R15 nelze provést/m);
    expect(greenThenRed(r.entries)).toEqual([]);
  });
  it("prázdný dokument a sestava se nestaví – načtení je hotový výsledek ✓", { timeout: 120_000 }, async () => {
    const r = await run(JSON.stringify({ app: "mnastrojarna-cad", version: 2, name: "S", kind: "assembly", material: "ocel", features: [], components: [] }));
    expect(at(r.entries, 1).map((e) => e.level)).toEqual(["ok"]);
  });
});

describe("22i – příkazy výkresu: přijetí ℹ, výsledek po vyhodnocení listu", () => {
  it("řez mimo těleso: ℹ přijetí, ✗ drawing.section-miss, žádné ✓ na řádcích výkresu", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres řez XZ odsazení 500');
    expect(at(r.entries, 3).map((e) => e.code)).toEqual(["op.accepted", "op.accepted"]);
    expect(at(r.entries, 4).map((e) => `${e.level}:${e.code ?? ""}`)).toEqual(["note:op.accepted", "error:drawing.section-miss"]);
    expect(at(r.entries, 4)[0].text).toBe("výkres: řez XZ odsazení 500 (rovina Y = -500) – výsledek po vyhodnocení listu níže");
    expect(r.entries.filter((e) => e.level === "ok" && /výkres|list/.test(e.text))).toEqual([]);
    expect(greenThenRed(r.entries)).toEqual([]);
  });
  it("list bez nálezů: ✓ „list … vyhodnocen bez nálezů“ až po vyhodnocení, na posledním řádku bloku", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres řez XZ odsazení -20');
    expect(at(r.entries, 3).map((e) => e.level)).toEqual(["note", "note"]);
    expect(at(r.entries, 4).map((e) => `${e.level}:${e.text}`)).toEqual(["note:výkres: řez XZ odsazení -20 (rovina Y = 20) – výsledek po vyhodnocení listu níže", "ok:výkres: list „List 1“ vyhodnocen bez nálezů (pohledy, řezy, Chytré kóty)"]);
    expect(formatConsole(r)).toContain("✓ výkres: list „List 1“ vyhodnocen bez nálezů (pohledy, řezy, Chytré kóty)");
  });
  it("výkres stav s řezem mimo těleso: výpis = a ✗ hned, žádné ✓", { timeout: 120_000 }, async () => {
    const r = await run('nový díl "Deska A"\nkvádr 60 40 10\nvýkres A4\nvýkres řez XZ odsazení 500\nvýkres stav');
    expect(at(r.entries, 5).map((e) => e.level).sort()).toEqual(["error", "measure"]);
    expect(greenThenRed(r.entries)).toEqual([]);
  });
});

describe("protokol: úrovně v JSON, řádek D a rozpočet 2048 B; cs / en / de", () => {
  const SCRIPT = 'nový díl "Plech"\nkvádr 20 20 10\ndíra 4 skrz v 10 10\nzaoblit 1 hrany svislé\nupravit "Zaoblení 1" radius=15\nvýkres A4\nvýkres řez XZ odsazení 500\nstav';
  it("stručný protokol projde gramatikou, vejde se do 2048 B a řádek D nese solids= valid=", { timeout: 120_000 }, async () => {
    const rep = finalizeReport(await runReport(new MemoryWorkspace(), SCRIPT, host()));
    expect(utf8Bytes(rep.protocol)).toBeLessThanOrEqual(DEFAULT_BUDGET);
    for (const l of rep.protocol.split("\n")) expect(grammarKind(l), l).not.toBeNull();
    const d = rep.protocol.split("\n").find((l) => GRAMMAR.doc.test(l))!;
    expect(d).toMatch(/^D "Plech" part feat=2\/0\/1 V=3\.87cm3 m=0\.03kg bbox=20x20x10 sheets=1 solids=1 valid=1$/);
    expect(rep.docs[0]).toMatchObject({ solids: 1, valid: true });
    // ve stručném protokolu nejsou ✓ ani ℹ – jen ✗ na řádcích úpravy a výkresu
    expect(rep.protocol.split("\n").filter((l) => l.startsWith("✗")).map((l) => l.split(" ").slice(1, 3).join(" "))).toEqual(["L5 feature.failed", "L7 drawing.section-miss"]);
  });
  it("JSON: každý výsledek prvku má data.levels (built / effect / body)", { timeout: 120_000 }, async () => {
    const rep = finalizeReport(await runReport(new MemoryWorkspace(), SCRIPT, host()));
    const hole = rep.entries.find((e) => e.level === "ok" && e.text.startsWith("Díra 1"))!;
    expect(hole.data).toMatchObject({ levels: { built: true, effect: { op: "cut", level: "partial" }, body: { solids: 1, free: 0, valid: true } } });
    expect((hole.data as { levels: { effect: { dV_mm3: number; tool_mm3: number } } }).levels.effect.dV_mm3).toBeCloseTo(-125.6637, 3);
  });
  it.each(["en", "de"] as const)("%s: přijetí a výsledek mají stejné kódy a úrovně, text je přeložený", { timeout: 120_000 }, async (lang) => {
    setLang(lang);
    try {
      const text = lang === "en" ? 'new part "Plate A"\nbox 20 20 10\nfillet 1 edges vertical\nedit "Fillet 1" radius=15' : 'neu teil "Platte A"\nquader 20 20 10\nverrunden 1 kanten vertikal\nbearbeiten "Verrundung 1" radius=15';
      const r = await run(text, new MemoryWorkspace(), { lang });
      expect(at(r.entries, 4).map((e) => `${e.level}:${e.code ?? ""}`), formatFull(finalizeReport(r))).toEqual(["note:op.accepted", "error:feature.failed"]);
      expect(at(r.entries, 4)[0].text.endsWith(tr("výsledek po výpočtu níže"))).toBe(true);
      expect(at(r.entries, 4)[0].text).not.toMatch(/výsledek/);
      expect(greenThenRed(r.entries)).toEqual([]);
    } finally {
      setLang("cs");
    }
  });
  it("řádky přijetí všech obsluh končí stejně ve všech jazycích (kód op.accepted, ne msg.note)", () => {
    const KEYS = ["→ {0} ({1}) přidán – výsledek po výpočtu níže", "→ {0} ({1}) – {2} hran podle pravidla „{3}“ – výsledek po výpočtu níže", "→ {0} ({1}) – {2} {3} podle pravidla „{4}“ – výsledek po výpočtu níže", "→ {0} (shell) – otevřeno ploch: {1} – výsledek po výpočtu níže", "→ {0} děr pro vyhazovače přidáno do historie (Vyhazovač 1…) – výsledek po výpočtu níže", "→ chladicí kanály vyvrtány do dílu ({0} prvků Kanál / Propojka) – výsledek po výpočtu níže", "→ {0}{1}: měřítko {2} kolem počátku – výsledek po výpočtu níže"];
    for (const lang of ["cs", "en", "de"] as const) {
      setLang(lang);
      for (const k of KEYS) expect(isAcceptance(tr(k, "a", "b", "c", "d", "e")), `${lang}: ${k}`).toBe(true);
      expect(isAcceptance(`→ ${tr("výsledek po vyhodnocení listu níže")}`)).toBe(true);
      expect(isAcceptance(tr("→ {0} ({1}) přidán – výsledek po výpočtu níže", "a", "b").replace("→", "✓"))).toBe(false);
    }
    setLang("cs");
  });
});
