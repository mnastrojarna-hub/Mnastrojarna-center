/**
 * Opravy chování @node-projects/acad-ts 3.7.0 za běhu (knihovnu v node_modules neměníme).
 *
 * 1. DwgObjectWriter._writeBlockHeader: seznam vlastněných handle sestavuje přes `Array.includes` a entity hledá přes
 *    `Array.find` v cyklu → O(n²): 40 000 entit modelového prostoru = 9 s, 100 000 = 92 s. Náhrada je stejná logika
 *    s množinami / mapami (O(n)) – zapisuje bajt po bajtu totéž (ověřeno testem shody výstupu v io.test.ts).
 * 2. DwgStreamWriterBase.writeBitDoubleWithDefault / DwgStreamReaderBase.readBitDoubleWithDefault (každá souřadnice
 *    vrcholu křivky): při každém volání 2–4 nová pole + DataView → většina času v GC. Náhrada se sdíleným bufferem,
 *    stejné bajty (platforma little-endian; jinak se oprava nepoužije).
 * 3. Zápis DXF (DxfSectionWriterBase) – soubory, které přísné čtečky (ezdxf, AutoCAD) odmítaly nebo četly špatně:
 *    - VIEWPORT: počátek a osy USS (110/111/112) se zapisovaly jako jedna hodnota bez složek 120/130 … (v binárním
 *      DXF NaN) → celý DXF s výřezem rozvržení byl pro ezdxf neplatný; chyběl 69 (ID výřezu).
 *    - ATTRIB / ATTDEF: druhá podtřída „100 AcDbText“ před AcDbAttribute(Definition) – AutoCAD ji u atributů nemá,
 *      cizí čtečky pak četly prázdnou značku (tag) a audit atributy mazal.
 *    - Color.approxIndex (záložní ACI 62 u pravé barvy hladiny): chybná vzdálenost (součet rozdílů se znaménkem) →
 *      #336699 = 2 (žlutá); náhrada nejbližší barvou ACI (eukleidovsky, jako nearestAci jádra).
 * 4. Čtení DXF R12 (DxfBlockSectionReader._readBlock): definice bloku se hledala podle názvu ve VŠECH tabulkách –
 *    blok se stejným názvem jako hladina se „našel“ jako hladina, zahodil se on i bloky za ním a jejich vložení.
 *    Oprava hledá jen záznam bloku (BLOCK_RECORD).
 * 5. Čtení hladin DXF (DxfTablesSectionReader._readLayer): barva 62 se čte bez znaménka (−6 → 65530), takže vypnutá
 *    hladina (záporná barva) byla zapnutá s barvou 7 – ve všech verzích, ASCII i binárně. Oprava čte se znaménkem.
 */
import {
  ACadVersion,
  AttributeBase,
  Block,
  BlockRecord,
  BlockTypeFlags,
  Color,
  DwgObjectWriter,
  DwgReferenceType,
  DwgStreamReaderBase,
  DwgStreamWriterBase,
  DxfBlockSectionReader,
  DxfCode,
  DxfSectionWriterBase,
  DxfSubclassMarker,
  DxfTablesSectionReader,
  ViewportStatusFlags,
  XYZ,
  XYZ_Zero,
} from "@node-projects/acad-ts";
import { nearestAci } from "../colors";

type AnyRec = Record<string, unknown> & { handle: number };

let applied = false;

const LE = new Uint8Array(new Float64Array([1]).buffer)[7] === 0x3f;
const F2 = new Float64Array(2);
const B2 = new Uint8Array(F2.buffer);
const DEF8 = new Uint8Array(F2.buffer, 0, 8);
const F1 = new Float64Array(1);
const B1 = new Uint8Array(F1.buffer);

