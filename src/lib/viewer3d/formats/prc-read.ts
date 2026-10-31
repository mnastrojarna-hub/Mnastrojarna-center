/**
 * Čtení komprimovaných sekcí PRC: globals (barvy, materiály, styly, souřadné systémy),
 * strom (definice dílů, výskyty produktů, reprezentační položky) a tessellace.
 *
 * Rozvržení entit podle ISO 14739-1 (PRC) s opravami známých odchylek specifikace
 * (tak jak je zapisují Adobe/HOOPS, Asymptote a další). Přesná geometrie (B-rep) se
 * nečte — prohlížeč potřebuje jen tessellaci.
 */

import { BitReader, PrcFormatError } from "./prc-bits";
import { decodeCompressedTess } from "./prc-compressed-tess";
import {
  mat4Identity,
  type Graphics,
  type Mat4,
  type MeshTess,
  type PrcGlobals,
  type PrcMaterial,
  type PrcOccurrence,
  type PrcPart,
  type PrcRI,
  type PrcStyle,
  type PrcTree,
  type Tess,
  type Uuid,
  type WireTess,
} from "./prc-model";
import { executeSchema, type PrcSchema } from "./prc-schema";

// ---------------------------------------------------------------------------
// Typy entit (číslování podle Adobe PRC Reference / ISO 14739-1)
// ---------------------------------------------------------------------------

export const T = {
  ROOT_PRCBaseWithGraphics: 2,
  SURF_Plane: 86,
  TOPO_Face: 149,
  TESS_3D: 172,
  TESS_3D_Compressed: 173,
  TESS_Face: 174,
  TESS_3D_Wire: 175,
  TESS_Markup: 176,
  MISC_Attribute: 201,
  MISC_CartesianTransformation: 202,
  MISC_EntityReference: 203,
  MISC_MarkupLinkedItem: 204,
  MISC_ReferenceOnPRCBase: 205,
  MISC_ReferenceOnTopology: 206,
  MISC_GeneralTransformation: 207,
  RI_RepresentationItem: 231,
  RI_BrepModel: 232,
  RI_Curve: 233,
  RI_Direction: 234,
  RI_Plane: 235,
  RI_PointSet: 236,
  RI_PolyBrepModel: 237,
  RI_PolyWire: 238,
  RI_Set: 239,
  RI_CoordinateSystem: 240,
  ASM_ModelFile: 301,
  ASM_FileStructure: 302,
  ASM_FileStructureGlobals: 303,
  ASM_FileStructureTree: 304,
  ASM_FileStructureTessellation: 305,
  ASM_FileStructureGeometry: 306,
  ASM_FileStructureExtraGeometry: 307,
  ASM_ProductOccurrence: 310,
  ASM_PartDefinition: 311,
  ASM_Filter: 320,
  MKP_View: 501,
  MKP_Markup: 502,
  MKP_Leader: 503,
  MKP_AnnotationItem: 504,
  MKP_AnnotationSet: 505,
  MKP_AnnotationReference: 506,
  GRAPH_Style: 701,
  GRAPH_Material: 702,
  GRAPH_Picture: 703,
  GRAPH_TextureApplication: 711,
  GRAPH_TextureDefinition: 712,
  GRAPH_TextureTransformation: 713,
  GRAPH_LinePattern: 721,
  GRAPH_DottingPattern: 723,
  GRAPH_HatchingPattern: 724,
  GRAPH_SolidPattern: 725,
  GRAPH_VPicturePattern: 726,
  GRAPH_AmbientLight: 731,
  GRAPH_PointLight: 732,
  GRAPH_DirectionalLight: 733,
  GRAPH_SpotLight: 734,
  GRAPH_SceneDisplayParameters: 741,
  GRAPH_Camera: 742,
} as const;

const TR_TRANSLATE = 0x01;
const TR_ROTATE = 0x02;
const TR_MIRROR = 0x04;
const TR_SCALE = 0x08;
const TR_NONUNIFORM = 0x10;
const TR_NONORTHO = 0x20;
const TR_HOMOGENEOUS = 0x40;

const MAX_COUNT = 50_000_000;

// ---------------------------------------------------------------------------
// Kontext čtení jedné sekce (aktuální jméno a grafika se resetují s každou sekcí)
// ---------------------------------------------------------------------------

export class SectionReader {
  readonly r: BitReader;
  /** Verze formátu, kterou zapsal autor (podmiňuje některá pole). */
  readonly version: number;
  readonly schema: PrcSchema | null;
  private curName = "";
  private curStyle = -1;
  private curBehaviour = 1;

  constructor(data: Uint8Array, version: number, schema: PrcSchema | null) {
    this.r = new BitReader(data);
    this.version = version;
    this.schema = schema;
  }

  fail(what: string): never {
    throw new PrcFormatError(what);
  }

  count(limit = MAX_COUNT): number {
    const n = this.r.readUInt();
    if (n > limit || n > this.r.remaining) this.fail("neplatný počet položek");
    return n;
  }

  expect(type: number): void {
    const t = this.r.readUInt();
    if (t !== type) this.fail(`neočekávaný typ entity ${t} (čekán ${type})`);
  }

  /** Rozšíření entity popsané schématem (novější verze formátu) — přeskočí se. */
  ext(type: number): void {
    if (this.schema && this.schema.has(type)) executeSchema(this, this.schema, type);
  }

  // ---- základní datové typy -------------------------------------------------

  vec3(): [number, number, number] {
    const r = this.r;
    return [r.readDouble(), r.readDouble(), r.readDouble()];
  }

  skipDoubles(n: number): void {
    for (let i = 0; i < n; i++) this.r.readDouble();
  }

  skipUInts(n: number): void {
    for (let i = 0; i < n; i++) this.r.readUInt();
  }

