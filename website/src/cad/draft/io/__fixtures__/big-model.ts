/** Velký generovaný výkres pro testy výkonu (io-perf.test.ts) – smíšené entity jako v reálném výkresu. */
import { newDraftModel } from "../../doc";
import type { DraftEntity, DraftModel } from "../../model";

/** výkres o `n` skupinách entit (1 skupina = křivka o `verts` vrcholech, 3 úsečky, text, kružnice, oblouk, každá 10. vložení bloku) */
export function bigModel(n: number, verts = 30): DraftModel {
  const m = newDraftModel();
  const ents: DraftEntity[] = [];
  let id = 0;
  const E = (o: Record<string, unknown>) => ents.push({ id: `e${++id}`, layer: id % 3 ? "0" : "OBRYS", ...o } as unknown as DraftEntity);
  m.layers = [...m.layers, { name: "OBRYS", color: 7, linetype: "Continuous", lineweight: 0.5, on: true, frozen: false, locked: false, plot: true }];
  m.blocks = [{ name: "BOD", base: [0, 0], entities: [{ id: "b1", layer: "0", type: "circle", c: [0, 0], r: 1 } as DraftEntity, { id: "b2", layer: "0", type: "line", a: [-1, 0], b: [1, 0] } as DraftEntity] }];
  for (let i = 0; i < n; i++) {
    const x = (i % 300) * 50;
    const y = Math.floor(i / 300) * 50;
    const pts: [number, number][] = [];
    for (let k = 0; k < verts; k++) pts.push([x + (k * 45) / verts, y + Math.sin(k / 3) * 10]);
    E({ type: "polyline", pts, ...(i % 5 === 0 ? { closed: true } : {}) });
    E({ type: "line", a: [x, y], b: [x + 40, y + 0.5] });
    E({ type: "line", a: [x, y + 5], b: [x + 40, y + 5.5] });
    E({ type: "line", a: [x, y + 10], b: [x + 40, y + 10.5] });
    E({ type: "text", p: [x, y + 20], h: 2.5, s: `Pozice ${i} – díl Č.${i % 97}` });
    E({ type: "circle", c: [x + 20, y + 30], r: 4 + (i % 7) });
    E({ type: "arc", c: [x + 30, y + 30], r: 5, a0: 0, a1: 90 + (i % 180) });
    if (i % 10 === 0) E({ type: "insert", block: "BOD", p: [x + 45, y + 45], sx: 1, sy: 1, rot: i % 360 });
  }
  return { ...m, entities: ents, seq: id };
}
