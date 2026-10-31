/**
 * DWG (AutoCAD R13 – 2018+, AC1012 – AC1032) → 2D výkres pro prohlížeč.
 *
 * Čtení obstarává LibreDWG zkompilovaná do WebAssembly (npm `@mlightcad/libredwg-web`, GPL-3.0):
 * soubor → `DwgDatabase` (hladiny, bloky, entity). Tady se z ní skládá `Drawing2D` v milimetrech:
 * jen modelový prostor, bloky (INSERT, vnořené, pole MINSERT), kóty (anonymní bloky *D…),
 * OCS entit (zrcadlené bloky s normálou −Z), barvy BYLAYER / BYBLOCK / true color a pravidlo
 * „entity bloku na hladině 0 přebírají hladinu vložení".
 *
 * WASM: instance LibreDWG se drží v modulu (jedna na adresář `wasmDir`) — ve Web Workeru
 * (`/vendor/libredwg-0.8.1/`) i v Node pod vitestem (absolutní cesta k `…/libredwg-web/wasm/`).
 * Po pádu uvnitř WASM (poškozený soubor → „memory access out of bounds") je instance nepoužitelná,
 * proto se zahodí a příští volání vytvoří novou.
 */
import type {
  Dwg3dFaceEntity,
  DwgArcEntity,
  DwgAttribEntity,
  DwgBlockRecordTableEntry,
  DwgBoundaryPath,
  DwgBoundaryPathEdge,
  DwgCircleEntity,
  DwgDatabase,
  DwgDimensionEntity,
  DwgEllipseEntity,
  DwgEntity,
  DwgHatchEntity,
  DwgInsertEntity,
  DwgLayerTableEntry,
  DwgLeaderEntity,
  DwgLineEntity,
  DwgLWPolylineEntity,
  DwgMLineEntity,
  DwgMTextEntity,
  DwgMultiLeaderEntity,
  DwgPointEntity,
  DwgPolyline2dEntity,
  DwgPolyline3dEntity,
  DwgSolidEntity,
  DwgSplineEntity,
  DwgTextBase,
  DwgTextEntity,
  LibreDwgEx,
} from "@mlightcad/libredwg-web";
import { aciColor, insunitsToMm, plainText, trueColor, type DrawColor, type DrawEntity, type DrawLayer, type Drawing2D, type Pt } from "../drawing2d";
import { ModelImportError } from "../types";
import {
  IDENTITY,
  apply,
  applyVec,
  bulgePoints,
  det,
  ellipseFromAxes,
  evalNurbs,
  interpolateFitPoints,
  isSimilarity,
  mul,
  normalizeSweep,
  ocsMatrix,
  trs,
  type M2,
  type V3,
} from "./dwg-geom";

const TAU = Math.PI * 2;

/** Hláška pro nečitelný soubor (poškozený / nepodporovaná verze / pád LibreDWG). */
export const DWG_READ_ERROR = "DWG se nepodařilo přečíst — soubor je poškozený nebo z nepodporované verze AutoCADu.";

/** Strop počtu výsledných entit (pole bloků umí výkres „nafouknout" — paměť workeru). */
export const MAX_DWG_ENTITIES = 1_000_000;
/** Maximální hloubka vnoření bloků. */
const MAX_BLOCK_DEPTH = 32;

// LibreDWG — chybové bity dwg_read_file (Dwg_Error)
const DWG_ERR_CRITICAL = 128;
const DWG_ERR_OUTOFMEM = 8192;

// ───────────────────────────── načtení WASM ─────────────────────────────

/** Načtená knihovna: instance WASM + číselník typů objektů (Dwg_Object_Type) z téhož balíčku. */
interface LoadedLib {
  lib: LibreDwgEx;
  types: Record<string, number | string>;
  /** Kódová stránka DWG (DwgCodePage) → jméno kódování pro TextDecoder. */
  encodingOf: (codepage: number) => string;
}

const libCache = new Map<string, Promise<LoadedLib>>();
let tmpSeq = 0;

/** Bez koncového lomítka (knihovna skládá `${dir}/libredwg-web.wasm`); kořen „/" → "" (ne „//…" = jiný host). */
function normalizeWasmDir(wasmDir: string): string {
  if (!wasmDir) return ".";
  return wasmDir.replace(/[\\/]+$/, "");
}

/** Instance LibreDWG pro daný adresář s `libredwg-web.wasm` (sdílená, líně vytvořená). */
function loadLibreDwg(wasmDir: string): Promise<LoadedLib> {
  const dir = normalizeWasmDir(wasmDir);
  let p = libCache.get(dir);
  if (!p) {
    const created = import("@mlightcad/libredwg-web").then(async (m) => ({
      lib: await m.LibreDwg.create(dir),
      types: m.Dwg_Object_Type as unknown as Record<string, number | string>,
      encodingOf: m.dwgCodePageToEncoding as (codepage: number) => string,
    }));
    p = created;
    libCache.set(dir, created);
    created.catch(() => {
      if (libCache.get(dir) === created) libCache.delete(dir);
    });
  }
  return p;
}

const ZERO_REF = Object.freeze({ absolute_ref: 0, value: 0, handleref: Object.freeze({ value: 0 }) });
/** Pole entit, která prohlížeč nepotřebuje (šířky polyčar, vzor šrafy, body semínek, tloušťka). */
const SKIPPED_FIELDS: Readonly<Record<string, number>> = Object.freeze({
  thickness: 0, num_widths: 0, widths: 0, num_deflines: 0, deflines: 0, num_seeds: 0,
});

/**
 * „Hostitel" pro LibreDwg.convert(): stejné metody, ale data, která 2D prohlížeč nepoužívá
 * (xdata, vlastník, rozšiřující slovník, typ čáry, náhledy bloků a výkresu, šířky, vzor šrafy),
 * se z WASM vůbec nečtou — převod je o ~40 % rychlejší (marshalling embind je hlavní náklad).
 */
function fastConvertHost(lib: LibreDwgEx): LibreDwgEx {
  const host = Object.create(lib) as LibreDwgEx;
  // metody třídy a wasmInstance jako vlastní vlastnosti — volání neprochází pastí `get` Proxy knihovny
  const proto = Object.getPrototypeOf(lib) as Record<string, unknown> | null;
  if (proto) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name === "constructor") continue;
      const fn = Object.getOwnPropertyDescriptor(proto, name)?.value;
      if (typeof fn === "function") Object.defineProperty(host, name, { value: fn, writable: true, configurable: true });
    }
  }
  const wasm = (lib as unknown as { wasmInstance?: unknown }).wasmInstance;
  if (wasm) Object.defineProperty(host, "wasmInstance", { value: wasm, writable: true, configurable: true });
  const dynapi = lib.dwg_dynapi_entity_data;
  Object.assign(host, {
    dwg_object_entity_get_xdata: () => [],
    dwg_object_entity_get_handle_object: () => ZERO_REF,
    dwg_object_entity_get_ownerhandle_object: () => ZERO_REF,
    dwg_object_entity_get_xdicobjhandle_object: () => ZERO_REF,
    dwg_object_entity_get_ltype_object_ref: () => ZERO_REF,
    dwg_object_entity_get_line_weight: () => 0,
    dwg_object_entity_get_ltype_scale: () => 1,
    dwg_entity_block_header_get_preview: () => null,
    dwg_ptr_to_hatch_defline_array: () => [],
    dwg_bmp: () => null,
    dwg_dynapi_entity_data(this: LibreDwgEx, obj: number, field: string) {
      return Object.prototype.hasOwnProperty.call(SKIPPED_FIELDS, field) ? SKIPPED_FIELDS[field] : dynapi.call(this, obj, field);
    },
  });
  return host;
}

