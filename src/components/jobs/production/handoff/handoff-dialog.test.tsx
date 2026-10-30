import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Předání do výroby — vykreslení dialogu z hotového plánu (bez serveru): nejlevnější nabídka předvyplněná,
// kdo + termín povinné, mezitermín vs. konečný termín, objednávka (vystaví se / použije se), druhy dialogu,
// bez práva na ceny žádné „Kč", výsledek předání.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/orders/j1",
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) => (open ? <div data-dialog>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogPortal: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogOverlay: () => null,
}));
vi.mock("@/app/actions/production-handoff", () => ({
  prepareProductionHandoff: vi.fn(), submitProductionHandoff: vi.fn(), ensureHandoffDocuments: vi.fn(), sendStepPurchaseOrder: vi.fn(),
  reissueStepPurchaseOrder: vi.fn(),
}));
vi.mock("@/app/actions/flow-status", () => ({ moveJobStage: vi.fn() }));
vi.mock("@/app/actions/technology", () => ({ saveItemTechnology: vi.fn(), setJobCompleteDelivery: vi.fn() }));
vi.mock("@/app/actions/production", () => ({ addJobOperations: vi.fn(), updateJobOperation: vi.fn() }));

import { ProductionHandoffDialog } from "./handoff-dialog";
import { HandoffResultView, resultLine } from "./handoff-result";
import {
  applyPhoneQuote, canSubmit, inputFromState, issuesOf, itemNoteOf, itemNotePatches, plainMoveOf, setStepWho, stateFromPlan, stepItems, stepLabels,
  suggestionLine, addStep, poLineOf, coverHintOf, overlapWarning, setStepKind, undoTargetOf,
} from "./handoff-model";
import { HandoffStepCard } from "./handoff-step-card";
import { coveredHint } from "@/lib/jobs/production-suggest";
import type { HandoffPlan, StepPlan, WhoSuggestion } from "@/lib/jobs/production-handoff-types";

const NOVAK = "11111111-1111-4111-8111-111111111111";
const HRUBY = "22222222-2222-4222-8222-222222222222";
const TEPKAL = "33333333-3333-4333-8333-333333333333";
const I1 = "44444444-4444-4444-8444-444444444444";
const I2 = "55555555-5555-4555-8555-555555555555";

function sug(over: Partial<WhoSuggestion>): WhoSuggestion {
  return {
    source: "nejlevnejsi_nabidka", who: { type: "supplier", id: NOVAK, name: "Frézy Novák s.r.o." }, supplierQuoteId: "q1", quoteNumber: "NAB-1",
    purchaseOrder: null, price: 12_200, currency: "CZK", priceBasis: "celkem", diffToBest: null, leadTimeDays: 21, deliveryDate: "2026-11-13",
    coverage: { matched: 2, total: 2, uncovered: [] }, expired: false, quantityMismatch: false, badges: ["nejlevnejsi"], reason: "Nejlevnější nabídka", ...over,
  };
}

function step(over: Partial<StepPlan>): StepPlan {
  return {
    key: "s1", operationId: null, kind: "vyroba", title: null, who: { type: "supplier", id: NOVAK, name: "Frézy Novák s.r.o." },
    plannedEnd: "2026-11-13", endsAtCustomerDate: false, deadlineAgreed: false, deadlineSource: "nabidka_dodavatele", whoSource: "nejlevnejsi_nabidka",
    supplierQuoteId: "q1", orderItemIds: null, start: true, po: { mode: "vystavit" }, note: null, status: null, locked: "none", label: "Výroba 1",
    performerRole: "částečný dodavatel",
    suggestions: {
      primary: sug({}),
      alternatives: [sug({
        source: "nabidka", who: { type: "supplier", id: HRUBY, name: "Kovoobrábění Hrubý s.r.o." }, supplierQuoteId: "q2", price: 13_400, diffToBest: 1_200,
        badges: ["vybrana"], reason: "Vybraná v Nákupu (P. Obchodník, 20. 10.) · o 1 200 Kč dražší", deliveryDate: "2026-11-10",
      })],
    },
    deadlineCaption: "z nabídky (3 týdny)", deadlineState: "odhad",
    poPreview: { supplierName: "Frézy Novák s.r.o.", itemCount: 2, unpriced: 0, total: 12_200, currency: "CZK", items: [], existing: null, blockers: [] },
    ...over,
  };
}

