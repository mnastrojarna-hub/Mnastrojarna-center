import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/settings/audit",
}));

import {
  actionLabel, auditEntryFromRow, auditHref, auditSummary, diffLines, entityLabel, periodFrom, pragueDayEnd, pragueDayStart,
  type AuditRow,
} from "./audit-model";
import { AuditList } from "./audit-list";
import { AuditFilters } from "./audit-filters";

const row = (over: Partial<AuditRow> = {}): AuditRow => ({
  id: 1, created_at: "2026-10-23T08:00:00Z", action: "settings_updated", entity: "integration_settings", entity_id: "quote_approval_limit",
  diff: { key: "quote_approval_limit", from: null, to: "500000", byName: "Super Admin" },
  actor_id: "u1", actor_kind: "user", actor_name: "Super Admin", via: "rucne",
  actor: { id: "u1", full_name: "Super Admin", email: "admin@local.test" },
  ...over,
});

describe("audit — popisky a mapování", () => {
  it("akce a entity česky; <tabulka>_deleted z DB = Smazáno", () => {
    expect(actionLabel("automation_mode_changed")).toBe("Změněn režim automatiky");
    expect(actionLabel("orders_deleted", "orders")).toBe("Smazáno: zakázky");
    expect(actionLabel("neco_noveho")).toBe("Neco noveho");
    expect(entityLabel("purchase_orders")).toBe("Objednávky dodavatelům");
    expect(entityLabel("x_y")).toBe("x y");
  });

  it("souhrn: smazaný řádek (číslo — název), změna z → na, jméno", () => {
    expect(auditSummary("orders_deleted", { row: { number: "Z-2026-871", title: "Upínky" } })).toBe("Z-2026-871 — Upínky");
    expect(auditSummary("automation_mode_changed", { module: "quote", from: "full", to: "approval" })).toBe("quote: plná automatika → se schválením");
    expect(auditSummary("customer_created", { name: "Strojmetal" })).toBe("Strojmetal");
    expect(auditSummary("settings_updated", { keys: ["a", "b"] })).toBe("a, b");
    expect(auditSummary("x", null)).toBeNull();
  });

  it("odkaz: zakázka, zákazník; smazaná zakázka bez odkazu, objekt zakázky na zakázku", () => {
    const id = "d0000000-0000-0000-0000-000000000006";
    expect(auditHref("orders", id, null, false)).toBe(`/orders/${id}`);
    expect(auditHref("orders", id, null, true)).toBeNull();
    expect(auditHref("quotes", "q", { jobId: id }, true)).toBe(`/orders/${id}`);
    expect(auditHref("customers", id, null, false)).toBe(`/customers/${id}`);
    expect(auditHref("mailboxes", id, null, false)).toBeNull();
  });

  it("autor nikdy prázdný: profil, smazaný účet (actor_name), AI, systém", () => {
    expect(auditEntryFromRow(row()).stamp).toMatchObject({ by: { id: "u1", name: "Super Admin" }, kind: "user", via: "rucne" });
    const gone = auditEntryFromRow(row({ actor: null, actor_id: null, actor_kind: "user", actor_name: "Vít Volný" }));
    expect(gone.stamp).toMatchObject({ by: null, byName: "Vít Volný", kind: "user" });
    expect(auditEntryFromRow(row({ actor: null, actor_id: null, actor_kind: "ai", actor_name: null, via: "email" })).stamp.kind).toBe("ai");
    const sys = auditEntryFromRow(row({ actor: null, actor_id: null, actor_kind: null, actor_name: null, via: "cron", diff: null }));
    expect(sys.stamp).toMatchObject({ kind: "system", via: "cron" });
    expect(auditEntryFromRow(row({ action: "orders_deleted", entity: "orders" })).destructive).toBe(true);
  });

  it("pražský den: začátek/konec v létě i v zimě, rychlé období", () => {
    expect(pragueDayStart("2026-07-01")).toBe("2026-06-30T22:00:00.000Z");
    expect(pragueDayStart("2026-12-01")).toBe("2026-11-30T23:00:00.000Z");
    expect(pragueDayEnd("2026-10-23")).toBe("2026-10-23T22:00:00.000Z");
    expect(pragueDayStart("nesmysl")).toBeNull();
    expect(periodFrom("dnes", "2026-10-23")).toBe("2026-10-23");
    expect(periodFrom("7d", "2026-10-23")).toBe("2026-10-17");
    expect(periodFrom("30d", "2026-10-23")).toBe("2026-09-24");
    expect(periodFrom("", "2026-10-23")).toBeNull();
  });

  it("řádky diffu: bez byName, zkrácené, ze smazaného řádku", () => {
    expect(diffLines({ byName: "x", a: 1, b: "y".repeat(200) }).map((l) => [l.key, l.value.length])).toEqual([["a", 1], ["b", 158]]);
    expect(diffLines({ row: { number: "Z-1", note: null } })).toEqual([{ key: "number", value: "Z-1" }]);
  });
});

describe("audit — render", () => {
  it("seznam: akce, entita, autor jako text, odkaz, podrobnosti; prázdný stav", () => {
    const html = renderToString(<AuditList entries={[
      auditEntryFromRow(row()),
      auditEntryFromRow(row({ id: 2, action: "orders_deleted", entity: "orders", entity_id: "x", diff: { row: { number: "Z-2026-871", title: "Upínky" } } })),
      auditEntryFromRow(row({ id: 3, action: "quotes_deleted", entity: "quotes", entity_id: "q", diff: { row: { number: "NAB-1" }, jobId: "d0000000-0000-0000-0000-000000000006" } })),
    ]} now={new Date("2026-10-23T09:00:00Z")} />).replace(/<!-- -->/g, "");
    expect(html).toContain("Změněno nastavení");
    expect(html).toContain("— → 500000");
    expect(html.replace(/<[^>]+>/g, "")).toContain("Super Admin · před 1 h"); // jméno a čas zvlášť
    expect(html).toContain("Smazáno: zakázky");
    expect(html).toContain("/orders/d0000000-0000-0000-0000-000000000006");
    expect(html).toContain("Podrobnosti");
    expect(html).toContain("text-[11px]");
    expect(html).toContain("bg-red-100 text-red-700");
    expect(renderToString(<AuditList entries={[]} />)).toContain("Pro tento filtr nejsou žádné záznamy");
  });

  it("filtry: osoba (i AI a Systém), entita, období jedním ťuknutím, od–do", () => {
    const html = renderToString(<AuditFilters
      value={{ osoba: "", entita: "", od: "", do: "", obdobi: "7d" }}
      actors={[{ id: "u1", name: "Super Admin" }]}
      entities={["orders", "integration_settings"]}
    />);
    expect(html).toContain("✨ AI");
    expect(html).toContain("Systém (plánovač, přímý zápis)");
    expect(html).toContain("Super Admin");
    expect(html).toContain("Zakázky");
    expect(html).toContain("Nastavení");
    expect(html).toMatch(/aria-pressed="true"[^>]*>7 dní/);
    expect(html).toContain('aria-label="Od"');
    expect(html).toContain("Zrušit filtr");
  });
});
