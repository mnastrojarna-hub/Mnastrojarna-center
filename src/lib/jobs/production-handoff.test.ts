import { describe, it, expect } from "vitest";
import {
  autoSendBlockers, calendarDaysBetween, canSubmitHandoff, daysText, deadlinePill, deadlineStateFor, deadlineText,
  groupPurchaseOrders, handoffErrorCode, performerRole, productionRowText, replanRoute, routeHealth, stageMoveIntent,
  stepSummaryText, validateHandoff, workingDaysBetween,
  type DeadlineOp, type HandoffValidationContext, type HandoffValidationStep, type RouteOp,
} from "./production-handoff";
import { hasWho, isStepReady, isStepStartable, stepLabel } from "./production";
import { STAGE_ORDER } from "./stages";
import type { JobStage } from "@/lib/supabase/database.types";

const TODAY = "2026-10-23"; // pátek

describe("záměr přesunu stavu (stageMoveIntent)", () => {
  const facts = { openSteps: 1, doneSteps: 0, deliveredPurchaseOrders: 0 };
  it("do výroby: předání z objednávky / potvrzené / pozastavené / reklamace, oprava z 6–8, z 0–2 a uzavřených ne", () => {
    const into = Object.fromEntries(STAGE_ORDER.filter((s) => s !== "ve_vyrobe").map((s) => [s, stageMoveIntent(s, "ve_vyrobe", facts)]));
    expect(into).toEqual({
      poptavka: { kind: "blocked", code: "NO_CUSTOMER_ORDER" },
      naceneni: { kind: "blocked", code: "NO_CUSTOMER_ORDER" },
      nabidka: { kind: "blocked", code: "NO_CUSTOMER_ORDER" },
      objednavka: { kind: "predani", rework: false },
      potvrzeno: { kind: "predani", rework: false },
      dodano_k_nam: { kind: "predani", rework: true },
      na_sklade: { kind: "predani", rework: true },
      montaz: { kind: "predani", rework: true },
      dodano_zakaznikovi: { kind: "none" },
      fakturovano: { kind: "none" },
      dokonceno: { kind: "blocked", code: "CLOSED" },
      pozastaveno: { kind: "predani", rework: false },
      reklamace: { kind: "predani", rework: false },
      nerealizovano: { kind: "blocked", code: "CLOSED" },
      zruseno: { kind: "blocked", code: "CLOSED" },
    });
  });

  it("z výroby: dál s otevřenými kroky = ukončení, zpět = vrácení předání, do vedlejších stavů nic", () => {
    const out = Object.fromEntries(STAGE_ORDER.filter((s) => s !== "ve_vyrobe").map((s) => [s, stageMoveIntent("ve_vyrobe", s, facts).kind]));
    expect(out).toEqual({
      poptavka: "zpet", naceneni: "zpet", nabidka: "zpet", objednavka: "zpet", potvrzeno: "zpet",
      dodano_k_nam: "ukonceni", na_sklade: "ukonceni", montaz: "ukonceni", dodano_zakaznikovi: "ukonceni", fakturovano: "ukonceni",
      dokonceno: "ukonceni", pozastaveno: "none", reklamace: "none", nerealizovano: "none", zruseno: "none",
    });
    expect(stageMoveIntent("ve_vyrobe", "dodano_k_nam", { ...facts, openSteps: 0 })).toEqual({ kind: "none" });
    expect(stageMoveIntent("ve_vyrobe", "na_sklade", facts)).toEqual({ kind: "ukonceni", target: "na_sklade" });
  });

  it("přeskočení výroby z 3–4 na 6+ = zápis výroby, jen když nic není hotové ani dodané", () => {
    expect(stageMoveIntent("potvrzeno", "dodano_k_nam", facts)).toEqual({ kind: "zaznam", target: "dodano_k_nam" });
    expect(stageMoveIntent("objednavka", "dodano_zakaznikovi", facts)).toEqual({ kind: "zaznam", target: "dodano_zakaznikovi" });
    expect(stageMoveIntent("potvrzeno", "dodano_k_nam", { ...facts, doneSteps: 1 })).toEqual({ kind: "none" });
    expect(stageMoveIntent("potvrzeno", "dodano_k_nam", { ...facts, deliveredPurchaseOrders: 1 })).toEqual({ kind: "none" });
    expect(stageMoveIntent("potvrzeno", "potvrzeno", facts)).toEqual({ kind: "none" });
    expect(stageMoveIntent("nabidka", "objednavka", facts)).toEqual({ kind: "none" });
    expect(stageMoveIntent("dodano_k_nam", "dodano_zakaznikovi", facts)).toEqual({ kind: "none" });
  });

  it("každá dvojice stavů dává známý záměr (žádná výjimka)", () => {
    for (const a of STAGE_ORDER) for (const b of STAGE_ORDER) {
      expect(["none", "predani", "blocked", "ukonceni", "zaznam", "zpet"]).toContain(stageMoveIntent(a as JobStage, b as JobStage, facts).kind);
    }
  });
});