  uuid(): Uuid {
    const r = this.r;
    return [r.readUInt(), r.readUInt(), r.readUInt(), r.readUInt()];
  }

  // ---- ContentPRCBase ------------------------------------------------------

  attributes(): void {
    const r = this.r;
    const n = this.count(1_000_000);
    for (let i = 0; i < n; i++) {
      this.expect(T.MISC_Attribute);
      this.attributeTitle();
      const keys = this.count(1_000_000);
      for (let k = 0; k < keys; k++) {
        this.attributeTitle();
        const type = r.readUInt();
        switch (type) {
          case 0:
            break;
          case 1:
            r.readInt();
            break;
          case 2:
            r.readDouble();
            break;
          case 3:
            r.readUInt();
            break;
          case 4:
            r.readString();
            break;
          case 5:
            r.readUInt();
            r.readUInt();
            break;
          default:
            this.fail("neznámý typ atributu");
        }
      }
    }
  }

  private attributeTitle(): void {
    if (this.r.readBool()) this.r.readUInt();
    else this.r.readString();
  }

  name(): string {
    if (!this.r.readBool()) this.curName = this.r.readString();
    return this.curName;
  }

  /** ContentPRCBase; `ref` = entita je odkazovatelná (následují 3 identifikátory). */
  base(ref: boolean): string {
    this.attributes();
    const nm = this.name();
    if (ref) {
      this.r.readUInt();
      this.r.readUInt();
      this.r.readUInt();
    }
    return nm;
  }

  graphics(): Graphics {
    const r = this.r;
    if (!r.readBool()) {
      r.readUInt(); // vrstva + 1
      this.curStyle = r.readUInt() - 1;
      const lo = r.readChar();
      const hi = r.readChar();
      this.curBehaviour = lo | (hi << 8);
    }
    return { style: this.curStyle, behaviour: this.curBehaviour };
  }

  /** PRCBaseWithGraphics (vždy odkazovatelné). */
  baseWithGraphics(): { name: string; graphics: Graphics } {
    const name = this.base(true);
    const graphics = this.graphics();
    this.ext(T.ROOT_PRCBaseWithGraphics);
    return { name, graphics };
  }

  // ---- transformace --------------------------------------------------------

  /** Obsah CartesianTransformation (za typem): chování + vektory → matice. */
  cartesian3d(): Mat4 {
    const r = this.r;
    const beh = r.readChar();
    let origin: number[] = [0, 0, 0];
    let x = [1, 0, 0];
    let y = [0, 1, 0];
    let z: number[] | null = null;
    let scale: number[] | null = null;
    let homog: number[] | null = null;
    if (beh & TR_TRANSLATE) origin = this.vec3();
    if (beh & TR_NONORTHO) {
      x = this.vec3();
      y = this.vec3();
      z = this.vec3();
    } else if (beh & TR_ROTATE) {
      x = this.vec3();
      y = this.vec3();
    }
    if (beh & TR_NONUNIFORM) scale = this.vec3();
    else if (beh & TR_SCALE) {
      const s = r.readDouble();
      scale = [s, s, s];
    }
    if (beh & TR_HOMOGENEOUS) homog = [r.readDouble(), r.readDouble(), r.readDouble(), r.readDouble()];
    if (!z) {
      const a = beh & TR_MIRROR ? y : x;
      const b = beh & TR_MIRROR ? x : y;
      z = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    }
    const m = mat4Identity();
    const cols = [x, y, z];
    for (let c = 0; c < 3; c++) {
      const s = scale ? scale[c] : 1;
      m[c * 4] = cols[c][0] * s;
      m[c * 4 + 1] = cols[c][1] * s;
      m[c * 4 + 2] = cols[c][2] * s;
    }
    m[12] = origin[0];
    m[13] = origin[1];
    m[14] = origin[2];
    if (homog) {
      m[3] = homog[0];
      m[7] = homog[1];
      m[11] = homog[2];
      m[15] = homog[3] || 1;
    }
    return m;
  }

  /** Transformace s typem (Cartesian nebo General). */
  transformation(): Mat4 {
    const type = this.r.readUInt();
    if (type === T.MISC_CartesianTransformation) return this.cartesian3d();
    if (type === T.MISC_GeneralTransformation) {
      const m = new Float64Array(16);
      for (let i = 0; i < 16; i++) m[i] = this.r.readDouble();
      return m;
    }
    return this.fail(`neznámý typ transformace ${type}`);
  }

  /** 2D kartézská transformace (u textur). */
  private cartesian2d(): void {
    const r = this.r;
    const beh = r.readChar();
    if (beh & TR_TRANSLATE) this.skipDoubles(2);
    if (beh & TR_ROTATE) this.skipDoubles(4);
    if (beh & TR_SCALE) this.skipDoubles(1);
    if (beh & TR_NONUNIFORM) this.skipDoubles(2);
    if (beh & TR_NONORTHO) this.skipDoubles(4);
    if (beh & TR_HOMOGENEOUS) this.skipDoubles(3);
  }

  // ---- RepresentationItem --------------------------------------------------

  private riContent(type: number): PrcRI {
    const { name, graphics } = this.baseWithGraphics();
    const localCs = this.r.readUInt() - 1;
    const tess = this.r.readUInt() - 1;
    return { type, name, graphics, localCs, tess, children: null, csMatrix: null };
  }

