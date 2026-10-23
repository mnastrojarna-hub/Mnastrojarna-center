import { describe, it, expect } from "vitest";
import {
  canSeeEmail, canUseMailbox, emailVisibilityFilter, ownedMailboxIds, selectMailboxesToSync,
  filterMailboxesForSync, allowGlobalFallback, isAiSwitchOn, cronAuthStatus, CATEGORY_STYLE,
  INBOX_CATEGORIES, categoryStyle, countByCategory, inferSentKind, sentKindFromApproval,
  approvalTypeForKind, sentItemKind, SENT_KIND_STYLE, SENT_KINDS, toEmailItem, toSentItemFromMail,
  toSentItemFromApproval, mergeSentItems, extractAddress, usefulAiSummary, jobStageForEmailCategory,
  jobTitleFromSubject, pragueDate, buildJobFromEmail, jobPeopleFromEmail, one, JOB_TITLE_MAX, filterInbox, foldText, mailtoReply,
  filterSent, countSentKinds, categoryCodeFromLabel, attachmentIssuer,
  type EmailListRow,
} from "./visibility";
import type { SentItem } from "@/lib/data/types";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const BOX_MINE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BOX_OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BOX_FREE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const mailboxes = [
  { id: BOX_MINE, owner_id: ME, active: true },
  { id: BOX_OTHER, owner_id: OTHER, active: true },
  { id: BOX_FREE, owner_id: null, active: true },
];

describe("viditelnost pošty", () => {
  const me = { userId: ME, all: false };
  const admin = { userId: OTHER, all: true };
  const owned = ownedMailboxIds(mailboxes, ME);

  it("vlastní schránky uživatele", () => {
    expect(owned).toEqual([BOX_MINE]);
    expect(ownedMailboxIds(mailboxes, "")).toEqual([]);
  });

  it("super admin vidí vše včetně schránky bez vlastníka", () => {
    expect(canSeeEmail(admin, { owner_id: null, mailbox_id: BOX_FREE }, [])).toBe(true);
    expect(canSeeEmail(admin, { owner_id: ME, mailbox_id: null }, [])).toBe(true);
  });

  it("běžný uživatel vidí svou schránku a e-maily přiřazené sobě", () => {
    expect(canSeeEmail(me, { owner_id: null, mailbox_id: BOX_MINE }, owned)).toBe(true);
    expect(canSeeEmail(me, { owner_id: ME, mailbox_id: null }, owned)).toBe(true);
    expect(canSeeEmail(me, { owner_id: ME, mailbox_id: BOX_OTHER }, owned)).toBe(true);
  });

  it("běžný uživatel nevidí cizí ani nepřiřazenou poštu", () => {
    expect(canSeeEmail(me, { owner_id: OTHER, mailbox_id: BOX_OTHER }, owned)).toBe(false);
    expect(canSeeEmail(me, { owner_id: null, mailbox_id: BOX_FREE }, owned)).toBe(false);
    expect(canSeeEmail(me, { owner_id: null, mailbox_id: null }, owned)).toBe(false);
    expect(canSeeEmail({ userId: "", all: false }, { owner_id: null, mailbox_id: null }, [])).toBe(false);
  });

  it("práce se schránkou", () => {
    expect(canUseMailbox(me, mailboxes[0])).toBe(true);
    expect(canUseMailbox(me, mailboxes[1])).toBe(false);
    expect(canUseMailbox(me, mailboxes[2])).toBe(false);
    expect(canUseMailbox(admin, mailboxes[2])).toBe(true);
  });

  it("PostgREST filtr jen s UUID", () => {
    expect(emailVisibilityFilter(ME, [BOX_MINE])).toBe(`owner_id.eq.${ME},mailbox_id.in.(${BOX_MINE})`);
    expect(emailVisibilityFilter(ME, [])).toBe(`owner_id.eq.${ME}`);
    expect(emailVisibilityFilter(ME, ["x),owner_id.neq.(y"])).toBe(`owner_id.eq.${ME}`);
    expect(emailVisibilityFilter("nope", [BOX_MINE])).toBeNull();
  });
});

