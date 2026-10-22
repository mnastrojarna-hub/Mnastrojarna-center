import { describe, it, expect } from "vitest";
import type { CustomerMatchCandidate, ExtractedBusinessDoc } from "./capture-types";
import {
  normalizeCompanyName, normalizeDocNumber, docNumbersEqual, nameSimilarity,
  matchCustomer, matchJob, MATCH_THRESHOLD, isSupplierSideDoc, type JobMatchCandidateExt,
} from "./matching";
import { normalizeExtracted } from "./extracted-normalize";
import objednavkaFixture from "./__fixtures__/capture/objednavka-strojmetal.json";
import poptavkaFixture from "./__fixtures__/capture/poptavka-novy-zakaznik.json";
import dodaciListFixture from "./__fixtures__/capture/dodaci-list-dodavatel.json";

const NOW = new Date("2026-10-22T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function doc(over: Partial<ExtractedBusinessDoc>): ExtractedBusinessDoc {
  return { ...normalizeExtracted({}), ...over };
}

// ── normalizace ─────────────────────────────────────────────

describe("normalizeCompanyName", () => {
  it("odstraní diakritiku, právní formu a interpunkci", () => {
    expect(normalizeCompanyName("Strojmetal a.s.")).toBe("strojmetal");
    expect(normalizeCompanyName("STROJMETAL, a. s.")).toBe("strojmetal");
    expect(normalizeCompanyName("Kovoobrábění Hrubý s.r.o.")).toBe("kovoobrabeni hruby");
    expect(normalizeCompanyName("Beneš CNC, spol. s r.o.")).toBe("benes cnc");
    expect(normalizeCompanyName("AeroParts EU GmbH")).toBe("aeroparts eu");
    expect(normalizeCompanyName("Müller & Söhne GmbH & Co. KG")).toBe("muller sohne");
    expect(normalizeCompanyName("Zemědělské družstvo Rovina")).toBe("zemedelske rovina");
    expect(normalizeCompanyName("Pila Hlinsko, v.o.s.")).toBe("pila hlinsko");
    expect(normalizeCompanyName("  ")).toBe("");
    expect(normalizeCompanyName(null)).toBe("");
  });
  it("písmena uvnitř slov nechá", () => {
    expect(normalizeCompanyName("Asko Kladno")).toBe("asko kladno");
    expect(normalizeCompanyName("Agro Sro Group")).toBe("agro group");
  });
});

describe("normalizeDocNumber / docNumbersEqual", () => {
  it("sjednotí velikost písmen, mezery a oddělovače", () => {
    expect(normalizeDocNumber("nab 2026/031")).toBe("NAB2026-031");
    expect(normalizeDocNumber(" NAB_2026.031 ")).toBe("NAB-2026-031");
    expect(docNumbersEqual("nab 2026/031", "NAB-2026-031")).toBe(true);
    expect(docNumbersEqual("NAB.2026.031", "nab-2026-031")).toBe(true);
  });
  it("ignoruje úvodní nuly a revizní příponu", () => {
    expect(docNumbersEqual("NAB-2026-31", "NAB-2026-031")).toBe(true);
    expect(docNumbersEqual("NAB-2026-031-R2", "NAB-2026-031")).toBe(true);
    expect(docNumbersEqual("NAB-2026-031 rev.2", "NAB-2026-031")).toBe(true);
    expect(docNumbersEqual("Z-2026-014", "Z-2026-14")).toBe(true);
  });
  it("PO s mezerami uvnitř čísla", () => {
    expect(docNumbersEqual("PO 4500 021 877", "PO-4500021877")).toBe(true);
    expect(docNumbersEqual("4500 021 877", "4500021877")).toBe(true);
  });
  it("chybějící písmenný prefix", () => {
    expect(docNumbersEqual("2026/031", "NAB-2026-031")).toBe(true);
  });
  it("rozdílná čísla nesplývají", () => {
    expect(docNumbersEqual("NAB-2026-031", "NAB-2026-032")).toBe(false);
    expect(docNumbersEqual("NAB-2026-031", "Z-2026-031")).toBe(false);
    expect(docNumbersEqual("BR100", "B")).toBe(false);
    expect(docNumbersEqual("4711-2026", "4712-2026")).toBe(false);
    expect(docNumbersEqual("", "")).toBe(false);
    expect(docNumbersEqual("NAB-2026-031", null)).toBe(false);
  });
});

