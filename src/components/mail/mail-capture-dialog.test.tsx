import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/inbox",
}));
vi.mock("@/components/access-provider", () => ({ useAccess: () => ({ features: ["orders", "ai_capture"], role: null, userId: "u1", can: () => true }) }));
vi.mock("@/app/actions/capture", () => ({ createCaptureUpload: vi.fn(), discardCapture: vi.fn() }));
vi.mock("@/app/actions/mail-capture", () => ({ finishMailCaptureAction: vi.fn(), mailCapturePlanAction: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import { MailCaptureDialog, SenderContactPanel, primaryJobOf } from "./mail-capture-dialog";
import type { MailCapturePlan } from "@/lib/email/mail-capture";

const html = (n: React.ReactNode) => renderToString(n).replace(/<!-- -->/g, "");

const plan = (over: Partial<MailCapturePlan> = {}): MailCapturePlan => ({
  ok: true, files: 4, skipped: [{ id: "a5", filename: "image001.png", reason: "logo / obrázek z podpisu" }], subject: "Poptávka hřídele",
  customer: { id: "c1", name: "Strojmetal" }, jobId: null, resumable: false,
  sender: { status: "new", name: "Petra Nová", email: "petra@strojmetal.cz", phone: "+420 777 123 456", contactId: null },
  ...over,
});

describe("Pošta → přílohy do dávky focení (dialog)", () => {
  it("nový odesílatel: přidat do kontaktů zákazníka je předvybrané, vynechané přílohy vidět", () => {
    const out = html(<SenderContactPanel plan={plan()} add onAdd={() => {}} />);
    expect(out).toContain('data-testid="mail-capture-add-contact"');
    expect(out).toMatch(/checked=""/);
    expect(out).toContain("Petra Nová");
    expect(out).toContain("Strojmetal");
    expect(out).toContain("image001.png (logo / obrázek z podpisu)");
  });

  it("existující kontakt: bez zaškrtávátka, jen informace", () => {
    const out = html(<SenderContactPanel plan={plan({ sender: { status: "existing", name: "Petra Nová", email: "petra@strojmetal.cz", phone: "", contactId: "k1" } })} add={false} onAdd={() => {}} />);
    expect(out).not.toContain("mail-capture-add-contact");
    expect(out).toContain("už je v Kartě zákazníka");
  });

  it("hlavní zakázka dávky = první uložená skupina", () => {
    expect(primaryJobOf({ groups: [{ key: "g1", ok: false, created: false }, { key: "g2", ok: true, jobId: "j2", jobNumber: "Z-2026-002", created: true }] })).toEqual({ jobId: "j2", jobNumber: "Z-2026-002", created: true });
    expect(primaryJobOf({ groups: [] })).toBeNull();
  });

  it("dialog se vykreslí jako „Přílohy e-mailu“ (SSR bez pádu)", () => {
    const out = html(<MailCaptureDialog request={{ threadId: "t1", emailId: "e1", key: "job.create", plan: plan() }} onClose={() => {}} onFinished={() => {}} />);
    expect(typeof out).toBe("string");
  });
});