describe("výběr schránek k synchronizaci", () => {
  it("super admin synchronizuje vše", () => {
    expect(selectMailboxesToSync({ userId: ME, all: true }, mailboxes)).toEqual({ kind: "all" });
  });
  it("ostatní jen své aktivní schránky", () => {
    expect(selectMailboxesToSync({ userId: ME, all: false }, mailboxes)).toEqual({ kind: "own", mailboxIds: [BOX_MINE] });
    expect(selectMailboxesToSync({ userId: ME, all: false }, [{ id: BOX_MINE, owner_id: ME, active: false }]))
      .toEqual({ kind: "none" });
    expect(selectMailboxesToSync({ userId: "33333333-3333-4333-8333-333333333333", all: false }, mailboxes))
      .toEqual({ kind: "none" });
  });
  it("filtr schránek a globální fallback", () => {
    expect(filterMailboxesForSync(mailboxes).map((m) => m.id)).toEqual([BOX_MINE, BOX_OTHER, BOX_FREE]);
    expect(filterMailboxesForSync(mailboxes, [BOX_OTHER]).map((m) => m.id)).toEqual([BOX_OTHER]);
    expect(filterMailboxesForSync(mailboxes, [])).toEqual([]);
    expect(allowGlobalFallback()).toBe(true);
    expect(allowGlobalFallback({})).toBe(true);
    expect(allowGlobalFallback({ mailboxIds: [] })).toBe(false);
    expect(allowGlobalFallback({ mailboxIds: [BOX_MINE] })).toBe(false);
  });
});

describe("hlavní vypínač AI a cron", () => {
  it("AI je vypnuté jen výslovně", () => {
    expect(isAiSwitchOn(undefined)).toBe(true);
    expect(isAiSwitchOn("true")).toBe(true);
    expect(isAiSwitchOn("")).toBe(true);
    expect(isAiSwitchOn("false")).toBe(false);
    expect(isAiSwitchOn(" FALSE ")).toBe(false);
    expect(isAiSwitchOn("0")).toBe(false);
    expect(isAiSwitchOn("off")).toBe(false);
  });
  it("autorizace cronu", () => {
    expect(cronAuthStatus("Bearer tajne", undefined)).toBe(503);
    expect(cronAuthStatus("Bearer tajne", "  ")).toBe(503);
    expect(cronAuthStatus(null, "tajne")).toBe(401);
    expect(cronAuthStatus("tajne", "tajne")).toBe(401);
    expect(cronAuthStatus("Bearer spatne", "tajne")).toBe(401);
    expect(cronAuthStatus("Bearer tajne-delsi", "tajne")).toBe(401);
    expect(cronAuthStatus("Bearer tajne", "tajne")).toBe(200);
    expect(cronAuthStatus("bearer  tajne ", "tajne")).toBe(200);
  });
});

describe("barvy kategorií", () => {
  it("každá kategorie má vlastní barvu a ikonu", () => {
    expect(INBOX_CATEGORIES).toHaveLength(10);
    const dots = new Set(INBOX_CATEGORIES.filter((c) => c !== "Spam" && c !== "Ostatní").map((c) => CATEGORY_STYLE[c].dot));
    expect(dots.size).toBe(8);
    for (const c of INBOX_CATEGORIES) {
      expect(CATEGORY_STYLE[c].label).toBe(c);
      expect(CATEGORY_STYLE[c].icon).toBeTruthy();
      expect(CATEGORY_STYLE[c].chip).toMatch(/dark:/);
    }
  });
  it("neznámá kategorie → Ostatní", () => {
    expect(categoryStyle("Nesmysl").label).toBe("Ostatní");
    expect(categoryStyle(null).label).toBe("Ostatní");
    expect(categoryStyle("Faktura").label).toBe("Faktura");
  });
  it("počty po kategoriích", () => {
    const counts = countByCategory([{ category: "Poptávka" }, { category: "Poptávka" }, { category: "Spam" }]);
    expect(counts["Poptávka"]).toBe(2);
    expect(counts.Spam).toBe(1);
    expect(counts.Faktura).toBe(0);
  });
});