  representationItem(depth = 0): PrcRI {
    if (depth > 64) this.fail("příliš hluboké vnoření položek");
    const r = this.r;
    const type = r.readUInt();
    switch (type) {
      case T.RI_BrepModel: {
        const ri = this.riContent(type);
        if (r.readBool()) {
          r.readUInt();
          r.readUInt();
        }
        r.readBool();
        this.ext(type);
        r.skipUserData();
        return ri;
      }
      case T.RI_Curve:
      case T.RI_Plane: {
        const ri = this.riContent(type);
        if (r.readBool()) {
          r.readUInt();
          r.readUInt();
        }
        this.ext(type);
        r.skipUserData();
        return ri;
      }
      case T.RI_Direction: {
        const ri = this.riContent(type);
        // zapisovače před vlastními daty ukládají i část „křivky" (drátové těleso)
        if (r.readBool()) {
          r.readUInt();
          r.readUInt();
        }
        r.skipUserData();
        if (r.readBool()) this.vec3();
        this.vec3();
        this.ext(type);
        r.skipUserData();
        return ri;
      }
      case T.RI_PointSet: {
        const ri = this.riContent(type);
        const n = this.count();
        this.skipDoubles(n * 3);
        this.ext(type);
        r.skipUserData();
        return ri;
      }
      case T.RI_PolyBrepModel: {
        const ri = this.riContent(type);
        r.readBool();
        this.ext(type);
        r.skipUserData();
        return ri;
      }
      case T.RI_PolyWire: {
        const ri = this.riContent(type);
        this.ext(type);
        r.skipUserData();
        return ri;
      }
      case T.RI_Set: {
        const ri = this.riContent(type);
        const n = this.count(10_000_000);
        const children: PrcRI[] = [];
        for (let i = 0; i < n; i++) children.push(this.representationItem(depth + 1));
        ri.children = children;
        this.ext(type);
        r.skipUserData();
        return ri;
      }
      case T.RI_CoordinateSystem: {
        const ri = this.riContent(type);
        ri.csMatrix = this.transformation();
        this.ext(type);
        r.skipUserData();
        return ri;
      }
      case T.RI_RepresentationItem: {
        this.riContent(type);
        return this.representationItem(depth + 1);
      }
      default:
        return this.fail(`neznámý typ reprezentační položky ${type}`);
    }
  }

  // ---- odkazy a markupy (čtou se jen kvůli posunu v proudu) ---------------

  private referenceUniqueId(): void {
    this.expect(T.MISC_ReferenceOnPRCBase);
    this.referenceOnPrcBaseBody();
    this.ext(T.MISC_ReferenceOnPRCBase);
  }

  private referenceOnPrcBaseBody(): void {
    const r = this.r;
    r.readUInt(); // typ cíle
    if (!r.readBool()) this.uuid();
    r.readUInt();
  }

  private referenceData(): void {
    const r = this.r;
    const type = r.readUInt();
    if (type === T.MISC_ReferenceOnTopology) {
      r.readUInt(); // typ topologie
      if (r.readBool()) {
        if (!r.readBool()) this.uuid();
        r.readUInt();
        r.readUInt();
        const n = this.count();
        this.skipUInts(n);
      }
    } else if (type === T.MISC_ReferenceOnPRCBase) {
      this.referenceOnPrcBaseBody();
    } else {
      this.fail(`neznámý typ odkazu ${type}`);
    }
  }

  private contentEntityReference(): void {
    this.baseWithGraphics();
    this.r.readUInt(); // lokální souřadný systém + 1
    if (this.r.readBool()) this.referenceData();
  }

  entityReference(): void {
    this.expect(T.MISC_EntityReference);
    this.contentEntityReference();
    this.ext(T.MISC_EntityReference);
    this.r.skipUserData();
  }

  private markupLinkedItem(): void {
    this.expect(T.MISC_MarkupLinkedItem);
    this.contentEntityReference();
    if (this.r.readBool()) this.referenceData();
    this.r.skip(4);
    this.ext(T.MISC_MarkupLinkedItem);
    this.r.skipUserData();
  }

  private leader(): void {
    this.expect(T.MKP_Leader);
    this.baseWithGraphics();
    if (this.r.readBool()) this.referenceUniqueId();
    if (this.r.readBool()) this.referenceUniqueId();
    this.r.readUInt();
    this.ext(T.MKP_Leader);
    this.r.skipUserData();
  }

  private markup(): void {
    this.expect(T.MKP_Markup);
    this.baseWithGraphics();
    this.r.readUInt(); // typ
    this.r.readUInt(); // podtyp
    let n = this.count();
    for (let i = 0; i < n; i++) this.referenceUniqueId();
    n = this.count();
    for (let i = 0; i < n; i++) this.referenceUniqueId();
    this.r.readUInt(); // tessellace + 1
    this.ext(T.MKP_Markup);
    this.r.skipUserData();
  }

  private annotationEntity(depth: number): void {
    if (depth > 64) this.fail("příliš hluboké vnoření anotací");
    const type = this.r.readUInt();
    if (type === T.MKP_AnnotationItem) {
      this.baseWithGraphics();
      this.referenceUniqueId();
    } else if (type === T.MKP_AnnotationSet) {
      this.baseWithGraphics();
      const n = this.count();
      for (let i = 0; i < n; i++) this.annotationEntity(depth + 1);
    } else if (type === T.MKP_AnnotationReference) {
      this.baseWithGraphics();
      const n = this.count();
      for (let i = 0; i < n; i++) this.referenceUniqueId();
    } else {
      this.fail(`neznámý typ anotace ${type}`);
    }
    this.ext(type);
    this.r.skipUserData();
  }

  markupData(): void {
    let n = this.count();
    for (let i = 0; i < n; i++) this.markupLinkedItem();
    n = this.count();
    for (let i = 0; i < n; i++) this.leader();
    n = this.count();
    for (let i = 0; i < n; i++) this.markup();
    n = this.count();
    for (let i = 0; i < n; i++) this.annotationEntity(0);
  }

  private surfPlane(): void {
    const r = this.r;
    this.expect(T.SURF_Plane);
    // ContentSurface
    if (r.readBool()) {
      this.attributes();
      this.name();
      r.readUInt();
    }
    r.readUInt(); // extend info
    this.cartesian3d();
    this.skipDoubles(4 + 4); // doména + parametrizace
  }

