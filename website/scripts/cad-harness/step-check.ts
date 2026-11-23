// Independent STEP check (wave 22, point 22c; critic KEEP "STEP of assemblies passed an independent check"): the app's own
// export check (agent-out.ts exportCheck) used to pass a STEP with 0 solids. This checker shares NO code with the app: its
// own OCCT instance (replicad-opencascadejs straight from node_modules, not replicad and not the app kernel), the plain
// STEPControl_Reader, TopExp_Explorer counts and BRepCheck_Analyzer with the EXACT method – modelled on the repro script
// stepcheck.mjs of the triage. Used by the acceptance gate (scripts/cad-acceptance.mjs via acceptance-lib.ts) and by vitest
// (engine/outputs-kernel.test.ts, w22/solid-export-engine.test.ts) for a part AND an assembly.
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/* eslint-disable @typescript-eslint/no-explicit-any */
type OC = any;

export type StepCheck = {
  /** IFSelect_ReturnStatus of ReadFile (IFSelect_RetDone = read) */
  read: string;
  solids: number;
  shells: number;
  closedShells: number;
  /** shells outside any solid (a closed shell that was never made a solid counts here) */
  freeShells: number;
  /** faces outside any shell */
  freeFaces: number;
  faces: number;
  /** volume of everything (OCCT GProp, open faces give a pseudo volume) and of closed shells only */
  volumeAll: number;
  volumeClosed: number;
  /** volume of the solids alone (sum over solids) */
  volumeSolids: number;
  validFast: boolean;
  validExact: boolean;
  bad: { solids: number; shells: number; faces: number; wires: number; edges: number };
};

let ocP: Promise<OC> | null = null;

/** own OCCT instance (once per process) – independent of the app kernel */
export function stepCheckOc(): Promise<OC> {
  if (!ocP) {
    // the package exports only ".", "./wasm" and "./package.json" – find its folder through package.json; resolve from this
    // module (vitest: scripts/cad-harness, gate bundle: node_modules/.cache/cad-harness), else from the cwd
    let pkg: string;
    try {
      pkg = createRequire(import.meta.url).resolve("replicad-opencascadejs/package.json");
    } catch {
      pkg = createRequire(path.join(process.cwd(), "package.json")).resolve("replicad-opencascadejs/package.json");
    }
    const js = path.join(path.dirname(pkg), "dist", "replicad_single.js");
    const wasm = path.join(path.dirname(pkg), "dist", "replicad_single.wasm");
    ocP = import(/* @vite-ignore */ pathToFileURL(js).href).then((m: { default: (o: unknown) => Promise<OC> }) => m.default({ locateFile: () => wasm }));
  }
  return ocP;
}

let seq = 0;

/** read a STEP file with OCCT's plain reader and count / check it */
export async function stepCheck(bytes: Uint8Array): Promise<StepCheck> {
  const oc = await stepCheckOc();
  const E = oc.TopAbs_ShapeEnum;
  const list = (s: unknown, k: unknown, avoid: unknown = E.TopAbs_SHAPE) => {
    const out: unknown[] = [];
    const ex = new oc.TopExp_Explorer(s, k, avoid);
    for (; ex.More(); ex.Next()) out.push(ex.Current());
    ex.delete();
    return out;
  };
  const file = `/stepcheck-${process.pid}-${++seq}.step`;
  oc.FS.writeFile(file, bytes);
  const rd = new oc.STEPControl_Reader();
  try {
    const st = rd.ReadFile(file);
    rd.TransferRoots(new oc.Message_ProgressRange());
    const s = rd.OneShape();
    const solids = list(s, E.TopAbs_SOLID);
    const shells = list(s, E.TopAbs_SHELL);
    const faces = list(s, E.TopAbs_FACE);
    const vol = (shape: unknown, onlyClosed: boolean) => {
      const gp = new oc.GProp_GProps();
      oc.BRepGProp.VolumeProperties(shape, gp, onlyClosed, false, false);
      const v = gp.Mass();
      gp.delete();
      return v;
    };
    const fast = new oc.BRepCheck_Analyzer(s, true, false, false);
    const validFast = fast.IsValid();
    fast.delete();
    const ax = new oc.BRepCheck_Analyzer(s, true, false, true);
    const validExact = ax.IsValid();
    const bad = { solids: 0, shells: 0, faces: 0, wires: 0, edges: 0 };
    if (!validExact) {
      for (const f of faces) if (!ax.IsValid(f)) bad.faces++;
      for (const w of list(s, E.TopAbs_WIRE)) if (!ax.IsValid(w)) bad.wires++;
      for (const e of list(s, E.TopAbs_EDGE)) if (!ax.IsValid(e)) bad.edges++;
      for (const sh of shells) if (!ax.IsValid(sh)) bad.shells++;
      for (const so of solids) if (!ax.IsValid(so)) bad.solids++;
    }
    ax.delete();
    return {
      read: String(st?.value ?? st),
      solids: solids.length,
      shells: shells.length,
      closedShells: shells.filter((sh) => oc.BRep_Tool.IsClosed(sh)).length,
      freeShells: list(s, E.TopAbs_SHELL, E.TopAbs_SOLID).length,
      freeFaces: list(s, E.TopAbs_FACE, E.TopAbs_SHELL).length,
      faces: faces.length,
      volumeAll: vol(s, false),
      volumeClosed: vol(s, true),
      volumeSolids: solids.reduce((a: number, so) => a + Math.abs(vol(so, false)), 0),
      validFast,
      validExact,
      bad,
    };
  } finally {
    rd.delete();
    try {
      oc.FS.unlink(file);
    } catch {
      /* already gone */
    }
  }
}

/**
 * What an independent reader says is wrong with a volume STEP: no solid, fewer solids than expected, free shells / faces
 * next to the solids, invalid by the exact BRepCheck. Empty = a clean volume model.
 */
export function stepCheckProblems(c: StepCheck, o: { minSolids?: number; solids?: number } = {}): string[] {
  const out: string[] = [];
  if (c.solids === 0) out.push(`no solid (shells=${c.shells}, freeShells=${c.freeShells}, freeFaces=${c.freeFaces})`);
  if (o.solids !== undefined && c.solids !== o.solids) out.push(`solids=${c.solids}, expected ${o.solids}`);
  if (o.minSolids !== undefined && c.solids < o.minSolids) out.push(`solids=${c.solids}, expected ≥ ${o.minSolids}`);
  if (c.freeShells > 0 || c.freeFaces > 0) out.push(`free shells ${c.freeShells}, free faces ${c.freeFaces}`);
  if (!c.validExact) out.push(`invalid by exact BRepCheck (bad faces ${c.bad.faces}, edges ${c.bad.edges})`);
  return out;
}
