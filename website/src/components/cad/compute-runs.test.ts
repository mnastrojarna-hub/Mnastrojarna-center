/**
 * Vlna 22, bod 12 (kolo 3): výpočty uvnitř aplikace mají id běhu a revizi vstupu se stavy čeká / počítá / dokončeno /
 * nahrazeno / zrušeno / chyba (compute-runs.ts). Pozdní odpověď staršího výpočtu je „nahrazeno“, nikdy „dokončeno“.
 */
import { describe, expect, it } from "vitest";
import { setLang } from "@/cad/i18n";
import { emptyDoc, type CadDoc, type Feature } from "@/cad/types";
import { computeBegin, computesSnapshot, lastCompute, tracked } from "./compute-runs";

const part = (h = 10): CadDoc => ({ ...emptyDoc("Deska A"), features: [{ id: "f1", name: "Kvádr", type: "box", size: [20, 10, h], position: [0, 0, 0] } as unknown as Feature] });

describe("výpočty aplikace s identitou (compute-runs)", () => {
  it("stavba: id v…, revize vstupu <klíč>@r·…, stav počítá → dokončeno; jiná revize = jiný inputRev", () => {
    setLang("cs");
    const a = computeBegin("build", "k1", part(10));
    const e = lastCompute()!;
    expect(e.id).toBe(a.id);
    expect(e.id).toMatch(/^v\d+$/);
    expect(e.state).toBe("running");
    expect(e.inputRev).toMatch(/^k1@r·[0-9a-f]{6}$/);
    expect(e.label).toBe("stavba modelu");
    a.end("done");
    expect(computesSnapshot("build").at(-1)).toMatchObject({ id: a.id, state: "done", kind: "compute", what: "build" });
    const b = computeBegin("build", "k1", part(12));
    expect(computesSnapshot("build").at(-1)!.inputRev).not.toBe(computesSnapshot("build").at(-2)!.inputRev);
    b.end("done");
  });

  it("čekající stavba je „čeká“, nahrazená novějším stavem „nahrazeno“ – nikdy „dokončeno“; první konec platí", () => {
    const q1 = computeBegin("build", "k1", part(10), { queued: true });
    expect(lastCompute()!.state).toBe("queued");
    q1.end("superseded");
    q1.end("done"); // pozdní konec se nepřepíše
    expect(computesSnapshot("build").find((x) => x.id === q1.id)!.state).toBe("superseded");
  });

  it("tracked: výjimka = chyba (zrušení = zrušeno), konec z práce (nahrazeno) se nepřepíše na dokončeno", async () => {
    await expect(tracked("clash", "k2", part(), async () => Promise.reject(new Error("jádro spadlo")))).rejects.toThrow(/jádro spadlo/);
    expect(computesSnapshot("clash").at(-1)).toMatchObject({ state: "error", error: "jádro spadlo" });
    const cancelled = new Error("zrušeno");
    await expect(tracked("measure", "k2", part(), async () => Promise.reject(cancelled), (e) => e === cancelled)).rejects.toBe(cancelled);
    expect(computesSnapshot("measure").at(-1)!.state).toBe("cancelled");
    await tracked("mates", "k2", part(), async (run) => run.end("superseded"));
    expect(computesSnapshot("mates").at(-1)!.state).toBe("superseded");
    await tracked("mates", "k2", part(), async () => undefined);
    expect(computesSnapshot("mates").at(-1)!.state).toBe("done");
  });
});