describe("druhy odeslané pošty", () => {
  it("odvození z předmětu", () => {
    expect(inferSentKind("Cenová nabídka NAB-2026-001 — Mnástrojárna s.r.o.")).toBe("quote");
    expect(inferSentKind("Upomínka — faktura 2026001")).toBe("reminder");
    expect(inferSentKind("Poptávka dodavateli: frézování dílu")).toBe("supplier");
    expect(inferSentKind("Re: Poptávka výkres 123")).toBe("email");
    expect(inferSentKind("Re: Cenová nabídka")).toBe("email");
    expect(inferSentKind("")).toBe("email");
    expect(inferSentKind(null)).toBe("email");
  });
  it("převod mezi typem fronty a druhem", () => {
    for (const k of SENT_KINDS) expect(sentKindFromApproval(approvalTypeForKind(k))).toBe(k);
    expect(sentKindFromApproval("categorization")).toBe("email");
    expect(sentItemKind({ rawType: "quote" })).toBe("quote");
    expect(sentItemKind({ rawType: "quote", kind: "reminder" })).toBe("reminder");
    expect(SENT_KIND_STYLE.email.label).toBe("E-mail");
  });
});

describe("mapování řádků", () => {
  const row: EmailListRow = {
    id: "e1", mailbox_id: BOX_MINE, owner_id: ME, direction: "in",
    from_name: "  Jan   Dvořák ", from_email: "dvorak@strojmetal.cz", to_email: "obchod@mnastrojarna.cz",
    subject: "Poptávka  dílu", snippet: null, body_text: "Dobrý den,\n posílám poptávku",
    category: "poptavka", priority: "vysoka", ai_confidence: 0.91,
    ai_summary: "AI není nakonfigurováno (doplň Claude API klíč v Nastavení).",
    is_read: false, has_draft: true, received_at: "2026-10-22T08:00:00Z", order_id: null,
    customer: { name: "StrojMetal" }, job: [{ id: "j1", number: "Z-2026-001" }], mailbox: { email: "obchod@mnastrojarna.cz" },
  };

  it("e-mail → EmailItem", () => {
    const item = toEmailItem(row);
    expect(item.from).toBe("Jan Dvořák");
    expect(item.subject).toBe("Poptávka dílu");
    expect(item.preview).toBe("Dobrý den, posílám poptávku");
    expect(item.category).toBe("Poptávka");
    expect(item.priority).toBe("Vysoká");
    expect(item.customer).toBe("StrojMetal");
    expect(item.aiSummary).toBeUndefined();
    expect(item.unread).toBe(true);
    expect(item.jobId).toBe("j1");
    expect(item.jobNumber).toBe("Z-2026-001");
    expect(item.mailboxEmail).toBe("obchod@mnastrojarna.cz");
    expect(item.direction).toBe("in");
  });

  it("neplatná kategorie a priorita → výchozí", () => {
    const item = toEmailItem({ ...row, category: null, priority: null, from_name: null, from_email: null, job: null, order_id: "j9" });
    expect(item.category).toBe("Ostatní");
    expect(item.priority).toBe("Střední");
    expect(item.from).toBe("—");
    expect(item.jobId).toBe("j9");
    expect(item.jobNumber).toBeUndefined();
  });

  it("one() bere objekt i pole", () => {
    expect(one([{ a: 1 }])).toEqual({ a: 1 });
    expect(one({ a: 2 })).toEqual({ a: 2 });
    expect(one(null)).toBeNull();
    expect(one([])).toBeNull();
  });

  it("odeslaný e-mail a položka fronty → SentItem", () => {
    const sent = toSentItemFromMail({
      id: "s1", mailbox_id: BOX_MINE, to_email: "Dvorak@StrojMetal.cz", subject: "Cenová nabídka NAB-2026-004",
      snippet: "x", body_text: "Text nabídky", received_at: "2026-10-22T09:00:00Z",
      job: { id: "j1", number: "Z-2026-001" }, mailbox: { email: "obchod@mnastrojarna.cz" }, sender: { full_name: "Petr" },
    });
    expect(sent).toMatchObject({ kind: "quote", rawType: "quote", type: "Nabídka", source: "mail", jobNumber: "Z-2026-001", senderName: "Petr", body: "Text nabídky" });
    const a = toSentItemFromApproval({
      id: "a1", type: "reminder", title: "Upomínka", target: "x@y.cz", payload: { body: "Zaplaťte" },
      status: "auto_executed", created_at: "2026-10-01T00:00:00Z", resolved_at: "2026-10-02T00:00:00Z",
    });
    expect(a).toMatchObject({ kind: "reminder", auto: true, body: "Zaplaťte", sentAt: "2026-10-02T00:00:00Z", source: "approval", toEmail: "x@y.cz" });
    expect(toSentItemFromApproval({ id: "a2", type: "categorization", title: "", target: null, payload: null, created_at: "2026-10-01T00:00:00Z" })).toBeNull();
  });
});

