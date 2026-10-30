import { describe, it, expect } from "vitest";
import {
  extractOurNumbers, extractWordNumbers, matchTokens, normToken, scoreCandidates, decideMatch, categoryAfterLink, hasStrongSignal,
  weakenNumberSignals, isSupplierInvoiceMail, ownTextOf, threadConflict, pickLatestCommunication, type CandidateRow,
} from "./job-match";

const row = (job: string, signal: string, extra: Partial<CandidateRow> = {}): CandidateRow => ({
  job_id: job, number: `Z-2026-${job}`, title: `Zakázka ${job}`, status: "nabidka", customer_id: "c1", signal, detail: null, open: true, ...extra,
});

describe("signály z textu", () => {
  it("naše čísla: Z-, NAB- (i revize), OV-; slovní tvar „nabídka 31/2026“ jen slabě", () => {
    expect(extractOurNumbers("Re: Nabídka NAB-2026-031-R2 k zakázce Z-2026-13", "objednávka OV 5/2026")).toEqual(
      expect.arrayContaining(["NAB-2026-031", "Z-2026-013", "OV-2026-005"]),
    );
    expect(extractOurNumbers("k Vaší nabídce č. 31/2026 a zakázce 7/2026")).toEqual([]);
    expect(extractWordNumbers("k Vaší nabídce č. 31/2026 a zakázce 7/2026")).toEqual(["NAB-2026-031", "Z-2026-007"]);
    expect(extractOurNumbers("OV-2026-005")).toEqual(["OV-2026-005"]);
    expect(extractOurNumbers("bez čísel 2026")).toEqual([]);
  });
  it("vlastní „objednávka č. 1382/2026“ zákazníka není naše OV (review #2)", () => {
    const t = "posíláme naši objednávku č. 1382/2026, potřebujeme celkem 35 ks";
    expect(extractOurNumbers(t)).toEqual([]);
    expect(extractWordNumbers(t)).toEqual([]);
  });
  it("číslo jen ve slabém tvaru → number_weak", () => {
    const rows = [row("013", "quote_number", { detail: "NAB-2026-031-R2" }), row("014", "job_number", { detail: "Z-2026-014" })];
    const w = weakenNumberSignals(rows, ["NAB-2026-031"]);
    expect(w.map((r) => r.signal)).toEqual(["quote_number", "number_weak"]);
    expect(decideMatch([w[1]], { category: "ostatni", direction: "in", customerId: "c1" }).kind).toBe("suggest");
  });
  it("faktura dodavatele z e-mailu", () => {
    expect(isSupplierInvoiceMail({ category: "faktura", supplier_id: "s1" })).toBe(true);
    expect(isSupplierInvoiceMail({ category: "faktura", supplier_id: null, job_link_source: "po_number" })).toBe(true);
    expect(isSupplierInvoiceMail({ category: "faktura", supplier_id: null })).toBe(false);
    expect(isSupplierInvoiceMail({ category: "ostatni", supplier_id: "s1" })).toBe(false);
  });
  it("tokeny pro výkres a číslo objednávky zákazníka (= drawing_norm)", () => {
    expect(normToken("H-200 / A.1")).toBe("H200A1");
    const t = matchTokens(["Díl H-200, objednávka 4500123."], ["H-200_revB.pdf", "IMG.jpg"]);
    expect(t).toEqual(expect.arrayContaining(["H200", "4500123", "H200_REVB"]));
    expect(t).not.toContain("IMG");
  });
});