export function applyAcadPatches(): void {
  if (applied) return;
  applied = true;
  patchDxfWriter();
  patchR12BlockReader();
  patchBlockBasePoint();
  patchLayerColorReader();
  if (LE) {
    const wp = (DwgStreamWriterBase as unknown as { prototype: Record<string, unknown> }).prototype;
    if (typeof wp.writeBitDoubleWithDefault === "function")
      wp.writeBitDoubleWithDefault = function writeBitDoubleWithDefaultFast(this: Record<string, any>, def: number, value: number) {
        if (def === value) {
          this.write2Bits(0);
          return;
        }
        // stejná logika jako originál: bajty prvního argumentu, porovnání s druhým od nejvyššího bajtu
        F2[0] = def;
        F2[1] = value;
        let first = 0;
        let last = 7;
        while (last >= 0 && B2[last] === B2[8 + last]) {
          first++;
          last--;
        }
        if (first >= 4) {
          this.write2Bits(1);
          this.writeBytesOffset(B2, 0, 4);
        } else if (first >= 2) {
          this.write2Bits(2);
          const b4 = B2[4], b5 = B2[5], b0 = B2[0], b1 = B2[1], b2 = B2[2], b3 = B2[3];
          this.writeByte(b4);
          this.writeByte(b5);
          this.writeByte(b0);
          this.writeByte(b1);
          this.writeByte(b2);
          this.writeByte(b3);
        } else {
          this.write2Bits(3);
          this.writeBytes(DEF8.slice());
        }
      };
    const rp = (DwgStreamReaderBase as unknown as { prototype: Record<string, unknown> }).prototype;
    if (typeof rp.readBitDoubleWithDefault === "function")
      rp.readBitDoubleWithDefault = function readBitDoubleWithDefaultFast(this: Record<string, any>, def: number) {
        const code = this.read2Bits();
        if (code === 0) return def;
        if (code === 3) return this.readDouble();
        if (code !== 1 && code !== 2) throw this.throwException("ReadBitDoubleWithDefault");
        F1[0] = def;
        const order = code === 1 ? [0, 1, 2, 3] : [4, 5, 0, 1, 2, 3];
        if (this.bitShift === 0)
          for (const i of order) {
            this.advanceByte();
            B1[i] = this._lastByte;
          }
        else {
          const shift = 8 - this.bitShift;
          for (const i of order) {
            let b = (this._lastByte << this.bitShift) & 255;
            this.advanceByte();
            b = (b | (this._lastByte >>> shift)) & 255;
            B1[i] = b;
          }
        }
        return F1[0];
      };
  }
  const proto = (DwgObjectWriter as unknown as { prototype: Record<string, unknown> }).prototype;
  if (typeof proto._writeBlockHeader !== "function") return; // jiná verze knihovny – bez opravy
  proto._writeBlockHeader = function writeBlockHeaderLinear(this: Record<string, any>, record: Record<string, any>) {
    const entities: AnyRec[] = this._getCompatibleEntities(record.entities);
    const ownedEntityHandles = entities.map((entity) => entity.handle);
    const ownedObjectHandles: number[] = record.layout == null && record.ownedObjectHandles.length > 0 ? [...record.ownedObjectHandles] : [...ownedEntityHandles];
    const ownedSet = new Set(ownedObjectHandles);
    for (const handle of ownedEntityHandles) {
      if (!ownedSet.has(handle)) {
        ownedSet.add(handle);
        ownedObjectHandles.push(handle);
      }
    }
    const flags = record.combinedFlags;
    const inserts: AnyRec[] = this.insertsByBlockName.get(record.name) ?? [];
    const insertHandles = inserts.map((insert) => insert.handle);
    const insertSet = new Set(insertHandles);
    if (String(record.name).toUpperCase().startsWith("*T")) {
      for (const handle of record.insertHandles as number[]) {
        if (!insertSet.has(handle)) {
          insertSet.add(handle);
          insertHandles.push(handle);
        }
      }
    }
    for (const insert of inserts) {
      if (!insertSet.has(insert.handle)) {
        insertSet.add(insert.handle);
        insertHandles.push(insert.handle);
      }
    }
    const insertsByHandle = new Map(inserts.map((insert) => [insert.handle, insert]));
    const entityByHandle = new Map<number, AnyRec>();
    for (const e of entities) if (!entityByHandle.has(e.handle)) entityByHandle.set(e.handle, e);
    const w = this._writer;
    this._writeCommonNonEntityData(record);
    if ((flags & BlockTypeFlags.Anonymous) !== 0) w.writeVariableText(String(record.name).substring(0, 2));
    else if (record.layout != null) w.writeVariableText(String(record.name).replace(/[0-9]/g, ""));
    else w.writeVariableText(record.name);
    this._writeXrefDependantBit({ flags });
    w.writeBit((flags & BlockTypeFlags.Anonymous) !== 0);
    w.writeBit(record.hasAttributes);
    w.writeBit((flags & BlockTypeFlags.XRef) !== 0);
    w.writeBit((flags & BlockTypeFlags.XRefOverlay) !== 0);
    if (this.r2000Plus) w.writeBit(record.isUnloaded);
    if (this.r2004Plus && (flags & BlockTypeFlags.XRef) === 0 && (flags & BlockTypeFlags.XRefOverlay) === 0) w.writeBitLong(ownedObjectHandles.length);
    w.write3BitDouble(record.blockEntity.basePoint);
    w.writeVariableText(record.blockEntity.xRefPath);
    if (this.r2000Plus) {
      for (let i = 0; i < insertHandles.length; i++) w.writeByte(1);
      w.writeByte(0);
      w.writeVariableText(record.blockEntity.comments);
      w.writeBitLong(0);
    }
    if (this.r2007Plus) {
      w.writeBitShort(record.units);
      w.writeBit(record.isExplodable);
      w.writeByte(record.canScale ? 1 : 0);
    }
    w.handleReferenceTyped(DwgReferenceType.HardPointer, 0);
    w.handleReferenceTyped(DwgReferenceType.HardOwnership, record.blockEntity);
    if (this._version >= ACadVersion.AC1012 && this._version <= ACadVersion.AC1015 && (flags & BlockTypeFlags.XRef) === 0 && (flags & BlockTypeFlags.XRefOverlay) === 0) {
      if (entities.length > 0) {
        w.handleReferenceTyped(DwgReferenceType.SoftPointer, entities[0]);
        w.handleReferenceTyped(DwgReferenceType.SoftPointer, entities[entities.length - 1]);
      } else {
        w.handleReferenceTyped(DwgReferenceType.SoftPointer, 0);
        w.handleReferenceTyped(DwgReferenceType.SoftPointer, 0);
      }
    }
    if (this.r2004Plus) {
      for (const handle of ownedObjectHandles) {
        const entity = entityByHandle.get(handle);
        if (entity) w.handleReferenceTyped(DwgReferenceType.HardOwnership, entity);
        else w.handleReferenceTypedHandle(DwgReferenceType.HardOwnership, handle);
      }
    }
    w.handleReferenceTyped(DwgReferenceType.HardOwnership, record.blockEnd);
    if (this.r2000Plus) {
      for (const handle of insertHandles) {
        const insert = insertsByHandle.get(handle);
        if (insert) w.handleReferenceTyped(DwgReferenceType.SoftPointer, insert);
        else w.handleReferenceTypedHandle(DwgReferenceType.SoftPointer, handle);
      }
      w.handleReferenceTyped(DwgReferenceType.HardPointer, record.layout);
    }
    this._registerObject(record);
  };
}

