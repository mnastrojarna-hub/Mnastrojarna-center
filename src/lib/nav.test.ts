import { describe, expect, it } from "vitest";
import { activeNavHref, allNavItems, matchesNavPath } from "@/lib/nav";

describe("aktivní položka navigace", () => {
  const hrefs = allNavItems.map((i) => i.href);

  it("podstránka patří k položce, podobný prefix ne", () => {
    expect(matchesNavPath("/orders/abc", "/orders")).toBe(true);
    expect(matchesNavPath("/orders", "/orders")).toBe(true);
    expect(matchesNavPath("/ordersx", "/orders")).toBe(false);
  });

  it("vyhraje nejdelší shoda — na auditu svítí jen Audit", () => {
    expect(activeNavHref("/settings/audit", hrefs)).toBe("/settings/audit");
    expect(activeNavHref("/settings", hrefs)).toBe("/settings");
    expect(activeNavHref("/orders/123", hrefs)).toBe("/orders");
    expect(activeNavHref("/neznamo", hrefs)).toBeNull();
  });
});
