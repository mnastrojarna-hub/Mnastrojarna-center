/**
 * Protokol CAD jádra (CAD-HEADLESS-NAVRH.md kap. 2.3, balík B1): požadavky `KernelReq` (přesun unie `Req` z `cad.worker.ts`),
 * mapa výsledků `KernelResults` a zprávy jádra `KernelMsg`. Stejný protokol mluví klient jádra (`kernel-client.ts`) nad
 * každým transportem – Web Worker v prohlížeči (`client.ts` → `cad.worker.ts`) i in-process ve vlákně běhu CLI
 * (`kernel-inprocess.ts`) – a obsluha `handleKernel` (`kernel-ops.ts`). Jen typy: modul se do prohlížeče nenačítá.
 */
import type { CadLang } from "./i18n";
import type { BuildProgress } from "./build";
import type { EdgeLite, FaceLite } from "./agent";
import type { DrawingMeta, DrawingOptions, DrawingResult } from "./drawing";
import type { SmartDims } from "./drawing-dims";
import type { Interference, MateFaceInfo } from "./asm-kernel";
import type { CompareOptions, CompareResult, ReferenceFile } from "./compare";
import type { ClashDetail, ClashPair } from "./clash-class";
import type { EntRef, EntityInfo, MeasureResult, ShapeSrc } from "./inspect";
import type { FaceOwner } from "./face-owner";
import type { MeasureQuery, MeasureReport } from "./measure";
import type { SurfQuery, SurfQueryResult } from "./surf-query";
import type { DatumDisplay } from "./feat/refs-more";
import type { Geo, PlaneDef, Ref, ResolvedPlane, Sig } from "./refs";
import type { BodyInfo, BuildResult, CadDoc, ComponentSource, ExportFormat, FaceInfo, Feature, FeatureStatus, Vec3 } from "./types";
import type { SplitPart, StepSplit } from "./formats/step-assembly";
import type { KernelShapeStats } from "./export-verify";
import type { ValidityResult } from "./validity";
import type { PerfEntry } from "./perf-log";

/** Požadavek na jádro (dřív `Req` v `cad.worker.ts`). `id` přidělí klient; odpověď nese totéž `id`. */
export type KernelReq =
  | { id: number; op: "init" }
  | { id: number; op: "build"; doc: CadDoc }
  /** přísný režim (balík B4): stavba bez sítě – jen výsledek prvků (✓/⚠/✗) přes řetěz mezipaměti stavby */
  | { id: number; op: "check"; doc: CadDoc }
  | { id: number; op: "topology"; doc: CadDoc }
  | { id: number; op: "face"; index: number }
  | { id: number; op: "export"; format: ExportFormat; doc: CadDoc }
  /** kontrola exportu z konzole: soubor znovu načíst a změřit proti modelu (export-verify.ts) */
  | { id: number; op: "exportStats"; doc: CadDoc; bytes: Uint8Array; format: "step" | "brep" }
  /** přesná kontrola platnosti tělesa dokumentu (BRepCheck přesnou metodou, vlna 22 bod 22a – validity-kernel.ts) */
  | { id: number; op: "validity"; doc: CadDoc; maxFaces?: number }
  /** `offset`/`total` = pořadí dávky v celém načítání sestavy (průběh „díl k z n“) */
  | { id: number; op: "asmParts"; parts: { key: string; source: ComponentSource }[]; offset?: number; total?: number }
  | { id: number; op: "asmFace"; key: string; index: number }
  | { id: number; op: "lang"; lang: CadLang }
  | { id: number; op: "interference"; doc: CadDoc }
  /** přesná obálka sestavy z těles listových dílů (stav sestavy) */
  | { id: number; op: "asmEnvelope"; doc: CadDoc }
  /** zařazení dvojic kolizí šroub × závit geometricky (clash-detail.ts, kap. 6.3) */
  | { id: number; op: "clashDetail"; doc: CadDoc; pairs: ClashPair[] }
  | { id: number; op: "compare"; doc: CadDoc; file: ReferenceFile; opts?: CompareOptions }
  | { id: number; op: "mateFace"; key: string; index: number }
  | { id: number; op: "mateEnt"; key: string; index: number; ent: "edge" | "vertex" | "mesh" }
  | { id: number; op: "cylFace"; key: string; radius: number }
  | { id: number; op: "inspect"; src: ShapeSrc; ref: EntRef; density?: number }
  /** filtr výběru Prvek: prvek, který vytvořil plochu dílu, a jeho plochy (face-owner.ts) */
  | { id: number; op: "faceOwner"; doc: CadDoc; index: number; point?: [number, number, number] }
  | { id: number; op: "measureEnt"; a: { src: ShapeSrc; ref: EntRef }; b: { src: ShapeSrc; ref: EntRef } | null }
  | { id: number; op: "measure"; q: MeasureQuery; doc?: CadDoc; density?: number; sources?: { key: string; source: ComponentSource }[] }
  | { id: number; op: "drawing"; doc: CadDoc; meta: DrawingMeta; opts?: Partial<DrawingOptions> }
  | { id: number; op: "refInfo"; doc: CadDoc; ref: Ref }
  | { id: number; op: "planeDef"; doc: CadDoc; def: PlaneDef }
  | { id: number; op: "datumGfx"; doc: CadDoc }
  | { id: number; op: "pickSigs"; doc: CadDoc; feature: Feature }
  | { id: number; op: "stepSplit"; bytes: Uint8Array; fileName: string }
  /** plochy třídy A: návaznost hran, hřebeny křivosti, řídicí body (surf-query.ts); `doc` = postavit nejdřív tento díl */
  | { id: number; op: "surfA"; q: SurfQuery; doc?: CadDoc };