type Rec = Record<string, any>;

/** oprava 3: zápis DXF (VIEWPORT, ATTRIB / ATTDEF, záložní ACI pravé barvy) */
function patchDxfWriter(): void {
  const C = Color as unknown as { approxIndex?: (r: number, g: number, b: number) => number };
  if (typeof C.approxIndex === "function") C.approxIndex = (r, g, b) => nearestAci([r, g, b]);
  const sw = (DxfSectionWriterBase as unknown as { prototype: Record<string, unknown> }).prototype;
  if (typeof sw._writeTextEntity === "function")
    sw._writeTextEntity = function writeTextEntity(this: Rec, text: Rec, map: Rec) {
      const subclass = map.subClasses.get(DxfSubclassMarker.text);
      const w = this._writer;
      w.write(DxfCode.Subclass, DxfSubclassMarker.text);
      w.write(39, text.thickness, subclass);
      w.writeVector(10, text.insertPoint, subclass);
      w.write(40, text.height, subclass);
      w.write(1, text.value ?? "", subclass);
      w.write(50, text.rotation, subclass);
      w.write(41, text.widthFactor, subclass);
      w.write(51, text.obliqueAngle, subclass);
      w.write(7, text.style?.name ?? "", subclass);
      w.write(71, text.mirror, subclass);
      w.write(72, text.horizontalAlignment, subclass);
      w.writeVector(11, text.alignmentPoint, subclass);
      w.writeVector(210, text.normal, subclass);
      // jen TEXT má druhou podtřídu AcDbText (se svislým zarovnáním 73); ATTRIB / ATTDEF pokračují AcDbAttribute…
      if (!(text instanceof AttributeBase)) {
        w.write(DxfCode.Subclass, DxfSubclassMarker.text);
        w.write(73, text.verticalAlignment, subclass);
      }
    };
  if (typeof sw._writeViewport === "function")
    sw._writeViewport = function writeViewport(this: Rec, viewport: Rec, map: Rec) {
      const subclass = map.subClasses.get(DxfSubclassMarker.viewport);
      const w = this._writer;
      const id = Number(viewport.id) || 1;
      w.write(DxfCode.Subclass, DxfSubclassMarker.viewport);
      w.writeVector(10, viewport.center, subclass);
      w.write(40, viewport.width, subclass);
      w.write(41, viewport.height, subclass);
      // 68 = stav (0 vypnutý, kladné = pořadí), 69 = ID výřezu
      w.write(68, (viewport.status & ViewportStatusFlags.ViewportOff) !== 0 ? 0 : id, subclass);
      w.write(69, id, subclass);
      w.writeVector(12, viewport.viewCenter, subclass);
      w.writeVector(13, viewport.snapBase, subclass);
      w.writeVector(14, viewport.snapSpacing, subclass);
      w.writeVector(15, viewport.gridSpacing, subclass);
      w.writeVector(16, viewport.viewDirection, subclass);
      w.writeVector(17, viewport.viewTarget, subclass);
      w.write(42, viewport.lensLength, subclass);
      w.write(43, viewport.frontClipPlane, subclass);
      w.write(44, viewport.backClipPlane, subclass);
      w.write(45, viewport.viewHeight, subclass);
      w.write(50, viewport.twistAngle, subclass);
      w.write(51, viewport.circleZoomPercent, subclass);
      w.write(72, viewport.displayUcsIcon, subclass);
      w.write(90, viewport.status, subclass);
      // body a vektory USS po složkách (110/120/130 …), ne jedna hodnota
      w.writeVector(110, viewport.ucsOrigin, subclass);
      w.writeVector(111, viewport.ucsXAxis, subclass);
      w.writeVector(112, viewport.ucsYAxis, subclass);
      w.write(281, viewport.renderMode, subclass);
      for (const layer of viewport.frozenLayers) w.writeHandle(331, layer);
    };
}

