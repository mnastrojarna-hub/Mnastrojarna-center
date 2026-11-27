/**
 * Vlna 22 kolo 7, bod 22h: zápis STEP po krocích s příčinou chyby (formats/export.ts writeStepFile).
 * Dřív replicad `blobSTEP` stav přenosu zahodil a při chybě hlásil jen „WRITE STEP FILE FAILED.“ – bez kroku, stavu jádra
 * a složení tvaru; průběh uvnitř převodu nebyl žádný.
 */
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import * as r from "replicad";
import opencascade from "replicad-opencascadejs";
import { setLang } from "../i18n";
import { exportShape, StepWriteError, writeStepFile, type StepStage } from "./export";

beforeAll(async () => {
  const oc = await (opencascade as unknown as (o: object) => Promise<unknown>)({
    locateFile: () => path.resolve(__dirname, "../../../node_modules/replicad-opencascadejs/dist/replicad_single.wasm"),
    print: () => undefined,
    printErr: () => undefined,
  });
  r.setOC(oc as never);
  setLang("cs");
}, 60_000);

// hlavička nese čas a počítadlo zápisů v relaci jádra („translator 8.0 2“) – zbytek musí být shodný
const body = (s: string) => s.replace(/^FILE_NAME\(.*$/m, "").replace(/STEP translator 8\.0 \d+/g, "STEP translator 8.0 N");
const text = (b: ArrayBuffer | Uint8Array) => new TextDecoder().decode(b instanceof Uint8Array ? b : new Uint8Array(b));

describe("bod 22h (kolo 7): převod do STEP po krocích", () => {
  it("kvádr: kroky přenos → zápis → čtení v pořadí, výsledek = dosavadní výstup replicad (mimo čas v hlavičce)", async () => {
    const box = r.makeBaseBox(20, 10, 5);
    const seen: { stage: StepStage; i: number; n: number; detail: string }[] = [];
    const mine = writeStepFile(box, (stage, i, n, detail) => seen.push({ stage, i, n, detail }));
    expect(seen.map((x) => `${x.stage} ${x.i + 1}/${x.n}`)).toEqual(["transfer 1/3", "write 2/3", "read 3/3"]);
    expect(seen[0].detail).toBe("tělesa 1, skořepiny 1, plochy 6");
    const old = text(await box.blobSTEP().arrayBuffer());
    expect(body(text(mine))).toBe(body(old));
    expect(text(await exportShape(box, "step", "Kvádr"))).toMatch(/MANIFOLD_SOLID_BREP/);
  });

  it("nulový tvar: chyba nese krok, stav jádra a složení tvaru (dřív „WRITE STEP FILE FAILED.“)", async () => {
    const oc = r.getOC() as unknown as { TopoDS_Shape: new () => unknown };
    const empty = { wrapped: new oc.TopoDS_Shape() } as unknown as r.Shape3D;
    // starý zápis (replicad) o příčině nic neřekne
    expect(() => (r.Solid.prototype as unknown as { blobSTEP(this: unknown): Blob }).blobSTEP.call(empty)).toThrow(/^WRITE STEP FILE FAILED\.$/);
    let err: unknown;
    try {
      writeStepFile(empty);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(StepWriteError);
    const e = err as StepWriteError;
    expect(e.stage).toMatch(/^(transfer|write)$/);
    expect(e.status).toMatch(/^IFSelect_Ret(Void|Error|Fail|Stop)$/);
    expect(e.shape).toMatchObject({ solids: 0, shells: 0, faces: 0 });
    expect(e.message).toMatch(/^zapisovač STEP: krok „(přenos tvaru do STEP|zápis textu STEP)“ skončil stavem IFSelect_Ret\w+ · tvar: tělesa 0, skořepiny 0, plochy 0 · tvar je/);
    await expect(exportShape(empty, "step", "Prázdný")).rejects.toThrow(/zapisovač STEP: krok/);
  });
});
