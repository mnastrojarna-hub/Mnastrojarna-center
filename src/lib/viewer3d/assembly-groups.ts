import type { ModelNode } from "./types";

/**
 * Skupiny pro výběr ve stromu sestavy: „díl" a „podsestava" k danému tělesu (síti).
 *
 * Pozor na STEP z OpenCascade: díly sestavy bývají přímo v uzlu podsestavy (uzel „rod-assembly"
 * má rovnou sítě „nut", „rod", „nut") — takový uzel NENÍ díl. Za díl se uzel bere jen tehdy, když
 * nemá podřízené uzly a jeho sítě nesou jeho jméno (nebo žádné / jen jednu síť) — vícetělesový díl.
 */
export interface AssemblyGroups {
  /** Tělesa dílu, ke kterému těleso patří (většinou jen ono samo). */
  partGroup(i: number): number[];
  /** Tělesa nejbližší podsestavy, do které díl patří. */
  assemblyGroup(i: number): number[];
}

const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");

export function buildAssemblyGroups(root: ModelNode, partNames: string[]): AssemblyGroups {
  const partCount = partNames.length;
  const nodeParts: number[][] = [];
  const nodeAll: number[][] = [];
  const nodeParent: number[] = [];
  const isPart: boolean[] = [];
  const partNode = new Array<number>(partCount).fill(-1);

  const visit = (n: ModelNode, parent: number): number[] => {
    const id = nodeParts.length;
    const parts = n.parts.filter((p) => p >= 0 && p < partCount);
    nodeParts.push(parts);
    nodeAll.push([]);
    nodeParent.push(parent);
    const name = norm(n.name);
    // uzel = díl: bez podřízených uzlů a sítě nesou jméno uzlu (nebo jediná síť)
    isPart.push(
      n.children.length === 0 &&
        parts.length > 0 &&
        (parts.length === 1 || parts.every((p) => {
          const pn = norm(partNames[p]);
          return !pn || pn === name;
        })),
    );
    for (const p of parts) if (partNode[p] < 0) partNode[p] = id;
    const all = [...parts];
    for (const c of n.children) all.push(...visit(c, id));
    nodeAll[id] = all;
    return all;
  };
  visit(root, -1);

  return {
    partGroup(i) {
      const n = partNode[i];
      return n >= 0 && isPart[n] ? [...nodeParts[n]] : [i];
    },
    assemblyGroup(i) {
      const n = partNode[i];
      if (n < 0) return [i];
      if (!isPart[n]) return [...nodeAll[n]];
      const parent = nodeParent[n];
      return parent >= 0 ? [...nodeAll[parent]] : [...nodeAll[n]];
    },
  };
}
