import * as THREE from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import type { MeshPart, ModelNode, ParsedModel, Rgb } from "../types";

/**
 * Síťové formáty (STL, OBJ, PLY a — na hlavním vlákně — 3MF / glTF) → společný formát.
 * Parsery three.js nepotřebují DOM (kromě 3MF/glTF), takže STL/OBJ/PLY běží ve workeru.
 */

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.slice().buffer as ArrayBuffer);
}

/** BufferGeometry (se zapečenou maticí) → díl. */
export function geometryToPart(geometry: THREE.BufferGeometry, name: string, color: Rgb | null, matrix?: THREE.Matrix4): MeshPart {
  const g = geometry.clone();
  if (matrix) g.applyMatrix4(matrix);
  const pos = g.getAttribute("position");
  const positions = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    positions[i * 3] = pos.getX(i);
    positions[i * 3 + 1] = pos.getY(i);
    positions[i * 3 + 2] = pos.getZ(i);
  }
  const nrm = g.getAttribute("normal");
  let normals: Float32Array | null = null;
  if (nrm && nrm.count === pos.count) {
    normals = new Float32Array(nrm.count * 3);
    for (let i = 0; i < nrm.count; i++) {
      normals[i * 3] = nrm.getX(i);
      normals[i * 3 + 1] = nrm.getY(i);
      normals[i * 3 + 2] = nrm.getZ(i);
    }
  }
  const idx = g.getIndex();
  const indices = idx ? Uint32Array.from(idx.array as ArrayLike<number>) : null;
  g.dispose();
  return { name, positions, normals, indices, color };
}

export function parseStl(bytes: Uint8Array, name = "STL"): ParsedModel {
  const geometry = new STLLoader().parse(toBuffer(bytes));
  const ud = geometry.userData as { groupNames?: string[] } | undefined;
  const parts: MeshPart[] = [];
  // ASCII STL s více tělesy → skupiny
  if (geometry.groups.length > 1 && !geometry.index) {
    geometry.groups.forEach((gr, i) => {
      const sub = new THREE.BufferGeometry();
      for (const key of Object.keys(geometry.attributes)) {
        const a = geometry.getAttribute(key) as THREE.BufferAttribute;
        sub.setAttribute(key, new THREE.BufferAttribute((a.array as Float32Array).slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
      }
      parts.push(geometryToPart(sub, ud?.groupNames?.[i] || `${name} ${i + 1}`, null));
    });
  } else {
    parts.push(geometryToPart(geometry, name, null));
  }
  return { parts, root: { name, parts: parts.map((_, i) => i), children: [] }, format: "STL" };
}

export function parsePly(bytes: Uint8Array, name = "PLY"): ParsedModel {
  const geometry = new PLYLoader().parse(toBuffer(bytes));
  const part = geometryToPart(geometry, name, null);
  return { parts: [part], root: { name, parts: [0], children: [] }, format: "PLY" };
}

/** Projde scénu three.js a každou síť převede na díl (se světovou maticí). */
export function object3DToModel(root: THREE.Object3D, format: string, rootName: string): ParsedModel {
  root.updateMatrixWorld(true);
  const parts: MeshPart[] = [];
  const walk = (o: THREE.Object3D, depth: number): ModelNode => {
    const node: ModelNode = { name: o.name || (depth === 0 ? rootName : "Skupina"), parts: [], children: [] };
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry?.getAttribute("position")) {
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial | undefined;
      const c = mat?.color;
      const color: Rgb | null = c ? [c.r, c.g, c.b] : null;
      node.parts.push(parts.length);
      parts.push({ ...geometryToPart(mesh.geometry, o.name || `Díl ${parts.length + 1}`, color, mesh.matrixWorld), opacity: mat?.opacity ?? 1 });
    }
    for (const ch of o.children) {
      const c = walk(ch, depth + 1);
      if (c.parts.length || c.children.length) node.children.push(c);
    }
    return node;
  };
  let tree = walk(root, 0);
  while (tree.parts.length === 0 && tree.children.length === 1) tree = tree.children[0];
  return { parts, root: tree, format };
}

export function parseObj(bytes: Uint8Array, name = "OBJ"): ParsedModel {
  const text = new TextDecoder().decode(bytes);
  const group = new OBJLoader().parse(text);
  group.name = name;
  return object3DToModel(group, "OBJ", name);
}
