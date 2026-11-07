import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

// Spodní lišta na mobilu (#25): číslo na „Menu“ a počty v rozbaleném menu (stejné odznaky jako postranní menu)
vi.mock("next/navigation", () => ({
  usePathname: () => "/orders",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
// rozbalené menu se v SSR vykreslí rovnou (bez portálu), ať jde číst jeho obsah
const dialogOpen = { value: false };
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => (dialogOpen.value ? <div data-dialog>{children}</div> : null),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div role="dialog">{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }) }));
vi.mock("@/components/automation-mode-toggle", () => ({ AutomationModeToggle: () => <span data-automation>Auto | Schvál.</span> }));
vi.mock("@/components/layout/sign-out", () => ({ signOutEverywhere: vi.fn() }));

import { MobileNav, mobileMenuCount, navScrollStep, NAV_TOP_ZONE, overlayOpen } from "./mobile-nav";
import type { Feature } from "@/lib/auth/permissions";

const ADMIN: Feature[] = ["orders", "workflow", "documents", "mail", "margins", "pricing", "quote_approval", "flow_all", "dashboard"];
const SALES: Feature[] = ["orders", "workflow", "documents", "mail", "margins"];
const COUNTS = { inbox: 2, inquiries: 3, pricing: 1, quotes: 4, confirmations: 0, orders: 12, approvals: 5 };
const html = (el: React.ReactElement) => renderToString(el).replace(/<!-- -->/g, "");

describe("mobilní lišta — odznaky", () => {
  it("„Menu“: super admin = co čeká na jeho rozhodnutí (AI přehled), ostatní = moje nabídky", () => {
    expect(mobileMenuCount(ADMIN, COUNTS)).toBe(5);
    expect(mobileMenuCount(SALES, COUNTS)).toBe(4);
    expect(mobileMenuCount(SALES, { ...COUNTS, quotes: 0 })).toBe(0);
    expect(mobileMenuCount(SALES, null)).toBe(0);
    dialogOpen.value = false;
    const admin = html(<MobileNav features={ADMIN} counts={COUNTS} />);
    expect(admin).toContain('aria-label="Menu — 5 čeká"');
    expect(admin).toMatch(/Menu<span[^>]*>5<\/span>/);
    const sales = html(<MobileNav features={SALES} counts={COUNTS} />);
    expect(sales).toContain('aria-label="Menu — 4 čeká"');
    const none = html(<MobileNav features={SALES} counts={{ ...COUNTS, quotes: 0 }} />);
    expect(none).toContain('aria-label="Menu"');
    expect(none).not.toMatch(/Menu<span/);
  });

  it("rozbalené menu: počty u položek (Poptávky, Nabídky…), Nacenění jen super admin", () => {
    dialogOpen.value = true;
    const sales = html(<MobileNav features={SALES} counts={COUNTS} />);
    expect(sales).toMatch(/Poptávky<\/span><span[^>]*>3<\/span>/);
    expect(sales).toMatch(/Nabídky<\/span><span[^>]*>4<\/span>/);
    expect(sales).not.toContain('href="/pricing"');
    expect(sales).toContain('href="/purchasing"');
    const admin = html(<MobileNav features={ADMIN} counts={COUNTS} />);
    expect(admin).toContain('href="/pricing"');
    expect(admin).toMatch(/AI přehled<\/span><span[^>]*>5<\/span>/);
    dialogOpen.value = false;
  });

  it("R072: Menu nese účet — Můj účet, motiv, Odhlásit (všichni), režim AI jen super admin; jedna položka Pošta", () => {
    dialogOpen.value = true;
    const user = { fullName: "Jan Novák", roleLabel: "Obchodník" };
    const sales = html(<MobileNav features={SALES} counts={COUNTS} user={user} />);
    expect(sales).toContain('href="/account"');
    expect(sales).toContain("Jan Novák");
    expect(sales).toContain('data-testid="mobile-menu-theme"');
    expect(sales).toContain("Tmavý motiv");
    expect(sales).toContain("Odhlásit se");
    expect(sales).not.toContain("data-automation");
    expect(sales).not.toContain('href="/sent"');
    expect(sales).not.toContain("Odeslaná pošta");
    expect(sales).toMatch(/>Pošta<\/span>/);
    const admin = html(<MobileNav features={ADMIN} counts={COUNTS} user={user} />);
    expect(admin).toContain("data-automation");
    dialogOpen.value = false;
  });
});

describe("mobilní lišta — schování při posunu (majitel 7. 11.)", () => {
  const shown = { hidden: false, acc: 0 };
  it("posun dolů schová, posun nahoru ukáže; drobné cuknutí nic nemění", () => {
    let s = navScrollStep(shown, 200, 210, 2000);
    expect(s.hidden).toBe(false);
    s = navScrollStep(s, 210, 240, 2000);
    expect(s.hidden).toBe(true);
    s = navScrollStep(s, 240, 236, 2000);
    expect(s.hidden).toBe(true);
    s = navScrollStep(s, 236, 220, 2000);
    expect(s.hidden).toBe(false);
  });

  it("nahoře na stránce je lišta vždy vidět; pružení za koncem stránky ji nevrací", () => {
    expect(navScrollStep({ hidden: true, acc: 40 }, 100, NAV_TOP_ZONE - 1, 2000).hidden).toBe(false);
    // iOS pružení: scrollTop za maximem a zpět — poloha se ořízne na konec obsahu
    expect(navScrollStep({ hidden: true, acc: 40 }, 2080, 2000, 2000).hidden).toBe(true);
  });

  it("pod otevřeným dialogem / prohlížečem dokumentu se lišta schová, pod popoverem ne", () => {
    const el = (popper: boolean) => ({ closest: (sel: string) => (popper && sel.includes("popper") ? {} : null) });
    const doc = (list: { closest: (s: string) => unknown }[], locked = false) =>
      ({ body: { hasAttribute: () => locked }, querySelectorAll: () => list }) as unknown as Parameters<typeof overlayOpen>[0];
    expect(overlayOpen(doc([]))).toBe(false);
    expect(overlayOpen(doc([], true))).toBe(true);
    expect(overlayOpen(doc([el(false)]))).toBe(true);
    expect(overlayOpen(doc([el(true)]))).toBe(false);
  });

  it("vykreslení: lišta vidět, s testid a bez data-hidden; výška počítá i spodní okraj iPhonu", () => {
    dialogOpen.value = false;
    const out = html(<MobileNav features={SALES} counts={COUNTS} />);
    expect(out).toContain('data-testid="mobile-nav"');
    expect(out).not.toContain("data-hidden");
    expect(out).toContain("h-[calc(4rem+env(safe-area-inset-bottom))]");
    expect(out).toContain("motion-safe:transition-transform");
  });
});