describe("kroky: název, číslování, připravenost, role", () => {
  const route = [
    { id: "a", kind: "vyroba" as const, status: "hotovo" as const, position: 0 },
    { id: "b", kind: "tepelne_zpracovani" as const, status: "probiha" as const, position: 1 },
    { id: "c", kind: "vyroba" as const, status: "ceka" as const, position: 2 },
  ];
  it("„Výroba 1 / Výroba 2“ přes jiné druhy; jediný krok jen „Výroba“; vlastní název vyhrává; přeskočené se nečísluje", () => {
    expect(stepLabel(route[0], route)).toBe("Výroba 1");
    expect(stepLabel(route[1], route)).toBe("Tepelné zpracování");
    expect(stepLabel(route[2], route)).toBe("Výroba 2");
    expect(stepLabel({ ...route[2], title: "Hrubování" }, route)).toBe("Hrubování");
    expect(stepLabel(route[0], [route[0]])).toBe("Výroba");
    const skipped = [{ ...route[0], status: "preskoceno" as const }, route[1], route[2]];
    expect(stepLabel(route[2], skipped)).toBe("Výroba 1");
    expect(stepLabel({ id: "x", kind: "vyroba" }, [{ id: "x", kind: "vyroba", position: 0 }, { id: "y", kind: "kontrola", position: 1 }])).toBe("Výroba 1");
  });

  it("připravený = kdo + termín; spustitelný = navíc u nás / objednávka / objednáno jinak", () => {
    const base = { inHouse: false, supplierId: "s1", plannedEnd: "2026-11-13" };
    expect(hasWho({ inHouse: false, supplierName: "  " })).toBe(false);
    expect(hasWho({ inHouse: false, supplierName: "Kalírna mimo adresář" })).toBe(true);
    expect(isStepReady(base)).toBe(true);
    expect(isStepReady({ ...base, plannedEnd: null })).toBe(false);
    expect(isStepStartable(base)).toBe(false);
    expect(isStepStartable({ ...base, purchaseOrderId: "po" })).toBe(true);
    expect(isStepStartable({ ...base, poMode: "neobjednavat" })).toBe(true);
    expect(isStepStartable({ inHouse: true, plannedEnd: "2026-11-13" })).toBe(true);
  });

  it("role: u nás / dodavatel (komplet nebo jediný krok) / částečný dodavatel", () => {
    const r = [{ id: "a", status: "ceka" as const }, { id: "b", status: "ceka" as const }];
    expect(performerRole({ id: "a", kind: "vyroba", inHouse: true }, r)).toBe("u nás");
    expect(performerRole({ id: "a", kind: "kompletni_dodavka", inHouse: false, supplierId: "s" }, r)).toBe("dodavatel");
    expect(performerRole({ id: "a", kind: "vyroba", inHouse: false, supplierId: "s" }, [r[0]])).toBe("dodavatel");
    expect(performerRole({ id: "b", kind: "tepelne_zpracovani", inHouse: false, supplierName: "Kalírna XY" }, r)).toBe("částečný dodavatel");
    expect(performerRole({ id: "b", kind: "vyroba", inHouse: false }, r)).toBeNull();
  });

  it("stav termínu určuje server: u nás plán, zaškrtnuté dohodnuto, potvrzení dodavatele, odeslaná objednávka", () => {
    expect(deadlineStateFor({ who: { type: "u_nas" } })).toBe("plan");
    expect(deadlineStateFor({ who: { type: "supplier", id: "s" }, deadlineAgreed: true })).toBe("dohodnuto");
    expect(deadlineStateFor({ who: { type: "supplier", id: "s" }, deadlineSource: "potvrzeni_dodavatele" })).toBe("potvrzeno");
    expect(deadlineStateFor({ who: { type: "supplier", id: "s" }, purchaseOrderStatus: "odeslana" })).toBe("pozadovano");
    expect(deadlineStateFor({ who: { type: "supplier", id: "s" }, deadlineSource: "nabidka_dodavatele" })).toBe("odhad");
  });
});

