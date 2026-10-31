import type { FaceRange, MeshPart, ModelNode, ParsedModel, Rgb } from "./types";

/** Výstup occt-import-js (OpenCascade ve WebAssembly) — STEP / IGES / BREP. */
export interface OcctMesh {
  name?: string;
  color?: number[] | null;
  brep_faces?: { first: number; last: number; color?: number[] | null }[];
  attributes: { position: { array: ArrayLike<number> }; normal?: { array: ArrayLike<number> } };
  index?: { array: ArrayLike<number> };
}

export interface OcctNode {
  name?: string;
  meshes?: number[];
  children?: OcctNode[];
}

export interface OcctResult {
  success: boolean;
  root?: OcctNode;
  meshes?: OcctMesh[];
}

function rgb(c: number[] | null | undefined): Rgb | null {
  if (!c || c.length < 3) return null;
  const v: Rgb = [Number(c[0]), Number(c[1]), Number(c[2])];
  return v.every((x) => Number.isFinite(x)) ? v : null;
}

const isBlack = (c: Rgb | null) => !!c && c[0] === 0 && c[1] === 0 && c[2] === 0;

/** Převod výsledku OpenCascade na společný formát prohlížeče. */
export function occtToModel(result: OcctResult, format: string): ParsedModel {
  const meshes = result.meshes ?? [];
  const parts: MeshPart[] = meshes.map((m, i) => {
    let color = rgb(m.color);
    let faces: FaceRange[] = (m.brep_faces ?? []).map((f) => ({ first: f.first, last: f.last, color: rgb(f.color) }));
    // IGES bez barev vrací černou — brát jako „bez barvy"
    if (isBlack(color) && faces.every((f) => !f.color || isBlack(f.color))) {
      color = null;
      faces = faces.map((f) => ({ ...f, color: null }));
    }
    const normal = m.attributes.normal?.array;
    return {
      name: m.name?.trim() || `Díl ${i + 1}`,
      positions: Float32Array.from(m.attributes.position.array),
      normals: normal && normal.length ? Float32Array.from(normal) : null,
      indices: m.index?.array ? Uint32Array.from(m.index.array) : null,
      color,
      faces: faces.length ? faces : null,
    };
  });

  const convert = (n: OcctNode, depth: number): ModelNode => ({
    name: n.name?.trim() || (depth === 0 ? "Model" : "Sestava"),
    parts: (n.meshes ?? []).filter((x) => x >= 0 && x < parts.length),
    children: (n.children ?? []).map((c) => convert(c, depth + 1)),
  });
  let root: ModelNode = result.root ? convert(result.root, 0) : { name: "Model", parts: parts.map((_, i) => i), children: [] };
  // prázdný kořen s jediným potomkem → rovnou potomek (méně zanoření ve stromu)
  while (root.parts.length === 0 && root.children.length === 1) root = root.children[0];
  return { parts, root, format };
}
