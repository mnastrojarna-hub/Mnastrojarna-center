import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Hlavní menu vlevo (majitel 3. 11.): jde sbalit na ikony, volba se pamatuje pro uživatele (profiles.ui_prefs)
const nav = { pathname: "/orders" };
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { Sidebar, sidebarMode } from "./sidebar";
import { UiPrefsProvider } from "@/components/ui-prefs/use-ui-prefs";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Feature } from "@/lib/auth/permissions";
import type { UiPrefs } from "@/lib/ui-prefs";

const SALES: Feature[] = ["orders", "workflow", "documents", "mail", "margins"];
const html = (prefs: UiPrefs) =>
  renderToString(
    <UiPrefsProvider userId="u1" server={prefs}>
      <TooltipProvider>
        <Sidebar features={SALES} counts={{ inbox: 7, quotes: 2 }} userName="Petr Obchodník" roleLabel="Obchodník" />
      </TooltipProvider>
    </UiPrefsProvider>,
  ).replace(/<!-- -->/g, "");

describe("hlavní menu — sbalení na ikony", () => {
  it("režim: volba uživatele má přednost; bez volby v Poště automaticky (CSS pod 1440 px), jinde rozbalené", () => {
    expect(sidebarMode(true, "/orders")).toBe("collapsed");
    expect(sidebarMode(false, "/inbox")).toBe("expanded");
    expect(sidebarMode(undefined, "/inbox")).toBe("auto");
    expect(sidebarMode(undefined, "/orders")).toBe("expanded");
  });

  it("rozbalené: popisky, odznaky a tlačítko Sbalit menu", () => {
    nav.pathname = "/orders";
    const h = html({});
    expect(h).toContain('data-sidebar="expanded"');
    expect(h).toContain('data-testid="sidebar-toggle"');
    expect(h).toContain('aria-label="Sbalit menu na ikony"');
    expect(h).toContain("Kniha zakázek");
    expect(h).toMatch(/sb-count[^>]*>7</);
  });

  it("sbalené (uložená volba): jen ikony s popiskem pro čtečky a počtem, tlačítko Rozbalit menu", () => {
    nav.pathname = "/orders";
    const h = html({ "app.sidebarCollapsed": true });
    expect(h).toContain('data-sidebar="collapsed"');
    expect(h).toContain('data-collapsed="1"');
    expect(h).toContain('aria-label="Rozbalit menu"');
    expect(h).toContain('aria-label="Pošta (7)"');
    expect(h).toContain('aria-label="Můj účet — Petr Obchodník"');
  });

  it("Pošta bez volby: auto (sbalí se samo na menší obrazovce); s volbou rozbalené zůstane rozbalené", () => {
    nav.pathname = "/inbox";
    expect(html({})).toContain('data-sidebar="auto"');
    expect(html({ "app.sidebarCollapsed": false })).toContain('data-sidebar="expanded"');
  });
});
