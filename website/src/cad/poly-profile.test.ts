/**
 * Hlášení agenta (11. vlna) s jádrem OCCT: profil zadaný textem jako několik lomených čar + oblouk se dřív rozpadl na dva
 * samostatně uzavřené obrysy (2 tělesa, 12 cm³ místo 13,21 cm³). Teď se čáry navázané na další entity neuzavírají a profil
 * se vysune jako jedno těleso. Vadný profil: chyba prvku i ⚠ říkají proč (profile-check.ts přes build.ts).
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { parseAgentText } from "./agent";
import { applySketchOp } from "./agent-sketch";
import { buildDoc, sketchChain } from "./build";
import { runText } from "./drawing-dims-harness";
import { emptyDoc, type CadDoc, type Feature } from "./types";
import "./ext/index";
import "./feat/index";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
}, 60_000);

/** text → dokument jako smyčka operací v cad-app.tsx (skica, entity, prvky s `$last` a režimem `$auto`) */
function docOf(text: string): { doc: CadDoc; log: string[] } {
  const doc = emptyDoc("Test");
  const log: string[] = [];
  const p = parseAgentText(text);
  expect(p.errors).toEqual([]);
  for (const op of p.ops) {
    if (op.k === "feature") {
      const f = { ...op.feature } as Feature & { sketchId?: string; mode?: string };
      if (f.sketchId === "$last") f.sketchId = [...doc.features].reverse().find((x) => x.type === "sketch")!.id;
      if (f.mode === "$auto") f.mode = doc.features.some((x) => x.type !== "sketch") ? "add" : "new";
      doc.features.push(f as Feature);
    } else if (op.k === "entities") log.push(...applySketchOp(doc.features, op));
  }
  return { doc, log };
}
const ARC = "oblouk 20 10 12,928932 12,928932 10 20";
/** L-profil 80 × 60, tloušťky 10, vnitřní zaoblení R10, vysunutý o 10 mm */
const L_VOL = (800 + 500 + (100 - 25 * Math.PI)) * 10;

describe("profil z lomených čar a oblouků se vysune (hlášení agenta)", () => {
  it("čáry + oblouk po řádcích → jedno těleso 13,21 cm³, prvky bez ⚠", async () => {
    const { doc, log } = docOf(`skica XY\nčára 0 0 80 0 80 10 20 10\n${ARC}\nčára 10 20 10 60 0 60 0 0\nvysunout 10`);
    expect(log.join("\n")).toContain("ℹ čára e1 otevřena");
    const res = await buildDoc(doc);
    expect(res.status.every((s) => s.ok && !s.warning)).toBe(true);
    expect(res.metrics?.volume).toBeCloseTo(L_VOL, 0);
    expect(res.metrics?.solids).toBe(1);
  }, 60_000);
  it("totéž s čarou se zaobleným rohem místo oblouku a rotací (osa Y skici = Z modelu)", async () => {
    const { doc, log } = docOf(`skica XZ\nčára 10 0 40 0 40 10 r 4 20 10\nčára 20 10 20 30 10 30 10 0\nrotovat`);
    // zaoblená čára se nejdřív uzavře úsečkou e5, druhá čára na ni naváže → úsečka se odebere
    expect(log.join("\n")).toContain("ℹ uzavírací úsečka e5 čáry se zaoblenými rohy odebrána – na konec [20; 10] nově navazuje e6");
    const res = await buildDoc(doc);
    expect(res.status.every((s) => s.ok && !s.warning)).toBe(true);
    // L-profil r 10…40 / z 0…10 + r 10…20 / z 10…30, vnější roh R4 – Pappus: 2π · 10 365,72 mm³ = 65 129,76 mm³
    expect(res.metrics?.solids).toBe(1);
    expect(res.metrics?.volume).toBeCloseTo(65129.76, 0);
  }, 60_000);
  it("dřívější chování pro srovnání: obě čáry uzavřené → dvě tělesa a menší objem", async () => {
    const { doc } = docOf(`skica XY\nčára 0 0 80 0 80 10 20 10 uzavřít\n${ARC}\nčára 10 20 10 60 0 60 0 0 uzavřít\nvysunout 10`);
    const res = await buildDoc(doc);
    expect(res.metrics?.volume).toBeCloseTo(12000, 0);
    expect(res.metrics?.solids).toBe(2);
  }, 60_000);
});