describe("rozhodnutí přiřazení", () => {
  const ctx = { category: "ostatni" as const, direction: "in" as const, customerId: "c1" };
  it("vlákno / odpověď / naše číslo = jisté → přiřadit", () => {
    for (const s of ["thread", "reply", "job_number", "quote_number", "customer_order"]) {
      const d = decideMatch([row("013", s)], ctx);
      expect(d.kind).toBe("link");
      if (d.kind === "link") expect(d.source).toBe(s);
    }
  });
  it("výkres + stejný zákazník = jisté; výkres cizí firmy = jen návrh", () => {
    expect(decideMatch([row("013", "drawing")], ctx).kind).toBe("link");
    expect(decideMatch([row("013", "drawing", { customer_id: "jiny" })], ctx).kind).toBe("suggest");
  });
  it("jediná otevřená zakázka firmy = návrh; víc zakázek = nejisté (AI)", () => {
    const one = decideMatch([row("013", "company")], ctx);
    expect(one.kind).toBe("suggest");
    const two = decideMatch([row("013", "company"), row("014", "company")], ctx);
    expect(two.kind).toBe("ambiguous");
    // firma + výkres jedné z nich → jasně ta
    const mix = decideMatch([row("013", "company"), row("014", "company"), row("014", "drawing")], ctx);
    expect(mix.kind).toBe("link");
    if (mix.kind === "link") expect(mix.candidate.jobId).toBe("014");
  });
  it("vlákno vyhrává nad zmínkou jiné zakázky", () => {
    const d = decideMatch([row("013", "thread"), row("010", "job_number")], ctx);
    expect(d.kind).toBe("link");
    if (d.kind === "link") expect(d.candidate.jobId).toBe("013");
  });
  it("číslo zakázky jiného zákazníka / OV jiného dodavatele = jen návrh (review #2)", () => {
    expect(decideMatch([row("013", "job_number", { customer_id: "c2" })], ctx).kind).toBe("suggest");
    expect(decideMatch([row("013", "quote_number", { customer_id: "c2" })], ctx).kind).toBe("suggest");
    expect(decideMatch([row("013", "po_number", { customer_id: "c2" })], ctx).kind).toBe("suggest");
    // neznámý odesílatel s naším OV → návrh
    expect(decideMatch([row("013", "po_number", { supplier_id: "s1" })], { ...ctx, customerId: null }).kind).toBe("suggest");
    expect(decideMatch([row("013", "po_number", { supplier_id: "s1" })], { ...ctx, customerId: null, supplierId: "s2" }).kind).toBe("suggest");
  });
  it("uzavřená zakázka / vlákno jen podle předmětu: nikdy automaticky (review #3)", () => {
    const closed = decideMatch([row("013", "thread", { status: "dokonceno", open: false })], ctx);
    expect(closed.kind).toBe("suggest");
    expect(decideMatch([row("013", "thread_subject")], ctx).kind).toBe("suggest");
    expect(decideMatch([row("013", "thread_subject")], { ...ctx, category: "poptavka" }).kind).toBe("none");
    expect(decideMatch([row("013", "thread", { open: false })], { ...ctx, category: "poptavka" }).kind).toBe("suggest");
    // nová objednávka: automaticky jen s naším číslem té zakázky
    expect(decideMatch([row("013", "thread")], { ...ctx, category: "objednavka" }).kind).toBe("suggest");
    expect(decideMatch([row("013", "quote_number"), row("013", "thread")], { ...ctx, category: "objednavka" }).kind).toBe("link");
  });
  it("dvě silné různé zakázky = nejisté", () => {
    expect(decideMatch([row("013", "job_number"), row("014", "job_number")], ctx).kind).toBe("ambiguous");
  });
  it("NOVÁ poptávka se slabým signálem se nepřiřazuje (zůstane Poptávkou)", () => {
    expect(decideMatch([row("013", "company")], { ...ctx, category: "poptavka" }).kind).toBe("none");
    expect(decideMatch([row("013", "drawing")], { ...ctx, category: "poptavka" }).kind).toBe("none");
    // odpověď v našem vlákně bez našeho čísla = návrh (poptávka se automaticky nepřiřadí)
    expect(decideMatch([row("013", "reply")], { ...ctx, category: "poptavka" }).kind).toBe("suggest");
    expect(decideMatch([row("013", "job_number")], { ...ctx, category: "poptavka" }).kind).toBe("link");
    // objednávka k poptávce podle výkresu = návrh
    expect(decideMatch([row("013", "drawing")], { ...ctx, category: "objednavka" }).kind).toBe("suggest");
  });
  it("dodavatel: otevřená objednávka OV = návrh, číslo OV = jisté", () => {
    expect(decideMatch([row("013", "supplier")], { ...ctx, customerId: null, supplierId: "s1" }).kind).toBe("suggest");
    expect(decideMatch([row("013", "po_number", { supplier_id: "s1" })], { ...ctx, customerId: null, supplierId: "s1" }).kind).toBe("link");
  });
  it("odchozí pošta: jen jisté přiřazení", () => {
    expect(decideMatch([row("013", "company")], { ...ctx, direction: "out" }).kind).toBe("none");
    expect(decideMatch([row("013", "reply")], { ...ctx, direction: "out" }).kind).toBe("link");
  });
  it("skóre: kombinace signálů, důvody, uzavřená zakázka slabší", () => {
    const [c] = scoreCandidates([row("013", "drawing"), row("013", "company")], ctx);
    expect(c.score).toBeGreaterThan(0.9);
    expect(c.reasons.length).toBe(2);
    expect(hasStrongSignal(c)).toBe(false);
    const [closed] = scoreCandidates([row("013", "drawing", { open: false })], ctx);
    expect(closed.score).toBeLessThan(0.5);
    expect(scoreCandidates([row("013", "nesmysl")], ctx)).toEqual([]);
  });
});