/** DwgDatabase z načteného souboru: rychlá cesta, při nečekané chybě JS (ne pádu WASM) běžný convert(). */
function convertDatabase(lib: LibreDwgEx, data: number): DwgDatabase {
  try {
    return lib.convert.call(fastConvertHost(lib), data) as DwgDatabase;
  } catch (e) {
    if (typeof WebAssembly !== "undefined" && e instanceof WebAssembly.RuntimeError) throw e;
    return lib.convert(data);
  }
}

/** Zahodí instanci (po pádu uvnitř WASM je její stav nepoužitelný). */
function dropLibreDwg(wasmDir: string): void {
  libCache.delete(normalizeWasmDir(wasmDir));
}

/** Rychlá kontrola hlavičky: DWG začíná verzí „AC1015", „AC1032", „AC1009", … */
function looksLikeDwg(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  const head = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]);
  return /^AC\d{4}$/.test(head) || /^AC[12]\.\d/.test(head) || head.startsWith("MC0.0");
}

/**
 * DWG bajty → 2D výkres (mm). `wasmDir` = adresář se souborem `libredwg-web.wasm`
 * (v prohlížeči URL cesta, např. `/vendor/libredwg-0.8.1/`; v Node cesta na disku).
 */
export async function parseDwg(bytes: Uint8Array, wasmDir: string): Promise<Drawing2D> {
  if (!looksLikeDwg(bytes)) {
    throw new ModelImportError("Soubor není výkres DWG (chybí hlavička AutoCADu) — zkontroluj příponu souboru.");
  }
  let lib: LibreDwgEx;
  let types: Record<string, number | string>;
  let encodingOf: (codepage: number) => string;
  try {
    ({ lib, types, encodingOf } = await loadLibreDwg(wasmDir));
  } catch {
    throw new ModelImportError("Modul pro čtení DWG (WebAssembly) se nepodařilo načíst — zkus stránku obnovit.");
  }

  let data = 0;
  let db: DwgDatabase;
  let version = "";
  let readError = 0;
  let encoding: string | undefined;
  let dropped: DroppedByBlock = new Map();
  try {
    // dwg_read_file přímo (místo dwg_read_data): chybový kód bez výpisu do konzole
    const name = `/dwg-import-${++tmpSeq}.dwg`;
    lib.FS.writeFile(name, bytes);
    let res: { error: number; data: number };
    try {
      res = lib.dwg_read_file(name) as { error: number; data: number };
    } finally {
      try {
        lib.FS.unlink(name);
      } catch {
        // soubor v paměťovém FS už není
      }
    }
    data = res.data;
    readError = res.error;
    if (readError & DWG_ERR_OUTOFMEM) {
      if (data) lib.dwg_abandon(data);
      data = 0;
      throw new ModelImportError("Výkres DWG je příliš velký — prohlížeči došla paměť.");
    }
    if (!data || lib.dwg_get_num_objects(data) === 0) throw new ModelImportError(DWG_READ_ERROR);
    try {
      version = lib.dwg_get_version_type(data)?.hdr ?? "";
      encoding = encodingOf(lib.dwg_get_codepage(data));
    } catch {
      version = version || "";
    }
    db = convertDatabase(lib, data);
    // doplnění toho, co convert() vynechává (MINSERT, ARC_DIMENSION, …), a soupis nepodporovaných typů
    try {
      dropped = supplementDatabase(lib, types, data, db);
    } catch {
      // pomocný průchod selhal — výkres z convert() stačí, instanci pro jistotu zahodit
      dropLibreDwg(wasmDir);
      dropped = new Map();
    }
  } catch (e) {
    if (e instanceof ModelImportError) throw e;
    // pád uvnitř WASM (RuntimeError) — instanci zahodit, příště se vytvoří nová
    dropLibreDwg(wasmDir);
    data = 0;
    throw new ModelImportError(DWG_READ_ERROR);
  } finally {
    if (data) {
      try {
        lib.dwg_free(data);
      } catch {
        dropLibreDwg(wasmDir);
      }
    }
  }

  const drawing = dwgDatabaseToDrawing(db, { version, dropped, encoding });
  if (readError >= DWG_ERR_CRITICAL) {
    drawing.warnings = ["Soubor DWG je částečně poškozený — výkres nemusí být úplný.", ...(drawing.warnings ?? [])];
  }
  return drawing;
}

// ───────────────────────── doplnění výstupu convert() ─────────────────────────

/** Entity, které convert() vynechal a nekreslí se: blok (jméno velkými písmeny) → typ (DXF jméno) → počet. */
export type DroppedByBlock = Map<string, Map<string, number>>;

/**
 * Typy entit, které LibreDwg.convert() z @mlightcad/libredwg-web 0.8.1 převádí (ostatní tiše vynechává).
 * Při povýšení knihovny zkontrolovat — kdyby začala převádět MINSERT / ARC_DIMENSION, patří sem (jinak by byly dvakrát).
 */
const CONVERTED_TYPES = [
  "3DFACE", "3DSOLID", "ARC", "ARCALIGNEDTEXT", "ATTDEF", "CIRCLE", "DIMENSION_ALIGNED", "DIMENSION_LINEAR",
  "DIMENSION_ANG3PT", "DIMENSION_ANG2LN", "DIMENSION_DIAMETER", "DIMENSION_ORDINATE", "DIMENSION_RADIUS", "ELLIPSE",
  "HATCH", "IMAGE", "INSERT", "LEADER", "LINE", "LWPOLYLINE", "MLINE", "MULTILEADER", "MTEXT", "OLE2FRAME", "OLEFRAME",
  "POINT", "POLYLINE_2D", "POLYLINE_3D", "PROXY_ENTITY", "RAY", "SECTIONOBJECT", "SHAPE", "SOLID", "TRACE", "SPLINE",
  "TABLE", "TEXT", "TOLERANCE", "VIEWPORT", "WIPEOUT", "XLINE",
];
/** Podřízené / pomocné objekty bez vlastní kresby (atributy, vrcholy, světla). */
const IGNORED_TYPES = ["ATTRIB", "SEQEND", "BLOCK", "ENDBLK", "VERTEX_2D", "VERTEX_3D", "VERTEX_MESH", "VERTEX_PFACE", "VERTEX_PFACE_FACE", "LIGHT"];

interface RawColor {
  index?: number;
  rgb?: number;
  method?: number;
}
interface RawRef {
  handleref?: { value?: number | bigint | string };
}

/**
 * Druhý, levný průchod surovým API LibreDWG (2 volání na entitu): projde vlastněné entity všech
 * bloků a doplní do `db` to, co convert() zahazuje, ač jde nakreslit — MINSERT (pole bloků) a kóty
 * ARC_DIMENSION / LARGE_RADIAL_DIMENSION (přes jejich blok *D…). Ostatní vynechané typy (REGION,
 * HELIX, objekty aplikací…) jen sečte pro upozornění.
 */
