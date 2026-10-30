import { describe, it, expect } from "vitest";
import { sendReceiveText, type SendOutcome } from "./send-receive";
import {
  LIVE_FAST_MIN_INTERVAL_MS, LIVE_FAST_MS, LIVE_INTERVAL_MS, LIVE_MIN_INTERVAL_MS, fastOverride, liveInterval, nextDelay, updatedAgoLabel,
} from "./live-poll";

const sent = (p: Partial<SendOutcome> = {}): SendOutcome => ({ ok: true, sent: 0, failed: 0, errors: [], needsSettings: false, waitingDrawings: 0, blockedDrawings: 0, ...p });

describe("Přijmout a odeslat — hláška", () => {
  it("vše prošlo: Přijato 3, odesláno 1.", () => {
    const r = sendReceiveText({ ok: true, configured: true, ingested: 3, text: "Staženo 5, nových 3." }, sent({ sent: 1 }));
    expect(r).toEqual({ ok: true, text: "Přijato 3, odesláno 1.", needsSettings: false });
  });
  it("odeslání z fronty selhalo na hesle → co opravit a kde", () => {
    const r = sendReceiveText(
      { ok: true, configured: true, ingested: 0, text: "Staženo 0, nových 0." },
      sent({ failed: 2, needsSettings: true, errors: [{ subject: "Nabídka", error: "Odeslání selhalo — Přihlášení odmítnuto (535)." }] }),
    );
    expect(r.ok).toBe(false);
    expect(r.needsSettings).toBe(true);
    expect(r.text).toContain("Přijato 0, odesláno 0.");
    expect(r.text).toContain("Neodesláno 2 zprávy („Nabídka“): Odeslání selhalo — Přihlášení odmítnuto (535).");
    expect(r.text).toContain("Nastavení pošty → Schránka");
  });
  it("příjem: odmítnuté heslo → Nastavení pošty; bez schránky → připojit", () => {
    const bad = sendReceiveText({ ok: false, configured: true, ingested: 0, text: "vit@x.cz: Heslo odmítnuto — oprav ho." }, sent());
    expect(bad.ok).toBe(false);
    expect(bad.needsSettings).toBe(true);
    expect(bad.text).toContain("Příjem: vit@x.cz: Heslo odmítnuto");
    const none = sendReceiveText({ ok: false, configured: false, ingested: 0, text: "Zatím nemáš připojenou e-mailovou schránku." }, sent());
    expect(none.needsSettings).toBe(true);
    expect(none.text).toContain("Zatím nemáš připojenou");
  });
  it("výkresy čekající na anonymizaci / kontrolu se jen oznámí (odejdou samy)", () => {
    const r = sendReceiveText({ ok: true, configured: true, ingested: 1, text: "" }, sent({ sent: 1, waitingDrawings: 2, blockedDrawings: 1 }));
    expect(r.ok).toBe(true);
    expect(r.text).toBe("Přijato 1, odesláno 1. Čeká na anonymizaci výkresů: 2 (odejde samo, až bude hotovo). Čeká na tvou kontrolu výkresů v zakázce: 1.");
  });
  it("síť při odesílání / příjem nedoběhl", () => {
    const r = sendReceiveText(null, sent({ ok: false, error: "Odeslání selhalo (síť)." }));
    expect(r.ok).toBe(false);
    expect(r.text).toBe("Přijato 0, odesláno 0. Odesílání: Odeslání selhalo (síť).");
  });
});

describe("živá pošta v otevřené Poště", () => {
  it("otevřená Pošta 30 s, jinak 60 s; server pouští schránku nejdřív po 25 / 45 s", () => {
    expect(liveInterval(true)).toBe(LIVE_FAST_MS);
    expect(LIVE_FAST_MS).toBe(30_000);
    expect(liveInterval(false)).toBe(LIVE_INTERVAL_MS);
    expect(LIVE_FAST_MIN_INTERVAL_MS).toBeLessThan(LIVE_FAST_MS);
    expect(LIVE_MIN_INTERVAL_MS).toBeLessThan(LIVE_INTERVAL_MS);
    // odstup při chybách platí i pro rychlý interval
    expect(nextDelay(2, liveInterval(true))).toBe(4 * LIVE_FAST_MS);
  });
  it("karta s Poštou nečeká na pomalou kartu se zápůjčkou, když je výsledek starší než ~25 s", () => {
    const now = 1_000_000;
    expect(fastOverride(true, now - 26_000, now)).toBe(true);
    expect(fastOverride(true, now - 10_000, now)).toBe(false);
    expect(fastOverride(false, now - 120_000, now)).toBe(false);
    expect(fastOverride(true, null, now)).toBe(true);
  });
  it("„Aktualizováno před X s“", () => {
    const now = 10_000_000;
    expect(updatedAgoLabel(null, now)).toBe("Aktualizuji…");
    expect(updatedAgoLabel(now - 2_000, now)).toBe("Aktualizováno právě teď");
    expect(updatedAgoLabel(now - 12_000, now)).toBe("Aktualizováno před 12 s");
    expect(updatedAgoLabel(now - 150_000, now)).toBe("Aktualizováno před 3 min");
  });
});