describe("kategorie po přiřazení", () => {
  const opt = { direction: "in" as const, strong: true, fromSupplier: false };
  it("komunikace → K zakázce; objednávka, faktura, reklamace… zůstávají", () => {
    expect(categoryAfterLink("ostatni", opt)).toBe("k_zakazce");
    expect(categoryAfterLink("technicka_dokumentace", opt)).toBe("k_zakazce");
    expect(categoryAfterLink("poptavka", opt)).toBe("poptavka"); // nová poptávka se nikdy nepřetřídí (review #3)
    expect(categoryAfterLink("poptavka", { ...opt, strong: false })).toBe("poptavka");
    expect(categoryAfterLink("nabidka_dodavatele", opt)).toBe("k_zakazce");
    expect(categoryAfterLink("nabidka_dodavatele", { ...opt, fromSupplier: true })).toBe("nabidka_dodavatele");
    for (const c of ["objednavka", "faktura", "reklamace", "upominka", "potvrzeni_objednavky", "spam"] as const) expect(categoryAfterLink(c, opt)).toBe(c);
    expect(categoryAfterLink("ostatni", { ...opt, direction: "out" })).toBe("ostatni");
  });
});

describe("odpověď ve vlákně zmiňuje jinou zakázku (fix 1)", () => {
  const ctx = { category: "ostatni" as const, direction: "in" as const, customerId: "c1" };
  const top = (rows: CandidateRow[]) => {
    const d = decideMatch(rows, ctx);
    if (d.kind !== "link") throw new Error(`čekal jsem link, je ${d.kind}`);
    return d.candidate;
  };
  it("vlastní text odpovědi jmenuje číslo jiné otevřené zakázky → silný konflikt (návrh, nic nepropsat)", () => {
    const rows = [row("013", "thread", { detail: "Re: Nabídka" }), row("010", "job_number", { detail: "Z-2026-010" })];
    const own = ownTextOf("k zakázce Z-2026-010: prosím zinkovat", []);
    const c = threadConflict(top(rows), rows, own, ctx);
    expect(c).toMatchObject({ strong: true, other: { jobId: "010" } });
    // naše nabídka / OV / objednávka zákazníka jiné zakázky = taky silné
    for (const [sig, detail, text] of [["quote_number", "NAB-2026-044-R2", "k nabídce NAB-2026-044"], ["po_number", "OV-2026-007", "OV-2026-007"], ["customer_order", "4500-777", "objednávka 4500777"]] as const) {
      const r = [row("013", "reply"), row("011", sig, { detail })];
      expect(threadConflict(top(r), r, ownTextOf(text, []), ctx)).toMatchObject({ strong: true, other: { jobId: "011" } });
    }
  });
  it("číslo jen v citaci / slovním tvaru (bez změněného předmětu) = žádný konflikt", () => {
    const rows = [row("013", "thread"), row("010", "job_number", { detail: "Z-2026-010" })];
    expect(threadConflict(top(rows), rows, ownTextOf("prosím zinkovat", []), ctx)).toBeNull();
    const weak = [row("013", "thread"), row("010", "number_weak", { detail: "Z-2026-010" })];
    expect(threadConflict(top(weak), weak, ownTextOf("prosím zinkovat Z-2026-010", []), ctx)).toBeNull();
  });
  it("text jmenuje i zakázku vlákna / jiného zákazníka / jen výkres → slabý konflikt (přiřadit vláknem, změny jen jako návrh)", () => {
    const both = [row("013", "thread"), row("013", "job_number", { detail: "Z-2026-013" }), row("010", "job_number", { detail: "Z-2026-010" })];
    expect(threadConflict(top(both), both, ownTextOf("Z-2026-013 ok, k Z-2026-010 prosím kalit", []), ctx)).toMatchObject({ strong: false, other: { jobId: "010" } });
    const foreign = [row("013", "thread"), row("010", "job_number", { detail: "Z-2026-010", customer_id: "c9" })];
    expect(threadConflict(top(foreign), foreign, ownTextOf("viz Z-2026-010", []), ctx)).toMatchObject({ strong: false });
    const dwg = [row("013", "thread"), row("010", "drawing", { detail: "H-300" })];
    expect(threadConflict(top(dwg), dwg, ownTextOf("k výkresu H-300 prosím kalit", []), ctx)).toMatchObject({ strong: false, other: { jobId: "010" } });
  });
  it("stejný výkres i v zakázce vlákna, uzavřená jiná zakázka, výkres cizí firmy, nevláknové přiřazení = bez konfliktu", () => {
    const same = [row("013", "thread"), row("013", "drawing", { detail: "H-300" }), row("010", "drawing", { detail: "H 300" })];
    expect(threadConflict(top(same), same, ownTextOf("H-300 prosím kalit", []), ctx)).toBeNull();
    const closed = [row("013", "thread"), row("001", "job_number", { detail: "Z-2026-001", open: false, status: "dokonceno" })];
    expect(threadConflict(top(closed), closed, ownTextOf("jako minule u Z-2026-001", []), ctx)).toBeNull();
    const foreignDwg = [row("013", "thread"), row("010", "drawing", { detail: "H-300", customer_id: "c9" })];
    expect(threadConflict(top(foreignDwg), foreignDwg, ownTextOf("H-300", []), ctx)).toBeNull();
    const byNumber = [row("013", "job_number", { detail: "Z-2026-013" }), row("010", "drawing", { detail: "H-300" })];
    expect(threadConflict(top(byNumber), byNumber, ownTextOf("Z-2026-013 a H-300", []), ctx)).toBeNull();
  });
  it("zakázka u vlákna dřív zamítnutá: nová zpráva s jejím číslem se zeptá znovu; jen výkres = slabý konflikt", () => {
    const rows = [row("013", "thread"), row("010", "job_number", { detail: "Z-2026-010", rejected: true })];
    const t = top(rows.filter((r) => !r.rejected));
    expect(threadConflict(t, rows, ownTextOf("k Z-2026-010 prosím kalit", []), ctx)).toMatchObject({ strong: true, other: { jobId: "010" } });
    const dwg = [row("013", "thread"), row("010", "drawing", { detail: "H-300", rejected: true })];
    expect(threadConflict(top(dwg.filter((r) => !r.rejected)), dwg, ownTextOf("H-300 prosím kalit", []), ctx)).toMatchObject({ strong: false });
  });
  it("číslo v názvu přílohy se počítá jako vlastní text", () => {
    const rows = [row("013", "thread"), row("010", "job_number", { detail: "Z-2026-010" })];
    expect(threadConflict(top(rows), rows, ownTextOf("posílám", ["Z-2026-010_vykres.pdf"]), ctx)).toMatchObject({ strong: true });
  });
  it("fix V2e: předmět odpovědi změněný na naše číslo jiné zakázky (zakázka vlákna v něm není) → silný konflikt", () => {
    const rows = [row("013", "thread", { detail: "Nabídka hřídel" }), row("010", "job_number", { detail: "Z-2026-010" })];
    expect(threadConflict(top(rows), rows, ownTextOf("prosím zinkovat", [], "Re: Z-2026-010 změna"), ctx)).toMatchObject({ strong: true, other: { jobId: "010" }, signals: ["job_number"] });
    // nabídka / OV jiné zakázky v předmětu taky
    const q = [row("013", "reply", { detail: "Podklady" }), row("011", "quote_number", { detail: "NAB-2026-044-R2" })];
    expect(threadConflict(top(q), q, ownTextOf("prosím zinkovat", [], "Re: NAB-2026-044 úprava"), ctx)).toMatchObject({ strong: true, other: { jobId: "011" } });
  });
  it("fix V2e: předmět jmenuje i zakázku vlákna / text jmenuje zakázku vlákna / jiný zákazník → jen slabý konflikt (změny návrhem)", () => {
    const both = [row("013", "thread", { detail: "Nabídka" }), row("013", "job_number", { detail: "Z-2026-013" }), row("010", "job_number", { detail: "Z-2026-010" })];
    expect(threadConflict(top(both), both, ownTextOf("prosím zinkovat", [], "Re: Z-2026-013 a Z-2026-010"), ctx)).toMatchObject({ strong: false, other: { jobId: "010" } });
    const rows = [row("013", "thread", { detail: "Nabídka" }), row("013", "job_number", { detail: "Z-2026-013" }), row("010", "job_number", { detail: "Z-2026-010" })];
    expect(threadConflict(top(rows), rows, ownTextOf("k Z-2026-013 prosím zinkovat", [], "Re: Z-2026-010"), ctx)).toMatchObject({ strong: false, other: { jobId: "010" } });
    const foreign = [row("013", "thread", { detail: "Nabídka" }), row("010", "job_number", { detail: "Z-2026-010", customer_id: "c9" })];
    expect(threadConflict(top(foreign), foreign, ownTextOf("prosím zinkovat", [], "Re: Z-2026-010"), ctx)).toMatchObject({ strong: false });
  });
  it("fix V2e: číslo jiné zakázky už v dřívějším předmětu vlákna (zděděné „Re:“) = žádný konflikt", () => {
    const rows = [row("013", "thread", { detail: "Nabídka" }), row("013", "thread", { detail: "Re: Z-2026-010 změna" }), row("010", "job_number", { detail: "Z-2026-010" })];
    expect(threadConflict(top(rows), rows, ownTextOf("prosím zinkovat", [], "Re: Re: Z-2026-010 změna"), ctx)).toBeNull();
    // výkres jiné zakázky jen v předmětu se nepočítá (jen naše čísla)
    const dwg = [row("013", "thread", { detail: "Nabídka" }), row("010", "drawing", { detail: "H-300" })];
    expect(threadConflict(top(dwg), dwg, ownTextOf("prosím zinkovat", [], "Re: H-300"), ctx)).toBeNull();
  });
  it("fix 4: víc nabídek / OV téže jiné zakázky — konflikt najde tu, kterou text jmenuje", () => {
    const rows = [row("013", "thread"), row("011", "quote_number", { detail: "NAB-2026-050" }), row("011", "quote_number", { detail: "NAB-2026-051" })];
    expect(threadConflict(top(rows), rows, ownTextOf("k NAB-2026-051 prosím zinkovat", []), ctx)).toMatchObject({ strong: true, other: { jobId: "011" } });
  });
});