export function supplementDatabase(lib: LibreDwgEx, types: Record<string, number | string>, data: number, db: DwgDatabase): DroppedByBlock {
  const T = (n: string): number => {
    const v = types[`DWG_TYPE_${n}`];
    return typeof v === "number" ? v : -1;
  };
  const known = new Set<number>([...CONVERTED_TYPES, ...IGNORED_TYPES].map(T).filter((v) => v >= 0));
  const tMinsert = T("MINSERT");
  const tArcDim = T("ARC_DIMENSION");
  const tLargeRadial = T("LARGE_RADIAL_DIMENSION");
  const tUnknown = T("UNKNOWN_ENT");

  const records = new Map<string, DwgBlockRecordTableEntry>();
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) if (b?.name) records.set(b.name.toUpperCase(), b);
  const layerByHandle = new Map<string, string>();
  for (const l of db.tables?.LAYER?.entries ?? []) if (l?.handle) layerByHandle.set(String(l.handle).toUpperCase(), l.name);

  const dropped: DroppedByBlock = new Map();
  const maxSteps = lib.dwg_get_num_objects(data) + 16;
  const numClasses = lib.dwg_get_num_classes(data);
  const hex = (v: unknown): string => (typeof v === "bigint" || typeof v === "number" ? v.toString(16).toUpperCase() : String(v ?? "").toUpperCase());

  const common = (obj: number) => {
    const ent = lib.dwg_object_to_entity(obj);
    const col = lib.dwg_object_entity_get_color_object(ent) as RawColor | null;
    let color: number | undefined;
    if (col && typeof col.rgb === "number" && (col.method === 194 || ((col.rgb >>> 24) & 255) === 194)) color = col.rgb & 0xffffff;
    const ref = lib.dwg_object_entity_get_layer_object_ref(ent) as RawRef | null;
    const hv = ref?.handleref?.value;
    return {
      handle: hex(lib.dwg_obj_get_handle_value(obj)),
      layer: hv !== undefined ? layerByHandle.get(hex(hv)) ?? "0" : "0",
      color,
      colorIndex: typeof col?.index === "number" ? col.index : 256,
      isVisible: !lib.dwg_object_entity_get_invisible(ent),
    };
  };

  for (const hdr of lib.dwg_getall_BLOCK_HEADER(data) ?? []) {
    if (!hdr) continue;
    const obj = lib.dwg_obj_generic_to_object(hdr);
    if (!obj) continue;
    let name: string | undefined = lib.dwg_entity_block_header_get_block(hdr)?.name;
    if (!name) name = lib.dwg_dynapi_entity_data(hdr, "name") as string | undefined;
    const rec = name ? records.get(String(name).toUpperCase()) : undefined;
    if (!rec) continue;
    const add = (e: DwgEntity) => {
      if (!rec.entities) rec.entities = [];
      rec.entities.push(e);
    };
    let cur = lib.get_first_owned_entity(obj);
    for (let steps = 0; cur && steps < maxSteps; steps++) {
      const ft = lib.dwg_object_get_fixedtype(cur);
      if (!known.has(ft)) {
        if (ft === tMinsert) {
          add(rawMinsert(lib, cur, common(cur)));
        } else if (ft === tArcDim || ft === tLargeRadial) {
          const tio = lib.dwg_object_to_entity_tio(cur);
          const d = (f: string) => lib.dwg_dynapi_entity_data(tio, f) as unknown;
          add({
            ...common(cur),
            type: "DIMENSION",
            name: lib.dwg_entity_get_block_name(tio, "block") ?? "",
            measurement: d("act_measurement"),
            textPoint: d("text_midpt"),
            text: d("user_text"),
            textRotation: d("text_rotation"),
            dimensionType: 0,
            extrusionDirection: d("extrusion"),
          } as unknown as DwgEntity);
        } else {
          let tname = lib.dwg_object_get_dxfname(cur) || "";
          if (ft === tUnknown || !tname || tname === "UNKNOWN_ENT") {
            const t = lib.dwg_object_get_type(cur);
            if (t >= 500 && t - 500 < numClasses) tname = lib.dwg_get_class(data, t - 500)?.dxfname || tname;
          }
          if (tname !== "LIGHT") {
            const key = rec.name.toUpperCase();
            let m = dropped.get(key);
            if (!m) dropped.set(key, (m = new Map()));
            m.set(tname || "?", (m.get(tname || "?") ?? 0) + 1);
          }
        }
      }
      cur = lib.get_next_owned_entity(obj, cur);
    }
  }
  return dropped;
}

/** MINSERT (vložení bloku v poli) → stejný tvar jako INSERT z convert(). */
function rawMinsert(lib: LibreDwgEx, obj: number, common: Partial<DwgEntity>): DwgEntity {
  const tio = lib.dwg_object_to_entity_tio(obj);
  const d = (f: string) => lib.dwg_dynapi_entity_data(tio, f) as unknown;
  let name = "";
  const ref = d("block_header") as number | undefined;
  if (ref) {
    const bo = lib.dwg_ref_get_object(ref);
    const bt = bo ? lib.dwg_object_to_object_tio(bo) : 0;
    if (bt) name = lib.dwg_entity_block_header_get_block(bt)?.name ?? "";
  }
  if (!name) name = String(d("block_name") ?? "");
  const scale = d("scale") as V3 | undefined;
  return {
    ...common,
    type: "INSERT",
    name,
    insertionPoint: d("ins_pt"),
    xScale: scale ? scale.x : 1,
    yScale: scale ? scale.y : 1,
    zScale: scale ? scale.z ?? 1 : 1,
    rotation: d("rotation") ?? 0,
    columnCount: d("num_cols") ?? 1,
    rowCount: d("num_rows") ?? 1,
    columnSpacing: d("col_spacing") ?? 0,
    rowSpacing: d("row_spacing") ?? 0,
    extrusionDirection: d("extrusion"),
    attribs: [],
  } as unknown as DwgEntity;
}

// ───────────────────────────── převod databáze ─────────────────────────────

export interface DwgConvertOptions {
  /** Verze z hlavičky souboru, např. „AC1032". */
  version?: string;
  /** Entity vynechané už při čtení (nepodporované typy) po blocích — započtou se do upozornění. */
  dropped?: DroppedByBlock;
  /** Kódování 8bitových řetězců výkresu (z kódové stránky DWG), např. „windows-1250". */
  encoding?: string;
}

interface Ctx {
  out: DrawEntity[];
  blocks: Map<string, DwgBlockRecordTableEntry>;
  blocksUpper: Map<string, DwgBlockRecordTableEntry>;
  blocksByHandle: Map<string, DwgBlockRecordTableEntry>;
  layerColors: Map<string, DrawColor>;
  /** Nepodporované typy entit → počet. */
  skipped: Map<string, number>;
  /** Vynechané typy po blocích (z čtení) — připočtou se při každém vykreslení bloku. */
  dropped: DroppedByBlock;
  /** Entity, jejichž převod selhal (poškozená data). */
  broken: number;
  missingBlocks: Set<string>;
  xrefs: Set<string>;
  cyclic: Set<string>;
  /** Jména bloků na aktuální cestě vnoření (detekce cyklů). */
  stack: string[];
  limitHit: boolean;
  /** Verze souboru (AC10xx) a kódování 8bitových řetězců — oprava textů MULTILEADER v R2004 a starších. */
  version: string;
  encoding: string;
}

/** Kontext vykreslení: transformace do světa (mm), zděděná hladina a barva BYBLOCK. */
interface Env {
  m: M2;
  /** Hladina vložení — entity bloku na hladině „0" ji přebírají (null = modelový prostor). */
  layer: string | null;
  /** Barva vložení pro entity s barvou BYBLOCK (null = modelový prostor → barva popředí). */
  byBlock: DrawColor | null;
  /** Uvnitř bloku kóty (definiční body na hladině Defpoints se nekreslí). */
  inDim: boolean;
}

/** Typy, které se záměrně nekreslí a nepatří do upozornění (konstrukční / pomocné objekty). */
const SILENT_TYPES = new Set(["ATTDEF", "VIEWPORT", "XLINE", "RAY", "WIPEOUT", "SEQEND", "VERTEX", "ENDBLK", "BLOCK"]);

