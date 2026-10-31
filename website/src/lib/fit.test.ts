import { describe, expect, it } from "vitest";
import { boxFits, checkFit } from "./fit";

const ok = (r: ReturnType<typeof checkFit>) => r.filter((x) => x.ok).map((x) => x.id);

describe("Vejde se váš díl?", () => {
  it("kvádr v libovolné orientaci", () => {
    expect(boxFits([500, 700, 300], [754, 500, 550])).toBe(true);
    expect(boxFits([800, 100, 100], [754, 500, 550])).toBe(false);
  });
  it("hřídel Ø 80 × 600 mm jde na soustruh i frézky", () => {
    expect(ok(checkFit({ shape: "rot", d: 80, len: 600, kg: 25 }))).toEqual(["axile-g8", "hypertun-65", "mcv-754q", "vmca-760"]);
  });
  it("příruba Ø 950 × 200 mm, 900 kg jen na AXILE G8", () => {
    expect(ok(checkFit({ shape: "rot", d: 950, len: 200, kg: 900 }))).toEqual(["axile-g8"]);
  });
  it("hmotnost nad 3 t nevyrobíme na žádném frézovacím centru", () => {
    expect(ok(checkFit({ shape: "prism", x: 600, y: 400, z: 200, kg: 3500 }))).toEqual(["fanuc-robocut"]);
  });
  it("velký profil pro drátové řezání", () => {
    expect(ok(checkFit({ shape: "edm", x: 1200, y: 900, z: 450 }))).toEqual(["fanuc-robocut"]);
    expect(ok(checkFit({ shape: "edm", x: 1300, y: 900, z: 450 }))).toEqual([]);
  });
  it("nevyplněné rozměry nic nevrátí", () => {
    expect(ok(checkFit({ shape: "prism", x: 0, y: 0, z: 0 }))).toEqual([]);
  });
});