  private camera(): void {
    this.expect(T.GRAPH_Camera);
    this.base(true);
    this.r.readBool();
    this.skipDoubles(9 + 6);
    this.ext(T.GRAPH_Camera);
  }

  private light(): void {
    const r = this.r;
    const type = r.readUInt();
    this.base(true);
    this.skipUInts(4);
    switch (type) {
      case T.GRAPH_AmbientLight:
        break;
      case T.GRAPH_PointLight:
        this.skipDoubles(3 + 3);
        break;
      case T.GRAPH_DirectionalLight:
        this.skipDoubles(3);
        if (this.version >= 8030) r.readDouble();
        break;
      case T.GRAPH_SpotLight:
        this.skipDoubles(3 + 3 + 3 + 2);
        break;
      default:
        this.fail(`neznámý typ světla ${type}`);
    }
    this.ext(type);
  }

  private sceneDisplayParameters(): void {
    const r = this.r;
    this.expect(T.GRAPH_SceneDisplayParameters);
    this.base(true);
    r.readBool();
    let n = this.count();
    for (let i = 0; i < n; i++) this.light();
    if (r.readBool()) this.camera();
    if (r.readBool()) this.vec3();
    n = this.count();
    for (let i = 0; i < n; i++) this.surfPlane();
    r.readUInt();
    r.readUInt();
    n = this.count();
    this.skipUInts(n * 2);
    r.readBool();
    this.ext(T.GRAPH_SceneDisplayParameters);
  }

  private filter(): void {
    const r = this.r;
    this.expect(T.ASM_Filter);
    this.base(true);
    r.readBool(); // aktivní
    r.readBool();
    let n = this.count();
    this.skipUInts(n);
    r.readBool();
    n = this.count();
    for (let i = 0; i < n; i++) this.entityReference();
    this.ext(T.ASM_Filter);
    r.skipUserData();
  }

  view(): void {
    const r = this.r;
    this.expect(T.MKP_View);
    this.baseWithGraphics();
    let n = this.count();
    for (let i = 0; i < n; i++) this.referenceUniqueId();
    this.surfPlane();
    if (this.version >= 7046 && r.readBool()) this.sceneDisplayParameters();
    if (this.version >= 7309) r.readBool();
    if (this.version >= 8016) {
      r.readBool();
      r.readBool();
      n = this.count();
      for (let i = 0; i < n; i++) this.referenceUniqueId();
      n = this.count();
      for (let i = 0; i < n; i++) this.filter();
    }
    this.ext(T.MKP_View);
    r.skipUserData();
  }

  // ---- strom -----------------------------------------------------------------

  partDefinition(): PrcPart {
    this.expect(T.ASM_PartDefinition);
    const { name, graphics } = this.baseWithGraphics();
    this.skipDoubles(6); // obálka
    const n = this.count(10_000_000);
    const items: PrcRI[] = [];
    for (let i = 0; i < n; i++) items.push(this.representationItem());
    this.markupData();
    const views = this.count();
    for (let i = 0; i < views; i++) this.view();
    this.ext(T.ASM_PartDefinition);
    this.r.skipUserData();
    return { name, graphics, items };
  }

  productOccurrence(): PrcOccurrence {
    const r = this.r;
    this.expect(T.ASM_ProductOccurrence);
    const { name, graphics } = this.baseWithGraphics();
    const part = r.readUInt() - 1;
    const prototype = r.readUInt() - 1;
    let prototypeFs: Uuid | null = null;
    if (prototype >= 0 && !r.readBool()) prototypeFs = this.uuid();
    const external = r.readUInt() - 1;
    let externalFs: Uuid | null = null;
    if (external >= 0 && !r.readBool()) externalFs = this.uuid();
    const nSons = this.count(10_000_000);
    const sons: number[] = [];
    for (let i = 0; i < nSons; i++) sons.push(r.readUInt());
    r.readChar(); // chování produktu
    const unitFromCad = r.readBool();
    const unit = r.readDouble();
    r.readChar(); // příznaky produktu
    r.readInt(); // stav načtení
    const location = r.readBool() ? this.transformation() : null;
    const nRefs = this.count();
    for (let i = 0; i < nRefs; i++) this.entityReference();
    this.markupData();
    let n = this.count();
    for (let i = 0; i < n; i++) this.view();
    if (r.readBool()) this.filter();
    n = this.count();
    for (let i = 0; i < n; i++) this.filter();
    n = this.count();
    for (let i = 0; i < n; i++) this.sceneDisplayParameters();
    this.ext(T.ASM_ProductOccurrence);
    r.skipUserData();
    return {
      name,
      graphics,
      part,
      prototype,
      prototypeFs,
      external,
      externalFs,
      sons,
      location,
      unit,
      unitFromCad,
      referenceCount: nRefs,
    };
  }

  // ---- globals ---------------------------------------------------------------

  private picture(): void {
    this.expect(T.GRAPH_Picture);
    this.base(false);
    this.skipUInts(4);
    this.ext(T.GRAPH_Picture);
  }

  private textureDefinition(): void {
    const r = this.r;
    this.expect(T.GRAPH_TextureDefinition);
    this.base(true);
    r.readUInt(); // obrázek + 1
    const dim = r.readChar();
    const mapping = r.readInt();
    if (mapping === 3) {
      r.readInt();
      if (r.readBool()) {
        const kind = r.readUInt();
        if (kind === TR_TRANSLATE || kind === TR_NONUNIFORM) this.skipDoubles(3);
        else if (kind === TR_ROTATE || kind === TR_MIRROR) this.skipDoubles(6);
        else if (kind === TR_SCALE) this.skipDoubles(1);
        else if (kind !== 0) this.fail("neznámá transformace textury");
      }
    }
    r.readUInt(); // atributy mapování
    let n = this.count();
    this.skipDoubles(n);
    n = this.count();
    this.r.skip(n * 8);
    const fn = r.readInt();
    if (fn === 3) this.skipDoubles(4);
    if (r.readInt() !== 0) r.readInt();
    if (r.readInt() !== 0) r.readInt();
    const applying = r.readChar();
    if (applying & 0x02) {
      r.readInt();
      r.readDouble();
    }
    r.readInt();
    if (dim > 1) r.readInt();
    if (dim > 2) r.readInt();
    if (r.readBool()) {
      this.expect(T.GRAPH_TextureTransformation);
      r.readBool();
      r.readBool();
      r.readBool();
      this.cartesian2d();
      this.ext(T.GRAPH_TextureTransformation);
    }
    this.ext(T.GRAPH_TextureDefinition);
  }

