import { describe, it, expect } from "vitest";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { PriorityBadge, PrioritySelect, clampPriority, priorityFromLevel, priorityStyle, priorityTitle, PRIORITY_VALUES } from "./index";

const html = (n: React.ReactNode) => renderToString(n).replace(/<!-- -->/g, "");

describe("priorita 1–5 — logika", () => {
  it("rozsah, barvy, z AI úrovně", () => {
    expect(PRIORITY_VALUES).toEqual([1, 2, 3, 4, 5]);
    expect(clampPriority(0)).toBe(1);
    expect(clampPriority(9)).toBe(5);
    expect(clampPriority("x")).toBe(3);
    expect(priorityStyle(1).label).toBe("Nejvyšší");
    expect(priorityStyle(1).solid).toContain("bg-red-600");
    expect(priorityStyle(5).label).toBe("Nejnižší");
    expect(priorityFromLevel("vysoka")).toBe(2);
    expect(priorityFromLevel("nizka")).toBe(4);
    expect(priorityFromLevel(null)).toBe(3);
    expect(priorityTitle(1, { manual: true, by: "Jan" })).toBe("Priorita 1 – Nejvyšší (ručně, Jan)");
    expect(priorityTitle(3)).toBe("Priorita 3 – Normální (AI / pravidla)");
  });
});

describe("priorita — komponenty", () => {
  it("štítek: P1 plný (ručně), P3 jemný (AI), popisek pro čtečky", () => {
    const manual = html(<PriorityBadge value={1} manual by="Jan" showLabel />);
    expect(manual).toContain("P1");
    expect(manual).toContain("Nejvyšší");
    expect(manual).toContain("bg-red-600");
    expect(manual).toContain('data-priority="1"');
    expect(manual).toContain('aria-label="Priorita 1 – Nejvyšší (ručně, Jan)"');
    const ai = html(<PriorityBadge value={3} />);
    expect(ai).toContain("bg-sky-50");
    expect(ai).not.toContain("bg-sky-600");
  });
  it("výběr inline: 5 tlačítek, vybrané aria-checked, návrat na AI jen u ruční", () => {
    const h = html(<PrioritySelect inline value={2} manual onChange={() => {}} />);
    expect(h.match(/role="radio"/g)).toHaveLength(5);
    expect(h).toContain('aria-checked="true" aria-label="Priorita 2 – Vysoká"');
    expect(h).toContain("Zpět na prioritu z AI");
    expect(html(<PrioritySelect inline value={2} onChange={() => {}} />)).not.toContain("Zpět na prioritu z AI");
  });
  it("výběr v nabídce: štítek jako spouštěč", () => {
    const h = html(<PrioritySelect value={4} onChange={() => {}} />);
    expect(h).toContain('data-testid="priority-select"');
    expect(h).toContain("P4");
    expect(h).toContain("Priorita: 4 – Nízká. Změnit");
  });
});