describe("sloučení odeslané pošty", () => {
  const mail = (id: string, to: string, at: string): SentItem => ({
    id, type: "E-mail", rawType: "email_reply", title: "Re: x", target: to, body: "", sentAt: at, auto: false,
    toEmail: to.toLowerCase(), source: "mail", kind: "email",
  });
  const appr = (id: string, to: string, at: string, auto = false, type: SentItem["rawType"] = "email_reply"): SentItem => ({
    id, type: "E-mail", rawType: type, title: "Odpověď", target: to, body: "tělo", sentAt: at, auto, source: "approval",
  });

  it("spáruje stejné odeslání a převezme druh i automatiku", () => {
    const out = mergeSentItems(
      [mail("m1", "jan@firma.cz", "2026-10-22T10:00:30Z")],
      [appr("a1", "Jan@Firma.cz", "2026-10-22T10:00:00Z", true, "quote")],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "m1", auto: true, kind: "quote", rawType: "quote", type: "Nabídka", body: "tělo" });
  });

  it("starší záznamy fronty bez protějšku zůstanou a řadí se od nejnovějšího", () => {
    const out = mergeSentItems(
      [mail("m1", "jan@firma.cz", "2026-10-22T10:00:00Z")],
      [appr("a1", "jan@firma.cz", "2026-10-22T12:00:00Z"), appr("a2", "eva@firma.cz", "2026-01-01T00:00:00Z")],
    );
    expect(out.map((i) => i.id)).toEqual(["a1", "m1", "a2"]);
  });

  it("jeden e-mail se nespáruje dvakrát", () => {
    const out = mergeSentItems(
      [mail("m1", "jan@firma.cz", "2026-10-22T10:00:00Z")],
      [appr("a1", "jan@firma.cz", "2026-10-22T10:01:00Z"), appr("a2", "jan@firma.cz", "2026-10-22T10:02:00Z")],
    );
    expect(out.map((i) => i.id).sort()).toEqual(["a2", "m1"]);
  });

  it("adresa z textu", () => {
    expect(extractAddress("Jan Dvořák <Jan@Firma.CZ>")).toBe("jan@firma.cz");
    expect(extractAddress("bez adresy")).toBeNull();
    expect(extractAddress(null)).toBeNull();
  });
});