/** Převod hotové `DwgDatabase` (výstup LibreDWG) na 2D výkres v mm. Exportováno kvůli testům. */
export function dwgDatabaseToDrawing(db: DwgDatabase, opts: DwgConvertOptions = {}): Drawing2D {
  const blocks = new Map<string, DwgBlockRecordTableEntry>();
  const blocksUpper = new Map<string, DwgBlockRecordTableEntry>();
  const blocksByHandle = new Map<string, DwgBlockRecordTableEntry>();
  for (const b of db.tables?.BLOCK_RECORD?.entries ?? []) {
    if (!b || typeof b.name !== "string") continue;
    if (!blocks.has(b.name)) blocks.set(b.name, b);
    const up = b.name.toUpperCase();
    if (!blocksUpper.has(up)) blocksUpper.set(up, b);
    if (b.handle) blocksByHandle.set(String(b.handle).toUpperCase(), b);
  }

  // hladiny (pořadí podle tabulky)
  const tableLayers: DrawLayer[] = [];
  const layerColors = new Map<string, DrawColor>();
  for (const l of db.tables?.LAYER?.entries ?? []) {
    if (!l || typeof l.name !== "string" || layerColors.has(l.name)) continue;
    const color = layerColor(l);
    layerColors.set(l.name, color);
    const off = !!l.off || !!l.frozen || (typeof l.colorIndex === "number" && l.colorIndex < 0);
    tableLayers.push(off ? { name: l.name, color, off: true } : { name: l.name, color });
  }

  const ctx: Ctx = {
    out: [],
    blocks,
    blocksUpper,
    blocksByHandle,
    layerColors,
    skipped: new Map(),
    dropped: opts.dropped ?? new Map(),
    broken: 0,
    missingBlocks: new Set(),
    xrefs: new Set(),
    cyclic: new Set(),
    stack: [],
    limitHit: false,
    version: opts.version ?? "",
    encoding: opts.encoding || "windows-1252",
  };

  const scale = insunitsToMm(typeof db.header?.INSUNITS === "number" ? db.header.INSUNITS : undefined);
  const root: Env = { m: scale === 1 ? IDENTITY : [scale, 0, 0, scale, 0, 0], layer: null, byBlock: null, inDim: false };

  // modelový prostor: přímo blok *Model_Space (db.entities obsahuje i paper space a atributy zvlášť)
  const model = blocksUpper.get("*MODEL_SPACE");
  const modelEntities: DwgEntity[] = model ? model.entities ?? [] : (db.entities ?? []).filter((e) => !e.isInPaperSpace);
  if (model) noteDropped(ctx, model.name);
  emitAll(ctx, modelEntities, root);

  const warnings: string[] = [];
  if (ctx.out.length === 0 && !ctx.limitHit) {
    // prázdný model, obsah jen v rozvržení (paper space) → ukázat aktivní rozvržení
    const paper = blocksUpper.get("*PAPER_SPACE");
    const paperEntities = (paper?.entities ?? []).filter((e) => e.type !== "VIEWPORT");
    if (paperEntities.length) {
      if (paper) noteDropped(ctx, paper.name);
      emitAll(ctx, paperEntities, root);
      if (ctx.out.length) warnings.push("Modelový prostor je prázdný — zobrazuje se rozvržení (paper space) bez obsahu výřezů.");
    }
  }

  const unsupported = [...ctx.skipped.entries()].sort((a, b) => b[1] - a[1]);
  if (unsupported.length) {
    const parts = unsupported.slice(0, 6).map(([t, n]) => `${t} ${n}×`);
    const more = unsupported.length > 6 ? " a další" : "";
    warnings.push(`Některé prvky výkresu se nezobrazí — nepodporované typy: ${parts.join(", ")}${more}.`);
  }
  if (ctx.broken > 0) {
    warnings.push(`${czCount(ctx.broken, "prvek", "prvky", "prvků")} výkresu se nepodařilo převést (poškozená data) — výkres nemusí být úplný.`);
  }
  if (ctx.missingBlocks.size) warnings.push(`Chybí definice bloků (${listNames(ctx.missingBlocks)}) — jejich vložení se nezobrazí.`);
  if (ctx.xrefs.size) warnings.push(`Externí reference (${listNames(ctx.xrefs)}) se nezobrazí — výkres na ně jen odkazuje.`);
  if (ctx.cyclic.size) warnings.push(`Bloky ${listNames(ctx.cyclic)} se odkazují samy na sebe nebo jsou vnořené příliš hluboko — přeskočeno.`);
  if (ctx.limitHit) {
    warnings.push(`Výkres je příliš rozsáhlý — zobrazeno prvních ${MAX_DWG_ENTITIES.toLocaleString("cs-CZ")} prvků.`);
  }

  // jen hladiny, na kterých něco je (v pořadí tabulky), plus hladiny chybějící v tabulce
  const used = new Set<string>();
  for (const e of ctx.out) used.add(e.layer);
  const layers = tableLayers.filter((l) => used.has(l.name));
  for (const name of used) if (!layerColors.has(name)) layers.push({ name, color: "fg" });

  const version = opts.version || (typeof db.header?.ACADVER === "string" ? db.header.ACADVER : "");
  return { layers, entities: ctx.out, format: version ? `DWG (${version})` : "DWG", warnings };
}

function emitAll(ctx: Ctx, entities: DwgEntity[], env: Env): void {
  for (const e of entities) {
    if (ctx.limitHit) return;
    try {
      emit(ctx, e, env);
    } catch {
      ctx.broken++;
    }
  }
}

/** Vynechané typy z bloku `name` → do upozornění (při každém vykreslení bloku). */
function noteDropped(ctx: Ctx, name: string): void {
  const m = ctx.dropped.get(name.toUpperCase());
  if (!m) return;
  for (const [t, n] of m) ctx.skipped.set(t, (ctx.skipped.get(t) ?? 0) + n);
}

function czCount(n: number, one: string, few: string, many: string): string {
  const word = n === 1 ? one : n >= 2 && n <= 4 ? few : many;
  return `${n.toLocaleString("cs-CZ")} ${word}`;
}

function listNames(names: Set<string>): string {
  const arr = [...names];
  return arr.slice(0, 5).join(", ") + (arr.length > 5 ? ", …" : "");
}

// ───────────────────────────── barvy a hladiny ─────────────────────────────

function layerColor(l: DwgLayerTableEntry): DrawColor {
  const ci = typeof l.colorIndex === "number" ? Math.abs(l.colorIndex) : 7;
  // LibreDWG: true color hladiny → colorIndex 256 + color (RGB); jinak ACI 1–255 a color = 0xFFFFFF
  if (ci >= 1 && ci <= 255) return aciColor(ci);
  if (typeof l.color === "number" && l.color !== 0xffffff) return trueColor(l.color);
  return "fg";
}

function entityLayer(e: DwgEntity, env: Env): string {
  const name = typeof e.layer === "string" && e.layer ? e.layer : "0";
  return name === "0" && env.layer !== null ? env.layer : name;
}

/** Barva entity: true color > ACI > BYLAYER (256) / BYBLOCK (0). */
function entityColor(ctx: Ctx, e: DwgEntity, layer: string, env: Env): DrawColor {
  if (typeof e.color === "number") return trueColor(e.color);
  const ci = typeof e.colorIndex === "number" ? e.colorIndex : 256;
  if (ci === 0) return env.byBlock ?? "fg";
  if (ci >= 256 || ci < -255) return ctx.layerColors.get(layer) ?? "fg";
  return aciColor(Math.abs(ci));
}

// ───────────────────────────── výstup ─────────────────────────────