function plan(over: Partial<HandoffPlan> = {}, margins = true): HandoffPlan {
  const heat = step({
    key: "s2", kind: "tepelne_zpracovani", label: "Tepelné zpracování", who: { type: "supplier", id: TEPKAL, name: "TepKal s.r.o." }, plannedEnd: "2026-11-19",
    supplierQuoteId: "q3", orderItemIds: [I1], start: false, po: { mode: "pri_predani" }, poPreview: null, deadlineCaption: "z nabídky (5 dní) + 1 den doprava",
    suggestions: { primary: sug({ who: { type: "supplier", id: TEPKAL, name: "TepKal s.r.o." }, supplierQuoteId: "q3", price: 2_100, leadTimeDays: 5 }), alternatives: [] },
  });
  const p: HandoffPlan = {
    token: "66666666-6666-4666-8666-666666666666", routeVersion: "v1", jobId: "j1", jobNumber: "Z-2026-104", customerName: "Strojírny Hradec",
    kind: "predani", stage: "potvrzeno", target: null,
    permissions: { canSeePrices: margins, canConfirmCustomerDate: margins, canReceive: margins, canSend: margins, canCancelSent: margins },
    finalDate: { date: "2026-11-20", source: "due_date", maxTolerated: "2026-11-25" },
    doneSteps: [], current: null, steps: [step({}), heat],
    routes: [
      { key: "rodiny", label: "Frézy Novák + TepKal", total: margins ? 14_300 : null, complete: true, selected: true },
      { key: "komplet:q9", label: "kompletně u Hrubý", total: margins ? 15_000 : null, complete: true, selected: false },
    ],
    routeSource: "nabidky", openPurchaseOrders: [],
    automation: { mode: "approval", sendDefault: false, senderEmail: margins ? "obchod@mnastrojarna.cz" : null, reason: margins ? null : "Objednávku odešle obchodník nebo admin (čeká ve frontě ke schválení)." },
    pendingCapturedQuotes: 0, issues: [],
    client: {
      today: "2026-10-24",
      suppliers: [
        { id: NOVAK, name: "Frézy Novák s.r.o.", email: "obchod@frezy-novak.cz", leadDays: null },
        { id: HRUBY, name: "Kovoobrábění Hrubý s.r.o.", email: "hruby@example.cz", leadDays: 10 },
        { id: TEPKAL, name: "TepKal s.r.o.", email: "kalirna@tepkal.cz", leadDays: 5 },
      ],
      items: [
        { id: I1, drawingNumber: "PR-7075-20", name: "Příruba", quantity: 200, unit: "ks", heatTreatment: "kalit 58–60 HRC", surfaceTreatment: null },
        { id: I2, drawingNumber: "PR-7075-21", name: "Pouzdro", quantity: 100, unit: "ks", heatTreatment: null, surfaceTreatment: null },
      ],
      otherSteps: [], openPurchaseOrders: [], previousEnd: null, kindSuggestions: {}, routeChips: ["+ Tepelné zpracování (výkres: kalit 58–60 HRC)"],
      remaining: [], undoHandoffId: null,
    },
    ...over,
  };
  if (!margins) {
    p.steps = p.steps.map((s) => ({
      ...s,
      suggestions: {
        primary: s.suggestions.primary ? { ...s.suggestions.primary, price: null, diffToBest: null, reason: "Doporučeno podle nabídek" } : null,
        alternatives: s.suggestions.alternatives.map((a) => ({ ...a, price: null, diffToBest: null, reason: a.reason.replace(/ · o .*dražší$/, "") })),
      },
      poPreview: s.poPreview ? { ...s.poPreview, total: null } : null,
    }));
  }
  return p;
}

const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");
/** Značka tlačítka „Předat do výroby" (atributy v libovolném pořadí). */
const submitTag = (h: string) => /<button[^>]*data-testid="handoff-submit"[^>]*>/.exec(h)?.[0] ?? "";
const dialog = (p: HandoffPlan, props: Partial<React.ComponentProps<typeof ProductionHandoffDialog>> = {}) =>
  html(<ProductionHandoffDialog open onOpenChange={() => {}} jobId="j1" initialPlan={p} {...props} />);