describe("zakázka z e-mailu", () => {
  it("stav podle kategorie", () => {
    expect(jobStageForEmailCategory("objednavka")).toBe("objednavka");
    expect(jobStageForEmailCategory("potvrzeni_objednavky")).toBe("objednavka");
    expect(jobStageForEmailCategory("poptavka")).toBe("poptavka");
    expect(jobStageForEmailCategory(null)).toBe("poptavka");
  });

  it("název z předmětu bez Re:/Fwd: a max 120 znaků", () => {
    expect(jobTitleFromSubject("RE: Fwd: Odp: Poptávka hřídele")).toBe("Poptávka hřídele");
    expect(jobTitleFromSubject("   ")).toBe("Zakázka z e-mailu");
    expect(jobTitleFromSubject(null)).toBe("Zakázka z e-mailu");
    const long = jobTitleFromSubject("x".repeat(300));
    expect(long.length).toBe(JOB_TITLE_MAX);
    expect(long.endsWith("…")).toBe(true);
  });

  it("datum v pražském čase", () => {
    expect(pragueDate("2026-10-21T23:30:00Z")).toBe("2026-10-22");
    expect(pragueDate("2026-07-01T10:00:00Z")).toBe("2026-07-01");
    expect(pragueDate("nesmysl")).toBeNull();
    expect(pragueDate(null)).toBeNull();
  });

  it("shrnutí AI bez zástupného textu", () => {
    expect(usefulAiSummary("AI není nakonfigurováno (doplň klíč)")).toBeUndefined();
    expect(usefulAiSummary("  Zákazník poptává 50 ks ")).toBe("Zákazník poptává 50 ks");
    expect(usefulAiSummary(null)).toBeUndefined();
  });

  it("řádek zakázky", () => {
    const base = {
      id: "e1", subject: "Re: Objednávka 4500123", from_name: "Eva", from_email: "eva@firma.cz",
      customer_id: "c1", category: "objednavka" as const, received_at: "2026-10-21T23:30:00Z",
      ai_summary: null, snippet: "Objednáváme 20 ks",
    };
    const row = buildJobFromEmail(base, { number: "Z-2026-007", actorId: ME });
    expect(row).toMatchObject({
      number: "Z-2026-007", title: "Objednávka 4500123", status: "objednavka", customer_id: "c1",
      customer_contact_email: "eva@firma.cz", customer_contact: "Eva", order_date: "2026-10-22",
      source: "email", email_id: "e1", created_by: ME, owner_id: ME, note: "Objednáváme 20 ks",
    });
    expect(row).not.toHaveProperty("inquiry_date");

    const inquiry = buildJobFromEmail(
      { ...base, category: "poptavka", customer_id: null, ai_summary: "Poptávka 5 ks hřídelí", from_name: null },
      { number: "Z-2026-008", actorId: ME, customerId: "c2" },
    );
    expect(inquiry).toMatchObject({ status: "poptavka", inquiry_date: "2026-10-22", customer_id: "c2", note: "Poptávka 5 ks hřídelí", customer_contact: null });
    expect(inquiry).not.toHaveProperty("order_date");

    // #25: obchodník / zpracovává podle vlastníka schránky, založil vždy klikající
    const owned = buildJobFromEmail(base, { number: "Z-2026-009", actorId: ME, ownerId: OTHER, assigneeId: null });
    expect(owned).toMatchObject({ owner_id: OTHER, created_by: ME });
    expect(owned).not.toHaveProperty("assignee_id");
    const worker = buildJobFromEmail(base, { number: "Z-2026-010", actorId: ME, ownerId: null, assigneeId: OTHER });
    expect(worker).toMatchObject({ owner_id: null, assignee_id: OTHER, created_by: ME });
  });

  it("#25 kdo zakázku z e-mailu vlastní (jobPeopleFromEmail)", () => {
    const SALES = "33333333-3333-4333-8333-333333333333";
    const WORKER = "44444444-4444-4444-8444-444444444444";
    const ADMIN = "55555555-5555-4555-8555-555555555555";
    const CUSTOMER_OWNER = "66666666-6666-4666-8666-666666666666";
    const admin = { id: ADMIN, role: "super_admin" };
    // schránka obchodníka (i když kliká admin) → obchodník schránky
    expect(jobPeopleFromEmail({ mailboxOwner: { id: SALES, role: "obchodnik" }, customerOwnerId: CUSTOMER_OWNER, actor: admin }))
      .toEqual({ ownerId: SALES, assigneeId: null });
    expect(jobPeopleFromEmail({ mailboxOwner: { id: ADMIN, role: "super_admin" }, customerOwnerId: CUSTOMER_OWNER, actor: admin }))
      .toEqual({ ownerId: ADMIN, assigneeId: null });
    // schránka zaměstnance → zpracovává on, obchodník = obchodník zákazníka, jinak klikající obchodník / admin, jinak nikdo
    expect(jobPeopleFromEmail({ mailboxOwner: { id: WORKER, role: "zamestnanec" }, customerOwnerId: CUSTOMER_OWNER, actor: admin }))
      .toEqual({ ownerId: CUSTOMER_OWNER, assigneeId: WORKER });
    expect(jobPeopleFromEmail({ mailboxOwner: { id: WORKER, role: "zamestnanec" }, customerOwnerId: null, actor: { id: SALES, role: "obchodnik" } }))
      .toEqual({ ownerId: SALES, assigneeId: WORKER });
    expect(jobPeopleFromEmail({ mailboxOwner: { id: WORKER, role: "zamestnanec" }, customerOwnerId: null, actor: { id: WORKER, role: "zamestnanec" } }))
      .toEqual({ ownerId: null, assigneeId: WORKER });
    // schránka bez vlastníka (info@) → obchodník zákazníka, jinak klikající
    expect(jobPeopleFromEmail({ mailboxOwner: null, customerOwnerId: CUSTOMER_OWNER, actor: admin })).toEqual({ ownerId: CUSTOMER_OWNER, assigneeId: null });
    expect(jobPeopleFromEmail({ mailboxOwner: null, customerOwnerId: null, actor: admin })).toEqual({ ownerId: ADMIN, assigneeId: null });
  });

  it("#25 vystavitel příloh e-mailu (attachmentIssuer)", () => {
    const S = "77777777-7777-4777-8777-777777777777";
    const C = "88888888-8888-4888-8888-888888888888";
    // dodavatel: nabídka dodavatele, faktura (i bez dodavatele — fail closed), e-mail jen od dodavatele
    expect(attachmentIssuer({ category: "nabidka_dodavatele" })).toBe("dodavatel");
    expect(attachmentIssuer({ category: "faktura", customerId: C })).toBe("dodavatel");
    expect(attachmentIssuer({ category: "faktura", supplierId: S })).toBe("dodavatel");
    expect(attachmentIssuer({ category: "ostatni", supplierId: S })).toBe("dodavatel");
    expect(attachmentIssuer({ category: "potvrzeni_objednavky", supplierId: S })).toBe("dodavatel");
    // zákazník: poptávka, objednávka, potvrzení, reklamace, technická dokumentace od zákazníka
    for (const category of ["poptavka", "objednavka", "potvrzeni_objednavky", "reklamace", "technicka_dokumentace"] as const) {
      expect(attachmentIssuer({ category, customerId: C })).toBe("zakaznik");
    }
    // nejasné: bez firmy, obě firmy, upomínka zákazníka, ostatní → neznámý vystavitel
    expect(attachmentIssuer({ category: "poptavka" })).toBeNull();
    expect(attachmentIssuer({ category: "poptavka", customerId: C, supplierId: S })).toBeNull();
    expect(attachmentIssuer({ category: "upominka", customerId: C })).toBeNull();
    expect(attachmentIssuer({ category: null, customerId: C })).toBeNull();
  });
});