describe("nameSimilarity", () => {
  it("1 pro stejné normalizované názvy, vysoko pro překlep, nízko pro jinou firmu", () => {
    expect(nameSimilarity("Strojmetal a.s.", "STROJMETAL, a. s.")).toBe(1);
    expect(nameSimilarity("Kovoobrábění Hrubý", "Kovoobrabeni Hruby s.r.o.")).toBe(1);
    expect(nameSimilarity("Strojmetall", "Strojmetal")).toBeGreaterThan(0.9);
    expect(nameSimilarity("TDK Precision", "Beneš CNC")).toBeLessThan(0.3);
    expect(nameSimilarity("", "Strojmetal")).toBe(0);
  });
});

// ── zákazník ────────────────────────────────────────────────

const customers: CustomerMatchCandidate[] = [
  {
    id: "c-strojmetal", name: "Strojmetal a.s.", ico: "45274649", dic: "CZ45274649",
    email: "nakup@strojmetal.cz", contactEmails: ["dvorak@strojmetal.cz"],
    customerNumber: "ZAK-0001", supplierNumberAtCustomer: "D-88412",
  },
  {
    id: "c-tdk", name: "TDK Precision s.r.o.", ico: "27082440", dic: "CZ27082440",
    email: "nakup@tdkprecision.cz", contactEmails: [], customerNumber: "ZAK-0002", supplierNumberAtCustomer: null,
  },
  {
    id: "c-aero", name: "AeroParts EU GmbH", ico: null, dic: "DE811234567",
    email: "weber@aeroparts.eu", contactEmails: [], customerNumber: "ZAK-0004", supplierNumberAtCustomer: "L-20931",
  },
  {
    id: "c-pepa", name: "Josef Novák — zámečnictví", ico: null, dic: null,
    email: "pepa.novak@gmail.com", contactEmails: [], customerNumber: null, supplierNumberAtCustomer: null,
  },
];

describe("matchCustomer", () => {
  it("IČO má přednost (100)", () => {
    expect(matchCustomer({ ico: "452 74 649", name: "úplně jiný název" }, customers))
      .toEqual({ id: "c-strojmetal", score: 100, reason: "podle IČO 45274649" });
  });
  it("DIČ (95)", () => {
    const m = matchCustomer({ dic: "de 811234567" }, customers);
    expect(m).toMatchObject({ id: "c-aero", score: 95 });
  });
  it("naše číslo dodavatele u zákazníka (90)", () => {
    const m = matchCustomer({ name: "AP EU" }, customers, { supplierNumberAtCustomer: "L 20931" });
    expect(m).toMatchObject({ id: "c-aero", score: 90 });
  });
  it("přesný normalizovaný název (85) — Strojmetal a.s. vs STROJMETAL, a. s.", () => {
    expect(matchCustomer({ name: "STROJMETAL, a. s." }, customers)).toMatchObject({ id: "c-strojmetal", score: 85, reason: "podle názvu firmy" });
  });
  it("přesný e-mail kontaktu (80)", () => {
    expect(matchCustomer({ email: "Dvorak@Strojmetal.cz" }, customers)).toMatchObject({ id: "c-strojmetal", score: 80 });
  });
  it("firemní doména (70), freemail ne", () => {
    expect(matchCustomer({ email: "uctarna@tdkprecision.cz" }, customers)).toMatchObject({ id: "c-tdk", score: 70 });
    expect(matchCustomer({ email: "jiny.clovek@gmail.com" }, customers)).toBeNull();
    expect(matchCustomer({ email: "pepa.novak@gmail.com" }, customers)).toMatchObject({ id: "c-pepa", score: 80 });
  });
  it("podobný název (60–75)", () => {
    const m = matchCustomer({ name: "TDK Precission s.r.o." }, customers);
    expect(m?.id).toBe("c-tdk");
    expect(m!.score).toBeGreaterThanOrEqual(60);
    expect(m!.score).toBeLessThanOrEqual(75);
  });
  it("rozdílné IČO = jiná firma, i se stejným názvem", () => {
    expect(matchCustomer({ name: "Strojmetal a.s.", ico: "12345678" }, customers)).toBeNull();
  });
  it("nic nesedí → null", () => {
    expect(matchCustomer({ name: "Hydraulika Morava s.r.o.", ico: "08542311", email: "horakova@hydraulika-morava.cz" }, customers)).toBeNull();
    expect(matchCustomer({}, customers)).toBeNull();
    expect(matchCustomer({ name: "Strojmetal" }, [])).toBeNull();
  });
});