function push(ctx: Ctx, e: DrawEntity): void {
  if (ctx.out.length >= MAX_DWG_ENTITIES) {
    ctx.limitHit = true;
    return;
  }
  ctx.out.push(e);
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const px = (p: { x?: number; y?: number } | null | undefined): number => num(p?.x);
const py = (p: { x?: number; y?: number } | null | undefined): number => num(p?.y);

/** Transformace entity v OCS (normála `n`, výška `elev`) do světa. */
function withOcs(m: M2, n: V3 | null | undefined, elev = 0): M2 {
  const o = ocsMatrix(n, elev);
  return o ? mul(m, o) : m;
}

function samePt(a: Pt, b: Pt): boolean {
  const tol = 1e-9 * (1 + Math.abs(a[0]) + Math.abs(a[1]));
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
}

/** Normalizace úhlu do <0, 2π). */
function norm(a: number): number {
  const r = a % TAU;
  return r < 0 ? r + TAU : r;
}

/** Polyčára v lokálních souřadnicích (volitelně s bulge) → svět. */
function emitPolyline(ctx: Ctx, m: M2, xs: number[], ys: number[], bulges: number[] | null, closed: boolean, layer: string, color: DrawColor): void {
  const n = xs.length;
  if (n < 2) {
    if (n === 1) push(ctx, { kind: "point", layer, color, p: apply(m, xs[0], ys[0]) });
    return;
  }
  const hasBulge = !!bulges && bulges.some((b, i) => b !== 0 && (closed || i < n - 1));
  if (!hasBulge) {
    const points: Pt[] = new Array(n);
    for (let i = 0; i < n; i++) points[i] = apply(m, xs[i], ys[i]);
    push(ctx, { kind: "polyline", layer, color, points, closed });
    return;
  }
  if (isSimilarity(m)) {
    const flip = det(m) < 0 ? -1 : 1;
    const points: Pt[] = new Array(n);
    const bl: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
      points[i] = apply(m, xs[i], ys[i]);
      bl[i] = num(bulges![i]) * flip;
    }
    push(ctx, { kind: "polyline", layer, color, points, bulges: bl, closed });
    return;
  }
  // nerovnoměrné měřítko: oblouky se rozloží na body (kružnice → elipsa)
  const local: Pt[] = [[xs[0], ys[0]]];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    bulgePoints(xs[i], ys[i], xs[j], ys[j], num(bulges![i]), local);
  }
  if (closed) local.pop(); // poslední bod = první
  push(ctx, { kind: "polyline", layer, color, points: local.map((p) => apply(m, p[0], p[1])), closed });
}

/** Kružnice / oblouk v lokálních souřadnicích (proti směru hodin a0 → a1) → svět. */
function emitArc(ctx: Ctx, m: M2, cx: number, cy: number, r: number, a0: number, a1: number, full: boolean, layer: string, color: DrawColor): void {
  if (!(r > 0)) return;
  const c = apply(m, cx, cy);
  const u = applyVec(m, r, 0);
  const v = applyVec(m, 0, r);
  if (isSimilarity(m)) {
    const rr = Math.hypot(u[0], u[1]);
    if (full) {
      push(ctx, { kind: "circle", layer, color, c, r: rr });
      return;
    }
    const rot = Math.atan2(u[1], u[0]);
    const [s, e] = det(m) > 0 ? normalizeSweep(a0 + rot, a1 + rot) : normalizeSweep(rot - a1, rot - a0);
    if (e - s >= TAU - 1e-9) push(ctx, { kind: "circle", layer, color, c, r: rr });
    else push(ctx, { kind: "arc", layer, color, c, r: rr, start: s, end: norm(e) });
    return;
  }
  const [t0, t1] = full ? [0, TAU] : normalizeSweep(a0, a1);
  const el = ellipseFromAxes(c, u, v, t0, t1);
  if (el) pushEllipse(ctx, el, layer, color);
}

function pushEllipse(
  ctx: Ctx,
  el: { c: Pt; major: Pt; ratio: number; start: number; end: number },
  layer: string,
  color: DrawColor,
): void {
  const full = el.end - el.start >= TAU - 1e-9;
  push(ctx, {
    kind: "ellipse", layer, color, c: el.c, major: el.major, ratio: el.ratio,
    start: full ? 0 : el.start, end: full ? TAU : norm(el.end),
  });
}

/** Body křivky (už ve světě) → „curve"; shodný první a poslední bod = uzavřená. */
function pushCurve(ctx: Ctx, pts: Pt[], forceClosed: boolean, layer: string, color: DrawColor): void {
  if (pts.length < 2) return;
  let closed = forceClosed;
  if (pts.length > 2 && samePt(pts[0], pts[pts.length - 1])) {
    pts = pts.slice(0, -1);
    closed = true;
  }
  push(ctx, { kind: "curve", layer, color, points: pts, closed });
}

/** Text v lokálních souřadnicích (poloha, rotace, výška) → svět. */
function pushText(
  ctx: Ctx, m: M2, x: number, y: number, rotation: number, height: number, text: string,
  hAlign: "left" | "center" | "right", vAlign: "baseline" | "bottom" | "middle" | "top",
  width: number | undefined, layer: string, color: DrawColor,
): void {
  const dir = applyVec(m, Math.cos(rotation), Math.sin(rotation));
  const dl = Math.hypot(dir[0], dir[1]);
  if (!(dl > 0)) return;
  const h = (height > 0 ? height : 2.5) * (Math.abs(det(m)) / dl);
  const out: DrawEntity = {
    kind: "text", layer, color, p: apply(m, x, y), text, height: h, rotation: Math.atan2(dir[1], dir[0]), hAlign, vAlign,
  };
  if (width && width > 0) out.width = width * dl;
  push(ctx, out);
}

const H_ALIGN = ["left", "center", "right"] as const;
const V_ALIGN = ["baseline", "bottom", "middle", "top"] as const;

/** TEXT / ATTRIB: zarovnání jako AutoCAD (bod vložení vs. bod zarovnání). */
function emitTextBase(ctx: Ctx, env: Env, t: DwgTextBase, layer: string, color: DrawColor): void {
  const text = plainText(String(t.text ?? ""));
  if (!text.trim()) return;
  const m = withOcs(env.m, t.extrusionDirection);
  const h = Math.round(num(t.halign));
  const v = Math.round(num(t.valign));
  const sx = px(t.startPoint);
  const sy = py(t.startPoint);
  // u jiného než výchozího zarovnání AutoCAD bod zarovnání vždy ukládá (i když je to 0,0)
  const hasEnd = !!t.endPoint;
  let x = sx;
  let y = sy;
  let rot = num(t.rotation);
  let hA: "left" | "center" | "right" = "left";
  let vA: "baseline" | "bottom" | "middle" | "top" = "baseline";
  if (h === 3 || h === 5) {
    // ALIGNED / FIT: text mezi bodem vložení a bodem zarovnání, na účaří
    if (hasEnd) {
      const ex = px(t.endPoint);
      const ey = py(t.endPoint);
      if (Math.hypot(ex - sx, ey - sy) > 1e-12) {
        x = (sx + ex) / 2;
        y = (sy + ey) / 2;
        rot = Math.atan2(ey - sy, ex - sx);
        hA = "center";
      }
    }
  } else if (h !== 0 || v !== 0) {
    if (hasEnd) {
      x = px(t.endPoint);
      y = py(t.endPoint);
    }
    if (h === 4) {
      hA = "center";
      vA = "middle";
    } else {
      hA = H_ALIGN[h] ?? "left";
      vA = V_ALIGN[v] ?? "baseline";
    }
  }
  pushText(ctx, m, x, y, rot, num(t.textHeight), text, hA, vA, undefined, layer, color);
}