describe("fix 4: víc řádků téhož signálu u jedné zakázky", () => {
  it("skóre bere nejsilnější řádek (OV od jejího dodavatele), ne náhodný první", () => {
    const ctx = { category: "ostatni" as const, direction: "in" as const, supplierId: "s1" };
    const a = row("020", "po_number", { detail: "OV-2026-001", supplier_id: "s9", customer_id: null });
    const b = row("020", "po_number", { detail: "OV-2026-002", supplier_id: "s1", customer_id: null });
    for (const rows of [[a, b], [b, a]]) {
      const [c] = scoreCandidates(rows, ctx);
      expect(c.score).toBe(0.94);
      expect(c.signals).toEqual(["po_number"]);
      expect(c.reasons).toHaveLength(1);
    }
  });
});

describe("nejasné: návrh zakázky s nejčerstvější komunikací (fix 5)", () => {
  const ctx = { category: "ostatni" as const, direction: "in" as const, customerId: "c1" };
  it("shoda skóre → zakázka s poslední poštou, jinak dosavadní pořadí", () => {
    const d = decideMatch([row("013", "company"), row("014", "company")], ctx);
    expect(d.kind).toBe("ambiguous");
    const cands = d.candidates;
    expect(cands[0].jobId).toBe("014");
    expect(pickLatestCommunication(cands, new Map([["013", "2026-10-28T10:00:00Z"]])).jobId).toBe("013");
    expect(pickLatestCommunication(cands, new Map([["013", "2026-10-01T10:00:00Z"], ["014", "2026-10-02T10:00:00Z"]])).jobId).toBe("014");
    expect(pickLatestCommunication(cands, new Map()).jobId).toBe("014");
    // vyšší skóre (výkres) se nepřebíjí čerstvostí pošty
    const mix = scoreCandidates([row("013", "company"), row("014", "company"), row("014", "drawing", { customer_id: "c9" })], ctx);
    expect(pickLatestCommunication(mix, new Map([["013", "2026-10-28T10:00:00Z"]])).jobId).toBe("014");
  });
});