  private material(): PrcMaterial {
    const r = this.r;
    const type = r.readUInt();
    this.base(true);
    if (type === T.GRAPH_Material) {
      const ambient = r.readUInt() - 1;
      const diffuse = r.readUInt() - 1;
      const emissive = r.readUInt() - 1;
      const specular = r.readUInt() - 1;
      r.readDouble(); // lesk
      r.readDouble();
      const diffuseAlpha = r.readDouble();
      r.readDouble();
      r.readDouble();
      this.ext(type);
      return { kind: 0, ambient, diffuse, emissive, specular, diffuseAlpha, generic: -1 };
    }
    if (type === T.GRAPH_TextureApplication) {
      const generic = r.readUInt() - 1;
      this.skipUInts(3);
      this.ext(type);
      return { kind: 1, ambient: -1, diffuse: -1, emissive: -1, specular: -1, diffuseAlpha: 1, generic };
    }
    return this.fail(`neznámý typ materiálu ${type}`);
  }

  private linePattern(): void {
    this.expect(T.GRAPH_LinePattern);
    this.base(true);
    const n = this.count();
    this.skipDoubles(n + 1);
    this.r.readBool();
    this.ext(T.GRAPH_LinePattern);
  }

  private style(): PrcStyle {
    const r = this.r;
    this.expect(T.GRAPH_Style);
    this.base(true);
    r.readDouble(); // šířka čáry
    r.readBool();
    r.readUInt();
    const isMaterial = r.readBool();
    const index = r.readUInt() - 1;
    let transparency = -1;
    if (r.readBool()) transparency = r.readChar();
    for (let i = 0; i < 3; i++) if (r.readBool()) r.readChar();
    this.ext(T.GRAPH_Style);
    return { isMaterial, index, transparency };
  }

  private fillPattern(): void {
    const r = this.r;
    const type = r.readUInt();
    this.base(true);
    r.readUInt(); // další vzor + 1
    switch (type) {
      case T.GRAPH_DottingPattern:
        r.readDouble();
        r.readBool();
        r.readInt();
        break;
      case T.GRAPH_HatchingPattern: {
        const n = this.count();
        for (let i = 0; i < n; i++) {
          this.skipDoubles(5);
          r.readUInt();
        }
        break;
      }
      case T.GRAPH_SolidPattern:
        r.readBool();
        r.readInt();
        break;
      case T.GRAPH_VPicturePattern:
        this.skipDoubles(2);
        this.expect(T.TESS_Markup);
        this.skipMarkupTess();
        break;
      default:
        this.fail(`neznámý vzor výplně ${type}`);
    }
    this.ext(type);
  }

  private coordinateSystem(): Mat4 {
    this.expect(T.RI_CoordinateSystem);
    this.riContent(T.RI_CoordinateSystem);
    const m = this.transformation();
    this.ext(T.RI_CoordinateSystem);
    this.r.skipUserData();
    return m;
  }

  /**
   * Globals: barvy, materiály, styly a souřadné systémy. Čte se postupně — co se přečíst
   * podaří, zůstane v `out` (zbytek zůstane prázdný).
   */
  globals(out: PrcGlobals): void {
    const r = this.r;
    this.expect(T.ASM_FileStructureGlobals);
    this.base(false);
    const nRef = this.count();
    for (let i = 0; i < nRef; i++) this.uuid();
    r.readDouble();
    r.readDouble();
    // MarkupSerializationHelper
    r.readString();
    let n = this.count();
    for (let i = 0; i < n; i++) {
      r.readString();
      r.readUInt();
      const keys = this.count();
      for (let k = 0; k < keys; k++) {
        r.readUInt();
        r.readChar();
      }
    }
    n = this.count();
    const colors: number[] = [];
    for (let i = 0; i < n; i++) colors.push(r.readDouble(), r.readDouble(), r.readDouble());
    out.colors = colors;
    n = this.count();
    for (let i = 0; i < n; i++) this.picture();
    n = this.count();
    for (let i = 0; i < n; i++) this.textureDefinition();
    n = this.count();
    for (let i = 0; i < n; i++) out.materials.push(this.material());
    n = this.count();
    for (let i = 0; i < n; i++) this.linePattern();
    n = this.count();
    for (let i = 0; i < n; i++) out.styles.push(this.style());
    n = this.count();
    for (let i = 0; i < n; i++) this.fillPattern();
    n = this.count();
    for (let i = 0; i < n; i++) out.coordSystems.push(this.coordinateSystem());
    // rozšíření ze schématu + uživatelská data už nepotřebujeme
  }

  /** Sekce stromu. Při chybě vrátí to, co se stihlo přečíst (`partial`). */
  tree(): PrcTree {
    const out: PrcTree = { parts: [], occurrences: [], root: -1, partial: true };
    this.expect(T.ASM_FileStructureTree);
    this.base(false);
    const nParts = this.count(10_000_000);
    for (let i = 0; i < nParts; i++) out.parts.push(this.partDefinition());
    const nPo = this.count(10_000_000);
    for (let i = 0; i < nPo; i++) out.occurrences.push(this.productOccurrence());
    // FileStructure (interní data)
    this.expect(T.ASM_FileStructure);
    this.base(false);
    this.r.readUInt(); // další volný index
    out.root = this.r.readUInt() - 1;
    out.partial = false;
    return out;
  }

