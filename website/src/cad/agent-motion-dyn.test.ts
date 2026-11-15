/**
 * Text dynamiky pohybové studie (cad/agent-motion-dyn.ts přes parseMotionText): CS / EN / DE, motor tam a zpět, hmotnost, síla /
 * moment na vazbě, chyby s návodem, objekt window.mncad.motion → řádky příkazů.
 */
import { describe, expect, it } from "vitest";
import { parseMotionText } from "./agent-motion";
import { motionApiLines } from "./asm-agent-dyn";

describe("pohyb dynamika – text", () => {
  it("CS / EN / DE: dynamika s časem, krokem, gravitací, tlumením a odrazem", () => {
    expect(parseMotionText("pohyb dynamika čas 0,5 krok 0,0005 gravitace -Z tlumení 0,05 odraz 0,3")).toEqual({ op: "dyn", cmd: { k: "on", duration: 0.5, dt: 0.0005, gravity: [0, 0, -1], damping: 0.05, restitution: 0.3 } });
    expect(parseMotionText("motion dynamics time 0.5 step 0.0005 gravity off")).toEqual({ op: "dyn", cmd: { k: "on", duration: 0.5, dt: 0.0005, gravity: null } });
    expect(parseMotionText("bewegung dynamik zeit 0,5 schritt 0,0005 schwerkraft +Y dämpfung 0,05")).toEqual({ op: "dyn", cmd: { k: "on", duration: 0.5, dt: 0.0005, gravity: [0, 1, 0], damping: 0.05 } });
    expect(parseMotionText("pohyb dynamika gravitace 0 0 -1")).toEqual({ op: "dyn", cmd: { k: "on", gravity: [0, 0, -1] } });
    expect(parseMotionText("pohyb dynamika")).toEqual({ op: "dyn", cmd: { k: "on" } });
    expect(parseMotionText("pohyb kinematika")).toEqual({ op: "dyn", cmd: { k: "off" } });
    expect(parseMotionText("motion kinematics")).toEqual({ op: "dyn", cmd: { k: "off" } });
  });

  it("hmotnost, síla a moment na vazbě", () => {
    expect(parseMotionText('pohyb hmotnost "Stírací deska" 2,4')).toEqual({ op: "dyn", cmd: { k: "mass", comp: "Stírací deska", kg: 2.4 } });
    expect(parseMotionText('motion mass "Stripper" auto')).toEqual({ op: "dyn", cmd: { k: "mass", comp: "Stripper", kg: null } });
    expect(parseMotionText("pohyb síla vazba 3 120")).toEqual({ op: "dyn", cmd: { k: "load", kind: "force", mate: "3", value: 120 } });
    expect(parseMotionText('pohyb moment vazba "Klika" -5')).toEqual({ op: "dyn", cmd: { k: "load", kind: "torque", mate: "Klika", value: -5 } });
    expect(parseMotionText("bewegung kraft verknüpfung #2 löschen")).toEqual({ op: "dyn", cmd: { k: "load", kind: "force", mate: "2", value: null } });
  });

  it("motor tam a zpět (CS / EN / DE); stávající syntaxe beze změny", () => {
    expect(parseMotionText('pohyb motor lineární vazba "LIS" 60..30 tam a zpět')).toMatchObject({ op: "motor", kind: "linear", mate: "LIS", from: 60, to: 30, back: true });
    expect(parseMotionText("motion motor linear mate 1 60..30 there and back steps 50")).toMatchObject({ op: "motor", from: 60, to: 30, back: true, steps: 50 });
    expect(parseMotionText("bewegung antrieb linear verknüpfung 1 60..30 hin und zurück")).toMatchObject({ op: "motor", back: true });
    const old = parseMotionText('pohyb motor rotační "Klika" 0..360 krok 5 kolize');
    expect(old).toMatchObject({ op: "motor", kind: "rotary", comp: "Klika", from: 0, to: 360, step: 5, collisions: true });
    expect("back" in old).toBe(false);
    expect(parseMotionText("pohyb krok 5")).toEqual({ op: "step", n: 5 });
    expect(parseMotionText("pohyb čas 2")).toEqual({ op: "set", duration: 2 });
  });

  it("chyby s návodem", () => {
    expect(() => parseMotionText("pohyb dynamika krok 1")).toThrow(/integrační krok/);
    expect(() => parseMotionText("pohyb dynamika odraz 2")).toThrow(/odraz/);
    expect(() => parseMotionText("pohyb dynamika gravitace dolů")).toThrow(/gravitace/);
    expect(() => parseMotionText("pohyb dynamika rychle")).toThrow(/neznámá volba „rychle“/);
    expect(() => parseMotionText("pohyb hmotnost")).toThrow(/hmotnost/);
    expect(() => parseMotionText('pohyb hmotnost "A" -1')).toThrow(/kladná/);
  });

  it("window.mncad.motion({...}) → řádky příkazů pohyb", () => {
    expect(motionApiLines({ mode: "dynamic", duration: 0.5, dt: 0.0005, gravity: "-Z", damping: 0.05, masses: { "Stírací deska": 2.4 }, forces: [{ mate: 3, value: 120 }], run: "spustit" })).toEqual([
      'hmotnost "Stírací deska" 2.4',
      "síla vazba 3 120",
      "dynamika čas 0.5 krok 0.0005 gravitace -Z tlumení 0.05",
      "spustit",
    ]);
    expect(motionApiLines({ mode: "kinematic" })).toEqual(["kinematika"]);
    expect(motionApiLines({ gravity: null })).toEqual(["dynamika gravitace vyp"]);
    expect(motionApiLines({ mode: "dynamic", gravity: [0, -1, 0] })).toEqual(["dynamika gravitace 0 -1 0"]);
  });
});

