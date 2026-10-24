import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import type { JobDetail, JobListItem, JobQuote, JobFile } from "@/lib/jobs/types";
import type { EmailItem } from "@/lib/data/types";
import { deriveFlow, menuActions, nextAction, type ActionCtx, type FlowFacts } from "@/lib/jobs/flow-status";
import type { FlowJobState } from "./flow-state";

// Smoke test stránek obchodního toku bez Next.js: router, session, data a akce jsou nahrazené
const access = { features: new Set<string>(["workflow", "documents", "orders", "mail", "margins"]) };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/inquiries",
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
vi.mock("@/app/actions/jobs", () => ({
  setJobStage: vi.fn(), createJob: vi.fn(), updateJob: vi.fn(), saveJobItems: vi.fn(), createJobQuote: vi.fn(),
  approveJobQuote: vi.fn(), markJobQuoteSent: vi.fn(), acceptJobQuote: vi.fn(), rejectJobQuote: vi.fn(), setJobQuoteArchived: vi.fn(),
  newJobQuoteRevision: vi.fn(),
}));
vi.mock("@/app/actions/job-documents", () => ({ generateJobDocument: vi.fn(), sendJobDocument: vi.fn(), draftJobDocumentEmail: vi.fn() }));
vi.mock("@/app/actions/flow-status", () => ({
  takeInquiry: vi.fn(), setInquiryStatus: vi.fn(), proposeFlowChange: vi.fn(), decideFlowProposal: vi.fn(), setQuoteState: vi.fn(),
  setOrderStatus: vi.fn(), requestOrderFix: vi.fn(), registerOrderChange: vi.fn(), decideOrderChange: vi.fn(),
}));
vi.mock("@/app/actions/flow-pages", () => ({ extendQuoteValidity: vi.fn() }));
vi.mock("@/app/actions/mail", () => ({ createJobFromEmail: vi.fn() }));
vi.mock("@/components/ai-pricing-panel", () => ({ AiPricingPanel: () => <div>AI-PANEL</div> }));
vi.mock("@/components/integration-settings-editor", () => ({ IntegrationSettingsEditor: () => <div>PARAMS-EDITOR</div> }));