describe("texty termínu (mezitermín / konečný termín, s kým a jak jistý)", () => {
  const ctx = { today: TODAY, finalDate: { date: "2026-11-20", source: "due_date" as const } };
  const op = (over: Partial<DeadlineOp>): DeadlineOp => ({ plannedEnd: "2026-11-13", inHouse: false, location: "Hrubý", ...over });
  it("každý stav termínu", () => {
    expect(deadlineText(op({ inHouse: true, location: "U nás", deadlineState: "plan" }), ctx)).toBe("Mezitermín 13. 11. — plán dílny (u nás)");
    expect(deadlineText(op({ deadlineState: "odhad", deadlineSource: "nabidka_dodavatele", leadTimeDays: 21 }), ctx))
      .toBe("Mezitermín 13. 11. — odhad z nabídky Hrubý (3 týdny), zatím nedohodnuto");
    expect(deadlineText(op({ deadlineState: "odhad", deadlineSource: "lhuta_dodavatele", leadTimeDays: 5 }), ctx))
      .toBe("Mezitermín 13. 11. — odhad (obvyklá lhůta Hrubý 5 dní), zatím nedohodnuto");
    expect(deadlineText(op({ location: "—", deadlineState: "odhad" }), ctx)).toBe("Termín 13. 11. — odhad, firma zatím nevybrána");
    expect(deadlineText(op({ deadlineState: "dohodnuto", deadlineChangedBy: { name: "Petr Obchodník" }, deadlineChangedAt: "2026-10-14T10:00:00Z" }), ctx))
      .toBe("Mezitermín 13. 11. — dohodnuto s Hrubý (P. Obchodník, 14. 10.)");
    expect(deadlineText(op({ deadlineState: "pozadovano", purchaseOrder: { number: "OV-2026-012", status: "odeslana" } }), ctx))
      .toBe("Mezitermín 13. 11. — požadováno v objednávce OV-2026-012, čeká na potvrzení Hrubý");
    expect(deadlineText(op({ plannedEnd: "2026-11-14", deadlineState: "potvrzeno", deadlineChangedAt: "2026-10-15T09:00:00Z", purchaseOrder: { number: "OV-2026-012", status: "potvrzena" } }), ctx))
      .toBe("Mezitermín 14. 11. — potvrdil Hrubý (OV-2026-012, 15. 10.)");
    expect(deadlineText(op({ plannedEnd: "2026-11-14", deadlineState: "zmena_ceka" }), ctx)).toBe("Mezitermín 14. 11. — změna čeká na odeslání Hrubý");
    expect(deadlineText(op({ plannedEnd: "2026-11-14", deadlineState: "zmena_ceka", changeSent: true }), ctx)).toBe("Mezitermín 14. 11. — změna poslána Hrubý, čeká na potvrzení");
    expect(deadlineText(op({ deadlineState: "odhad", purchaseOrder: { number: "OV-2026-012", status: "vystavena" } }), ctx))
      .toBe("Mezitermín 13. 11. — odhad, zatím nedohodnuto · objednávka OV-2026-012 čeká na odeslání");
    expect(deadlineText(op({ plannedEnd: null }), ctx)).toBeNull();
  });

  it("konečný termín (zákazník) se závazkem dodavatele; nepotvrzený požadavek zákazníka", () => {
    const fin = (over: Partial<DeadlineOp>) => op({ plannedEnd: "2026-11-20", endsAtCustomerDate: true, ...over });
    expect(deadlineText(fin({ deadlineState: "potvrzeno", purchaseOrder: { number: "OV-1", status: "potvrzena", confirmedDate: "2026-11-20" } }), ctx))
      .toBe("Konečný termín (zákazník) 20. 11. — dohodnuto se zákazníkem · Hrubý: potvrzeno 20. 11.");
    expect(deadlineText(fin({ deadlineState: "pozadovano", purchaseOrder: { number: "OV-1", status: "odeslana" } }), ctx))
      .toBe("Konečný termín (zákazník) 20. 11. — dohodnuto se zákazníkem · Hrubý: požadováno, čeká na potvrzení");
    expect(deadlineText(fin({ deadlineState: "pozadovano", purchaseOrder: { number: "OV-1", status: "potvrzena", confirmedDate: "2026-11-22" } }), ctx))
      .toBe("Konečný termín (zákazník) 20. 11. — dohodnuto se zákazníkem · Hrubý: potvrdil až 22. 11. (o 2 dny později)");
    expect(deadlineText(fin({ deadlineState: "odhad" }), ctx)).toBe("Konečný termín (zákazník) 20. 11. — dohodnuto se zákazníkem · odhad");
    expect(deadlineText(fin({ deadlineState: "odhad" }), { today: TODAY, finalDate: { date: "2026-11-20", source: "customer_required_date" } }))
      .toBe("Konečný termín (zákazník) 20. 11. — požadavek zákazníka, zatím nepotvrzený · odhad");
  });

  it("štítky: odhad šedě, potvrzeno zeleně, čeká žlutě, po termínu červeně", () => {
    expect(deadlinePill(op({ deadlineState: "odhad" }), ctx)).toEqual({ text: "mezitermín 13. 11. · Hrubý · odhad", tone: "grey" });
    expect(deadlinePill(op({ deadlineState: "potvrzeno" }), ctx)).toEqual({ text: "mezitermín 13. 11. · Hrubý · potvrzeno", tone: "green" });
    expect(deadlinePill(op({ deadlineState: "pozadovano" }), ctx)).toEqual({ text: "mezitermín 13. 11. · Hrubý · čeká na potvrzení", tone: "amber" });
    expect(deadlinePill(op({ plannedEnd: "2026-11-20", endsAtCustomerDate: true }), ctx)).toEqual({ text: "konečný 20. 11. · zákazník", tone: "green" });
    expect(deadlinePill(op({ plannedEnd: "2026-10-21", status: "probiha" }), ctx)).toEqual({ text: "2 dny po termínu (21. 10.)", tone: "red" });
    expect(deadlinePill(op({ plannedEnd: "2026-10-21", status: "hotovo", deadlineState: "potvrzeno" }), ctx)?.tone).toBe("green");
  });

  it("souhrn kroku do historie", () => {
    expect(stepSummaryText({ label: "Tepelné zpracování", who: { type: "supplier", id: "s", name: "TepKal s.r.o." }, role: "částečný dodavatel",
      plannedEnd: "2026-11-19", endsAtCustomerDate: false, deadlineState: "odhad" }))
      .toBe("Tepelné zpracování · TepKal s.r.o. (částečný dodavatel) · mezitermín 19. 11. (odhad)");
    expect(stepSummaryText({ label: "Výroba 2", who: { type: "u_nas" }, plannedEnd: "2026-11-20", endsAtCustomerDate: true }))
      .toBe("Výroba 2 · U nás · konečný termín (zákazník) 20. 11.");
  });
});