describe("ProductionHandoffDialog — předání do výroby", () => {
  it("obchodník: nejlevnější nabídka s cenou a termínem předvyplněná, kdo + termín povinné, mezitermín, objednávka", () => {
    const h = dialog(plan());
    expect(h).toContain("Předat do výroby");
    expect(h).toContain("Z-2026-104 · Strojírny Hradec — komu to zadáváš a do kdy.");
    expect(h).toContain("Nejlevnější nabídka: Frézy Novák s.r.o. — 12 200 Kč, termín 3 týdny");
    expect(h).toContain("✓ vybráno");
    expect(h).toContain("Předvyplnila AI");
    expect(h).toContain("Kdo to dělá *");
    expect(h).toContain("Termín kroku *");
    expect(h).toContain("Mezitermín · odhad — zatím nedohodnuto");
    expect(h).toContain("Termín mám dohodnutý s Frézy Novák s.r.o.");
    expect(h).toContain("Konečný termín (zákazník) 20. 11. 2026 — dohodnuto se zákazníkem · max. tolerovaný 25. 11.");
    expect(h).toContain("Nejlevnější postup: Frézy Novák + TepKal 14 300 Kč (kompletně u Hrubý 15 000 Kč)");
    expect(h).toContain("Použít: kompletně u Hrubý");
    expect(h).toContain("Vytvoří se objednávka OV-… pro Frézy Novák s.r.o. (PDF)");
    expect(h).toContain("2 položky · 12 200 Kč · požadovaný termín 13. 11.");
    // druhý krok sbalený: kalírna jen díl s kalením, objednávka až při předání kroku
    expect(h).toContain("Krok 2/2 · Tepelné zpracování");
    expect(h).toContain("Objednávka se vystaví, až díl půjde do tohoto kroku");
    expect(h).toContain("Díly: 1 ze 2 (PR-7075-20)");
    expect(h).toContain("Rovnou odeslat dodavateli (obchod@frezy-novak.cz)");
    expect(h).toContain("Odešle se z: obchod@mnastrojarna.cz");
    // souhrn u tlačítka: kdo a do kdy (na mobilu je karta kroku pod okrajem obrazovky)
    expect(h).toContain("Krok 1: Frézy Novák s.r.o. · do 13. 11. · 2 kroky · 1 objednávka");
    expect(h).toContain("Poznámka k předání (nepovinné)");
    expect(submitTag(h)).not.toContain(`disabled=""`);
  });

  it("zaměstnanec: žádné „Kč“, „Doporučeno podle nabídek“, bez odeslání (odešle obchodník nebo admin)", () => {
    const h = dialog(plan({}, false));
    expect(h).not.toContain("Kč");
    expect(h).toContain("Doporučeno podle nabídek: Frézy Novák s.r.o. — termín 3 týdny");
    expect(h).toContain("Doporučený postup podle nabídek: Frézy Novák + TepKal");
    expect(h).not.toContain("Rovnou odeslat dodavateli");
    expect(h).toContain("Objednávku odešle obchodník nebo admin");
    expect(h).toContain("Vytvoří se objednávka OV-… pro Frézy Novák s.r.o. (PDF)");
  });

  it("bez kdo u kroku, který teď začíná → tlačítko vypnuté a chyba „vyber, kdo to dělá“", () => {
    const p = plan({ steps: [step({ who: { type: "none" }, whoSource: undefined, suggestions: { primary: null, alternatives: [] }, poPreview: null })] });
    const h = dialog(p);
    expect(h).toContain("K tomuto kroku nemáme nabídku — vyber firmu, nebo „U nás“.");
    expect(submitTag(h)).toContain(`disabled=""`);
    const state = stateFromPlan(p);
    const issues = issuesOf(p, state);
    expect(issues.some((i) => i.code === "who_missing")).toBe(true);
    expect(canSubmit(p, state, issues)).toBe(false);
  });

  it("vystavená objednávka z Nákupu se použije (žádná druhá); konečný termín na posledním kroku", () => {
    const p = plan({
      steps: [step({
        po: { mode: "existujici", existingId: "po1" }, whoSource: "objednavka", endsAtCustomerDate: true, plannedEnd: "2026-11-20",
        suggestions: { primary: sug({ source: "objednavka", purchaseOrder: { id: "po1", number: "OV-2026-012", status: "vystavena" }, reason: "Použije se vystavená objednávka OV-2026-012 (Frézy Novák s.r.o., vystavená)" }), alternatives: [] },
        poPreview: { supplierName: "Frézy Novák s.r.o.", itemCount: 2, unpriced: 0, total: 12_200, currency: "CZK", items: [], existing: { id: "po1", number: "OV-2026-012", status: "vystavena" }, blockers: [] },
      })],
      openPurchaseOrders: [{ id: "po1", number: "OV-2026-012", supplierName: "Frézy Novák s.r.o.", status: "vystavena" }],
    });
    const h = dialog(p);
    expect(h).toContain("Použije se vystavená objednávka OV-2026-012");
    expect(h).toContain("Ne, vystavit novou objednávku");
    expect(h).toContain("Konečný termín (zákazník) 20. 11. — dohodnuto se zákazníkem");
    expect(h).toContain("Tento krok končí konečným termínem (zákazník) 20. 11.");
    const input = inputFromState(p, stateFromPlan(p));
    expect(input.steps[0].po).toMatchObject({ mode: "existujici", existingId: "po1" });
    expect(JSON.stringify(input)).not.toMatch(/12200|price/);
  });

  it("varování: postup končí po konečném termínu → „Vím o tom“ je povinné", () => {
    const p = plan();
    let s = stateFromPlan(p);
    s = { ...s, steps: s.steps.map((x, i) => (i === 1 ? { ...x, plannedEnd: "2026-11-24" } : x)) };
    const issues = issuesOf(p, s);
    expect(issues.some((i) => i.code === "last_after_final" && i.acceptLate)).toBe(true);
    expect(canSubmit(p, s, issues)).toBe(false);
    expect(canSubmit(p, { ...s, acceptLate: true })).toBe(true);
  });

  it("výběr jiné nabídky → kdo + zdroj + nabídka; přidaný krok předvyplní nejlevnější firmu k druhu", () => {
    const p = plan();
    p.client!.kindSuggestions = { brouseni: { orderItemIds: null, primary: sug({ who: { type: "supplier", id: HRUBY, name: "Kovoobrábění Hrubý s.r.o." }, supplierQuoteId: "q7", leadTimeDays: 7 }), alternatives: [] } };
    let s = stateFromPlan(p);
    const alt = p.steps[0].suggestions.alternatives[0];
    s = setStepWho(p, s, 0, alt.who, alt);
    expect(s.steps[0]).toMatchObject({ whoSource: "nabidka", supplierQuoteId: "q2" });
    s = addStep(p, s, "brouseni");
    expect(s.steps).toHaveLength(3);
    expect(s.steps[2]).toMatchObject({ kind: "brouseni", who: { type: "supplier", id: HRUBY }, po: { mode: "pri_predani" } });
    expect(s.steps[2].plannedEnd >= s.steps[1].plannedEnd).toBe(true);
    expect(suggestionLine(p.steps[0].suggestions.primary!, { canSeePrices: true })).toBe("Nejlevnější nabídka: Frézy Novák s.r.o. — 12 200 Kč, termín 3 týdny (do 13. 11.)");
  });

  it("druhy: Posunout dál / Předat do kroku / Doplnit / Zapsat výrobu / Vrátit / Ukončit", () => {
    const running = { id: "op1", label: "Výroba 1", location: "Frézy Novák s.r.o.", status: "probiha" as const, purchaseOrder: { id: "po1", number: "OV-2026-012", status: "odeslana" as const, items: [{ id: "it1", label: "PR-7075-20", quantity: 200, received: 0, unit: "ks" }, { id: "it2", label: "PR-7075-21", quantity: 100, received: 0, unit: "ks" }] } };
    const next = plan({ kind: "dalsi_krok", stage: "ve_vyrobe", current: running, steps: [plan().steps[1]] });
    const a = dialog(next);
    expect(a).toContain("Posunout dál");
    expect(a).toContain("Výroba 1 u Frézy Novák s.r.o. — kam díl jde dál?");
    expect(a).toContain("Další krok: Tepelné zpracování · TepKal s.r.o. · mezitermín 19. 11.");
    expect(a).toContain("Jiný další krok…");
    expect(a).toContain("Ukončit výrobu");
    expect(a).toContain("Převzato od Frézy Novák s.r.o.");
    expect(a).toContain("Předat dalšímu kroku");
    const b = dialog(plan({ kind: "dalsi_krok", stage: "ve_vyrobe", current: null }));
    expect(b).toContain("Předat do kroku");
    const c = dialog(plan({ kind: "doplneni", stage: "ve_vyrobe" }));
    expect(c).toContain("Doplnit předání do výroby");
    expect(c).toContain("Zakázka je ve výrobě, ale chybí, kdo to dělá a termín.");
    expect(c).toContain("Uložit předání");
    const d = dialog(plan({ kind: "zaznam", stage: "potvrzeno", steps: [step({ done: true, start: false, po: { mode: "neobjednavat", noneReason: "Zapsáno zpětně" } })] }), { target: "dodano_k_nam" });
    expect(d).toContain("Zapsat výrobu");
    expect(d).toContain("Kdo to vyrobil? *");
    expect(d).toContain("Hotovo dne *");
    expect(d).toContain("Bez výroby (ze skladu / hotový díl) — důvod *");
    const e = dialog(plan({ kind: "zpet", stage: "ve_vyrobe", steps: [] }));
    expect(e).toContain("Vrátit předání do výroby");
    const f = dialog(plan({
      kind: "ukonceni", stage: "ve_vyrobe", current: running, steps: [],
      client: { ...plan().client!, remaining: [{ id: "op2", label: "Tepelné zpracování", location: "TepKal s.r.o.", purchaseOrder: { id: "po2", number: "OV-2026-013", status: "odeslana" } }] },
    }));
    expect(f).toContain("Ukončit výrobu");
    expect(f).toContain("Díly jsou u nás — připravit k expedici");
    expect(f).toContain("Zbývající kroky (1) se přeskočí");
    expect(f).toContain("Proč končíš dřív? *");
    expect(f).toContain("Zrušit i odeslanou objednávku OV-2026-013?");
    // dokud uživatel na nic nesáhl, červená chyba „Napiš, proč končíš…“ nesvítí (pole je označené „*“, tlačítko šedé)
    expect(f).not.toContain("Napiš, proč končíš výrobu dřív");
    expect(submitTag(f)).toContain(`disabled=""`);
  });

  it("nehlídá (majitel 29. 10.): vždy jde „Přesunout bez dodavatele a termínu“ — i když kdo chybí", () => {
    const p = plan({ steps: [step({ who: { type: "none" }, whoSource: undefined, suggestions: { primary: null, alternatives: [] }, poPreview: null })] });
    const h = dialog(p);
    expect(submitTag(h)).toContain(`disabled=""`);
    expect(h).toContain("Přesunout bez dodavatele a termínu");
    expect(/<button[^>]*data-testid="handoff-plain-move"[^>]*>/.exec(h)?.[0]).not.toContain(`disabled=""`);
    // doplnění / další krok stav nemění → bez přesunu
    expect(dialog(plan({ kind: "doplneni", stage: "ve_vyrobe" }))).not.toContain("Přesunout bez");
    expect(plainMoveOf("predani", { stage: "potvrzeno" })).toMatchObject({ to: "ve_vyrobe", label: "Přesunout bez dodavatele a termínu" });
    expect(plainMoveOf("predani", { stage: "ve_vyrobe" })).toBeNull();
    expect(plainMoveOf("ukonceni", { target: "na_sklade" })).toMatchObject({ to: "na_sklade" });
    expect(plainMoveOf("zpet", { target: "potvrzeno" })).toMatchObject({ to: "potvrzeno" });
    expect(plainMoveOf("dalsi_krok", { stage: "ve_vyrobe" })).toBeNull();
  });

  it("poznámky pro dodavatele k dílům kroku (z Technologie) jdou upravit; změněné se uloží k položce", () => {
    const p = plan();
    p.client!.items[0] = { ...p.client!.items[0], supplierNote: "pozor popsat na čele" };
    const h = dialog(p);
    expect(h).toContain("Poznámky pro dodavatele");
    expect(h).toContain("pozor popsat na čele");
    let s = stateFromPlan(p);
    expect(itemNoteOf(p, s, I1)).toBe("pozor popsat na čele");
    expect(itemNotePatches(p, s)).toEqual([]);
    s = { ...s, itemNotes: { [I1]: "pozor popsat na čele", [I2]: "  změna materiálu na 1.4301 " } };
    expect(itemNotePatches(p, s)).toEqual([{ itemId: I2, supplierNote: "změna materiálu na 1.4301" }]);
    expect(stepItems(p, s.steps[1]).map((i) => i.id)).toEqual([I1]);
  });

  it("nabídka telefonem: tlačítko u kdo; zapsaná nabídka se vybere (kdo, nabídka, termín z nabídky)", () => {
    const p = plan();
    expect(dialog(p)).toContain("Nabídka telefonem…");
    const phone = sug({
      source: "nabidka", who: { type: "supplier", id: HRUBY, name: "Kovoobrábění Hrubý s.r.o." }, supplierQuoteId: "q-tel", quoteNumber: null,
      price: 11_000, leadTimeDays: 10, deliveryDate: null, badges: [], reason: "Nabídka telefonem",
    });
    const s = applyPhoneQuote(p, stateFromPlan(p), 0, phone);
    expect(s.steps[0]).toMatchObject({ who: { type: "supplier", id: HRUBY }, supplierQuoteId: "q-tel", whoSource: "nabidka" });
    expect(s.steps[0].suggestions.alternatives[0].reason).toBe("Nabídka telefonem");
    expect(s.steps[0].plannedEnd).toBe("2026-11-03"); // 24. 10. + 10 dní
    const h = html(<ProductionHandoffDialog open onOpenChange={() => {}} jobId="j1" initialPlan={{ ...p, steps: [{ ...p.steps[0], who: phone.who, supplierQuoteId: "q-tel", whoSource: "nabidka", suggestions: { primary: p.steps[0].suggestions.primary, alternatives: [phone] } }] }} />);
    expect(h).toContain("Kovoobrábění Hrubý s.r.o. — 11 000 Kč, termín 10 dní");
    expect(h).toContain("Nabídka telefonem");
  });

  it("tři kroky (Výroba 1 → Tepelné zpracování → Výroba 2), každý se svým termínem", () => {
    const p = plan();
    let s = stateFromPlan(p);
    s = addStep(p, s, "vyroba");
    const labels = stepLabels(p, s.steps);
    expect(labels).toEqual(["Výroba 1", "Tepelné zpracování", "Výroba 2"]);
    expect(s.steps[2].plannedEnd >= s.steps[1].plannedEnd).toBe(true);
  });

  it("review: přidaná „Výroba 2“ nepřevezme nabídku Výroby 1 (cena by byla dvakrát) — stejná firma bez ceny jen jako volba, jinak další volná nabídka", () => {
    const novak = sug({});
    const hruby = sug({ source: "nabidka", who: { type: "supplier", id: HRUBY, name: "Kovoobrábění Hrubý s.r.o." }, supplierQuoteId: "q2", price: 13_400, reason: "Další nabídka" });
    const p = plan({ client: { ...plan().client!, kindSuggestions: { vyroba: { orderItemIds: null, primary: novak, alternatives: [] } } } });
    let s = addStep(p, stateFromPlan(p), "vyroba");
    // další výroba: nic se nepředvyplní (kdo prázdný), stejná firma bez ceny je jedna volba
    expect(s.steps[2]).toMatchObject({ who: { type: "none" }, supplierQuoteId: null });
    expect(s.steps[2].suggestions.primary).toBeNull();
    const same = s.steps[2].suggestions.alternatives.find((a) => a.who.type === "supplier" && a.who.id === NOVAK);
    expect(same).toMatchObject({ supplierQuoteId: null, price: null, reason: "Stejná firma jako krok 1 — cena dle nové nabídky" });
    // vybraná stejná firma = objednávka bez ceny (žádných 12 200 Kč podruhé)
    s = setStepWho(p, s, 2, same!.who, same);
    s = { ...s, steps: s.steps.map((x, i) => (i === 2 ? { ...x, po: { ...x.po, orderNow: true } } : x)) };
    expect(s.steps[2]).toMatchObject({ who: { type: "supplier", id: NOVAK }, supplierQuoteId: null, whoSource: "posledni_operace" });
    expect(poLineOf(p, s, 2)).toMatchObject({ mode: "new", total: null, unpriced: 2 });
    // volná nabídka jiné firmy vyhraje
    const p2 = plan({ client: { ...plan().client!, kindSuggestions: { vyroba: { orderItemIds: null, primary: novak, alternatives: [hruby] } } } });
    const s2 = addStep(p2, stateFromPlan(p2), "vyroba");
    expect(s2.steps[2]).toMatchObject({ who: { type: "supplier", id: HRUBY }, supplierQuoteId: "q2" });
    expect(s2.steps[2].suggestions.alternatives.some((a) => a.who.type === "supplier" && a.who.id === NOVAK && a.supplierQuoteId === null)).toBe(true);
  });

  it("review: náhled objednávky = položky objednávky (nabídka telefonem s cenou celkem za víc dílů neslíbí částku)", () => {
    const p = plan();
    const phone = sug({
      source: "nabidka", who: { type: "supplier", id: HRUBY, name: "Kovoobrábění Hrubý s.r.o." }, supplierQuoteId: "q-tel", price: 9_800,
      reason: "Nabídka telefonem", order: { itemCount: 2, unpriced: 2, total: null },
    });
    const s = applyPhoneQuote(p, stateFromPlan(p), 0, phone);
    expect(poLineOf(p, s, 0)).toMatchObject({ mode: "new", itemCount: 2, unpriced: 2, total: null });
    const ok = applyPhoneQuote(p, stateFromPlan(p), 0, { ...phone, order: { itemCount: 2, unpriced: 0, total: 9_800 } });
    expect(poLineOf(p, ok, 0)).toMatchObject({ unpriced: 0, total: 9_800 });
  });

  it("review: vrácení předání má jednu volbu „jen přesunout stav“ (odkaz v patičce), ne druhé zaškrtávátko s prázdným důvodem", () => {
    const running = { id: "op1", label: "Výroba 1", location: "Frézy Novák s.r.o.", status: "probiha" as const, purchaseOrder: null };
    const h = dialog(plan({ kind: "zpet", stage: "ve_vyrobe", current: running, steps: [], client: { ...plan().client!, undoHandoffId: "h1" } }), { target: "potvrzeno" });
    expect(h).toContain("Jen přesunout stav na „Potvrzená objednávka“ (kroky a objednávky zůstanou)");
    expect(h).not.toContain("Jen opravit stav");
    expect(h.match(/data-testid="handoff-plain-move"/g)).toHaveLength(1);
  });

  it("review: na mobilu je kdo a termín u tlačítka; „Rovnou odeslat“ pod kroky (patička nízká)", () => {
    const h = dialog(plan());
    expect(h).toContain("Krok 1: Frézy Novák s.r.o. · do 13. 11.");
    expect(h.match(/data-testid="handoff-send-now"/g)).toHaveLength(2); // pod kroky (mobil) + patička (desktop)
    expect(h).toMatch(/class="[^"]*sm:hidden[^"]*"[^>]*><label[^>]*data-testid="handoff-send-now"/);
  });

  it("výsledek: PDF ✓ + odesláno / čeká na odeslání [Odeslat dodavateli] / PDF se nepodařilo — Zkusit znovu", () => {
    const res = {
      handoffId: "h1", replayed: false, kind: "predani" as const, stage: "ve_vyrobe" as const, operationIds: [], startedOperationId: null, completedOperationId: null,
      purchaseOrders: [
        { id: "p1", number: "OV-2026-012", supplierName: "Frézy Novák s.r.o.", fileId: "f1", pdf: "ok" as const, send: "odeslano" as const, queueId: "q1" },
        { id: "p2", number: "OV-2026-013", supplierName: "TepKal s.r.o.", fileId: "f2", pdf: "ok" as const, send: "ceka_na_schvaleni" as const, queueId: "q2" },
        { id: "p3", number: "OV-2026-014", supplierName: "Kalírna XY", fileId: null, pdf: "chyba" as const, send: "ceka_na_schvaleni" as const, queueId: "q3" },
      ],
      issues: [],
    };
    const h = html(<HandoffResultView jobId="j1" kind="predani" result={res} canSend senderEmail="obchod@mnastrojarna.cz" onClose={() => {}} />);
    expect(h).toContain("Předáno do výroby ✓");
    expect(h).toContain("OV-2026-012 · Frézy Novák s.r.o. · PDF ✓ · odesláno z obchod@mnastrojarna.cz");
    expect(h).toContain("OV-2026-013 · TepKal s.r.o. · PDF ✓ · čeká na odeslání");
    expect(h).toContain("Odeslat dodavateli");
    expect(h).toContain("Otevřít PDF");
    expect(h).toContain("OV-2026-014 · Kalírna XY · PDF se nepodařilo vytvořit");
    expect(h).toContain("Zkusit znovu");
    const w = html(<HandoffResultView jobId="j1" kind="predani" result={res} canSend={false} senderEmail={null} onClose={() => {}} />);
    expect(w).toContain("Odešle obchodník nebo admin");
    expect(w).not.toContain("Otevřít PDF");
    expect(resultLine(res.purchaseOrders[1], null)).toBe("OV-2026-013 · TepKal s.r.o. · PDF ✓ · čeká na odeslání");
  });
});