/** Atribut MTEXT / MULTILEADER: 1–9 (TL, TC, TR, ML, MC, MR, BL, BC, BR). */
function attachment(ap: number): ["left" | "center" | "right", "top" | "middle" | "bottom"] {
  const a = Math.min(9, Math.max(1, Math.round(ap) || 1));
  return [H_ALIGN[(a - 1) % 3], (["top", "middle", "bottom"] as const)[Math.floor((a - 1) / 3)]];
}

// ───────────────────────────── entity ─────────────────────────────

function emit(ctx: Ctx, e: DwgEntity, env: Env): void {
  if (!e || e.isVisible === false) return;
  const type = String(e.type ?? "");
  const layer = entityLayer(e, env);
  const color = entityColor(ctx, e, layer, env);
  switch (type) {
    case "LINE": {
      const l = e as DwgLineEntity;
      push(ctx, { kind: "line", layer, color, a: apply(env.m, px(l.startPoint), py(l.startPoint)), b: apply(env.m, px(l.endPoint), py(l.endPoint)) });
      return;
    }
    case "LWPOLYLINE": {
      const pl = e as DwgLWPolylineEntity;
      const vs = pl.vertices ?? [];
      const m = withOcs(env.m, pl.extrusionDirection, num(pl.elevation));
      emitPolyline(ctx, m, vs.map(px), vs.map(py), vs.map((v) => num(v.bulge)), (num(pl.flag) & 512) !== 0, layer, color);
      return;
    }
    case "POLYLINE2D":
    case "POLYLINE3D": {
      const pl = e as DwgPolyline2dEntity | DwgPolyline3dEntity;
      let vs = (pl.vertices ?? []) as (DwgPolyline2dEntity["vertices"][number] | DwgPolyline3dEntity["vertices"][number])[];
      // spline-fit polyčára: kreslí se vrcholy proložení (8), ne řídicí body (16)
      if (vs.some((v) => (num(v.flag) & 8) !== 0)) vs = vs.filter((v) => (num(v.flag) & 16) === 0);
      const closed = (num(pl.flag) & 1) !== 0;
      if (type === "POLYLINE2D") {
        const p2 = pl as DwgPolyline2dEntity;
        const m = withOcs(env.m, p2.extrusionDirection, num(p2.elevation));
        const v2 = vs as DwgPolyline2dEntity["vertices"];
        emitPolyline(ctx, m, v2.map(px), v2.map(py), v2.map((v) => num(v.bulge)), closed, layer, color);
      } else {
        emitPolyline(ctx, env.m, vs.map(px), vs.map(py), null, closed, layer, color);
      }
      return;
    }
    case "CIRCLE": {
      const c = e as DwgCircleEntity;
      const m = withOcs(env.m, c.extrusionDirection, num(c.center?.z));
      emitArc(ctx, m, px(c.center), py(c.center), num(c.radius), 0, TAU, true, layer, color);
      return;
    }
    case "ARC": {
      const a = e as DwgArcEntity;
      const m = withOcs(env.m, a.extrusionDirection, num(a.center?.z));
      emitArc(ctx, m, px(a.center), py(a.center), num(a.radius), num(a.startAngle), num(a.endAngle), false, layer, color);
      return;
    }
    case "ELLIPSE": {
      const el = e as DwgEllipseEntity;
      const mj = el.majorAxisEndPoint;
      const n = unitNormal(el.extrusionDirection);
      const ratio = num(el.axisRatio, 1);
      // vedlejší poloosa = ratio · (N × hlavní)
      const mx = num(mj?.x);
      const my = num(mj?.y);
      const mz = num(mj?.z);
      const minX = ratio * (n[1] * mz - n[2] * my);
      const minY = ratio * (n[2] * mx - n[0] * mz);
      const [t0, t1] = normalizeSweep(num(el.startAngle), num(el.endAngle, TAU));
      const res = ellipseFromAxes(apply(env.m, px(el.center), py(el.center)), applyVec(env.m, mx, my), applyVec(env.m, minX, minY), t0, t1);
      if (res) pushEllipse(ctx, res, layer, color);
      return;
    }
    case "SPLINE": {
      const s = e as DwgSplineEntity;
      const ctrl = (s.controlPoints ?? []).map((p): Pt => [px(p), py(p)]);
      let pts: Pt[] = [];
      if (ctrl.length >= 2) {
        pts = evalNurbs(ctrl, (s.knots ?? []).map((k) => num(k)), num(s.degree, 3), s.weights ?? null);
      } else {
        const fit = (s.fitPoints ?? []).map((p): Pt => [px(p), py(p)]);
        const tan = (t: V3 | undefined): Pt | null => (t ? [num(t.x), num(t.y)] : null);
        if (fit.length >= 2) pts = num(s.degree, 3) <= 1 ? fit : interpolateFitPoints(fit, tan(s.startTangent), tan(s.endTangent));
      }
      if (pts.length >= 2) pushCurve(ctx, pts.map((p) => apply(env.m, p[0], p[1])), false, layer, color);
      return;
    }
    case "TEXT":
      emitTextBase(ctx, env, e as DwgTextEntity, layer, color);
      return;
    case "ATTRIB": {
      const a = e as DwgAttribEntity;
      if ((num(a.flags) & 1) !== 0 || !a.text) return; // neviditelný atribut
      emitTextBase(ctx, env, a.text, layer, color);
      return;
    }
    case "MTEXT": {
      const t = e as DwgMTextEntity;
      const text = plainText(String(t.text ?? ""));
      if (!text.trim()) return;
      const [hA, vA] = attachment(num(t.attachmentPoint, 1));
      const d = t.direction;
      const rot = d && (num(d.x) !== 0 || num(d.y) !== 0) ? Math.atan2(num(d.y), num(d.x)) : num(t.rotation);
      pushText(ctx, env.m, px(t.insertionPoint), py(t.insertionPoint), rot, num(t.textHeight) || num(t.rectHeight), text, hA, vA, num(t.rectWidth) || undefined, layer, color);
      return;
    }
    case "INSERT":
      emitInsert(ctx, e as DwgInsertEntity, env, layer, color);
      return;
    case "DIMENSION":
      emitDimension(ctx, e as DwgDimensionEntity, env, layer, color);
      return;
    case "POINT": {
      // definiční body kót (hladina Defpoints) se netisknou ani nezobrazují
      if (env.inDim && layer.toUpperCase() === "DEFPOINTS") return;
      const p = (e as DwgPointEntity).position;
      push(ctx, { kind: "point", layer, color, p: apply(env.m, px(p), py(p)) });
      return;
    }
    case "SOLID":
    case "TRACE": {
      const s = e as DwgSolidEntity;
      const m = withOcs(env.m, s.extrusionDirection);
      // pořadí rohů SOLID: 1-2-4-3
      const corners = [s.corner1, s.corner2, s.corner4 ?? s.corner3, s.corner3];
      const pts: Pt[] = [];
      for (const c of corners) {
        if (!c) continue;
        const p = apply(m, px(c), py(c));
        if (!pts.length || !samePt(pts[pts.length - 1], p)) pts.push(p);
      }
      if (pts.length > 2 && samePt(pts[0], pts[pts.length - 1])) pts.pop();
      if (pts.length >= 2) push(ctx, { kind: "polyline", layer, color, points: pts, closed: pts.length > 2 });
      return;
    }
    case "3DFACE": {
      const f = e as Dwg3dFaceEntity;
      const c: Pt[] = [f.corner1, f.corner2, f.corner3, f.corner4 ?? f.corner3].map((p) => apply(env.m, px(p), py(p)));
      const invisible = num(f.flag) & 15;
      if (!invisible) {
        const pts: Pt[] = [];
        for (const p of c) if (!pts.length || !samePt(pts[pts.length - 1], p)) pts.push(p);
        if (pts.length > 2 && samePt(pts[0], pts[pts.length - 1])) pts.pop();
        if (pts.length >= 2) push(ctx, { kind: "polyline", layer, color, points: pts, closed: pts.length > 2 });
      } else {
        for (let i = 0; i < 4; i++) {
          if (invisible & (1 << i)) continue;
          const a = c[i];
          const b = c[(i + 1) % 4];
          if (!samePt(a, b)) push(ctx, { kind: "line", layer, color, a, b });
        }
      }
      return;
    }
    case "HATCH":
      emitHatch(ctx, e as DwgHatchEntity, env, layer, color);
      return;
    case "LEADER": {
      const l = e as DwgLeaderEntity;
      const pts = (l.vertices ?? []).map((p): Pt => [px(p), py(p)]);
      if (pts.length < 2) return;
      if (l.isSpline && pts.length >= 3) pushCurve(ctx, interpolateFitPoints(pts).map((p) => apply(env.m, p[0], p[1])), false, layer, color);
      else emitPolyline(ctx, env.m, pts.map((p) => p[0]), pts.map((p) => p[1]), null, false, layer, color);
      return;
    }
    case "MULTILEADER":
      emitMultiLeader(ctx, e as DwgMultiLeaderEntity, env, layer, color);
      return;
    case "MLINE": {
      const ml = e as DwgMLineEntity;
      const vs = ml.vertices ?? [];
      const lines = Math.max(0, ...vs.map((v) => v.lines?.length ?? 0));
      const closed = (num(ml.flags) & 2) !== 0;
      for (let j = 0; j < lines; j++) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (const v of vs) {
          const off = num(v.lines?.[j]?.segmentParams?.[0]);
          xs.push(px(v.vertex) + num(v.miterDirection?.x) * off);
          ys.push(py(v.vertex) + num(v.miterDirection?.y) * off);
        }
        emitPolyline(ctx, env.m, xs, ys, null, closed, layer, color);
      }
      return;
    }
    default:
      if (!SILENT_TYPES.has(type)) ctx.skipped.set(type || "?", (ctx.skipped.get(type || "?") ?? 0) + 1);
  }
}