/** oprava 4: blok DXF R12 se stejným názvem jako hladina / styl / typ čáry */
function patchR12BlockReader(): void {
  const rp = (DxfBlockSectionReader as unknown as { prototype: Record<string, unknown> }).prototype;
  const orig = rp._readBlock as ((this: Rec) => unknown) | undefined;
  if (typeof orig !== "function") return;
  rp._readBlock = function readBlockTyped(this: Rec) {
    const b = this._builder as Rec;
    const own = Object.prototype.hasOwnProperty.call(b, "tryGetTableEntry");
    const prev = b.tryGetTableEntry as (name: string, type?: unknown) => unknown;
    // během čtení hlavičky bloku se podle názvu hledá jen záznam bloku
    b.tryGetTableEntry = function (this: Rec, name: string, type?: unknown) {
      return prev.call(this, name, type ?? BlockRecord);
    };
    try {
      return orig.call(this);
    } finally {
      if (own) b.tryGetTableEntry = prev;
      else delete b.tryGetTableEntry;
    }
  };
}

/**
 * oprava 6: bod vložení bloku v DXF. acad-ts 3.7.0 má `Block.basePoint = XYZ_Zero` – všechny bloky sdílí JEDEN objekt
 * a čtečka DXF do něj zapisuje skupiny 10/20/30, takže každý blok dostal bod vložení posledního bloku (a sdílená nula
 * se změnila). Před prvním zápisem dostane blok vlastní bod; sdílená nula se vrátí na 0,0,0.
 */
function patchBlockBasePoint(): void {
  const rp = (DxfBlockSectionReader as unknown as { prototype: Record<string, unknown> }).prototype;
  const base = rp.tryAssignCurrentValue as ((this: Rec, o: unknown, map: unknown) => boolean) | undefined;
  if (typeof base !== "function") return;
  const zero = XYZ_Zero as unknown as { x: number; y: number; z: number };
  rp.tryAssignCurrentValue = function tryAssignOwnBasePoint(this: Rec, o: unknown, map: unknown) {
    if (o instanceof Block && (o as unknown as { basePoint: unknown }).basePoint === XYZ_Zero) {
      (o as unknown as { basePoint: XYZ }).basePoint = new XYZ(0, 0, 0);
      zero.x = zero.y = zero.z = 0;
    }
    return base.call(this, o, map);
  };
}

/** oprava 5: záporná barva hladiny (vypnutá hladina) */
function patchLayerColorReader(): void {
  const tp = (DxfTablesSectionReader as unknown as { prototype: Record<string, unknown> }).prototype;
  const orig = tp._readLayer as ((this: Rec, template: Rec, map: Rec) => boolean) | undefined;
  if (typeof orig !== "function") return;
  tp._readLayer = function readLayerSigned(this: Rec, template: Rec, map: Rec) {
    if (this._reader.code !== 62) return orig.call(this, template, map);
    let index = Number(this._reader.value);
    if (!Number.isFinite(index)) index = Number(this._reader.valueAsShort);
    if (index > 32767) index -= 65536; // 16bitové číslo bez znaménka → se znaménkem
    const layer = template.cadObject;
    if (index < 0) {
      layer.isOn = false;
      index = -index;
    }
    if (index >= 1 && index <= 255) layer.color = new Color(index);
    return true;
  };
}
