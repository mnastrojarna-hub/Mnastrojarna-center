/**
 * Formulář úpravy pružiny (nález 9 recenze): operace „přidat“ (zapisuje ji průvodce „do tohoto dílu“ i text `přidat`) má vlastní
 * zvýrazněnou volbu – dřív nabízel přepínač jen nové / odebrat / průnik a při mode = "add" nebylo zvýrazněno nic.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Feature } from "@/cad/types";
import { getExtUi } from "../ext/registry";
import { calcExtension, calcTorsion } from "@/cad/springs";
import { libraryToSpring } from "./create";
import { MODE_OPTIONS } from "./register";

const form = (mode: string) => {
  const Form = getExtUi("spring.compression")!.Form!;
  const f = { id: "s", name: "Pružina", type: "ext", ext: "spring.compression", data: { d: 2, De: 20, L0: 50, n: 8, ends: "ground", at: [0, 0, 0], axis: "Z", mode } } as unknown as Extract<Feature, { type: "ext" }>;
  return renderToStaticMarkup(createElement(Form, { f, onChange: () => undefined } as never));
};
/** text zvýrazněné volby přepínače Operace (aktivní tlačítko má bílé pozadí) */
const active = (html: string) => [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g)].filter((m) => /\bbg-white\b/.test(m[1])).map((m) => m[2]);

describe("formulář pružiny – operace", () => {
  it("volby nové / přidat / odebrat / průnik; zvýrazněná odpovídá data.mode", () => {
    expect(MODE_OPTIONS.map((o) => o.v)).toEqual(["new", "add", "cut", "intersect"]);
    expect(active(form("add"))).toContain("Přidat");
    expect(active(form("new"))).toContain("Nové těleso");
    expect(active(form("cut"))).toContain("Odebrat");
    expect(active(form("intersect"))).toContain("Průnik");
    // neznámá / chybějící hodnota = nové těleso (výchozí)
    expect(active(form(""))).toContain("Nové těleso");
  });
});

describe("knihovna → předvyplněná tabulka (nález 10)", () => {
  it("zkrutná: úhel ramen z knihovny (výchozí 90°) = zlomek závitu n + úhel/360", () => {
    const t = libraryToSpring("springTorsion", { d: 2, D: 16, n: 5, leg: 30, angle: 90 });
    expect(t).toEqual({ kind: "torsion", data: { d: 2, De: 16, n: 5.25, l1: 30, l2: 30 } });
    expect(calcTorsion(t.data!).v.legAngle).toBeCloseTo(90, 9);
    expect(calcTorsion(libraryToSpring("springTorsion", { d: 2, D: 16, n: 5, leg: 30, angle: 180 }).data!).v.legAngle).toBeCloseTo(180, 9);
    expect(calcTorsion(libraryToSpring("springTorsion", { d: 2, D: 16, n: 5, leg: 30 }).data!).v.legAngle).toBeCloseTo(90, 9);
  });
  it("tažná: délka těla L z knihovny – těsně vinuté tělo Lk = (n + 1) · d → n = L/d − 1", () => {
    const e = libraryToSpring("springExt", { d: 1.6, D: 12, L: 40, n: 10 });
    expect(e.data).toMatchObject({ d: 1.6, De: 12, n: 24 });
    expect(calcExtension(e.data!).v.Lk).toBeCloseTo(40, 9);
    // bez délky zůstane počet závitů
    expect(libraryToSpring("springExt", { d: 1.6, D: 12, n: 10 }).data).toMatchObject({ n: 10 });
  });
});