describe("převodník dokument → skript: dynamika pohybové studie", () => {
  it("motor tam a zpět, hmotnost, síla na vazbě a dynamika se zapíší a přečtou zpět", async () => {
    const { docToScript } = await import("./doc-script");
    const { emptyDoc } = await import("./types");
    const part = (name: string) => ({ ...emptyDoc(name), features: [] });
    const doc: import("./types").CadDoc = {
      ...emptyDoc("Střižník"),
      kind: "assembly" as const,
      components: [
        { id: "a", name: "Spodní", source: { kind: "part" as const, doc: part("Spodní") }, placement: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] }, fixed: true },
        { id: "b", name: "Horní", source: { kind: "part" as const, doc: part("Horní") }, placement: { position: [0, 0, 60] as [number, number, number], rotation: [0, 0, 0] as [number, number, number] } },
      ],
      mates: [{ id: "m1", type: "distance" as const, a: { compId: "b", face: 4 }, b: { compId: "a", face: 5 }, value: 40, name: "LIS" }],
      motion: { motors: [{ id: "mo", kind: "linear" as const, mate: "m1", from: 40, to: 10, back: true }], duration: 0.5, steps: 20, mode: "dynamic" as const, dyn: { dt: 0.0005, gravity: [0, 0, -1] as [number, number, number], damping: 0.05, restitution: 0.2, masses: { b: 2.4 }, loads: [{ mate: "m1", kind: "force" as const, value: 120 }] } },
    };
    const text = docToScript(doc).text;
    const lines = text.split("\n").filter((l) => /^pohyb /.test(l));
    expect(lines.some((l) => /pohyb motor lineární vazba 1 40\.\.10 tam a zpět/.test(l))).toBe(true);
    expect(lines).toContain("pohyb hmotnost #2 2.4");
    expect(lines).toContain("pohyb síla vazba 1 120");
    expect(lines).toContain("pohyb dynamika čas 0.5 krok 0.0005 gravitace -Z tlumení 0.05 odraz 0.2");
    // zpět parserem
    expect(parseMotionText(lines.find((l) => l.startsWith("pohyb dynamika"))!)).toEqual({ op: "dyn", cmd: { k: "on", duration: 0.5, dt: 0.0005, gravity: [0, 0, -1], damping: 0.05, restitution: 0.2 } });
    expect(parseMotionText("pohyb hmotnost #2 2.4")).toEqual({ op: "dyn", cmd: { k: "mass", comp: "#2", kg: 2.4 } });
    expect(parseMotionText(lines.find((l) => l.startsWith("pohyb motor"))!)).toMatchObject({ op: "motor", back: true, from: 40, to: 10 });
  });
});