describe("filtr Inboxu", () => {
  const base = toEmailItem({
    id: "e1", mailbox_id: null, from_name: "Jan Dvořák", from_email: "dvorak@strojmetal.cz", subject: "Poptávka hřídele",
    snippet: "50 ks", category: "poptavka", priority: "stredni", ai_confidence: null, ai_summary: null,
    is_read: false, has_draft: false, received_at: "2026-10-22T08:00:00Z", customer: { name: "StrojMetal" },
  });
  const read = { ...base, id: "e2", unread: false, category: "Faktura" as const, subject: "Faktura 2026001" };
  const spam = { ...base, id: "e3", category: "Spam" as const, subject: "Výhra" };
  const all = [base, read, spam];

  it("Vše bez spamu, spam pod svým chipem", () => {
    expect(filterInbox(all, { category: "Vše" }).map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(filterInbox(all, { category: "Spam" }).map((e) => e.id)).toEqual(["e3"]);
    expect(filterInbox(all, { category: "Faktura" }).map((e) => e.id)).toEqual(["e2"]);
  });
  it("jen nepřečtené a hledání bez diakritiky", () => {
    expect(filterInbox(all, { category: "Vše", unreadOnly: true }).map((e) => e.id)).toEqual(["e1"]);
    expect(filterInbox(all, { category: "Vše", query: "hridele" }).map((e) => e.id)).toEqual(["e1"]);
    expect(filterInbox(all, { category: "Vše", query: "strojmetal faktura" }).map((e) => e.id)).toEqual(["e2"]);
    expect(filterInbox(all, { category: "Vše", query: "nic takoveho" })).toEqual([]);
    expect(foldText("Žluťoučký KŮŇ")).toBe("zlutoucky kun");
  });
  it("odpověď mailto", () => {
    expect(mailtoReply({ fromEmail: "Jan <jan@firma.cz>", subject: "Poptávka" })).toBe("mailto:jan@firma.cz?subject=Re%3A%20Popt%C3%A1vka");
    expect(mailtoReply({ fromEmail: "jan@firma.cz", subject: "RE: x" })).toBe("mailto:jan@firma.cz?subject=RE%3A%20x");
    expect(mailtoReply({ fromEmail: "", subject: "x" })).toBeNull();
  });
});

describe("filtr odeslané pošty", () => {
  const items: SentItem[] = [
    { id: "1", type: "E-mail", rawType: "email_reply", title: "Re: poptávka", target: "jan@firma.cz", body: "", sentAt: "2026-10-22T10:00:00Z", auto: false, kind: "email", jobNumber: "Z-2026-001" },
    { id: "2", type: "Nabídka", rawType: "quote", title: "Cenová nabídka NAB-2026-002", target: "eva@firma.cz", body: "", sentAt: "2026-10-21T10:00:00Z", auto: true },
    { id: "3", type: "Upomínka", rawType: "reminder", title: "Upomínka", target: "x@y.cz", body: "", sentAt: "2026-10-20T10:00:00Z", auto: false },
  ];
  it("podle druhu, automatiky a hledání", () => {
    expect(filterSent(items, { kind: "all" })).toHaveLength(3);
    expect(filterSent(items, { kind: "quote" }).map((i) => i.id)).toEqual(["2"]);
    expect(filterSent(items, { kind: "auto" }).map((i) => i.id)).toEqual(["2"]);
    expect(filterSent(items, { kind: "all", query: "z-2026-001" }).map((i) => i.id)).toEqual(["1"]);
    expect(filterSent(items, { kind: "all", query: "eva nabidka" }).map((i) => i.id)).toEqual(["2"]);
  });
  it("počty", () => {
    expect(countSentKinds(items)).toEqual({ all: 3, email: 1, quote: 1, reminder: 1, supplier: 0, auto: 1 });
  });
});

describe("kód kategorie z popisku", () => {
  it("převod tam a zpět", () => {
    expect(categoryCodeFromLabel("Potvrzení objednávky")).toBe("potvrzeni_objednavky");
    expect(categoryCodeFromLabel("Spam")).toBe("spam");
    expect(categoryCodeFromLabel("Nesmysl")).toBeNull();
    for (const c of INBOX_CATEGORIES) expect(categoryCodeFromLabel(c)).not.toBeNull();
  });
});