// ── zakázka ─────────────────────────────────────────────────

function job(over: Partial<JobMatchCandidateExt> & { id: string; number: string }): JobMatchCandidateExt {
  return {
    title: `Zakázka ${over.number}`, stage: "nabidka", createdAt: daysAgo(10),
    customerId: "c-strojmetal", customerName: "Strojmetal a.s.", customerIco: "45274649", customerDic: "CZ45274649",
    customerEmails: ["nakup@strojmetal.cz"], customerOrderNumber: null, customerInquiryNumber: null,
    quoteNumbers: [], drawingNumbers: [],
    ...over,
  };
}

const jobs: JobMatchCandidateExt[] = [
  job({ id: "j101", number: "Z-2026-101", stage: "poptavka", customerInquiryNumber: "POP-7781", drawingNumbers: ["VK-2291"], createdAt: daysAgo(2) }),
  job({ id: "j103", number: "Z-2026-103", stage: "nabidka", quoteNumbers: ["NAB-2026-031", "NAB-2026-031-R2"], drawingNumbers: ["VK-2291", "VK-2292"], createdAt: daysAgo(21) }),
  job({ id: "j105", number: "Z-2026-105", stage: "potvrzeno", customerOrderNumber: "4711-2026", quoteNumbers: ["NAB-2026-019"], drawingNumbers: ["VL-2379-08"], createdAt: daysAgo(40), supplierId: "s-hruby", supplierOrderNumber: "OBJ-2026-030" }),
  job({ id: "j112", number: "Z-2026-112", stage: "dokonceno", customerOrderNumber: "4602-2026", drawingNumbers: ["DS-2311"], createdAt: daysAgo(140) }),
  job({
    id: "j104", number: "Z-2026-104", stage: "objednavka", customerId: "c-aero", customerName: "AeroParts EU GmbH",
    customerOrderNumber: "PO-4500021877", quoteNumbers: ["NAB-2026-028"], drawingNumbers: ["PR-7075-20"],
    supplierId: "s-hruby", supplierOrderNumber: null, createdAt: daysAgo(27),
  }),
  job({ id: "j110", number: "Z-2026-110", stage: "dodano_zakaznikovi", customerId: "c-tdk", customerName: "TDK Precision s.r.o.", customerOrderNumber: "OBJ-23-9702", createdAt: daysAgo(92) }),
];