/** název operace jádra */
export type KernelReqOp = KernelReq["op"];

/** zpráva požadavku: požadavek + data importů (`mnblob:`), která jádro ještě nemá (posílají se jen poprvé) */
export type KernelEnvelope = KernelReq & { blobs?: Record<string, Uint8Array> };

/** data požadavku bez `id` (doplní klient) */
export type KernelArgs<K extends KernelReqOp> = Omit<Extract<KernelReq, { op: K }>, "id">;

/** výsledek `topology`: plochy a hrany pro výběr pravidlem, obálka, míry a tělesa dílu */
export type TopologyResult = { faces: FaceLite[]; edges: EdgeLite[]; bbox: [Vec3, Vec3]; metrics: NonNullable<BuildResult["metrics"]>; /** tělesa dílu (aktivní první) s rozsahy indexů ploch a hran */ bodies?: BodyInfo[] };

/** výsledek `stepSplit`: díly sestavy STEP s otiskem dat (`id`); `null` = soubor není sestava */
export type StepSplitResult = (Omit<StepSplit, "parts"> & { parts: (SplitPart & { id: string })[] }) | null;

/** Mapa výsledků: operace → `result` v odpovědi jádra. Typy hlídá obsluha (`kernel-ops.ts` `reply`) i klient (`call<op>`). */
export interface KernelResults {
  init: void;
  lang: void;
  build: BuildResult;
  check: { status: FeatureStatus[]; paramErrors: string[]; solid: boolean };
  topology: TopologyResult | null;
  face: FaceInfo | null;
  export: ArrayBuffer;
  exportStats: { model: KernelShapeStats; file: KernelShapeStats };
  validity: ValidityResult;
  asmParts: { key: string; result: BuildResult }[];
  asmFace: FaceInfo | null;
  interference: Interference[];
  asmEnvelope: { bbox: [Vec3, Vec3] | null; leaves: number; turned: number; approx: number };
  clashDetail: ClashDetail[];
  compare: CompareResult;
  mateFace: MateFaceInfo | null;
  mateEnt: MateFaceInfo | null;
  cylFace: number;
  inspect: EntityInfo;
  faceOwner: FaceOwner | null;
  measureEnt: MeasureResult;
  measure: MeasureReport;
  drawing: DrawingResult & { smart?: SmartDims };
  refInfo: { geo: Geo | null; sig: Sig | null; error?: string };
  planeDef: { plane: ResolvedPlane | null; error?: string };
  datumGfx: { id: string; gfx: DatumDisplay }[];
  pickSigs: { feature: Feature; changed: boolean; warnings: string[] } | null;
  stepSplit: StepSplitResult;
  surfA: SurfQueryResult;
}

/** typovaná operace jádra: `call({ op: "build", doc })` → `Promise<BuildResult>` */
export type KernelCall = <K extends KernelReqOp>(req: KernelArgs<K> & { op: K }) => Promise<KernelResults[K]>;

/**
 * Zpráva jádra klientovi: odpověď (`ok` + `result` / `error`, `fatal` = pád WASM – instance je nepoužitelná), průběh
 * dlouhé operace (`progress`, bez `ok`), nebo záznam měření (`perf`, bez `id`). `at` = čas odeslání výsledku (měření přenosu).
 */
export type KernelMsg = { id?: number; ok?: boolean; result?: unknown; error?: string; progress?: BuildProgress; perf?: PerfEntry; fatal?: boolean; at?: number };

/** odeslání zprávy jádra (Web Worker: `postMessage`; in-process: kopie `structuredClone` s přenosem bufferů) */
export type KernelPost = (m: KernelMsg, transfer?: Transferable[]) => void;

/* kontrola úplnosti: každá operace z `KernelReq` má výsledek v `KernelResults` a naopak */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
export type KernelResultsComplete = Assert<Same<keyof KernelResults, KernelReqOp>>;