describe("řádek knihy", () => {
  const job = {
    stage: "ve_vyrobe" as const, productionStep: "tepelne_zpracovani", productionLocation: "TepKal", productionTotal: 3,
    productionStepNo: 2, productionStepKindNo: 1, productionDue: "2026-11-12", productionDueState: "odhad" as const,
  };
  it("„Krok 2/3 · Tepelné zpracování · TepKal · do 12. 11.“ + štítek + tečka neodeslané objednávky", () => {
    expect(productionRowText(job, TODAY)).toEqual({
      kind: "krok", text: "Krok 2/3 · Tepelné zpracování · TepKal · do 12. 11.", overdue: false,
      pill: { label: "odhad", tone: "grey" }, dot: null,
    });
    expect(productionRowText({ ...job, productionPoStatus: "vystavena" }, TODAY).dot).toEqual({ title: "Objednávka neodeslána" });
  });
  it("Výroba N jen při víc krocích, konečný, po termínu, plán, chybí kdo, hotovo", () => {
    expect(productionRowText({ ...job, productionStep: "vyroba", productionStepKindNo: 2, productionStepNo: 3, productionDue: "2026-11-20", productionDueFinal: true, productionLocation: "Hrubý" }, TODAY).text)
      .toBe("Krok 3/3 · Výroba 2 · Hrubý · do 20. 11. (konečný)");
    expect(productionRowText({ ...job, productionStep: "vyroba", productionTotal: 1, productionStepNo: 1 }, TODAY).text).toBe("Krok 1/1 · Výroba · TepKal · do 12. 11.");
    expect(productionRowText({ ...job, productionDue: "2026-10-21" }, TODAY)).toMatchObject({ overdue: true, text: "Krok 2/3 · Tepelné zpracování · TepKal · 2 dny po termínu" });
    expect(productionRowText({ ...job, stage: "potvrzeno", productionStep: "vyroba", productionStepNo: 1, productionTotal: 2, productionLocation: "Novák" }, TODAY).text)
      .toBe("Plán: Krok 1/2 · Výroba 1 · Novák");
    expect(productionRowText({ ...job, productionDue: null }, TODAY)).toMatchObject({ kind: "legacy", text: "Krok 2/3 · Tepelné zpracování · Chybí kdo a termín" });
    expect(productionRowText({ stage: "ve_vyrobe", productionStep: null }, TODAY)).toMatchObject({ kind: "legacy", text: "Chybí kdo a termín" });
    expect(productionRowText({ stage: "dodano_k_nam", productionStep: "hotovo" }, TODAY)).toMatchObject({ kind: "done", text: "Výroba hotová" });
    expect(productionRowText({ stage: "potvrzeno", productionStep: null }, TODAY).kind).toBe("none");
  });
});