function unitNormal(n: V3 | null | undefined): [number, number, number] {
  const x = num(n?.x);
  const y = num(n?.y);
  const z = num(n?.z);
  const l = Math.hypot(x, y, z);
  return l > 1e-12 ? [x / l, y / l, z / l] : [0, 0, 1];
}

function findBlock(ctx: Ctx, name: string): DwgBlockRecordTableEntry | undefined {
  return ctx.blocks.get(name) ?? ctx.blocksUpper.get(name.toUpperCase());
}

/** Vstup do bloku (kontrola cyklů / hloubky). false = přeskočit. */
function enterBlock(ctx: Ctx, name: string): boolean {
  const up = name.toUpperCase();
  if (ctx.stack.length >= MAX_BLOCK_DEPTH || ctx.stack.includes(up)) {
    ctx.cyclic.add(name);
    return false;
  }
  ctx.stack.push(up);
  return true;
}

function emitInsert(ctx: Ctx, ins: DwgInsertEntity, env: Env, layer: string, color: DrawColor): void {
  const name = String(ins.name ?? "");
  const block = name ? findBlock(ctx, name) : undefined;
  if (!block) {
    if (name) ctx.missingBlocks.add(name);
  } else if ((num(block.flags) & 4) !== 0 && !(block.entities ?? []).length) {
    ctx.xrefs.add(name);
  } else if (enterBlock(ctx, name)) {
    try {
      const m = withOcs(env.m, ins.extrusionDirection, num(ins.insertionPoint?.z));
      const ix = px(ins.insertionPoint);
      const iy = py(ins.insertionPoint);
      const xs = num(ins.xScale, 1) || 1;
      const ys = num(ins.yScale, 1) || 1;
      const rot = num(ins.rotation);
      const cols = Math.max(1, Math.floor(num(ins.columnCount, 1)));
      const rows = Math.max(1, Math.floor(num(ins.rowCount, 1)));
      const cs = num(ins.columnSpacing);
      const rs = num(ins.rowSpacing);
      const bx = px(block.basePoint);
      const by = py(block.basePoint);
      const cos = Math.cos(rot);
      const sin = Math.sin(rot);
      const ents = block.entities ?? [];
      noteDropped(ctx, block.name);
      // prázdný blok se neprochází; nesmyslně velké pole (MINSERT 10⁵ × 10⁵) jen do stropu entit
      const cells = ents.length ? rows * cols : 0;
      for (let k = 0; k < cells && !ctx.limitHit; k++) {
        if (k >= MAX_DWG_ENTITIES) {
          ctx.limitHit = true;
          break;
        }
        // T(ip + R·(c·cs, r·rs)) · R(rot) · S(xs, ys) · T(−base)
        const ox = (k % cols) * cs;
        const oy = Math.floor(k / cols) * rs;
        const local = trs(ix + cos * ox - sin * oy, iy + sin * ox + cos * oy, rot, xs, ys);
        local[4] -= local[0] * bx + local[2] * by;
        local[5] -= local[1] * bx + local[3] * by;
        emitAll(ctx, ents, { m: mul(m, local), layer, byBlock: color, inDim: false });
      }
    } finally {
      ctx.stack.pop();
    }
  }
  // atributy jsou uložené už ve světových (rodičovských) souřadnicích
  for (const a of ins.attribs ?? []) {
    if (ctx.limitHit) return;
    try {
      emit(ctx, a, env);
    } catch {
      ctx.broken++;
    }
  }
}

function emitDimension(ctx: Ctx, d: DwgDimensionEntity, env: Env, layer: string, color: DrawColor): void {
  const name = String(d.name ?? "");
  const block = name ? findBlock(ctx, name) : undefined;
  if (block && (block.entities ?? []).length) {
    if (!enterBlock(ctx, name)) return;
    try {
      // geometrie kóty je v bloku *D… už ve světových souřadnicích (identita)
      noteDropped(ctx, block.name);
      emitAll(ctx, block.entities, { m: env.m, layer, byBlock: color, inDim: true });
    } finally {
      ctx.stack.pop();
    }
    return;
  }
  // blok kóty chybí → aspoň text s naměřenou hodnotou
  const measured = num(d.measurement, NaN);
  const raw = typeof d.text === "string" ? d.text : "";
  if (raw === " ") return; // potlačený text
  const value = Number.isFinite(measured) ? formatMeasurement(d, measured) : "";
  const text = plainText(raw ? raw.replace(/<>/g, value) : value);
  if (!text.trim() || !d.textPoint) return;
  pushText(ctx, env.m, px(d.textPoint), py(d.textPoint), num(d.textRotation), 2.5, text, "center", "middle", undefined, layer, color);
}

function formatMeasurement(d: DwgDimensionEntity, v: number): string {
  const t = num(d.dimensionType) & 15;
  if (t === 2 || t === 5) return `${(Math.round(((v * 180) / Math.PI) * 100) / 100).toString().replace(".", ",")}°`;
  return (Math.round(v * 100) / 100).toString().replace(".", ",");
}