const user = { id: "u1", email: "obchod@local.test", fullName: "Petr Obchodník", role: "obchodnik", active: true };
// #25: rozsah „moje" stránek toku (data jsou mockovaná níže, rozsah se jim jen předá)
const scopeState = { all: false, canToggle: false, who: "moje" as "moje" | "vsichni", error: false, mailboxEmails: [] as string[] };
vi.mock("@/lib/data/flow-scope", () => ({
  flowWhoFrom: async () => null,
  getFlowScope: async () => ({
    userId: "u1", all: scopeState.all, who: scopeState.who, canToggle: scopeState.canToggle, jobIds: new Set(["j1", "j2", "j4", "j5"]),
    mailboxIds: [], mailboxEmails: scopeState.mailboxEmails, error: scopeState.error,
  }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireFeature: async () => user,
  requireUser: async () => user,
  getAccess: async () => ({ user, ctx: {}, features: [...access.features], can: (f: string) => access.features.has(f) }),
}));

function job(over: Partial<JobListItem> = {}): JobListItem {
  return {
    id: "j1", number: "Z-2026-101", title: "Hřídel VK-2291", stage: "poptavka", priority: "vysoka",
    customer: { id: "c1", name: "Strojmetal a.s.", customerNumber: "ZK0007", ico: null },
    customerOrderNumber: null, customerInquiryNumber: "RFQ-77",
    drawingNumbers: ["VK-2291"], itemCount: 1, totalQuantity: 10,
    value: null, purchaseCost: null, currency: "CZK",
    inquiryDate: "2026-10-20", orderDate: null, customerRequiredDate: "2026-11-21", dueDate: null,
    expectedDeliveryDate: null, supplierPromisedDate: null, maxToleratedDate: null,
    receivedAt: null, deliveredAt: null,
    owner: { id: "u1", name: "Petr Obchodník" }, assignee: null, createdBy: null,
    supplier: null, quoteCount: 0, fileCount: 0, aiFilled: false, source: "manual",
    createdAt: "2026-10-20T10:00:00Z", updatedAt: "2026-10-20T10:00:00Z", stageChangedAt: null,
    ...over,
  };
}

function quote(over: Partial<JobQuote> = {}): JobQuote {
  return {
    id: "q1", number: "NAB-2026-031", revision: 2, title: "Hřídel", status: "odeslano", total: 186000, currency: "CZK",
    validUntil: "2026-10-01", leadTimeDays: 21, deliveryTerms: null, paymentTerms: null, note: null,
    createdBy: { id: "u1", name: "Petr Obchodník" }, approvedBy: { id: "u9", name: "Super Admin" }, approvedAt: "2026-10-02T08:00:00Z",
    sentAt: "2026-10-03T08:00:00Z", createdAt: "2026-10-02T08:00:00Z", archived: false, aiGenerated: false, accepted: false,
    items: [], ...over,
  };
}

function detail(over: Partial<JobDetail> = {}): JobDetail {
  return {
    ...job(),
    note: null, tags: [], technology: null, manufacturingLocation: null, specificRequirements: null, deliveryMethod: null,
    supplierOrderNumber: null, invoiceNumber: null, deliveryNoteNumber: null,
    customerContact: null, customerContactEmail: null, customerContactPhone: null,
    pricedBy: null, approvedBy: null, approvedAt: null, confirmedAt: null, productionStartedAt: null, shippedAt: null, invoicedAt: null,
    emailId: null, aiConfidence: null, acceptedQuoteId: null, margin: null,
    customerDetail: {
      id: "c1", name: "Strojmetal a.s.", customerNumber: "ZK0007", supplierNumberAtCustomer: null, ico: null, dic: null,
      street: null, city: null, zip: null, country: "CZ", email: "nakup@strojmetal.cz", phone: null, contactPerson: null,
      deliveryAddress: null, paymentTermsDays: 30,
    },
    items: [{
      id: "i1", position: 0, drawingNumber: "VK-2291", revision: "B", name: "Hřídel", description: null, material: "C45",
      quantity: 10, unit: "ks", unitPrice: 1200, purchaseUnitPrice: 800, note: null,
    }],
    quotes: [], files: [], events: [],
    ...over,
  };
}

const file = (over: Partial<JobFile & { job: { id: string; number: string; title: string; customerName: string | null } }> = {}) => ({
  id: "f1", kind: "faktura" as const, title: "Faktura FV-2026-001", filename: "Faktura_FV-2026-001.pdf", mimeType: "application/pdf",
  sizeBytes: 52_000, version: 2, archived: false, replacedBy: null, quoteId: null, uploadedBy: { id: "u1", name: "Petr Obchodník" },
  createdAt: "2026-10-21T10:00:00Z", aiConfidence: null, note: null, hasAiData: false,
  job: { id: "j5", number: "Z-2026-111", title: "Příruba", customerName: "Beneš CNC s.r.o." },
  ...over,
});

const email = (over: Partial<EmailItem> = {}): EmailItem => ({
  id: "e1", from: "Jan Nákupčí", fromEmail: "nakup@strojmetal.cz", subject: "Poptávka hřídelí", preview: "Dobrý den, poptáváme…",
  category: "Poptávka", priority: "Střední", customer: "Strojmetal a.s.", receivedAt: "2026-10-22T08:00:00Z",
  aiConfidence: 0.93, unread: true, hasDraft: false, ...over,
});

const data = {
  listJobs: vi.fn(async (f: { stages?: string[] }) => {
    const all = [
      job(),
      job({ id: "j2", number: "Z-2026-102", stage: "naceneni", priority: "stredni" }),
      job({ id: "j4", number: "Z-2026-104", stage: "objednavka", customerOrderNumber: "PO-4500021877", value: 94000, quoteCount: 1 }),
      job({ id: "j5", number: "Z-2026-105", stage: "potvrzeno", dueDate: "2026-11-05" }),
    ];
    return f?.stages?.length ? all.filter((j) => f.stages!.includes(j.stage)) : all;
  }),
  getJob: vi.fn(async (id: string) =>
    id === "j4"
      ? detail({ id: "j4", number: "Z-2026-104", stage: "objednavka", customerOrderNumber: "PO-4500021877" })
      : detail({ id, number: id === "j2" ? "Z-2026-102" : "Z-2026-101", stage: id === "j2" ? "naceneni" : "poptavka" }),
  ),
  // #25: párování pošty proti všem zakázkám (Potvrzení objednávek)
  listJobOrderRefs: vi.fn(async () => [{ id: "j4", number: "Z-2026-104", customerOrderNumber: "PO-4500021877" }]),
  getJobFormOptions: vi.fn(async () => ({ users: [], customers: [{ id: "c1", name: "Strojmetal a.s.", customerNumber: "ZK0007", ico: null }], suppliers: [] })),
  listQuotes: vi.fn(async () => [
    { ...quote(), job: { id: "j3", number: "Z-2026-103", title: "Hřídel", stage: "nabidka" as const }, customer: { id: "c3", name: "Beneš CNC s.r.o." } },
    { ...quote({ id: "q2", number: "NAB-2026-034", revision: 1, status: "ke_schvaleni", approvedBy: null, sentAt: null, validUntil: "2026-12-01", total: null }), job: { id: "j2", number: "Z-2026-102", title: "Pouzdra", stage: "naceneni" as const }, customer: null },
    { ...quote({ id: "q3", number: "NAB-2026-031", revision: 1, archived: true }), job: { id: "j3", number: "Z-2026-103", title: "Hřídel", stage: "nabidka" as const }, customer: null },
  ]),
  listJobFiles: vi.fn(async () => [
    file(),
    file({ id: "f2", kind: "foto", title: null, filename: "IMG_2001.jpg", mimeType: "image/jpeg", version: 1 }),
    file({ id: "f3", kind: "vykres", title: null, filename: "VK-2291.pdf", archived: true, version: 1 }),
  ]),
};
vi.mock("@/lib/data/jobs", () => data);
const emails = vi.fn(async () => [
  email(),
  email({ id: "e2", subject: "Objednávka PO-1", category: "Objednávka", jobId: "j4", jobNumber: "Z-2026-104" }),
]);
vi.mock("@/lib/data/queries", () => ({
  getEmails: () => emails(),
  // #25: fronta super admina „Ke schválení“ (vždy všech)
  listPendingQuoteApprovals: async () => [
    { quoteId: "q7", number: "NAB-2026-040", jobId: "j9", jobNumber: "Z-2026-190", customerName: "Kovo Brno", authorName: "Petr Obchodník", total: 12000, currency: "CZK", updatedAt: "2026-10-23T08:00:00Z", createdAt: "2026-10-23T08:00:00Z", unpriced: false },
    { quoteId: "q8", number: "NAB-2026-041", jobId: "j9", jobNumber: "Z-2026-190", customerName: "Kovo Brno", authorName: "Pavel Dílna", total: null, currency: "CZK", updatedAt: "2026-10-23T08:00:00Z", createdAt: "2026-10-23T08:00:00Z", unpriced: true },
  ],
}));
vi.mock("@/lib/data/pricing-data", () => ({
  getRecentPricingCalculations: async () => [{ id: "pc1", drawing_number: "VK-1", customer_name: "X", material: "C45", quantity: 5, unit_price: 100, corrected: false, created_at: "2026-10-20T10:00:00Z" }],
}));
vi.mock("@/lib/data/settings-data", () => ({ getIntegrationSettingsMeta: async () => [{ key: "pricing_rate", category: "pricing", label: "Sazba", isSecret: false, value: "1000" }] }));

// ── Podrobné stavy toku (jako z DB: deriveFlow + nextAction pro přihlášeného) ──
const TODAY = "2026-10-23";
function flowFacts(over: Partial<FlowFacts>): FlowFacts {
  return {
    stage: "poptavka", inquiryStatus: "v_reseni", orderStatus: null, orderRevision: 0, orderConfirmedRevision: null,
    confirmationIssuedRevision: null, confirmationSentRevision: null, itemsCount: 1, itemsPriced: 0, itemsDelivered: 0, itemsPartial: 0,
    lastDeliveryAt: null, partialDeliveryAt: null, productionDone: 0, productionTotal: 0, deliveryNoteConfirmedAt: null,
    invoiceNumber: null, invoiceDueDate: null, paidAt: null, paidSoFar: 0, waitingSince: null, orderStatusChangedAt: null,
    pendingSupplierQuotes: 0, lostReason: null, proposal: null, hasOperations: false, hasPurchaseOrders: false, ...over,
  };
}
const petr = { by: { id: "u1", name: "Petr Obchodník" }, byName: null, at: "2026-10-23T08:00:00Z", via: "rucne" as const, kind: "user" as const };
function flowState(jobId: string, f: FlowFacts, stamps: Partial<FlowJobState["stamps"]> = {}): FlowJobState {
  const snapshot = deriveFlow(f, [], TODAY);
  const ctx = { can: (x: string) => access.features.has(x), userId: "u1", isSuperAdmin: false, assigneeId: f.assigneeId ?? null } as ActionCtx;
  return {
    jobId, facts: f, snapshot, quotes: [],
    stamps: { stage: null, inquiry: null, order: null, orderChange: null, confirmed: null, confirmationSent: null, lost: null, proposal: null, ...stamps },
    next: nextAction(f, snapshot, ctx), menu: menuActions(f, snapshot, ctx), canDecideProposal: false,
  };
}
const flowStates = (): Record<string, FlowJobState> => ({
  j1: flowState("j1", flowFacts({}), { inquiry: petr }),
  j2: flowState("j2", flowFacts({ stage: "naceneni", itemsPriced: 0 }), { inquiry: petr }),
  j4: flowState("j4", flowFacts({ stage: "objednavka", inquiryStatus: "zpracovana", orderStatus: "dorucena", orderRevision: 1 }), { order: petr }),
  j5: flowState("j5", flowFacts({ stage: "potvrzeno", inquiryStatus: "zpracovana", orderStatus: "potvrzena", orderRevision: 1, orderConfirmedRevision: 1, confirmationSentRevision: 1 }), { confirmed: petr }),
});
const VIEW_KEY = { inquiry: "inquiry", pricing: "pricing", order: "order", fulfilment: "fulfilment" } as const;
vi.mock("@/lib/data/flow-pages", () => ({
  getFlowJobStates: vi.fn(async (ids: string[]) => Object.fromEntries(Object.entries(flowStates()).filter(([id]) => ids.includes(id)))),
  listFlowStateJobIds: vi.fn(async (filter: { phase: keyof typeof VIEW_KEY; keys: string[] }[]) => {
    const out = new Set<string>();
    for (const [id, st] of Object.entries(flowStates())) {
      for (const f of filter) if (f.keys.includes(String(st.snapshot[VIEW_KEY[f.phase]]))) out.add(id);
    }
    return out;
  }),
  getFlowQuoteInfo: vi.fn(async () => ({})),
  getLatestOrderRevisions: vi.fn(async () => ({})),
  getFileFlowInfo: vi.fn(async () => ({
    f1: { origin: "generated", issuer: "my", orderRevision: null, uploaded: petr, archived: null },
  })),
}));
vi.mock("@/lib/data/flow-status", () => ({
  getFlowCounts: vi.fn(async () => ({ "inquiry.prijata": 2, "inquiry.v_reseni": 1, "pricing.ceka": 2, "quote.odeslana": 1, "quote.ke_schvaleni": 1, "order.dorucena": 1, "order.potvrzena": 1 })),
}));

type PageModule = { default: (...args: any[]) => Promise<React.ReactElement> };

async function page(mod: Promise<PageModule>, props?: unknown): Promise<string> {
  const { default: Page } = await mod;
  const el = await Page(props);
  return renderToString(el).replace(/<!-- -->/g, "");
}

// první import stránek (celý strom komponent) trvá pod zátěží i přes 5 s — načíst předem, ať test neuteče na timeout
beforeAll(async () => {
  await Promise.all([
    import("@/app/(app)/inquiries/page"), import("@/app/(app)/quotes/page"), import("@/app/(app)/confirmations/page"),
    import("@/app/(app)/documents/page"), import("@/app/(app)/pricing/page"),
  ]);
}, 120_000);

beforeEach(() => {
  access.features = new Set(["workflow", "documents", "orders", "mail", "margins"]);
  Object.assign(scopeState, { all: false, canToggle: false, who: "moje", error: false, mailboxEmails: [] });
});

describe("stránky obchodního toku — vykreslení", () => {
  it("Poptávky: hlavička, chipy stavů s počty, stav + autor, další krok Nacenit, pošta se Založit zakázku", async () => {
    access.features.add("pricing"); // #25: krok „Nacenit“ má jen super admin (pricing)
    const html = await page(import("@/app/(app)/inquiries/page"), { searchParams: Promise.resolve({}) });
    expect(html).toContain("Poptávky");
    expect(html).toContain("Otevřené poptávky");
    expect(html).toMatch(/aria-pressed="true"[^>]*>Otevřené<span[^>]*>3</);
    expect(html).toContain("V řešení · Petr Obchodník");
    expect(html).toContain('data-flow-state="inquiry.v_reseni"');
    expect(html).not.toContain("Stav zakázky:"); // korekce stavu jen v kartě zakázky
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('href="/orders?segment=poptavky&amp;stages=poptavka"');
    expect(html).toContain("Z-2026-101");
    expect(html).toContain('href="/pricing?job=j1"');
    expect(html).toContain("Popt. zák.");
    expect(html).toContain("Poptávky v poště");
    expect(html).toContain("Založit zakázku");
    expect(html).not.toContain("Objednávka PO-1"); // jiná kategorie
    expect(html).toContain("Nová poptávka");
    expect(html).toContain("Vyfotit poptávku");
  });

  it("Poptávky bez pošty: sekce pošty se nevykreslí", async () => {
    access.features.delete("mail");
    const html = await page(import("@/app/(app)/inquiries/page"), { searchParams: Promise.resolve({}) });
    expect(html).not.toContain("Poptávky v poště");
  });

  it("Nacenění: ruční ceny, marže jen s právem, AI sekce jen pro AI nacenění", async () => {
    let html = await page(import("@/app/(app)/pricing/page"), { searchParams: Promise.resolve({ job: "j2" }) });
    expect(html).toContain("Nacenění dělá člověk — AI se z tvých cen učí.");
    expect(html).toContain("Nákup / ks");
    expect(html).toContain("Marže");
    expect(html).toContain("Vytvořit nabídku z ceny");
    expect(html).toContain("Nacenil: <span");
    expect(html).toContain("Bez ceny"); // #25: chip pricing.ceka
    expect(html).toContain('aria-label="Stav nacenění"');
    expect(html).not.toContain("AI-PANEL");
    expect(html).not.toContain("AI návrh ceny");

    access.features.delete("margins");
    access.features.add("ai_pricing");
    access.features.add("settings");
    html = await page(import("@/app/(app)/pricing/page"), { searchParams: Promise.resolve({}) });
    expect(html).not.toContain("Nákup / ks");
    expect(html).toContain("AI návrh ceny (zatím jen pro ladění)");
    expect(html).toContain("AI-PANEL");
    expect(html).toContain("PARAMS-EDITOR");
  });

  it("Nabídky: chipy stavů (QUOTE_STATES), verze, kdo zadal / schválil, vypršelá platnost, PDF náhled", async () => {
    const html = await page(import("@/app/(app)/quotes/page"), { searchParams: Promise.resolve({}) });
    expect(html).toContain("NAB-2026-031");
    expect(html).toContain("verze 2");
    expect(html).toContain("Schváleno · S. Admin");
    expect(html).toContain("Zadáno · P. Obchodník");
    // #25: místo „zatím neschváleno“ výslovně, že ji nejde odeslat
    expect(html).toContain("čeká na schválení super admina — odeslat ji zatím nejde");
    expect(html).toContain("Vypršela platnost");
    expect(html).toContain('data-quote-state="vyprsela"');
    expect(html).toContain('href="/api/pdf/job/j3?type=nabidka&amp;quoteId=q1"');
    expect(html).toContain("Neschválená"); // #25: štítek stavu ke_schvaleni
    expect(html).toContain('aria-label="Stav nabídky"');
    expect(html).toContain("bez ceny");
    expect(html).not.toContain("Archivovaná"); // archiv je jen ve „Více“ (výchozí = otevřené)
    expect(html).not.toContain("AI-PANEL");
  });

  it("Potvrzení: akční seznam K potvrzení (Doručená + autor + Potvrdit objednávku), chip Potvrzené filtruje, pošta", async () => {
    let html = await page(import("@/app/(app)/confirmations/page"), { searchParams: Promise.resolve({}) });
    expect(html).toContain("Potvrzení objednávek");
    expect(html).toContain("K potvrzení");
    expect(html).toContain("Z-2026-104");
    expect(html).toContain("Obj. zák.");
    expect(html).toContain("Doručená · Petr Obchodník");
    expect(html).toContain("Potvrdit objednávku");
    expect(html).not.toContain("Z-2026-105"); // potvrzená není ve frontě
    expect(html).toContain("Objednávky v poště");
    expect(html).toContain("Otevřít zakázku Z-2026-104");

    html = await page(import("@/app/(app)/confirmations/page"), { searchParams: Promise.resolve({ stav: "potvrzena" }) });
    expect(html).toContain("Z-2026-105");
    expect(html).toContain("Potvrzená · Petr Obchodník");
    expect(html).toContain("Potvrzení odesláno");
    expect(html).not.toContain(">Z-2026-104<");
  });

  it("Dokumenty: filtry druhů s počty, náhled fotky, verze, vystavení dokladu, vzory", async () => {
    const html = await page(import("@/app/(app)/documents/page"));
    expect(html).toContain("Dokumenty");
    expect(html).toContain("Faktura FV-2026-001");
    expect(html).toContain('src="/api/jobs/files/f2"');
    expect(html).toContain(">v2<");
    expect(html).toContain('href="/api/jobs/files/f1?download=1"');
    expect(html).not.toContain("VK-2291.pdf"); // archivovaný je skrytý
    expect(html).toContain("Zobrazit archivované (1)");
    expect(html).toContain("Vystavit doklad ze zakázky");
    expect(html).toContain("Vystavit PDF");
    expect(html).toContain("Vzory dokladů");
    expect(html).toContain('href="/api/pdf/dodaci-list"');
    expect(html).toContain("náš doklad");
    expect(html).toContain("Vystaveno · P. Obchodník");
  });
});

describe("#25 role a viditelnost — stránky toku", () => {
  const plain = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

  it("Poptávky ne-admin: bez Nacenění (odkaz, krok proužku), „Vytvořit nabídku“ do editoru, poznámka „moje“ se schránkou", async () => {
    scopeState.mailboxEmails = ["obchod@mnastrojarna.test"];
    const html = await page(import("@/app/(app)/inquiries/page"), { searchParams: Promise.resolve({}) });
    expect(html).not.toContain('href="/pricing');
    expect(plain(html)).not.toContain("Nacenit");
    expect(html).toContain('href="/orders/j1?tab=nabidky&amp;nova=1"');
    expect(plain(html)).toContain("Vytvořit nabídku");
    expect(plain(html)).toContain("Pak Vytvoř nabídku v kartě zakázky — super admin ji schválí a ty ji odešleš.");
    expect(plain(html)).toContain(
      "Vidíš jen svoje: zakázky, kde jsi obchodník nebo je zpracováváš, které jsi založil(a), a vše, co přišlo do tvé schránky obchod@mnastrojarna.test. Všechny zakázky najdeš v Knize zakázek.",
    );
    // proužek toku bez kroku „Nacenění“
    expect(html).not.toMatch(/title="Nacenění:/);
    expect(html).not.toContain('aria-label="Koho zobrazit"');
  });

  it("chyba „moje“: text chyby místo „Žádná poptávka nečeká“", async () => {
    scopeState.error = true;
    data.listJobs.mockImplementationOnce(async () => []);
    const html = await page(import("@/app/(app)/inquiries/page"), { searchParams: Promise.resolve({}) });
    expect(plain(html)).toContain("Tvoje zakázky se nepodařilo načíst — obnov stránku.");
    expect(html).not.toContain("Žádná poptávka nečeká");
  });

  it("super admin: přepínač „Všichni / Jen moje“, krok Nacenění; Nabídky se sekcí „Ke schválení“", async () => {
    access.features = new Set(["workflow", "documents", "orders", "mail", "margins", "pricing", "quote_approval", "flow_all", "dashboard"]);
    Object.assign(scopeState, { all: true, canToggle: true, who: "vsichni" });
    let html = await page(import("@/app/(app)/inquiries/page"), { searchParams: Promise.resolve({}) });
    expect(html).toContain('aria-label="Koho zobrazit"');
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>.*?Všichni/);
    expect(html).toMatch(/title="Nacenění:/);
    expect(html).not.toContain("Zobrazuješ jen svoje");

    Object.assign(scopeState, { all: false, who: "moje" });
    html = await page(import("@/app/(app)/quotes/page"), { searchParams: Promise.resolve({}) });
    expect(plain(html)).toContain("Zobrazuješ jen svoje — přepnout na Všichni");
    expect(plain(html)).toContain("Ke schválení (2)");
    expect(plain(html)).toContain("Nabídky od kolegů a od AI. Bez schválení je nejde odeslat.");
    expect(plain(html)).toContain("připravil(a) Petr Obchodník");
    expect(plain(html)).toContain("bez ceny");
    expect(html).toContain('data-pending-quote="q7"');
    expect(html).toContain('href="/orders/j9?tab=nabidky"');
    // nabídka bez ceny: „Schválit“ zamčené
    expect(html).toMatch(/data-pending-quote="q8"[\s\S]*?disabled=""[^>]*title="Nabídku s položkou bez ceny nejde schválit/);
    expect(plain(html)).toContain("Vrátit…");
    // popis = stejné číslo jako sekce „Ke schválení (2)“ (ne flow_counts), shoda 2–4 „čekají“
    expect(plain(html)).toContain("2 čekají na tvé schválení");
    expect(plain(html)).not.toContain("1 čeká na tvé schválení");
    // „Schválit a odeslat“ přímo v řádku fronty jen u nabídky s cenou; bez ceny viditelný důvod
    expect(html).toMatch(/data-pending-quote="q7"[\s\S]*?Schválit a odeslat[\s\S]*?data-pending-quote="q8"/);
    expect(html.slice(html.indexOf('data-pending-quote="q8"'))).not.toMatch(/Schválit a odeslat[\s\S]*?Otevřít nabídku NAB-2026-041/);
    expect(plain(html)).toContain("bez ceny — nejde schválit, chybí cena");
    // super admin na tabuli: „čeká na tvé schválení“, ne „na schválení super admina“
    expect(plain(html)).toContain("čeká na tvé schválení — odeslat půjde po schválení");
    expect(plain(html)).not.toContain("čeká na schválení super admina — odeslat ji zatím nejde");
    expect(plain(html)).toContain("Nacenit poptávku");
  });
});