describe("validace předání (validateHandoff)", () => {
  const ctx: HandoffValidationContext = { today: TODAY, stage: "potvrzeno", dueDate: "2026-11-20", customerRequiredDate: null, maxToleratedDate: "2026-11-25" };
  const step = (over: Partial<HandoffValidationStep> = {}): HandoffValidationStep => ({
    kind: "vyroba", who: { type: "supplier", id: "s-novak", name: "Frézy Novák" }, plannedEnd: "2026-11-13", endsAtCustomerDate: false,
    deadlineAgreed: false, start: false, po: { mode: "vystavit" }, ...over,
  });
  const codes = (steps: HandoffValidationStep[], extra: Partial<Parameters<typeof validateHandoff>[0]> = {}, c: Partial<HandoffValidationContext> = {}) =>
    validateHandoff({ kind: "predani", steps, ...extra }, { ...ctx, ...c }).map((i) => `${i.level}:${i.code}${i.step ? `@${i.step}` : ""}`);

  it("platné předání dvou kroků (výroba → kalení s konečným termínem) projde", () => {
    const issues = validateHandoff({ kind: "predani", steps: [
      step({ start: true }),
      step({ kind: "tepelne_zpracovani", who: { type: "supplier", id: "s-tk", name: "TepKal" }, plannedEnd: "2026-11-20", endsAtCustomerDate: true, po: { mode: "pri_predani" } }),
    ] }, ctx);
    expect(issues).toEqual([]);
    expect(canSubmitHandoff(issues, false)).toBe(true);
  });

  it("kdo chybí u kroku, který začíná / objednává / běží; u pozdějšího kroku „rozhodnu později“ smí", () => {
    expect(codes([step({ who: { type: "none" }, start: true })])).toContain("error:who_missing@1");
    expect(codes([step({ who: { type: "none" }, po: { mode: "vystavit" } })])).toContain("error:who_missing@1");
    expect(codes([step({ who: { type: "none" }, status: "probiha", po: { mode: null } })], { kind: "doplneni" } as never)).toContain("error:who_missing@1");
    expect(codes([step({ start: true }), step({ who: { type: "none" }, plannedEnd: "2026-11-18", po: { mode: "pri_predani" } })])).not.toContain("error:who_missing@2");
  });

  it("termín: chybí / neplatný / v minulosti (chyba, u běžícího jen varování) / začátek po konci / víkend", () => {
    expect(codes([step({ plannedEnd: null })])).toContain("error:deadline_missing@1");
    expect(codes([step({ plannedEnd: "13. 11. 2026" })])).toContain("error:deadline_invalid@1");
    expect(codes([step({ plannedEnd: "2026-10-12" })])).toContain("error:deadline_past@1");
    const running = validateHandoff({ kind: "doplneni", steps: [step({ plannedEnd: "2026-10-21", status: "probiha", po: { mode: null } })] }, { ...ctx, stage: "ve_vyrobe" });
    expect(running.find((i) => i.code === "deadline_past")).toEqual({
      code: "deadline_past", level: "warning", step: 1, message: "Krok 1 už běží a je 2 dny po termínu (21. 10.) — doplň nový termín, pokud ho znáš.",
    });
    expect(codes([step({ plannedStart: "2026-11-14" })])).toContain("error:start_after_end@1");
    expect(codes([step({ plannedEnd: "2026-11-14" })])).toContain("warning:non_working_day@1");
    expect(codes([step({ plannedEnd: "2026-10-28" })])).toContain("warning:non_working_day@1"); // státní svátek
  });

  it("pořadí: dřívější konec dalšího kroku = chyba u stejných dílů, varování u různých", () => {
    expect(codes([step(), step({ kind: "tepelne_zpracovani", plannedEnd: "2026-11-11", po: { mode: "pri_predani" } })])).toContain("error:deadline_order@2");
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    expect(codes([step({ orderItemIds: [a] }), step({ orderItemIds: [b], plannedEnd: "2026-11-11", po: { mode: "pri_predani" } })])).toContain("warning:deadline_order@2");
  });

  it("konečný termín: jen poslední krok, musí sedět (nebo změnit termín zákazníkovi), chybí, nepotvrzený, uplynul", () => {
    expect(codes([step({ endsAtCustomerDate: true, plannedEnd: "2026-11-20" }), step({ plannedEnd: "2026-11-20", po: { mode: "pri_predani" } })])).toContain("error:final_not_last@1");
    const mismatch = validateHandoff({ kind: "predani", steps: [step({ endsAtCustomerDate: true, plannedEnd: "2026-11-23" })] }, ctx);
    expect(mismatch.find((i) => i.code === "final_mismatch")?.message)
      .toBe("Krok 1: konečný termín musí být stejný jako konečný termín (zákazník) 20. 11. — nebo zaškrtni „Změnit i konečný termín zákazníkovi na 23. 11.“ (jen obchodník/admin).");
    expect(codes([step({ endsAtCustomerDate: true, plannedEnd: "2026-11-23" })], { updateCustomerDate: true })).not.toContain("error:final_mismatch@1");
    expect(codes([step()], {}, { dueDate: null })).toContain("error:final_missing");
    expect(codes([step()], {}, { dueDate: null, customerRequiredDate: "2026-11-20" })).toContain("info:final_unconfirmed");
    expect(codes([step()], { finalDate: { date: "2026-11-20", confirmed: true } }, { dueDate: null })).not.toContain("info:final_unconfirmed");
    expect(codes([step({ plannedEnd: "2026-11-13" })], {}, { dueDate: "2026-10-20" })).toContain("warning:final_past");
  });

  it("pozdě: mezitermín po konečném termínu a konec výroby po termínu chtějí „Vím o tom“", () => {
    const issues = validateHandoff({ kind: "predani", steps: [step({ plannedEnd: "2026-11-23" })] }, ctx);
    // poslední krok: jedno varování „Výroba skončí…", ne ještě „mezitermín po konečném termínu"
    expect(issues.filter((i) => i.acceptLate).map((i) => i.code)).toEqual(["last_after_final"]);
    const two = validateHandoff({ kind: "predani", steps: [step({ plannedEnd: "2026-11-23" }), step({ plannedEnd: "2026-11-24", po: { mode: "pri_predani" } })] }, ctx);
    expect(two.filter((i) => i.acceptLate).map((i) => `${i.code}@${i.step}`)).toEqual(["interim_after_final@1", "last_after_final@2"]);
    expect(issues.find((i) => i.code === "last_after_final")?.message)
      .toBe("Výroba skončí 23. 11. — 3 dny po konečném termínu (zákazník) 20. 11.; max. tolerovaný 25. 11.. Domluv nový termín se zákazníkem.");
    expect(issues.filter((i) => i.acceptLate).every((i) => i.level === "warning")).toBe(true);
    expect(canSubmitHandoff(issues, false)).toBe(false);
    expect(canSubmitHandoff(issues, true)).toBe(true);
    expect(codes([step({ plannedEnd: "2026-11-20" })])).toContain("warning:no_buffer@1");
  });

  it("objednávka: důvod u „objednáno jinak“, duplicitní objednávka u stejného dodavatele", () => {
    expect(codes([step({ po: { mode: "neobjednavat", noneReason: " " } })])).toContain("error:po_reason_missing@1");
    const dup = validateHandoff({ kind: "predani", steps: [step({ start: true })] }, {
      ...ctx, openPurchaseOrders: [{ id: "po", number: "OV-2026-012", supplierId: "s-novak", supplierName: "Frézy Novák", linked: false }],
    });
    expect(dup.find((i) => i.code === "po_duplicate")?.message).toBe("Frézy Novák už má k zakázce objednávku OV-2026-012 — použij ji, nebo ji nejdřív zruš.");
    const reuse = validateHandoff({ kind: "predani", steps: [step({ start: true, po: { mode: "existujici", existingId: "po" } })] }, {
      ...ctx, openPurchaseOrders: [{ id: "po", number: "OV-2026-012", supplierId: "s-novak", supplierName: "Frézy Novák", linked: false }],
    });
    expect(reuse.some((i) => i.code === "po_duplicate")).toBe(false);
    // A (existující OV) → B → A (nová): existující objednávka je tímto předáním použitá, nová u A smí vzniknout
    const aba = validateHandoff({ kind: "predani", steps: [
      step({ start: true, po: { mode: "existujici", existingId: "po" } }),
      step({ kind: "tepelne_zpracovani", who: { type: "supplier", id: "s-tk", name: "TepKal" }, plannedEnd: "2026-11-16", po: { mode: "pri_predani" } }),
      step({ kind: "brouseni", plannedEnd: "2026-11-18", po: { mode: "vystavit" } }),
    ] }, { ...ctx, openPurchaseOrders: [{ id: "po", number: "OV-2026-012", supplierId: "s-novak", supplierName: "Frézy Novák", linked: false }] });
    expect(aba.some((i) => i.code === "po_duplicate")).toBe(false);
  });

  it("plán s „Objednat hned“ před objednávkou zákazníka = chyba (jako server)", () => {
    expect(validateHandoff({ kind: "plan", steps: [step({ po: { mode: "vystavit" } })] }, { ...ctx, stage: "nabidka" }).map((i) => i.code)).toContain("no_customer_order");
    expect(validateHandoff({ kind: "plan", steps: [step({ po: { mode: "pri_predani" } })] }, { ...ctx, stage: "nabidka" }).map((i) => i.code)).not.toContain("no_customer_order");
  });

  it("nepotvrzené datum z dialogu nepřebije potvrzený termín zákazníkovi (server ho do due_date nezapíše)", () => {
    const st = { kind: "predani" as const, finalDate: { date: "2026-11-25", confirmed: false }, steps: [step({ plannedEnd: "2026-11-25", endsAtCustomerDate: true })] };
    expect(validateHandoff(st, ctx).map((i) => i.code)).toContain("final_mismatch");
    expect(validateHandoff({ ...st, finalDate: { date: "2026-11-25", confirmed: true } }, ctx).map((i) => i.code)).not.toContain("final_mismatch");
    // bez termínu zákazníka se nepotvrzené datum použije (zapíše se jako požadavek)
    expect(validateHandoff(st, { ...ctx, dueDate: null }).map((i) => i.code)).not.toContain("final_mismatch");
  });

  it("start jen jednoho kroku, aspoň jeden díl, nejvýš 12 kroků, zákazník musí objednat", () => {
    expect(codes([step({ start: true }), step({ start: true, plannedEnd: "2026-11-16" })])).toContain("error:start_multiple");
    expect(codes([step({ orderItemIds: [] })])).toContain("error:item_scope_empty@1");
    expect(codes(Array.from({ length: 13 }, () => step({ po: { mode: "pri_predani" } })))).toContain("error:too_many");
    expect(codes([step()], {}, { stage: "nabidka" })).toContain("error:no_customer_order");
  });

  it("díl bez výrobního kroku a jiné množství v nabídce = varování", () => {
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const issues = validateHandoff({ kind: "predani", steps: [step({ orderItemIds: [a] })] }, {
      ...ctx, items: [{ id: a, drawingNumber: "PR-7075-20" }, { id: b, drawingNumber: "PR-7075-21" }],
      quantityMismatch: { 0: { quoted: 100, ordered: 200, unit: "ks" } },
    });
    expect(issues.find((i) => i.code === "items_unassigned")?.message).toBe("Díl PR-7075-21 není v žádném kroku výroby.");
    expect(issues.find((i) => i.code === "quantity_mismatch")?.message).toBe("Nabídka je na 100 ks, objednáváš 200 ks — cena za kus se může lišit.");
  });

  it("zápis výroby zpětně: datum v minulosti je v pořádku", () => {
    expect(codes([step({ plannedEnd: "2026-10-20", done: true, po: { mode: "neobjednavat", noneReason: "Zapsáno zpětně" } })], { kind: "zaznam" } as never, { stage: "potvrzeno" }))
      .not.toContain("error:deadline_past@1");
  });
});