function emitHatch(ctx: Ctx, h: DwgHatchEntity, env: Env, layer: string, color: DrawColor): void {
  const m = withOcs(env.m, h.extrusionDirection);
  for (const path of (h.boundaryPaths ?? []) as DwgBoundaryPath[]) {
    if (!path) continue;
    if ("vertices" in path && Array.isArray(path.vertices)) {
      const vs = path.vertices;
      emitPolyline(ctx, m, vs.map(px), vs.map(py), path.hasBulge ? vs.map((v) => num(v.bulge)) : null, path.isClosed !== false, layer, color);
      continue;
    }
    if (!("edges" in path) || !Array.isArray(path.edges)) continue;
    // navazující úsečky → jedna polyčára; oblouky / elipsy / spliny zvlášť
    let chainX: number[] = [];
    let chainY: number[] = [];
    const flush = () => {
      if (chainX.length >= 2) {
        const n = chainX.length;
        const closed = n > 3 && samePt([chainX[0], chainY[0]], [chainX[n - 1], chainY[n - 1]]);
        if (closed) {
          chainX.pop();
          chainY.pop();
        }
        emitPolyline(ctx, m, chainX, chainY, null, closed, layer, color);
      }
      chainX = [];
      chainY = [];
    };
    for (const edge of path.edges as DwgBoundaryPathEdge[]) {
      if (!edge) continue;
      switch (edge.type) {
        case 1: {
          const ed = edge as Extract<DwgBoundaryPathEdge, { start: unknown }>;
          const sx = px(ed.start);
          const sy = py(ed.start);
          const n = chainX.length;
          if (n && !samePt([chainX[n - 1], chainY[n - 1]], [sx, sy])) flush();
          if (!chainX.length) {
            chainX.push(sx);
            chainY.push(sy);
          }
          chainX.push(px(ed.end));
          chainY.push(py(ed.end));
          break;
        }
        case 2: {
          flush();
          const ed = edge as Extract<DwgBoundaryPathEdge, { radius: unknown }>;
          const s = num(ed.startAngle);
          const en = num(ed.endAngle);
          // úhly oblouku po směru hodin jsou v DWG uložené zrcadlově (−úhel)
          if (ed.isCCW === false) emitArc(ctx, m, px(ed.center), py(ed.center), num(ed.radius), -en, -s, false, layer, color);
          else emitArc(ctx, m, px(ed.center), py(ed.center), num(ed.radius), s, en, false, layer, color);
          break;
        }
        case 3: {
          flush();
          const ed = edge as Extract<DwgBoundaryPathEdge, { lengthOfMinorAxis: unknown }>;
          const mx = px(ed.end);
          const my = py(ed.end);
          const ratio = num(ed.lengthOfMinorAxis, 1);
          let s = num(ed.startAngle);
          let en = num(ed.endAngle);
          if (ed.isCCW === false) [s, en] = [-en, -s];
          const [t0, t1] = normalizeSweep(s, en);
          const res = ellipseFromAxes(apply(m, px(ed.center), py(ed.center)), applyVec(m, mx, my), applyVec(m, -my * ratio, mx * ratio), t0, t1);
          if (res) pushEllipse(ctx, res, layer, color);
          break;
        }
        case 4: {
          flush();
          const ed = edge as Extract<DwgBoundaryPathEdge, { knots: unknown }>;
          const ctrl = (ed.controlPoints ?? []).map((p): Pt => [px(p), py(p)]);
          const weights = (ed.controlPoints ?? []).map((p) => num(p.weight, 1));
          let pts: Pt[] = [];
          if (ctrl.length >= 2) pts = evalNurbs(ctrl, (ed.knots ?? []).map((k) => num(k)), num(ed.degree, 3), weights.some((w) => w !== 1) ? weights : null);
          else if ((ed.fitDatum ?? []).length >= 2) pts = interpolateFitPoints(ed.fitDatum.map((p): Pt => [px(p), py(p)]));
          if (pts.length >= 2) pushCurve(ctx, pts.map((p) => apply(m, p[0], p[1])), false, layer, color);
          break;
        }
        default:
          break;
      }
    }
    flush();
  }
}

/**
 * Soubory do R2004 (< AC1021) mají 8bitové řetězce, ale libredwg-web čte text MULTILEADER jako
 * UTF-16 → dvojice bajtů slepené do jednoho znaku („xx\\Pxx" → „硸停硸"). Rozložit zpět na bajty
 * a dekódovat kódovou stránkou výkresu; jiné texty nechat beze změny.
 */
export function repairLegacyText(s: string, version: string, encoding = "windows-1252"): string {
  if (!s || !version || !/^AC\d{4}$/.test(version) || version >= "AC1021") return s;
  for (let i = 0; i < s.length - 1; i++) if (s.charCodeAt(i) <= 0xff) return s;
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    bytes.push(c & 0xff);
    if (c > 0xff) bytes.push(c >> 8);
  }
  while (bytes.length && bytes[bytes.length - 1] === 0) bytes.pop();
  // jen pokud z toho vznikne rozumný text (bez řídicích znaků kromě tabulátoru / konce řádku)
  if (!bytes.length || bytes.some((b) => b < 0x20 && b !== 9 && b !== 10 && b !== 13)) return s;
  try {
    return new TextDecoder(encoding).decode(new Uint8Array(bytes));
  } catch {
    return String.fromCharCode(...bytes);
  }
}

function emitMultiLeader(ctx: Ctx, ml: DwgMultiLeaderEntity, env: Env, layer: string, color: DrawColor): void {
  const m = env.m;
  for (const sec of ml.leaderSections ?? []) {
    const last = sec.lastLeaderLinePointSet !== false && sec.lastLeaderLinePoint ? sec.lastLeaderLinePoint : null;
    for (const line of sec.leaderLines ?? []) {
      const xs = (line.vertices ?? []).map(px);
      const ys = (line.vertices ?? []).map(py);
      if (last) {
        xs.push(px(last));
        ys.push(py(last));
      }
      if (xs.length >= 2) emitPolyline(ctx, m, xs, ys, null, false, layer, color);
    }
    // „dogleg" — vodorovná odbočka k textu
    const len = num(sec.doglegLength, num(ml.doglegLength));
    if (last && ml.doglegEnabled !== false && sec.doglegVector && len > 0) {
      const a = apply(m, px(last), py(last));
      const b = apply(m, px(last) + num(sec.doglegVector.x) * len, py(last) + num(sec.doglegVector.y) * len);
      if (!samePt(a, b)) push(ctx, { kind: "line", layer, color, a, b });
    }
  }
  if (ml.hasMText !== false && ml.textContent && ml.textAnchor) {
    const text = plainText(repairLegacyText(String(ml.textContent), ctx.version, ctx.encoding));
    if (text.trim()) {
      const [hA, vA] = attachment(num(ml.textAttachmentPoint, 1));
      const d = ml.textDirection;
      const rot = d && (num(d.x) !== 0 || num(d.y) !== 0) ? Math.atan2(num(d.y), num(d.x)) : num(ml.textRotation);
      pushText(ctx, m, px(ml.textAnchor), py(ml.textAnchor), rot, num(ml.textHeight, 2.5), text, hA, vA, num(ml.textWidth) || undefined, layer, color);
    }
  }
  // obsah typu blok (např. pozice v kroužku)
  const bc = ml.blockContent;
  const blockId = bc?.blockContentId ?? ml.blockContentId;
  if (ml.hasBlock && blockId && bc?.position) {
    const block = ctx.blocksByHandle.get(String(blockId).toUpperCase());
    if (block && enterBlock(ctx, block.name)) {
      try {
        const sc = bc.scale ?? ml.blockContentScale;
        const local = trs(px(bc.position), py(bc.position), num(bc.rotation, num(ml.blockContentRotation)), num(sc?.x, 1) || 1, num(sc?.y, 1) || 1);
        local[4] -= local[0] * px(block.basePoint) + local[2] * py(block.basePoint);
        local[5] -= local[1] * px(block.basePoint) + local[3] * py(block.basePoint);
        noteDropped(ctx, block.name);
        emitAll(ctx, block.entities ?? [], { m: mul(m, local), layer, byBlock: color, inDim: false });
      } finally {
        ctx.stack.pop();
      }
    }
  }
}