describe("matchJob", () => {
  it("naše číslo zakázky = 100", () => {
    const r = matchJob(doc({ docKind: "dodaci_list", issuer: "my", ourJobNumber: "z-2026-105" }), jobs, { customerId: "c-strojmetal", now: NOW });
    expect(r.best).toMatchObject({ jobId: "j105", score: 100 });
    expect(r.best!.reason).toBe("podle našeho čísla zakázky Z-2026-105");
  });

  it("objednávka Strojmetalu podle naší nabídky NAB-2026-031 (fixture) → 95, alternativa podle výkresu", () => {
    const d = normalizeExtracted(objednavkaFixture);
    const r = matchJob(d, jobs, { customerId: "c-strojmetal", now: NOW });
    expect(r.best).toMatchObject({ jobId: "j103", score: 95, reason: "podle čísla nabídky NAB-2026-031" });
    expect(r.alternatives[0]).toMatchObject({ jobId: "j101", jobNumber: "Z-2026-101", customerName: "Strojmetal a.s." });
    expect(r.alternatives[0].score).toBe(65);
    expect(r.alternatives[0].reason).toContain("VK-2291");
  });

  it("nabídka s revizní příponou na dokladu sedí na původní číslo", () => {
    const r = matchJob(doc({ docKind: "objednavka", issuer: "zakaznik", ourQuoteNumber: "NAB 2026/019-R3" }), jobs, { customerId: "c-strojmetal", now: NOW });
    expect(r.best).toMatchObject({ jobId: "j105", score: 95 });
  });

  it("číslo objednávky zákazníka s mezerami (92)", () => {
    const r = matchJob(doc({ docKind: "potvrzeni", issuer: "my", customerOrderNumber: "PO 4500 021 877" }), jobs, { customerId: "c-aero", now: NOW });
    expect(r.best).toMatchObject({ jobId: "j104", score: 92 });
    expect(r.best!.reason).toBe("podle čísla objednávky zákazníka PO-4500021877");
  });

  it("číslo poptávky zákazníka (88)", () => {
    const r = matchJob(doc({ docKind: "poptavka", issuer: "zakaznik", customerInquiryNumber: "pop 7781" }), jobs, { customerId: "c-strojmetal", now: NOW });
    expect(r.best).toMatchObject({ jobId: "j101", score: 88 });
  });

  it("čísla zákazníka u jiného zákazníka neplatí", () => {
    const r = matchJob(doc({ docKind: "objednavka", issuer: "zakaznik", customerOrderNumber: "4711-2026" }), jobs, { customerId: "c-tdk", now: NOW });
    expect(r.best).toBeNull();
  });

  it("naše číslo nabídky u zakázky jiného zákazníka → srážka, jen alternativa", () => {
    const r = matchJob(doc({ docKind: "objednavka", issuer: "zakaznik", ourQuoteNumber: "NAB-2026-031" }), jobs, { customerId: "c-tdk", now: NOW });
    expect(r.best).toBeNull();
    expect(r.alternatives[0]).toMatchObject({ jobId: "j103", score: 55 });
    expect(r.alternatives[0].reason).toContain("jinému zákazníkovi");
  });

  it("stejný zákazník + výkresy: 65 + 5 za každý další", () => {
    const d = doc({
      docKind: "objednavka", issuer: "zakaznik",
      items: [
        { ...normalizeExtracted({ items: [{ drawingNumber: "VK-2291" }] }).items[0] },
        { ...normalizeExtracted({ items: [{ drawingNumber: "vk 2292" }] }).items[0] },
      ],
    });
    const r = matchJob(d, jobs, { customerId: "c-strojmetal", now: NOW });
    expect(r.best).toMatchObject({ jobId: "j103", score: 70 });
    expect(r.best!.reason).toBe("stejný zákazník a výkresy VK-2291, vk 2292");
    expect(r.alternatives.map((a) => a.jobId)).toContain("j101");
  });

  it("stejný výkres bez známého zákazníka nic nepáruje", () => {
    const d = doc({ docKind: "objednavka", issuer: "zakaznik", items: normalizeExtracted({ items: [{ drawingNumber: "VK-2291" }] }).items });
    expect(matchJob(d, jobs, { now: NOW })).toEqual({ best: null, alternatives: [] });
  });

  it("slabá shoda (stejný zákazník, stav sedí, do 180 dní) = 45, nikdy automaticky", () => {
    const r = matchJob(doc({ docKind: "objednavka", issuer: "zakaznik" }), jobs, { customerId: "c-strojmetal", now: NOW });
    expect(r.best).toBeNull();
    expect(r.alternatives.map((a) => a.jobId)).toEqual(["j101", "j103"]);
    expect(r.alternatives.every((a) => a.score === 45)).toBe(true);
    // poptávka sama o sobě ke starším zakázkám nepatří
    expect(matchJob(doc({ docKind: "poptavka", issuer: "zakaznik" }), jobs, { customerId: "c-strojmetal", now: NOW }).alternatives).toEqual([]);
  });

  it("uzavřená zakázka −30, pokud nesedí přesné číslo", () => {
    const d = doc({ docKind: "faktura", issuer: "my", items: normalizeExtracted({ items: [{ drawingNumber: "DS-2311" }] }).items });
    const r = matchJob(d, jobs, { customerId: "c-strojmetal", now: NOW });
    expect(r.best).toBeNull();
    const closed = r.alternatives.find((a) => a.jobId === "j112");
    expect(closed).toMatchObject({ score: 35 });
    expect(closed!.reason).toContain("uzavřená (Dokončeno)");
    // potvrzená zakázka téhož zákazníka (slabá shoda 45) je před uzavřenou
    expect(r.alternatives[0]).toMatchObject({ jobId: "j105", score: 45 });
    // přesné číslo objednávky srážku ruší
    const exact = matchJob(doc({ docKind: "faktura", issuer: "my", customerOrderNumber: "4602-2026" }), jobs, { customerId: "c-strojmetal", now: NOW });
    expect(exact.best).toMatchObject({ jobId: "j112", score: 92 });
  });

  it("shoda skóre → vyhrává novější zakázka", () => {
    const twins = [
      job({ id: "old", number: "Z-2026-001", drawingNumbers: ["AB-1"], createdAt: daysAgo(100) }),
      job({ id: "new", number: "Z-2026-050", drawingNumbers: ["AB-1"], createdAt: daysAgo(3) }),
    ];
    const d = doc({ docKind: "potvrzeni", issuer: "my", items: normalizeExtracted({ items: [{ drawingNumber: "AB-1" }] }).items });
    const r = matchJob(d, twins, { customerId: "c-strojmetal", now: NOW });
    expect(r.best?.jobId).toBe("new");
    expect(r.alternatives[0].jobId).toBe("old");
  });

  it("dodavatelský DL (fixture): stejný dodavatel + výkres páruje, bez dodavatele jen alternativa", () => {
    const d = normalizeExtracted(dodaciListFixture);
    expect(isSupplierSideDoc(d)).toBe(true);
    const withSupplier = matchJob(d, jobs, { supplierId: "s-hruby", now: NOW });
    expect(withSupplier.best).toMatchObject({ jobId: "j104", score: 65 });
    expect(withSupplier.best!.reason).toBe("stejný dodavatel a výkres PR-7075-20");
    const alone = matchJob(d, jobs, { now: NOW });
    expect(alone.best).toBeNull();
    expect(alone.alternatives[0]).toMatchObject({ jobId: "j104", score: 50 });
  });

  it("dodavatelský doklad: naše objednávka u dodavatele (92), číslo objednávky zákazníka se nepoužije", () => {
    const d = doc({ docKind: "potvrzeni", issuer: "dodavatel", customerOrderNumber: "OBJ 2026/030" });
    expect(matchJob(d, jobs, { now: NOW }).best).toMatchObject({ jobId: "j105", score: 92 });
    const d2 = doc({ docKind: "potvrzeni", issuer: "dodavatel", customerOrderNumber: "4711-2026" });
    expect(matchJob(d2, jobs, { customerId: "c-strojmetal", now: NOW }).best).toBeNull();
  });

  it("poptávka nového zákazníka (fixture) → nic, založí se nová zakázka", () => {
    const r = matchJob(normalizeExtracted(poptavkaFixture), jobs, { customerId: null, now: NOW });
    expect(r).toEqual({ best: null, alternatives: [] });
  });

  it("alternativ je nejvýš 3 a mají skóre ≥ 30", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      job({ id: `m${i}`, number: `Z-2026-2${i}0`, stage: "naceneni", createdAt: daysAgo(i + 1) }));
    const r = matchJob(doc({ docKind: "objednavka", issuer: "zakaznik" }), many, { customerId: "c-strojmetal", now: NOW });
    expect(r.best).toBeNull();
    expect(r.alternatives).toHaveLength(3);
    expect(r.alternatives.map((a) => a.jobId)).toEqual(["m0", "m1", "m2"]);
    expect(MATCH_THRESHOLD).toBe(60);
  });

  it("stará zakázka (> 180 dní) slabou shodu nedostane", () => {
    const old = [job({ id: "x", number: "Z-2025-900", stage: "nabidka", createdAt: daysAgo(200) })];
    expect(matchJob(doc({ docKind: "objednavka", issuer: "zakaznik" }), old, { customerId: "c-strojmetal", now: NOW }).alternatives).toEqual([]);
  });
});