  /** Jen čtení stromu s tolerancí chyb (vrací i rozpracovaný výsledek). */
  treeTolerant(): { tree: PrcTree; error: string | null } {
    const out: PrcTree = { parts: [], occurrences: [], root: -1, partial: true };
    try {
      this.expect(T.ASM_FileStructureTree);
      this.base(false);
      const nParts = this.count(10_000_000);
      for (let i = 0; i < nParts; i++) out.parts.push(this.partDefinition());
      const nPo = this.count(10_000_000);
      for (let i = 0; i < nPo; i++) out.occurrences.push(this.productOccurrence());
      this.expect(T.ASM_FileStructure);
      this.base(false);
      this.r.readUInt();
      out.root = this.r.readUInt() - 1;
      out.partial = false;
      return { tree: out, error: null };
    } catch (e) {
      if (!(e instanceof PrcFormatError)) throw e;
      return { tree: out, error: e.message };
    }
  }

  // ---- tessellace -----------------------------------------------------------

  private baseTessCoords(): Float64Array {
    const r = this.r;
    r.readBool(); // is_calculated
    const n = this.count();
    const coords = new Float64Array(n);
    for (let i = 0; i < n; i++) coords[i] = r.readDouble();
    return coords;
  }

  private vertexColors(nPoints: number, nSegments: number, isFace: boolean): void {
    const r = this.r;
    const rgba = r.readBool();
    const segment = isFace ? false : r.readBool();
    if (r.readBool()) this.fail("nepodporované optimalizované barvy vrcholů");
    const n = segment ? nSegments : nPoints;
    if (n <= 0) return;
    const bytes = rgba ? 4 : 3;
    r.skip(bytes * 8);
    for (let i = 1; i < n; i++) if (!r.readBool()) r.skip(bytes * 8);
  }

  /** Tělo TESS_Markup (za typem) — jen se přeskočí. */
  skipMarkupTess(): void {
    const r = this.r;
    r.readBool();
    const nc = this.count();
    this.skipDoubles(nc);
    const ncodes = this.count();
    this.skipUInts(ncodes);
    const nt = this.count();
    for (let i = 0; i < nt; i++) r.readString();
    r.readString();
    r.readChar();
  }

  /** Tělo TESS_3D_Wire (za typem). */
  wireTess(): WireTess {
    const r = this.r;
    const pos = this.baseTessCoords();
    const nPts = Math.floor(pos.length / 3);
    const nIdx = this.count();
    const seg: number[] = [];
    let points = 0;
    let wires = 0;
    if (nIdx === 0) {
      for (let i = 0; i + 1 < nPts; i++) seg.push(i, i + 1);
      points = nPts;
      wires = 1;
    } else {
      let count = 0;
      let prevLast = -1;
      while (count < nIdx) {
        const size = r.readUInt();
        const n = size & 0x0fffffff;
        const closing = (size & 0x10000000) !== 0;
        const continuous = (size & 0x20000000) !== 0;
        if (count + 1 + n > nIdx) this.fail("neplatná drátová tessellace");
        let first = -1;
        let last = -1;
        for (let i = 0; i < n; i++) {
          const v = Math.floor(r.readUInt() / 3);
          if (v >= nPts) continue;
          if (first < 0) {
            first = v;
            if (continuous && prevLast >= 0) seg.push(prevLast, v);
          } else seg.push(last, v);
          last = v;
        }
        if (closing && first >= 0 && last !== first) seg.push(last, first);
        if (last >= 0) prevLast = last;
        points += n + (closing ? 1 : 0);
        wires++;
        count += 1 + n;
      }
    }
    if (r.readBool()) this.vertexColors(points, Math.max(0, points - wires), false);
    return { kind: "wire", pos, seg: Uint32Array.from(seg) };
  }

  /** Tělo TESS_3D (za typem). */
  tess3d(): MeshTess {
    const r = this.r;
    const coords = this.baseTessCoords();
    r.readBool(); // has_faces
    r.readBool(); // has_loops
    const mustRecalc = r.readBool();
    let crease = 25;
    if (mustRecalc) {
      r.readChar();
      crease = r.readDouble();
    }
    const nNormals = this.count();
    const normals = new Float64Array(nNormals);
    for (let i = 0; i < nNormals; i++) normals[i] = r.readDouble();
    const nWire = this.count();
    this.skipUInts(nWire);
    const nTri = this.count();
    const triIdx = new Uint32Array(nTri);
    for (let i = 0; i < nTri; i++) triIdx[i] = r.readUInt();
    const nFaces = this.count();
    const faces: TessFace[] = [];
    for (let i = 0; i < nFaces; i++) faces.push(this.tessFace());
    const nTex = this.count();
    this.skipDoubles(nTex);
    return expandTess3d(coords, normals, triIdx, faces, !mustRecalc && nNormals > 0, mustRecalc, crease);
  }

  private tessFace(): TessFace {
    const r = this.r;
    this.expect(T.TESS_Face);
    const nAttr = this.count();
    let style = -1;
    for (let i = 0; i < nAttr; i++) {
      const s = r.readUInt() - 1;
      if (i === 0) style = s;
    }
    r.readUInt(); // začátek drátu
    const nWire = this.count();
    this.skipUInts(nWire);
    const used = r.readUInt();
    const start = r.readUInt();
    const nSizes = this.count();
    const sizes = new Uint32Array(nSizes);
    for (let i = 0; i < nSizes; i++) sizes[i] = r.readUInt();
    const texIdx = r.readUInt();
    if (r.readBool()) {
      const n = faceVertexCount(used, sizes);
      if (n < 0) this.fail("nepodporované barvy vrcholů plochy");
      this.vertexColors(n, n, true);
    }
    if (nAttr > 0) r.readUInt(); // chování
    this.ext(T.TESS_Face);
    return { used, start, sizes, texIdx, style };
  }

