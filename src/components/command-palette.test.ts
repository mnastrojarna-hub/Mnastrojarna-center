import { describe, it, expect } from "vitest";
import { paletteScore, rankEntries } from "@/components/command-palette";
import { searchNormalize } from "@/lib/jobs/mapping";

const e = (label: string, ...kw: string[]) => ({ label, keywords: searchNormalize([label, ...kw].join(" ")) });

describe("⌘K hledání", () => {
  const jobs = [
    e("Z-2026-014 · Příruby AL", "Strojmetal a.s.", "PO-4500021877", "PR-1"),
    e("Z-2026-002 · Hřídel 42CrMo4", "Česká Ocel s.r.o."),
    e("Z-2025-099 · Pouzdra", "Hofmann GmbH"),
  ];

  it("bez hledání vrátí prvních N", () => {
    expect(rankEntries(jobs, "", 2)).toHaveLength(2);
    expect(rankEntries(jobs, "  ", 0)).toEqual([]);
  });

  it("hledá bez diakritiky v číslech i zákaznících", () => {
    expect(rankEntries(jobs, "ceska ocel", 8).map((j) => j.label)).toEqual(["Z-2026-002 · Hřídel 42CrMo4"]);
    expect(rankEntries(jobs, "4500021877", 8)).toHaveLength(1);
    expect(rankEntries(jobs, "hridel", 8)).toHaveLength(1);
    expect(rankEntries(jobs, "neexistuje", 8)).toEqual([]);
  });

  it("začátek popisku má přednost před shodou v klíčových slovech", () => {
    const list = [e("Hofmann objednávka", "x"), e("Pouzdra", "hofmann")];
    expect(rankEntries([...list].reverse(), "hofmann", 8).map((x) => x.label)).toEqual(["Hofmann objednávka", "Pouzdra"]);
    expect(paletteScore("hof", list[0])).toBe(3);
    expect(paletteScore("hof", list[1])).toBe(1);
    expect(paletteScore("", list[1])).toBe(1);
  });

  it("všechna slova musí sedět", () => {
    expect(paletteScore("z-2026 pouzdra", jobs[2])).toBe(0);
    expect(paletteScore("z-2025 pouzdra", jobs[2])).toBeGreaterThan(0);
  });
});
