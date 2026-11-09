import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";

vi.mock("@/app/actions/mail-stage", () => ({
  confirmStageSignalAction: vi.fn(), undoStageSignalAction: vi.fn(), changeStageSignalAction: vi.fn(),
  getThreadStageSignalsAction: vi.fn(() => Promise.resolve([])), getApprovalStageSignalAction: vi.fn(() => new Promise(() => {})),
  getStageSignalAction: vi.fn(() => new Promise(() => {})),
}));

import { MailStageCard, StageChoiceEditor } from "./mail-stage-signal";
import type { MailStageView } from "@/lib/email/mail-stage-store";

const html = (n: React.ReactNode) => renderToString(n).replace(/<!-- -->/g, "");
const flat = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const base: MailStageView = {
  id: "s1", jobId: "j1", jobNumber: "Z-2026-014", emailId: "e1", threadId: "t1", kind: "reklamace", finalKind: null, status: "pending",
  reason: "Nesedí rozměry dle výkresu", quote: null, lostReason: null, claimReason: "rozmery", confidence: 0.85, source: "rules",
  from: "Jan Dvořák", auto: false, fromStage: null, toStage: null, options: ["reklamace", "pozastaveno"], undoable: false, createdAt: "2026-11-09T10:00:00Z",
};
const noop = () => undefined;

describe("pošta → speciální stav zakázky (UI)", () => {
  it("návrh: tlačítko „Přepnout zakázku do Reklamace“, Upravit…, Ne, žádná změna", () => {
    const h = html(<MailStageCard view={base} onDone={noop} onError={noop} />);
    const t = flat(h);
    expect(h).toContain('data-testid="mail-stage-pending"');
    expect(t).toContain("E-mail naznačuje: Reklamace · Z-2026-014");
    expect(t).toContain("Přepnout zakázku do Reklamace");
    expect(t).toContain("Upravit…");
    expect(t).toContain("Ne, žádná změna");
    expect(t).toContain("„Nesedí rozměry dle výkresu“ — Jan Dvořák");
  });

  it("přepnuto AI: Vrátit / Změnit…, po pozdější změně stavu jen rada", () => {
    const applied = { ...base, status: "applied" as const, finalKind: "reklamace" as const, auto: true, fromStage: "dodano_zakaznikovi" as const, toStage: "reklamace" as const, undoable: true };
    const t = flat(html(<MailStageCard view={applied} onDone={noop} onError={noop} />));
    expect(t).toContain("AI přepnula podle e-mailu: Dodáno zákazníkovi");
    expect(t).toContain("Vrátit");
    expect(t).toContain("Změnit…");
    const stale = flat(html(<MailStageCard view={{ ...applied, undoable: false }} onDone={noop} onError={noop} />));
    expect(stale).not.toContain("Vrátit");
    expect(stale).toContain("Korekce stavu");
  });

  it("výběr: stavy podle zakázky + Žádná změna, druh reklamace, důvod prohry u uzavření", () => {
    const h = html(<StageChoiceEditor view={base} value={{ kind: "reklamace", reason: "x", claimReason: "rozmery" }} onChange={noop} idPrefix="t" />);
    expect(flat(h)).toContain("Žádná změna (e-mail to nenaznačuje)");
    expect(flat(h)).toContain("Rozměry / tolerance");
    const lost = html(<StageChoiceEditor view={{ ...base, options: ["nerealizovano"] }} value={{ kind: "nerealizovano", reason: "x", lostReason: "jiny_dodavatel" }} onChange={noop} idPrefix="u" />);
    expect(flat(lost)).toContain("Vybral jiného dodavatele");
    expect(flat(lost)).not.toContain("Výroba se nepovedla");
  });
});