describe("zdraví postupu a přeplánování", () => {
  const ops: RouteOp[] = [
    { id: "v1", kind: "vyroba", status: "probiha", position: 0, plannedEnd: "2026-11-13", deadlineState: "potvrzeno" },
    { id: "tz", kind: "tepelne_zpracovani", status: "ceka", position: 1, plannedEnd: "2026-11-19", deadlineState: "odhad" },
    { id: "v2", kind: "vyroba", status: "ceka", position: 2, plannedEnd: "2026-11-20", endsAtCustomerDate: true },
  ];
  it("v pořádku → nic; posunutý termín zákazníka → „přeplánuj“; konec po termínu → „Ohrožen konečný termín (o 2 dny)“", () => {
    expect(routeHealth(ops, { dueDate: "2026-11-20" }, TODAY)).toEqual([]);
    expect(routeHealth(ops, { dueDate: "2026-11-24" }, TODAY).map((i) => i.chip)).toEqual(["Konečný termín se změnil — přeplánuj výrobu"]);
    const late = routeHealth(ops, { dueDate: "2026-11-18" }, TODAY);
    expect(late.map((i) => i.chip)).toEqual(["Konečný termín se změnil — přeplánuj výrobu", "Ohrožen konečný termín (o 2 dny)"]);
    expect(routeHealth(ops, { dueDate: null, customerRequiredDate: "2026-11-19" }, TODAY).find((i) => i.code === "route_late")?.days).toBe(1);
  });
  it("překryv kroků a aktuální krok po termínu", () => {
    const bad = [ops[0], { ...ops[1], plannedEnd: "2026-11-12" }, ops[2]];
    expect(routeHealth(bad, { dueDate: "2026-11-20" }, TODAY).find((i) => i.code === "overlap")?.message)
      .toBe("Krok 2 začíná dřív, než skončí krok 1 — zkontroluj termíny.");
    expect(routeHealth(ops, { dueDate: "2026-11-20" }, "2026-11-16").find((i) => i.code === "step_overdue")).toMatchObject({ operationId: "v1", days: 3 });
  });
  it("posun výroby o 2 pracovní dny posune kalení se stejnou délkou; konečný krok drží termín zákazníka", () => {
    const p = replanRoute(ops, { operationId: "v1", plannedEnd: "2026-11-17" });
    expect(p.map((x) => [x.id, x.from, x.to, x.changed, x.highlight])).toEqual([
      ["v1", "2026-11-13", "2026-11-17", true, true],
      ["tz", "2026-11-19", "2026-11-20", true, false],   // 3 prac. dny po výrobě jako dřív (18., 19., 20.; 17. 11. svátek)
      ["v2", "2026-11-20", "2026-11-20", false, false],
    ]);
    expect(p[0].note).toBe("termín byl potvrzený dodavatelem — změna se mu pošle");
    expect(p.map((x) => x.label)).toEqual(["Výroba 1", "Tepelné zpracování", "Výroba 2"]);
    // krok bez data se přeskočí; další krok se měří od posledního s datem, nikdy neskončí dřív než předchozí
    const gap: RouteOp[] = [
      { id: "a", kind: "vyroba", status: "probiha", position: 0, plannedEnd: "2026-11-13" },
      { id: "b", kind: "tepelne_zpracovani", status: "ceka", position: 1, plannedEnd: null },
      { id: "c", kind: "brouseni", status: "ceka", position: 2, plannedEnd: "2026-11-25" },
      { id: "d", kind: "kontrola", status: "ceka", position: 3, plannedEnd: "2026-11-27" },
    ];
    const g = replanRoute(gap, { operationId: "a", plannedEnd: "2026-11-20" });
    expect(g.map((x) => [x.id, x.to])).toEqual([["a", "2026-11-20"], ["b", null], ["c", "2026-12-01"], ["d", "2026-12-03"]]);   // c: 7 prac. dní po a jako dřív
    // změněný krok neměl datum: další kroky beze změny
    const g2 = replanRoute([{ ...gap[0], plannedEnd: null }, { ...gap[1], plannedEnd: "2026-11-18" }, gap[2]], { operationId: "a", plannedEnd: "2026-11-20" });
    expect(g2.filter((x) => x.changed).map((x) => x.id)).toEqual(["a"]);
    const due = replanRoute(ops, { dueDate: "2026-11-24" });
    expect(due.find((x) => x.id === "v2")).toMatchObject({ to: "2026-11-24", changed: true });
    expect(due.filter((x) => x.changed).length).toBe(1);
  });
  it("pracovní dny mezi daty (svátky ČR)", () => {
    expect(workingDaysBetween("2026-11-13", "2026-11-19")).toBe(3);   // po 16., st 18., čt 19. (17. 11. svátek)
    expect(workingDaysBetween("2026-11-19", "2026-11-13")).toBe(-3);
    expect(workingDaysBetween("2026-10-23", "2026-10-23")).toBe(0);
    expect(calendarDaysBetween("2026-11-20", "2026-11-22")).toBe(2);
    expect(daysText(1)).toBe("1 den");
    expect(daysText(4)).toBe("4 dny");
    expect(daysText(5)).toBe("5 dní");
  });
});