describe("vadný profil – důvod u prvku", () => {
  it("otevřený profil: vysunutí ✗ s otevřenými konci a id entit", async () => {
    const { doc } = docOf("skica XY\núsečka 0 40 0 0\núsečka 0 0 60 0\núsečka 60 0 60 40\nvysunout 10");
    const res = await buildDoc(doc);
    const ex = res.status.find((s) => s.id === doc.features[1].id)!;
    expect(ex.ok).toBe(false);
    expect(ex.error).toMatch(/Skica neobsahuje uzavřený profil/);
    expect(ex.error).toContain("Profil skici „Skica 1“: otevřený konec e1 v [0; 40]; otevřený konec e3 v [60; 40].");
  }, 60_000);
  it("mezera 0,02 mm: vysunutí ✗ s mezerou mezi e1 a e2", async () => {
    const { doc } = docOf("skica XY\nčára 0 0 80 0 80 10 20 10\núsečka 20,02 10 0 0\nvysunout 10");
    const res = await buildDoc(doc);
    const ex = res.status.find((s) => s.id === doc.features[1].id)!;
    expect(ex.ok).toBe(false);
    expect(ex.error).toContain("mezera 0,02 mm mezi e1 [20; 10] a e2 [20,02; 10]");
  }, 60_000);
  it("křížící se obrysy: vysunutí projde, ale ⚠ řekne, kde se kříží", async () => {
    const { doc } = docOf("skica XY: obdélník 40 20; obdélník 20 40\nvysunout 5");
    const res = await buildDoc(doc);
    const ex = res.status.find((s) => s.id === doc.features[1].id)!;
    expect(ex.ok).toBe(true);
    expect(ex.warning).toMatch(/Profil skici „Skica 1“: e1 kříží e2 v \[/);
  }, 60_000);
});

describe("oprava po revizi (jádro)", () => {
  const sweepOn = (doc: CadDoc) => {
    const sk = doc.features.find((f) => f.type === "sketch")!;
    doc.features.push({ id: "sw", name: "Tažení 1", type: "sweep", profileId: "", pathId: sk.id, mode: "new", frenet: false, circleRadius: 3 } as Feature);
    return doc;
  };
  it("osamocená čára se zaobleným rohem jako dráha tažení zůstane otevřená: π·3²·(40+40+5π) = 2 706 mm³ (ne uzavřený trojúhelník)", async () => {
    const { doc, log } = docOf("skica XZ: čára 0 0 0 50 r 10 50 50");
    expect(log.join("\n")).toContain("ℹ čára se zaoblenými rohy uzavřena úsečkou e4"); // jako profil by se uzavřela
    const res = await buildDoc(sweepOn(doc));
    const st = res.status.find((x) => x.id === "sw")!;
    expect(st.ok).toBe(true);
    expect(st.warning ?? "").not.toMatch(/Profil skici/);
    expect(res.metrics?.volume).toBeCloseTo(Math.PI * 9 * (80 + 5 * Math.PI), -1);
  }, 120_000);
  it("totéž u obyčejné lomené čáry (L z 3 bodů): dráha 100 mm, ne uzavřený trojúhelník; žebro bere stejnou otevřenou křivku", async () => {
    const { doc } = docOf("skica XZ: čára 0 0 0 50 50 50");
    const sk = doc.features[0] as Extract<Feature, { type: "sketch" }>;
    expect(sk.entities[0]).toMatchObject({ closed: true, autoClose: true });
    expect(sketchChain(sk)).toHaveLength(2); // dráha žebra bez uzavíracího úseku
    const res = await buildDoc(sweepOn(doc));
    expect(res.status.find((x) => x.id === "sw")?.ok).toBe(true);
    expect(res.metrics?.volume).toBeCloseTo(Math.PI * 9 * 100, -1);
  }, 120_000);
  it("lopatky z jednoho bodu (starší skripty): každá čára uzavřená, vysunutí ✓ 3 × 200 mm² × 3 mm", async () => {
    const { doc } = docOf("skica XY: čára 0 0 40 5 40 -5; čára 0 0 -40 5 -40 -5; čára 0 0 5 40 -5 40\nvysunout 3");
    const res = await buildDoc(doc);
    expect(res.status.every((x) => x.ok)).toBe(true);
    expect(res.metrics?.volume).toBeCloseTo(1800, 0);
  }, 120_000);
  it("výslovně uzavřená čára v obrysu z více entit: vysunutí projde, ale ⚠ řekne, co do obrysu nepatří", async () => {
    const { doc } = docOf(`skica XY\nčára 0 0 80 0 80 10 20 10 uzavřít\n${ARC}\nčára 10 20 10 60 0 60 0 0\nvysunout 10`);
    const res = await buildDoc(doc);
    const ex = res.status.find((s) => s.id === doc.features[1].id)!;
    expect(ex.ok).toBe(true);
    expect(ex.warning).toContain("leží na obrysu e1");
    expect(ex.warning).toContain("e1 je uzavřená čára – má-li být částí obrysu s e2, napište u ní „otevřená“");
  }, 120_000);
  it("pomocník testů výkresu (runText) uzavírá lomené čáry stejně jako konzole", async () => {
    const { doc } = await runText(`nový díl X\nskica XY\nčára 0 0 80 0 80 10 20 10\n${ARC}\nčára 10 20 10 60 0 60 0 0\nvysunout 10`);
    const sk = doc.features.find((f) => f.type === "sketch") as Extract<Feature, { type: "sketch" }>;
    expect(sk.entities.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(sk.entities.filter((e) => e.type === "polyline").map((e) => (e as { closed: boolean }).closed)).toEqual([false, false]);
    const res = await buildDoc(doc);
    expect(res.metrics?.volume).toBeCloseTo(L_VOL, 0);
  }, 120_000);
});