  /**
   * Celá sekce tessellací. Každá položka se čte zvlášť; jakmile jedna selže, další už
   * nelze najít (proud nemá délky položek) — vrátí se, co se přečetlo, a chyba.
   */
  tessellations(onUnsupported: (msg: string) => void): {
    tess: (Tess | null)[];
    declared: number;
    error: string | null;
  } {
    const r = this.r;
    const out: (Tess | null)[] = [];
    this.expect(T.ASM_FileStructureTessellation);
    this.base(false);
    const n = this.count(50_000_000);
    // anotace (TESS_Markup) se nepočítají — „deklarované" jsou jen tessellace geometrie
    let markups = 0;
    try {
      for (let i = 0; i < n; i++) {
        const type = r.readUInt();
        switch (type) {
          case T.TESS_3D:
            out.push(this.tess3d());
            break;
          case T.TESS_3D_Wire:
            out.push(this.wireTess());
            break;
          case T.TESS_Markup:
            this.skipMarkupTess();
            out.push(null);
            markups++;
            break;
          case T.TESS_3D_Compressed: {
            const res = decodeCompressedTess(this.r);
            if (res.warning) onUnsupported(res.warning);
            out.push(res.mesh);
            break;
          }
          default:
            throw new PrcFormatError(`neznámý typ tessellace ${type}`);
        }
        this.ext(type);
      }
    } catch (e) {
      if (!(e instanceof PrcFormatError)) throw e;
      return { tess: out, declared: n - markups, error: e.message };
    }
    return { tess: out, declared: n - markups, error: null };
  }
}

// ---------------------------------------------------------------------------
// Rozbalení TESS_3D na trojúhelníky
// ---------------------------------------------------------------------------

interface TessFace {
  used: number;
  start: number;
  sizes: Uint32Array;
  texIdx: number;
  style: number;
}

const F_TRIANGLE = 0x0002;
const F_FAN = 0x0004;
const F_STRIP = 0x0008;
const F_TRIANGLE_1N = 0x0020;
const F_FAN_1N = 0x0040;
const F_STRIP_1N = 0x0080;
const F_TEXTURED_SHIFT = 8; // 0x0200 = Triangle | textured …
const F_POLYFACE_ANY = 0x0001 | 0x0010 | 0x0100 | 0x1000;
const NORMAL_SINGLE = 0x40000000;
const NORMAL_MASK = 0x3fffffff;

/** Typy trojúhelníkových entit v pořadí, ve kterém leží v datech plochy. */
const ENTITY_ORDER: { flag: number; kind: 0 | 1 | 2; one: boolean; tex: boolean }[] = [
  { flag: F_TRIANGLE, kind: 0, one: false, tex: false },
  { flag: F_FAN, kind: 1, one: false, tex: false },
  { flag: F_STRIP, kind: 2, one: false, tex: false },
  { flag: F_TRIANGLE_1N, kind: 0, one: true, tex: false },
  { flag: F_FAN_1N, kind: 1, one: true, tex: false },
  { flag: F_STRIP_1N, kind: 2, one: true, tex: false },
  { flag: F_TRIANGLE << F_TEXTURED_SHIFT, kind: 0, one: false, tex: true },
  { flag: F_FAN << F_TEXTURED_SHIFT, kind: 1, one: false, tex: true },
  { flag: F_STRIP << F_TEXTURED_SHIFT, kind: 2, one: false, tex: true },
  { flag: F_TRIANGLE_1N << F_TEXTURED_SHIFT, kind: 0, one: true, tex: true },
  { flag: F_FAN_1N << F_TEXTURED_SHIFT, kind: 1, one: true, tex: true },
  { flag: F_STRIP_1N << F_TEXTURED_SHIFT, kind: 2, one: true, tex: true },
];

/** Počet vrcholů (odkazů na body) v trojúhelníkových datech plochy; −1 = neznámý typ. */
function faceVertexCount(used: number, sizes: Uint32Array): number {
  if (used & F_POLYFACE_ANY) return -1;
  let p = 0;
  let total = 0;
  for (const e of ENTITY_ORDER) {
    if (!(used & e.flag)) continue;
    if (p >= sizes.length) return -1;
    if (e.kind === 0) total += sizes[p++] * 3;
    else {
      const g = sizes[p++];
      if (p + g > sizes.length) return -1;
      for (let i = 0; i < g; i++) total += sizes[p++] & NORMAL_MASK;
    }
  }
  return total;
}

