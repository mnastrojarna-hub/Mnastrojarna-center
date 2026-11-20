/**
 * Operace jádra `validity` (vlna 22, bod 22a): přesná kontrola platnosti tělesa dokumentu (BRepCheck přesnou metodou) s počtem
 * vadných ploch – pro `kontrola přesně`, automatickou kontrolu před exportem STEP / BREP a tlačítko v aplikaci. Těleso dílu
 * z mezipaměti stavby; sestava = složené těleso dílů v polohách (uvolní se hned po kontrole).
 */
import { shapeOfDoc } from "./asm-kernel";
import { countSub, exactCheck } from "./check";
import type { CadDoc } from "./types";
import { EXACT_MAX_FACES, type ValidityResult } from "./validity";

const free = (s: unknown) => {
  try {
    (s as { delete?: () => void } | null)?.delete?.();
  } catch {
    /* už uvolněno */
  }
};

export async function validityOfDoc(doc: CadDoc, o: { maxFaces?: number } = {}): Promise<ValidityResult> {
  const t0 = Date.now();
  const body = await shapeOfDoc(doc);
  if (!body) return { method: "none", valid: null, faces: 0, solids: 0, badFaces: 0, ms: Date.now() - t0, why: "empty" };
  try {
    const faces = countSub(body, "FACE");
    const solids = countSub(body, "SOLID");
    const max = o.maxFaces ?? EXACT_MAX_FACES;
    if (faces > max) return { method: "none", valid: null, faces, solids, badFaces: 0, ms: Date.now() - t0, why: "faces" };
    const c = exactCheck(body);
    return { method: "exact", valid: c.valid, faces, solids, badFaces: c.badFaces, ms: Date.now() - t0 };
  } finally {
    if (doc.kind === "assembly") free(body); // složené těleso sestavy vzniká pro každé volání; těleso dílu patří mezipaměti stavby
  }
}
