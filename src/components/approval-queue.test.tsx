import { describe, it, expect, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/app/actions/approvals", () => ({ resolveApproval: vi.fn(), updateApprovalBody: vi.fn() }));
vi.mock("@/components/automation-provider", () => ({ useAutomation: () => ({ mode: "approval", setMode: vi.fn() }) }));

import { ApprovalQueue } from "./approval-queue";

const now = Date.now();
const iso = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString();

describe("Fronta schvalování — oba autoři (kdo připravil, kdo vyřídil)", () => {
  it("čekající: kdo návrh připravil; vyřízené: Schváleno / Zamítnuto · jméno, automaticky = ✨ AI", () => {
    const html = renderToString(
      <ApprovalQueue
        initialItems={[{
          id: "a1", rawType: "reminder", type: "Upomínka", title: "Připomenout nabídku NAB-1", summary: "", target: "x@y.cz",
          body: "Dobrý den", createdAt: iso(5), aiConfidence: 0.8, proposedBy: "Systém (plánovač)",
        }]}
        recent={[
          { id: "r1", title: "Odpověď: Poptávka", type: "Odpověď", status: "approved", proposedBy: "✨ AI", stamp: { by: { id: "u1", name: "Petr Obchodník" }, byName: "Petr Obchodník", at: iso(10), via: null, kind: "user" } },
          { id: "r2", title: "Odpověď: Faktura", type: "Odpověď", status: "auto_executed", proposedBy: "✨ AI", stamp: { by: null, byName: null, at: iso(20), via: "automaticky", kind: "ai" } },
          { id: "r3", title: "Nabídka NAB-2", type: "Nabídka", status: "rejected", proposedBy: "✨ AI", stamp: { by: { id: "u2", name: "Super Admin" }, byName: "Super Admin", at: iso(30), via: null, kind: "user" } },
        ]}
      />,
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("připravil Systém (plánovač)");
    expect(html).toContain("Naposledy vyřízeno");
    expect(html).toContain("Schváleno · P. Obchodník");
    expect(html).toContain("Odesláno automaticky · ✨ AI");
    expect(html).toContain("Zamítnuto · S. Admin");
    expect(html).toContain("připravil ✨ AI");
    expect(html).toContain("text-red-700");
  });
});
