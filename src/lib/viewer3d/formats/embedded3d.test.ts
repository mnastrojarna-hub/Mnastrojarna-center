import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { zlibSync } from "fflate";
import { decodePdf3D } from "./embedded3d";
import { computeTopology } from "../topology";

const FIX = path.join(__dirname, "__fixtures__");
const enc = (s: string) => new TextEncoder().encode(s);

function pdfWith(kind: "U3D" | "PRC", payload: Uint8Array): Uint8Array {
  const body = zlibSync(payload);
  const head = enc(`%PDF-1.6\n5 0 obj\n<< /Type /3D /Subtype /${kind} /Length ${body.length} /Filter /FlateDecode >>\nstream\n`);
  const tail = enc(`\nendstream\nendobj\n6 0 obj\n<< /Type /Annot /Subtype /3D /3DD 5 0 R >>\nendobj\n%%EOF\n`);
  const out = new Uint8Array(head.length + body.length + tail.length);
  out.set(head, 0);
  out.set(body, head.length);
  out.set(tail, head.length + body.length);
  return out;
}

describe("3D PDF → model pro prohlížeč", () => {
  it("U3D v PDF: díly, trojúhelníky a topologie", async () => {
    const u3d = new Uint8Array(fs.readFileSync(path.join(FIX, "u3d-box_2shaders.u3d")));
    const m = await decodePdf3D(pdfWith("U3D", u3d));
    expect(m.format).toBe("U3D (3D PDF)");
    expect(m.parts.length).toBeGreaterThan(0);
    const tris = m.parts.reduce((n, p) => n + (p.indices?.length ?? 0) / 3, 0);
    expect(tris).toBeGreaterThan(0);
    for (const p of m.parts) expect(() => computeTopology({ positions: p.positions, indices: p.indices, faces: p.faces })).not.toThrow();
  });

  it("PDF bez 3D a poškozený 3D proud → srozumitelná chyba", async () => {
    await expect(decodePdf3D(enc("%PDF-1.4\n%%EOF"))).rejects.toThrow(/není žádný 3D model/);
    await expect(decodePdf3D(pdfWith("U3D", enc("nesmysl")))).rejects.toThrow(/U3D|3D/);
  });
});