class GrowU32 {
  a: Uint32Array;
  n = 0;
  constructor(cap: number) {
    this.a = new Uint32Array(Math.max(16, cap));
  }
  push3(x: number, y: number, z: number): void {
    if (this.n + 3 > this.a.length) {
      const b = new Uint32Array(this.a.length * 2 + 3);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  result(): Uint32Array {
    return this.a.slice(0, this.n);
  }
}

class GrowF32 {
  a: Float32Array;
  n = 0;
  constructor(cap: number) {
    this.a = new Float32Array(Math.max(16, cap));
  }
  push3(x: number, y: number, z: number): void {
    if (this.n + 3 > this.a.length) {
      const b = new Float32Array(this.a.length * 2 + 3);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  result(): Float32Array {
    return this.a.slice(0, this.n);
  }
}

function expandTess3d(
  coords: Float64Array,
  normals: Float64Array,
  idx: Uint32Array,
  faces: TessFace[],
  hasNormals: boolean,
  mustRecalc: boolean,
  creaseDeg: number,
): MeshTess {
  const nPts = Math.floor(coords.length / 3);
  const nNrm = Math.floor(normals.length / 3);
  const tri = new GrowU32(Math.floor(idx.length / 2));
  const nrm = hasNormals ? new GrowF32(Math.floor(idx.length * 1.5)) : null;
  const faceStart = new Uint32Array(faces.length + 1);
  const faceStyle = new Int32Array(faces.length);
  const N = hasNormals ? 1 : 0;
  // pracovní buffery pro jednu skupinu (vějíř / pás)
  let gp = new Int32Array(64);
  let gn = new Int32Array(64);
  let running = 0;

  for (let fi = 0; fi < faces.length; fi++) {
    const f = faces[fi];
    faceStart[fi] = tri.n / 3;
    faceStyle[fi] = f.style;
    let p = running;
    if (!mustRecalc && f.start < idx.length) p = f.start;
    const sizes = f.sizes;
    let s = 0;
    let ok = (f.used & F_POLYFACE_ANY) === 0;
    for (let ei = 0; ok && ei < ENTITY_ORDER.length; ei++) {
      const e = ENTITY_ORDER[ei];
      if (!(f.used & e.flag)) continue;
      if (s >= sizes.length) {
        ok = false;
        break;
      }
      const T_ = e.tex ? f.texIdx : 0;
      const corner = N + T_ + 1; // indexů na roh u „vícenormálových" typů
      if (e.kind === 0) {
        const count = sizes[s++];
        const per = e.one ? N + 3 * (T_ + 1) : 3 * corner;
        if (p + count * per > idx.length) {
          ok = false;
          break;
        }
        for (let t = 0; t < count; t++) {
          let v0: number, v1: number, v2: number;
          let n0 = -1,
            n1 = -1,
            n2 = -1;
          if (e.one) {
            if (N) n0 = n1 = n2 = Math.floor(idx[p] / 3);
            v0 = Math.floor(idx[p + N + T_] / 3);
            v1 = Math.floor(idx[p + N + T_ + (T_ + 1)] / 3);
            v2 = Math.floor(idx[p + N + T_ + 2 * (T_ + 1)] / 3);
          } else {
            if (N) {
              n0 = Math.floor(idx[p] / 3);
              n1 = Math.floor(idx[p + corner] / 3);
              n2 = Math.floor(idx[p + 2 * corner] / 3);
            }
            v0 = Math.floor(idx[p + N + T_] / 3);
            v1 = Math.floor(idx[p + corner + N + T_] / 3);
            v2 = Math.floor(idx[p + 2 * corner + N + T_] / 3);
          }
          p += per;
          if (v0 >= nPts || v1 >= nPts || v2 >= nPts) continue;
          tri.push3(v0, v1, v2);
          if (nrm) pushNormals(nrm, normals, nNrm, n0, n1, n2);
        }
      } else {
        const groups = sizes[s++];
        if (s + groups > sizes.length) {
          ok = false;
          break;
        }
        for (let g = 0; g < groups; g++) {
          const raw = sizes[s++];
          const n = raw & NORMAL_MASK;
          const single = e.one && (raw & NORMAL_SINGLE) !== 0;
          const need = single ? N + n * (T_ + 1) : n * corner;
          if (p + need > idx.length || n > 1e8) {
            ok = false;
            break;
          }
          if (n > gp.length) {
            gp = new Int32Array(n * 2);
            gn = new Int32Array(n * 2);
          }
          if (single) {
            const nn = N ? Math.floor(idx[p] / 3) : -1;
            for (let k = 0; k < n; k++) {
              gp[k] = Math.floor(idx[p + N + k * (T_ + 1) + T_] / 3);
              gn[k] = nn;
            }
          } else {
            for (let k = 0; k < n; k++) {
              gn[k] = N ? Math.floor(idx[p + k * corner] / 3) : -1;
              gp[k] = Math.floor(idx[p + k * corner + N + T_] / 3);
            }
          }
          p += need;
          if (e.kind === 1) {
            for (let k = 1; k + 1 < n; k++) {
              const a = gp[0],
                b = gp[k],
                c = gp[k + 1];
              if (a >= nPts || b >= nPts || c >= nPts) continue;
              tri.push3(a, b, c);
              if (nrm) pushNormals(nrm, normals, nNrm, gn[0], gn[k], gn[k + 1]);
            }
          } else {
            for (let k = 0; k + 2 < n; k++) {
              let a = k,
                b = k + 1;
              const c = k + 2;
              if (k & 1) {
                a = k + 1;
                b = k;
              }
              if (gp[a] >= nPts || gp[b] >= nPts || gp[c] >= nPts) continue;
              tri.push3(gp[a], gp[b], gp[c]);
              if (nrm) pushNormals(nrm, normals, nNrm, gn[a], gn[b], gn[c]);
            }
          }
        }
      }
    }
    running = p;
  }
  faceStart[faces.length] = tri.n / 3;
  return {
    kind: "mesh",
    pos: coords,
    tri: tri.result(),
    cornerNormals: nrm ? nrm.result() : null,
    faceStart,
    faceStyle,
    creaseAngle: creaseToRadians(creaseDeg),
  };
}

function pushNormals(out: GrowF32, normals: Float64Array, nNrm: number, a: number, b: number, c: number): void {
  pushNormal(out, normals, nNrm, a);
  pushNormal(out, normals, nNrm, b);
  pushNormal(out, normals, nNrm, c);
}

function pushNormal(out: GrowF32, normals: Float64Array, nNrm: number, n: number): void {
  if (n >= 0 && n < nNrm) out.push3(normals[n * 3], normals[n * 3 + 1], normals[n * 3 + 2]);
  else out.push3(0, 0, 0);
}

export function creaseToRadians(deg: number): number {
  if (!Number.isFinite(deg) || deg <= 0) return (25 * Math.PI) / 180;
  if (deg > 180) return Math.PI;
  return (deg * Math.PI) / 180;
}