describe("objednávky kroků a automatické odeslání", () => {
  const A = { type: "supplier" as const, id: "a", name: "A" };
  const B = { type: "supplier" as const, id: "b", name: "B" };
  it("souvislé kroky stejné firmy = jedna objednávka (A,A → 1; A,B,A → 3; bez sdílení se rozdělí)", () => {
    expect(groupPurchaseOrders([{ key: "1", who: A, ordersNow: true }, { key: "2", who: A, ordersNow: true }]))
      .toEqual([{ key: "po:1", who: A, stepKeys: ["1", "2"] }]);
    expect(groupPurchaseOrders([{ key: "1", who: A, ordersNow: true }, { key: "2", who: B, ordersNow: true }, { key: "3", who: A, ordersNow: true }]).map((g) => g.stepKeys))
      .toEqual([["1"], ["2"], ["3"]]);
    expect(groupPurchaseOrders([{ key: "1", who: A, ordersNow: true, sharedWithNext: false }, { key: "2", who: A, ordersNow: true }]).map((g) => g.stepKeys))
      .toEqual([["1"], ["2"]]);
    expect(groupPurchaseOrders([{ key: "1", who: A, ordersNow: true }, { key: "2", who: { type: "u_nas" }, ordersNow: false }, { key: "3", who: A, ordersNow: true }]).length).toBe(2);
    expect(groupPurchaseOrders([{ key: "1", who: A, ordersNow: true }, { key: "2", who: A, ordersNow: false }]).map((g) => g.stepKeys)).toEqual([["1"]]);
  });
  it("blokace plné automatiky", () => {
    expect(autoSendBlockers({ unpricedItems: 0, quoteExpired: false, partialCoverage: false, whoSource: "nejlevnejsi_nabidka", supplierEmail: "a@b.cz", senderUsable: true })).toEqual([]);
    expect(autoSendBlockers({ unpricedItems: 2, quoteExpired: true, partialCoverage: true, whoSource: "rucne", supplierEmail: "", senderUsable: false })).toEqual([
      "2 položky bez ceny", "nabídka vypršela", "nabídka pokrývá jen část dílů", "ručně zvolená dražší firma",
      "dodavatel nemá v adresáři e-mail", "nemáš nastavenou schránku pro odesílání",
    ]);
    expect(autoSendBlockers({ unpricedItems: 1, quoteExpired: false, partialCoverage: false, whoSource: "objednavka", supplierEmail: "a@b.cz", senderUsable: true })).toEqual(["1 položka bez ceny"]);
  });
  it("kód chyby z DB", () => {
    expect(handoffErrorCode({ hint: "STEP_CHANGED", message: "x" })).toBe("STEP_CHANGED");
    expect(handoffErrorCode({ hint: "HANDOFF_REQUIRED" })).toBe("HANDOFF_REQUIRED");
    expect(handoffErrorCode({ code: "42501" })).toBe("FORBIDDEN");
    expect(handoffErrorCode({ hint: "jiné" })).toBeNull();
    expect(handoffErrorCode(null)).toBeNull();
  });
});
