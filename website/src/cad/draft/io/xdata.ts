/**
 * XDATA (rozšířená data entit) ⇄ model: `ext.xdata[aplikace] = [[kód, hodnota], …]`. Kódy 1000 text, 1002 { },
 * 1003 hladina, 1004 binární (hex), 1005 handle (hex), 1010–1013 body [x,y,z], 1040–1042 čísla, 1070 / 1071 celá.
 * Vlastní aplikace MNCAD nese id entity a údaje bez obdoby v DXF (JSON po kouscích 1000).
 */
import {
  type AppId,
  type CadObject,
  ExtendedData,
  ExtendedDataBinaryChunk,
  ExtendedDataControlString,
  ExtendedDataCoordinate,
  ExtendedDataDirection,
  ExtendedDataDisplacement,
  ExtendedDataDistance,
  ExtendedDataHandle,
  ExtendedDataInteger16,
  ExtendedDataInteger32,
  ExtendedDataLayer,
  ExtendedDataReal,
  type ExtendedDataRecord,
  ExtendedDataScale,
  ExtendedDataString,
  ExtendedDataWorldCoordinate,
  XYZ,
} from "@node-projects/acad-ts";
import { chunks, MNCAD_APP } from "./common";
import type { XRec } from "./types";

const hex = (u8: Uint8Array) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s: string) => Uint8Array.from((s.match(/../g) ?? []).map((x) => parseInt(x, 16)));
const xyz = (v: unknown): XYZ => {
  const a = Array.isArray(v) ? v : [0, 0, 0];
  return new XYZ(Number(a[0]) || 0, Number(a[1]) || 0, Number(a[2]) || 0);
};

/** záznam modelu → záznam acad-ts (neznámý kód = null) */
export function toRecord([code, v]: XRec, layerHandle: (name: string) => number = () => 0): ExtendedDataRecord | null {
  switch (code) {
    case 1000:
      return new ExtendedDataString(String(v ?? ""));
    case 1002:
      return new ExtendedDataControlString(String(v) === "}");
    case 1003:
      return new ExtendedDataLayer(layerHandle(String(v ?? "0")));
    case 1004:
      return new ExtendedDataBinaryChunk(unhex(String(v ?? "")));
    case 1005:
      return new ExtendedDataHandle(parseInt(String(v ?? "0"), 16) || 0);
    case 1010:
      return new ExtendedDataCoordinate(xyz(v));
    case 1011:
      return new ExtendedDataWorldCoordinate(xyz(v));
    case 1012:
      return new ExtendedDataDisplacement(xyz(v));
    case 1013:
      return new ExtendedDataDirection(xyz(v));
    case 1040:
      return new ExtendedDataReal(Number(v) || 0);
    case 1041:
      return new ExtendedDataDistance(Number(v) || 0);
    case 1042:
      return new ExtendedDataScale(Number(v) || 0);
    case 1070:
      return new ExtendedDataInteger16(Number(v) | 0);
    case 1071:
      return new ExtendedDataInteger32(Number(v) | 0);
  }
  return null;
}

/** záznam acad-ts → záznam modelu */
export function fromRecord(r: ExtendedDataRecord): XRec | null {
  const code = Number(r.code);
  const v = r.rawValue as unknown;
  if (code === 1002) return [1002, (r as ExtendedDataControlString).value === "}" ? "}" : "{"];
  if (code === 1004) return [1004, v instanceof Uint8Array ? hex(v) : ""];
  if (code === 1005) return [1005, Number(v || 0).toString(16).toUpperCase()];
  if (code >= 1010 && code <= 1013) {
    const p = v as { x: number; y: number; z: number } | undefined;
    return [code, p ? [p.x, p.y, p.z] : [0, 0, 0]];
  }
  if (code === 1003) {
    const ref = (r as unknown as { value?: { name?: string } | null }).value;
    return [1003, ref?.name ?? (typeof v === "string" ? v : "0")];
  }
  if (code >= 1000 && code <= 1071) return [code, v];
  return null;
}

/** XDATA objektu acad-ts → model (bez MNCAD a bez ACAD DSTYLE – ty se převádí zvlášť) */
export function readXData(o: CadObject, skip: (app: string) => boolean = () => false): { xdata?: Record<string, XRec[]>; mncad?: { id?: string; json?: Record<string, unknown> } } {
  const out: Record<string, XRec[]> = {};
  let mncad: { id?: string; json?: Record<string, unknown> } | undefined;
  let any = false;
  const dict = o.extendedData;
  if (!dict || dict.size === 0) return {};
  for (const [app, data] of dict) {
    const name = app?.name ?? "";
    if (name.toUpperCase() === MNCAD_APP) {
      const strs = data.records.filter((r) => Number(r.code) === 1000).map((r) => String(r.rawValue ?? ""));
      mncad = { id: strs[0] || undefined };
      if (strs.length > 1) {
        try {
          mncad.json = JSON.parse(strs.slice(1).join(""));
        } catch {
          /* poškozená data – ignorovat */
        }
      }
      continue;
    }
    if (skip(name)) continue;
    const recs = data.records.map(fromRecord).filter((x): x is XRec => !!x);
    out[name] = recs;
    any = true;
  }
  return { ...(any ? { xdata: out } : {}), ...(mncad ? { mncad } : {}) };
}

export type XDataCtx = { appId: (name: string) => AppId | null; layerHandle: (name: string) => number };

/** zapíše XDATA modelu + MNCAD (id, JSON) na objekt acad-ts */
export function writeXData(o: CadObject, ctx: XDataCtx, xdata: Record<string, XRec[]> | undefined, mncad?: { id?: string; json?: Record<string, unknown> }): void {
  if (xdata) {
    for (const [app, recs] of Object.entries(xdata)) {
      if (!app || app.toUpperCase() === MNCAD_APP) continue;
      const id = ctx.appId(app);
      if (!id) continue;
      const rs = recs.map((r) => toRecord(r, ctx.layerHandle)).filter((x): x is ExtendedDataRecord => !!x);
      o.extendedData.addByAppId(id, new ExtendedData(rs));
    }
  }
  if (mncad && (mncad.id || mncad.json)) {
    const id = ctx.appId(MNCAD_APP);
    if (!id) return;
    const rs: ExtendedDataRecord[] = [new ExtendedDataString(mncad.id ?? "")];
    if (mncad.json && Object.keys(mncad.json).length) for (const c of chunks(JSON.stringify(mncad.json))) rs.push(new ExtendedDataString(c));
    o.extendedData.addByAppId(id, new ExtendedData(rs));
  }
}