describe("follow-up WP3: další výroba, vrácení předání, mobil", () => {
  // Hrubý: nabídka na kompletní dodávku (celá zakázka, 15 000 Kč) — bez pravidla by byla „Jediná nabídka“ i pro Výrobu 2
  const komplet = sug({
    source: "nejlevnejsi_nabidka", who: { type: "supplier", id: HRUBY, name: "Kovoobrábění Hrubý s.r.o." }, supplierQuoteId: "qK", quoteNumber: "NAB-K",
    price: 15_000, reason: "Jediná nabídka", badges: ["nejlevnejsi"],
  });
  const sameNovak = sug({
    source: "posledni_operace", supplierQuoteId: null, quoteNumber: null, price: null, badges: [], order: null,
    reason: "Stejná firma jako jiný krok — cena dle nové nabídky",
  });
  const quotes = [
    { id: "q1", number: "NAB-1", supplierId: NOVAK, supplierName: "Frézy Novák s.r.o.", complete: false, itemIds: null, usedBy: null, usedByOpId: null },
    { id: "qK", number: "NAB-K", supplierId: HRUBY, supplierName: "Kovoobrábění Hrubý s.r.o.", complete: true, itemIds: null, usedBy: null, usedByOpId: null },
  ];
  const withKomplet = (margins: boolean, covered = true) => plan({
    client: {
      ...plan({}, margins).client!, quotes,
      kindSuggestions: {
        vyroba: {
          orderItemIds: null, primary: komplet, alternatives: [],
          ...(covered ? { covered: { primary: null, alternatives: [sameNovak] } } : {}),
        },
      },
    },
  }, margins);

  for (const margins of [true, false]) {
    it(`krok 1 z nabídky Nováka + „Výroba 2“: kompletní dodávka Hrubý se nepředvyplní, kdo prázdný s nápovědou (${margins ? "obchodník" : "zaměstnanec"})`, () => {
      const p = withKomplet(margins);
      const s = addStep(p, stateFromPlan(p), "vyroba");
      expect(s.steps[2]).toMatchObject({ who: { type: "none" }, supplierQuoteId: null });
      expect(s.steps[2].suggestions.primary).toBeNull();
      expect([s.steps[2].suggestions.primary, ...s.steps[2].suggestions.alternatives].some((x) => x?.supplierQuoteId === "qK")).toBe(false);
      expect(coverHintOf(p, s, 2)).toBe(coveredHint("krok 1 (Výroba 1)"));
      const card = html(<HandoffStepCard plan={p} state={s} index={2} label="Výroba 2" expanded onExpand={() => {}} onChange={() => {}} />);
      expect(card).toContain("Díly už dělá krok 1 (Výroba 1) — kompletní dodávka se tu znovu nenabízí");
      expect(card).not.toContain("Jediná nabídka");
      expect(card).not.toContain("nejlevnější");
      expect(card).not.toContain("15 000");
      expect(card).toContain("Stejná firma jako jiný krok");      // volba jedním ťuknutím, ne předvyplněná
    });
  }

  it("pojistka bez serverové varianty: nabídka označená jako kompletní dodávka se pro další výrobu vyřadí i v dialogu", () => {
    const p = withKomplet(true, false);
    const s = addStep(p, stateFromPlan(p), "vyroba");
    expect(s.steps[2].who).toEqual({ type: "none" });
    expect(s.steps[2].suggestions.alternatives.some((x) => x.supplierQuoteId === "qK")).toBe(false);
  });

  it("první krok (nic nekryje) kompletní dodávku dál dostane — „Výroba“ na prázdném postupu", () => {
    const p = withKomplet(true);
    const empty = { ...stateFromPlan(p), steps: [] };
    const s = addStep(p, empty, "vyroba");
    expect(s.steps[0]).toMatchObject({ who: { type: "supplier", id: HRUBY }, supplierQuoteId: "qK" });
  });

  it("změna druhu kroku na obrábění u další výroby: firma z kompletní dodávky nezůstane předvyplněná", () => {
    const p = withKomplet(true);
    let s = stateFromPlan(p);
    // krok 2 (kalírna, z návrhu) → přepnout na Výrobu
    s = setStepKind(p, s, 1, "vyroba");
    expect(s.steps[1]).toMatchObject({ kind: "vyroba", who: { type: "none" }, supplierQuoteId: null });
  });

  it("varování: firma kroku má nabídku, která už kryje díly jiného kroku (komplet / nabídka kroku 1) — bez cen", () => {
    const p = withKomplet(false);
    let s = addStep(p, stateFromPlan(p), "vyroba");
    expect(overlapWarning(p, s, 2)).toBeNull();
    // ručně Hrubý (má kompletní dodávku)
    s = setStepWho(p, s, 2, { type: "supplier", id: HRUBY, name: "Kovoobrábění Hrubý s.r.o." });
    expect(overlapWarning(p, s, 2)).toBe("Pozor: Kovoobrábění Hrubý s.r.o. má nabídku na kompletní dodávku NAB-K — díly dělá i krok 1 (Výroba 1). Obrábění by se objednalo dvakrát.");
    const card = html(<HandoffStepCard plan={p} state={s} index={2} label="Výroba 2" expanded onExpand={() => {}} onChange={() => {}} />);
    expect(card).toContain('data-testid="handoff-overlap-warning"');
    expect(card).not.toContain("Kč");
    // stejná firma jako krok 1 (její nabídku má krok 1)
    s = setStepWho(p, s, 2, { type: "supplier", id: NOVAK, name: "Frézy Novák s.r.o." });
    expect(overlapWarning(p, s, 2)).toBe("Pozor: nabídku Frézy Novák s.r.o. NAB-1 už má krok 1 (Výroba 1) — tady se díly objednají znovu (cena dle nové nabídky).");
    // krok 1 sám sebe nevaruje (jeho vlastní nabídka), kalírna se neřeší
    expect(overlapWarning(p, s, 0)).toBeNull();
    expect(overlapWarning(p, s, 1)).toBeNull();
  });

  it("Vrátit předání: cíl = stav před předáním (pozastaveno / objednávka / reklamace), ne vždy Potvrzená", () => {
    const running = { id: "op1", label: "Výroba 1", location: "Frézy Novák s.r.o.", status: "probiha" as const, purchaseOrder: null };
    for (const [stage, label] of [["pozastaveno", "Pozastaveno"], ["objednavka", "Objednávka"], ["reklamace", "Reklamace"]] as const) {
      const p = plan({ kind: "zpet", stage: "ve_vyrobe", current: running, steps: [], client: { ...plan().client!, undoHandoffId: "h1", undoStage: stage } });
      expect(undoTargetOf(p, null)).toBe(stage);
      const h = dialog(p);    // z menu postupu / akce toku — bez cíle
      expect(h).toContain(`Jen přesunout stav na „${label}“ (kroky a objednávky zůstanou)`);
      expect(h).toContain(`zakázka do stavu před předáním: <strong class="text-foreground">${label}</strong>`);
    }
    // výběr stavu (StageSelect) určí cíl sám; bez údajů ze serveru Potvrzená
    expect(undoTargetOf(plan({ client: { ...plan().client!, undoStage: "pozastaveno" } }), "objednavka")).toBe("objednavka");
    expect(undoTargetOf(null, null)).toBe("potvrzeno");
    expect(plainMoveOf("zpet", { target: undoTargetOf(plan({ client: { ...plan().client!, undoStage: "reklamace" } })) })).toMatchObject({ to: "reklamace" });
  });

  it("mobil: „Převzato od …“ — celé jméno firmy, objednávka pod ním (ne vlastní sloupec)", () => {
    const running = {
      id: "op1", label: "Výroba 1", location: "VERIFY-WALK-Frezy Novak s.r.o.", status: "probiha" as const,
      purchaseOrder: { id: "po1", number: "OV-2026-1968", status: "vystavena" as const, items: [{ id: "pi1", label: "PR-7075-20", quantity: 200, received: 0, unit: "ks" }] },
    };
    const h = dialog(plan({ kind: "dalsi_krok", stage: "ve_vyrobe", current: running }));
    expect(h).toMatch(/<span class="block break-words">Převzato od VERIFY-WALK-Frezy Novak s\.r\.o\.<\/span><span class="block[^"]*">objednávka OV-2026-1968<\/span>/);
  });
});
