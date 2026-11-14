/**
 * Pole všech typů prvků – JEDNA tabulka pro nápovědu `prvek nápověda <typ>` (EN `feature help`, DE `element hilfe`)
 * a pro přehled mezer textových příkazů (co jde zadat jen přes `prvek <typ> klíč=hodnota`, `upravit` nebo JSON).
 *
 * Tabulka je svázaná s `types.ts`: typ `FieldTable` vyžaduje pro každý typ prvku právě všechna jeho pole (chybějící i navíc
 * = chyba překladu TypeScriptu); test feature-fields.test.ts navíc čte zdrojový text `types.ts` a hlídá i volitelnost polí.
 * Společná pole (`id`, `name`, `type`, `suppressed`, `body`) jsou popsaná zvlášť. Čisté funkce bez jádra.
 */
import { tr } from "./i18n";
import type { Feature, FeatureType } from "./types";

type KeysOfUnion<T> = T extends unknown ? keyof T : never;
/** pole společná všem prvkům */
export const COMMON_FIELDS = ["id", "name", "type", "suppressed", "body"] as const;
type Common = (typeof COMMON_FIELDS)[number];
export type FieldsOf<T extends FeatureType> = Exclude<KeysOfUnion<Extract<Feature, { type: T }>>, Common>;

/** druh hodnoty pole – určuje zápis v `prvek … klíč=hodnota` */
export type FieldKind = "number" | "integer" | "boolean" | "enum" | "text" | "vec3" | "vec2" | "ref" | "faceRef" | "refs" | "direction" | "axisDef" | "planeDef" | "extent" | "from" | "thin" | "sketchPlane" | "sketch" | "sketches" | "feature" | "features" | "faces" | "edges" | "indices" | "map" | "sigs" | "json" | "body";
/**
 * Popis pole: druh, jednotka, povolené hodnoty, nepovinné (`opt` = v types.ts `?:`), význam, zápis vlastním textovým příkazem
 * (`text`; chybí = jen `prvek` / `upravit` / JSON) a u sjednocených typů (pole) druh, ke kterému pole patří (`only`).
 */
export type FieldSpec = { k: FieldKind; unit?: "mm" | "°"; values?: readonly string[]; opt?: true; desc: string; text?: string; only?: string };
type TypeSpec<T extends FeatureType> = { cmd?: string; ex?: string; fields: { [K in FieldsOf<T>]: FieldSpec } };
export type FieldTable = { [T in FeatureType]: TypeSpec<T> };

// ---------------- společné popisy ----------------
const MODE = (): FieldSpec => ({ k: "enum", values: ["new", "add", "cut", "intersect"], desc: tr("booleovská operace: nové těleso / přidat / odebrat / průnik"), text: tr("přidat|odebrat|průnik|nové") });
const MODE_NO_TEXT = (): FieldSpec => ({ k: "enum", values: ["new", "add", "cut", "intersect"], desc: tr("booleovská operace: nové těleso / přidat / odebrat / průnik") });
const POS = (desc: string): FieldSpec => ({ k: "vec3", unit: "mm", desc, text: tr("v x y z") });
const POSREF = (): FieldSpec => ({ k: "ref", opt: true, desc: tr("poloha odkazem (vrchol, střed hrany, střed kružnice, střed plochy, pomocný bod…) – má přednost před position"), text: tr("na V3 | na střed hrany E2 | na střed kružnice E5 | na střed plochy F3 | na bod \"Bod 1\" | na mezi V1 V5") });
const AXIS = (): FieldSpec => ({ k: "enum", values: ["X", "Y", "Z"], desc: tr("osa (globální X / Y / Z)"), text: tr("osa X|Y|Z") });
const DIRDEF = (): FieldSpec => ({ k: "direction", opt: true, desc: tr("osa libovolným směrem – má přednost před axis"), text: tr("osa -Z | osa 1 0 1 | osa hrana E3 | osa plocha F2 | osa \"Osa 1\" | osa body V1 V5") });
const SIGS = (): FieldSpec => ({ k: "sigs", opt: true, desc: tr("otisky výběru – doplní program (ručně vynechat)") });
const FACES = (desc = tr("plochy")): FieldSpec => ({ k: "faces", desc });
const SK = (desc = tr("skica (název, id nebo $last)")): FieldSpec => ({ k: "sketch", desc });
const THIN = (): FieldSpec => ({ k: "thin", opt: true, desc: tr("tenká stěna {side: one|two|mid|in, t1, t2}") });
const PLANE3 = (desc: string, text?: string): FieldSpec => ({ k: "enum", values: ["XY", "XZ", "YZ"], desc, ...(text ? { text } : {}) });
const N = (desc: string, unit?: "mm" | "°", text?: string, opt?: boolean): FieldSpec => ({ k: "number", desc, ...(unit ? { unit } : {}), ...(text ? { text } : {}), ...(opt ? { opt: true as const } : {}) });
const B = (desc: string, text?: string, opt?: boolean): FieldSpec => ({ k: "boolean", desc, ...(text ? { text } : {}), ...(opt ? { opt: true as const } : {}) });
const O = <S extends FieldSpec>(s: S): S => ({ ...s, opt: true });

/** Tabulka polí (vytvoří se až při použití – texty v jazyce rozhraní). */
export function featureFields(): FieldTable {
  const lin = tr("pole kind=linear");
  const circ = tr("pole kind=circular");
  const curve = tr("pole kind=curve");
  const fill = tr("pole kind=fill");
  return {
    sketch: {
      cmd: tr("skica XY|XZ|YZ [odsazení N]: … · skica počátek x y z normála nx ny nz: … · skica plocha F3: … · skica rovina \"Rovina 1\": …"),
      fields: {
        plane: { k: "sketchPlane", desc: tr("rovina skici (základní + odsazení, nebo obecná)"), text: tr("skica XY|XZ|YZ [odsazení N] · skica počátek … normála …") },
        entities: { k: "json", desc: tr("entity skici (obdélník, kružnice, čára, oblouk, spline…)"), text: tr("entity za dvojtečkou: obdélník W H; kružnice D; čára …") },
        constraints: { k: "json", opt: true, desc: tr("geometrické vazby skici"), text: tr("vazba <druh> e1 e2") },
        dims: { k: "json", opt: true, desc: tr("kóty skici"), text: tr("kóta <druh> e1 <hodnota>") },
        planeDef: { k: "planeDef", opt: true, desc: tr("asociativní definice roviny (plocha, pomocná rovina, 3 body…)"), text: tr("skica plocha F3 | skica rovina \"Rovina 1\"") },
      },
    },
    extrude: {
      cmd: tr("vysunout H|výška H [směr …] [sklon a [k +X]] [symetricky] [skrz|k tělesu|k dalšímu|k ploše F3|k rovině \"Rovina 1\"|k vrcholu V3] [odebrat|přidat|průnik|nové] [obráceně] [úkos a [dovnitř|ven] [břit N] [ostré rohy|zaoblené rohy]]"),
      ex: "prvek extrude sketchId=$last distance=20 mode=cut draftAngle=-2 draftLand=3 draftCorners=sharp",
      fields: {
        sketchId: { ...SK(), text: tr("(poslední skica)") },
        distance: N(tr("délka vysunutí"), "mm", tr("vysunout H")),
        symmetric: B(tr("symetricky na obě strany od skici"), tr("symetricky")),
        reverse: B(tr("opačný směr"), tr("obráceně")),
        mode: MODE(),
        draftAngle: N(tr("úkos stěn: + = dovnitř (vnější obrys se od skici zužuje, otvory profilu rozšiřují), − = ven"), "°", tr("úkos a [dovnitř|ven]"), true),
        draftLand: N(tr("břit – rovná část kolmo od roviny skici před začátkem úkosu"), "mm", tr("břit N"), true),
        draftCorners: { k: "enum", opt: true, values: ["sharp", "round"], desc: tr("rohy úkosu: ostré (rovinné stěny) / zaoblené (vzdalující se rohy se zaoblí)"), text: tr("ostré rohy | zaoblené rohy") },
        normalHeight: B(tr("délka se měří kolmo na rovinu skici (výška), ne podél šikmého směru"), tr("výška H"), true),
        extent: { k: "extent", opt: true, desc: tr("ukončení: na vzdálenost, skrz vše, k dalšímu, k vrcholu, k ploše, odsazeně, k tělesu, střední rovina"), text: tr("skrz | k tělesu | k dalšímu | k ploše F3 [odsazení N] | k rovině \"Rovina 1\" | k vrcholu V3") },
        extent2: { k: "extent", opt: true, desc: tr("ukončení druhého směru") },
        from: { k: "from", opt: true, desc: tr("začátek: rovina skici, odsazení, od plochy, od vrcholu") },
        dir: { k: "direction", opt: true, desc: tr("směr vysunutí (výchozí normála skici); sklon = {\"kind\":\"angle\",\"deg\":25,\"toward\":[1,0,0]}"), text: tr("směr x y z | směr +X | směr hrana E3 | směr osa \"Osa 1\" | směr plocha F2 | směr body V1 V2 | sklon a [k +X]") },
        thin: THIN(),
        twist: N(tr("zkroucení po délce"), "°", undefined, true),
        endScale: N(tr("měřítko konce (1 = beze změny)"), undefined, undefined, true),
        outerOnly: B(tr("jen vnější obrys (otvory profilu ignorovat)"), undefined, true),
      },
    },
    revolve: {
      cmd: tr("rotovat [úhel] [osa X|Y|Z | osa hrana E3 | osa plocha F7 | osa \"Osa 1\" | osa body V1 V5] [symetricky] [odebrat|přidat|průnik|nové]"),
      fields: {
        sketchId: { ...SK(), text: tr("(poslední skica)") },
        angle: N(tr("úhel rotace (360 = celá otáčka)"), "°", tr("rotovat úhel")),
        axis: { k: "enum", values: ["x", "y"], desc: tr("osa skici (x = vodorovná, y = svislá)"), text: tr("osa x|y") },
        mode: MODE(),
        axisDef: { k: "axisDef", opt: true, desc: tr("osa modelem (hrana, válcová plocha, 2 body, globální, pomocná osa…)"), text: tr("osa X|Y|Z | osa hrana E3 | osa plocha F7 | osa \"Osa 1\" | osa body V1 V5") },
        angle2: N(tr("úhel druhým směrem"), "°", undefined, true),
        symmetric: B(tr("symetricky (střední rovina)"), tr("symetricky"), true),
        thin: THIN(),
      },
    },
    box: {
      cmd: tr("kvádr X Y Z [střed] [v x y z | na …] [osa …] [odebrat|průnik|nové]"),
      ex: 'prvek box size=20;20;20 centered=ano position=50;50;50 dirDef={"kind":"vector","v":[0,1,1]}',
      fields: {
        size: { k: "vec3", unit: "mm", desc: tr("rozměry X × Y × Z"), text: tr("kvádr X Y Z") },
        position: POS(tr("roh kvádru (se „střed“ jeho střed)")),
        centered: B(tr("poloha je střed kvádru"), tr("střed")),
        mode: MODE(),
        positionRef: POSREF(),
        dirDef: { ...DIRDEF(), desc: tr("osa Z kvádru libovolným směrem (otáčí se kolem polohy)") },
      },
    },
    cylinder: {
      cmd: tr("válec D H [v x y z | na …] [osa …] [odebrat|průnik|nové]"),
      ex: 'prvek cylinder radius=5 height=150 position=-50;0;-40 dirDef={"kind":"vector","v":[1,0,1]} mode=cut',
      fields: {
        radius: N(tr("poloměr (text zadává průměr D)"), "mm", tr("válec D H")),
        height: N(tr("výška po ose"), "mm", tr("válec D H")),
        position: POS(tr("střed podstavy")),
        axis: AXIS(),
        mode: MODE(),
        positionRef: POSREF(),
        dirDef: DIRDEF(),
      },
    },
    sphere: {
      cmd: tr("koule D [v x y z | na …] [odebrat|průnik|nové]"),
      fields: { radius: N(tr("poloměr (text zadává průměr D)"), "mm", tr("koule D")), position: POS(tr("střed koule")), mode: MODE(), positionRef: POSREF() },
    },
    cone: {
      cmd: tr("kužel D1 D2 H [v x y z | na …] [osa …] [odebrat|průnik|nové]"),
      ex: 'prvek cone radius1=10 radius2=0 height=15 position=0;0;40 dirDef={"kind":"vector","v":[0,0.5,-0.866]} mode=cut',
      fields: {
        radius1: N(tr("poloměr podstavy (text zadává průměr D1)"), "mm", tr("kužel D1 D2 H")),
        radius2: N(tr("poloměr ve výšce H (0 = špička)"), "mm", tr("kužel D1 D2 H")),
        height: N(tr("výška po ose"), "mm", tr("kužel D1 D2 H")),
        position: POS(tr("střed podstavy")),
        axis: AXIS(),
        mode: MODE(),
        positionRef: POSREF(),
        dirDef: DIRDEF(),
      },
    },
    tube: {
      cmd: tr("trubka D d H [v x y z | na …] [osa …] [odebrat|průnik|nové]"),
      fields: {
        outer: N(tr("vnější průměr"), "mm", tr("trubka D d H")),
        inner: N(tr("vnitřní průměr (0 = plný válec)"), "mm", tr("trubka D d H")),
        height: N(tr("délka po ose"), "mm", tr("trubka D d H")),
        position: POS(tr("střed podstavy")),
        axis: AXIS(),
        mode: MODE(),
        positionRef: POSREF(),
        dirDef: DIRDEF(),
      },
    },
    hole: {
      cmd: tr("díra D [hloubka H [dno ploché | hrot 118]|skrz [obousměrně]|k tělesu] v x y [z] [osa Z] [směr vx vy vz | sklon úhel] [zahloubení D2 H2] [kuželové D2] [závit M8 [jádro | vrták [N]]]"),
      ex: 'prvek hole diameter=10 depth=12 position=20;30;20 tipAngle=180',
      fields: {
        position: { ...POS(tr("bod začátku díry (text bez z = na povrchu tělesa)")), text: tr("v x y [z]") },
        axis: AXIS(),
        flip: B(tr("vrtat ve směru osy (výchozí proti ose – shora dolů)"), tr("obráceně")),
        diameter: N(tr("průměr (u závitové díry skutečný vrták – viz tapDrill)"), "mm", tr("díra D")),
        depth: N(tr("hloubka (0 = skrz)"), "mm", tr("hloubka H | skrz")),
        bothWays: B(tr("„skrz“ na obě strany od bodu"), tr("obousměrně"), true),
        cbDiameter: N(tr("průměr válcového zahloubení (0 = bez)"), "mm", tr("zahloubení D2 H2")),
        cbDepth: N(tr("hloubka válcového zahloubení"), "mm", tr("zahloubení D2 H2")),
        kind: { k: "enum", opt: true, values: ["simple", "counterbore", "countersink", "tapped"], desc: tr("druh díry"), text: tr("zahloubení | kuželové | závit") },
        csDiameter: N(tr("průměr kuželového zahloubení"), "mm", tr("kuželové D2"), true),
        csAngle: N(tr("vrcholový úhel kuželového zahloubení (90)"), "°", tr("kuželové D2 A"), true),
        thread: { k: "text", opt: true, desc: tr("závit (M8, M18×1,5)"), text: tr("závit M8") },
        tapDrill: { k: "enum", opt: true, values: ["table", "minor", "custom"], desc: tr("vrták závitové díry: table = z tabulky (M8 → 6,8), minor = jádro D1 podle ISO 965-1 (M8 → 6,647), custom = vrtá se diameter"), text: tr("(bez volby) | jádro | vrták N | díra 6,647 závit M8") },
        threadDepth: N(tr("užitečná délka závitu"), "mm", tr("hloubka-závitu T"), true),
        end: { k: "json", opt: true, desc: tr("ukončení: blind, throughAll, toNext, toFace, toVertex, offsetFromFace, toBody"), text: tr("k tělesu") },
        points: { k: "refs", opt: true, desc: tr("více poloh (odkazy na body)"), text: tr("v x1 y1 z1 v x2 y2 z2 (souřadnice)") },
        dirDef: { ...DIRDEF(), desc: tr("osa díry libovolným směrem – má přednost před axis"), text: tr("směr vx vy vz | sklon úhel") },
        tipAngle: N(tr("úhel špičky vrtáku slepé díry 60–170° (výchozí 118), 180 = ploché dno; jiná hodnota: text / prvek / upravit = chyba, starší JSON = varování a oříznutí"), "°", tr("hrot N | dno ploché"), true),
        fit: { k: "enum", opt: true, values: ["fine", "medium", "coarse"], desc: tr("řada průchozích děr ISO 273 (informativní)") },
      },
    },
    fillet: {
      cmd: tr("zaoblit R [hrany <pravidlo>] · zaoblit R hrany … setback S · zaoblit eliptické D1 D2 hrany …"),
      ex: 'prvek fillet radius=2 edges=svislé kind=variable radii={"0":2,"3":5}',
      fields: {
        radius: N(tr("poloměr (u eliptického D1)"), "mm", tr("zaoblit R")),
        edges: { k: "edges", desc: tr("hrany (all = všechny)"), text: tr("hrany <pravidlo> | hrany E3 E7") },
        kind: { k: "enum", opt: true, values: ["constant", "asymmetric", "variable", "faceFace", "fullRound", "setback", "conic"], desc: tr("druh zaoblení"), text: tr("setback | eliptické") },
        setbacks: { k: "json", opt: true, desc: tr("setback pro jednotlivé vrcholy [{at: Ref, d}]"), text: tr("vrchol V3 S2") },
        rho: N(tr("kuželosečka rho (0,5 = parabola)"), undefined, tr("rho 0,5"), true),
        r2: N(tr("druhý poloměr (asymetrické) / D2 (eliptické)"), "mm", tr("eliptické D1 D2"), true),
        radii: { k: "map", opt: true, desc: tr("proměnný poloměr: index hrany → R") },
        radii2: { k: "map", opt: true, desc: tr("druhý poloměr podle hrany") },
        faces: O(FACES(tr("plochy (plocha–plocha, plné zaoblení)"))),
        faces2: O(FACES(tr("druhá sada ploch (plocha–plocha)"))),
        edgeSigs: SIGS(),
        faceSigs: SIGS(),
        faceSigs2: SIGS(),
        faceRefs: { k: "refs", opt: true, desc: tr("plochy odkazem (plocha–plocha, eliptické D1)") },
        faceRefs2: { k: "refs", opt: true, desc: tr("druhé plochy odkazem") },
        faceRefsMid: { k: "refs", opt: true, desc: tr("střední plochy (plné zaoblení)") },
        tangentChain: B(tr("šířit po tečně navazujících hranách"), undefined, true),
        setback: N(tr("setback – vzdálenost konce zaoblení od vrcholu"), "mm", tr("setback S"), true),
      },
    },
    chamfer: {
      cmd: tr("srazit C [hrany <pravidlo>|E3 E7] · srazit D úhel A plocha F3 [hrany …] · srazit D1 D2 plocha F3 [hrany …]"),
      ex: "prvek chamfer distance=1 kind=distanceAngle angle=30 edges=horní",
      fields: {
        distance: N(tr("vzdálenost"), "mm", tr("srazit C")),
        edges: { k: "edges", desc: tr("hrany (all = všechny)"), text: tr("hrany <pravidlo> | hrany E3 E7") },
        kind: { k: "enum", opt: true, values: ["equal", "twoDistances", "distanceAngle", "vertex"], desc: tr("druh: stejné / dvě vzdálenosti / vzdálenost + úhel / vrchol"), text: tr("srazit D úhel A plocha F3 | srazit D1 D2 plocha F3") },
        d2: N(tr("druhá vzdálenost"), "mm", tr("srazit D1 D2 plocha F3"), true),
        d3: N(tr("třetí vzdálenost (vrchol)"), "mm", undefined, true),
        angle: N(tr("úhel (vzdálenost + úhel)"), "°", tr("úhel A"), true),
        faceRef: { k: "faceRef", opt: true, desc: tr("referenční plocha pro druhou vzdálenost / úhel"), text: tr("plocha F3") },
        vertices: { k: "indices", opt: true, desc: tr("vrcholy (druh vertex) – indexy od 0") },
        vertexRefs: { k: "refs", opt: true, desc: tr("vrcholy odkazem") },
        tangentChain: B(tr("šířit po tečně navazujících hranách"), undefined, true),
        edgeSigs: SIGS(),
        vertexSigs: SIGS(),
      },
    },
    shell: {
      cmd: tr("skořepina T [otevřít <pravidlo>|F3 F5]"),
      fields: {
        thickness: N(tr("tloušťka stěny"), "mm", tr("skořepina T")),
        faces: { ...FACES(tr("otevřené (odebrané) plochy")), text: tr("otevřít <pravidlo> | otevřít F3 F5") },
        thicknesses: { k: "map", opt: true, desc: tr("jiná tloušťka pro plochu: index → mm") },
        outward: B(tr("zesílit ven (vnější rozměr roste)"), undefined, true),
        faceSigs: SIGS(),
      },
    },
    pattern: {
      cmd: tr("pole N rozteč P [směr X|x y z|hrana E3|body V1 V5] [N2 rozteč P2 směr …] · pole kruhové N [úhel 360] [osa Z|hrana E3|plocha F7|\"Osa 1\"] [v cx cy cz]"),
      ex: 'prvek pattern kind=linear featureId=$last count=4 spacing=20 dirDef={"kind":"edge","ref":{"kind":"edge","index":3}}',
      fields: {
        featureId: { k: "feature", desc: tr("zdrojový prvek (název, id nebo $last)"), text: tr("(poslední prvek)") },
        kind: { k: "enum", values: ["linear", "circular", "curve", "sketch", "fill"], desc: tr("druh pole"), text: tr("pole … | pole kruhové …") },
        count: { k: "integer", desc: tr("počet instancí"), text: tr("pole N"), only: tr("linear, circular, curve") },
        spacing: N(tr("rozteč"), "mm", tr("rozteč P")),
        direction: { k: "vec3", desc: tr("směr řady"), text: tr("směr X|x y z"), only: lin },
        count2: { k: "integer", opt: true, desc: tr("počet ve druhém směru"), text: tr("N2 rozteč P2"), only: lin },
        spacing2: { ...N(tr("rozteč ve druhém směru"), "mm", tr("N2 rozteč P2"), true), only: lin },
        direction2: { k: "vec3", opt: true, desc: tr("druhý směr (mřížka)"), text: tr("směr Y"), only: lin },
        dirDef: { k: "direction", opt: true, desc: tr("směr odkazem (hrana, osa, 2 body) – má přednost před direction"), text: tr("směr hrana E3 | směr body V1 V5 | směr osa \"Osa 1\""), only: lin },
        dirDef2: { k: "direction", opt: true, desc: tr("druhý směr odkazem"), text: tr("N2 rozteč P2 směr hrana E5"), only: lin },
        skip: { k: "indices", opt: true, desc: tr("přeskočené instance") },
        spacingMode: { k: "enum", opt: true, values: ["step", "total"], desc: tr("rozteč jako krok, nebo celková délka"), only: lin },
        stagger: { ...B(tr("střídavé řady (posun o půl kroku)"), undefined, true), only: lin },
        geometryOnly: B(tr("jen geometrie (rychlejší, bez booleovské operace)"), undefined, true),
        featureIds: { k: "features", opt: true, desc: tr("více zdrojových prvků") },
        angle: { ...N(tr("celkový úhel"), "°", tr("úhel 360")), only: circ },
        axis: { ...AXIS(), only: circ },
        center: { k: "vec3", unit: "mm", desc: tr("bod na ose"), text: tr("v cx cy cz"), only: circ },
        axisDef: { k: "axisDef", opt: true, desc: tr("osa odkazem (hrana, válec, pomocná osa…)"), text: tr("osa hrana E3 | osa plocha F7 | osa \"Osa 1\" | osa body V1 V5"), only: circ },
        symmetric: { ...B(tr("symetricky na obě strany"), undefined, true), only: circ },
        equalSpacing: { ...B(tr("rovnoměrně v celém úhlu"), undefined, true), only: circ },
        radial: { ...B(tr("natáčet instance s rotací"), undefined, true), only: circ },
        sketchId: { k: "sketch", desc: tr("skica křivky / bodů / obrysu"), only: tr("curve, sketch, fill") },
        align: { k: "enum", values: ["tangent", "fixed"], desc: tr("natočení po křivce"), only: curve },
        margin: { k: "number", unit: "mm", desc: tr("okraj výplně"), only: fill },
        layout: { k: "enum", values: ["grid", "stagger", "circular"], desc: tr("rozmístění výplně"), only: fill },
      },
    },
    mirror: {
      cmd: tr("zrcadlit XY|XZ|YZ [odsazení N] · zrcadlit plocha F3 [odsazení N] · zrcadlit rovina \"Rovina 1\" [odsazení N]"),
      ex: 'prvek mirror planeDef={"kind":"face","ref":{"kind":"face","index":2}} featureIds=$last',
      fields: {
        plane: PLANE3(tr("základní rovina zrcadlení"), tr("zrcadlit XY|XZ|YZ")),
        offset: N(tr("odsazení roviny"), "mm", tr("odsazení N")),
        keepOriginal: B(tr("ponechat originál")),
        planeDef: { k: "planeDef", opt: true, desc: tr("rovina definicí (plocha, pomocná rovina, 3 body…) – má přednost"), text: tr("zrcadlit plocha F3 | zrcadlit rovina \"Rovina 1\"") },
        featureIds: { k: "features", opt: true, desc: tr("zrcadlit jen vybrané prvky (jinak celé těleso)") },
      },
    },
    import: {
      fields: {
        fileName: { k: "text", desc: tr("název souboru") },
        format: { k: "enum", values: ["step", "brep", "stl", "iges"], desc: tr("formát") },
        data: { k: "text", desc: tr("obsah souboru (base64) – raději window.mncad.importFile()") },
      },
    },
    sweep: {
      ex: 'prvek sweep profileId="Skica 1" pathId=$last',
      fields: {
        profileId: SK(tr("skica profilu")),
        pathId: SK(tr("skica dráhy")),
        mode: MODE_NO_TEXT(),
        frenet: B(tr("Frenetův trojhran (profil se natáčí podle křivosti)")),
        guideId: { k: "sketch", opt: true, desc: tr("vodicí křivka") },
        twist: N(tr("zkroucení po dráze"), "°", undefined, true),
        twistTurns: N(tr("počet otáček zkroucení"), undefined, undefined, true),
        thin: THIN(),
        circleRadius: N(tr("kruhový průřez bez skici profilu (poloměr)"), "mm", undefined, true),
        keepNormal: B(tr("držet normálu profilu"), undefined, true),
        transition: { k: "enum", opt: true, values: ["right", "round", "transformed"], desc: tr("přechod v rozích dráhy") },
        scaleEnd: N(tr("měřítko profilu na konci"), undefined, undefined, true),
      },
    },
    loft: {
      ex: 'prvek loft sketchIds=["Skica 1","Skica 2"] ruled=ne',
      fields: {
        sketchIds: { k: "sketches", desc: tr("profily (2 a více skic)") },
        ruled: B(tr("přímkové plochy mezi profily")),
        mode: MODE_NO_TEXT(),
        guideIds: { k: "sketches", opt: true, desc: tr("vodicí křivky") },
        centerlineId: { k: "sketch", opt: true, desc: tr("středová křivka") },
        closed: B(tr("uzavřené (poslední profil zpět na první)"), undefined, true),
        smooth: B(tr("hladce uzavřené (periodická plocha)"), undefined, true),
        startCond: { k: "enum", opt: true, values: ["none", "normal", "direction"], desc: tr("podmínka na začátku") },
        endCond: { k: "enum", opt: true, values: ["none", "normal", "direction"], desc: tr("podmínka na konci") },
        startDir: { k: "direction", opt: true, desc: tr("směr na začátku") },
        endDir: { k: "direction", opt: true, desc: tr("směr na konci") },
        startLen: N(tr("váha tečny na začátku"), undefined, undefined, true),
        endLen: N(tr("váha tečny na konci"), undefined, undefined, true),
        thin: THIN(),
        startPoint: { k: "ref", opt: true, desc: tr("počáteční bod (špička)") },
        endPoint: { k: "ref", opt: true, desc: tr("koncový bod (špička)") },
      },
    },
    draft: {
      cmd: tr("úkos A plochy <pravidlo|F1 F2…> [dělicí \"Skica\"] [stupňovitý] [směr +Z] [rovina XY odsazení N]"),
      fields: {
        angle: N(tr("úhel úkosu"), "°", tr("úkos A")),
        faces: { ...FACES(), text: tr("plochy <pravidlo|F1 F2…>") },
        plane: PLANE3(tr("neutrální rovina"), tr("rovina XY|XZ|YZ")),
        offset: N(tr("odsazení neutrální roviny"), "mm", tr("odsazení N")),
        planeDef: { k: "planeDef", opt: true, desc: tr("neutrální rovina definicí") },
        pull: { k: "direction", opt: true, desc: tr("směr tahu (vyhození)"), text: tr("směr +Z") },
        partingSketchId: { k: "sketch", opt: true, desc: tr("dělicí křivka (skica)"), text: tr("dělicí \"Skica\"") },
        tangentChain: B(tr("šířit po tečně navazujících plochách"), undefined, true),
        step: B(tr("stupňovitý úkos (každý úsek od vlastní roviny)"), tr("stupňovitý"), true),
        faceSigs: SIGS(),
      },
    },
    split: {
      fields: {
        plane: PLANE3(tr("rovina řezu")),
        offset: N(tr("odsazení roviny"), "mm"),
        keep: { k: "enum", values: ["positive", "negative"], desc: tr("ponechaná strana") },
        planeDef: { k: "planeDef", opt: true, desc: tr("rovina definicí – má přednost") },
        faceRef: { k: "faceRef", opt: true, desc: tr("řez rovinou plochy") },
      },
    },
    transform: {
      fields: {
        translate: { k: "vec3", unit: "mm", desc: tr("posun") },
        rotateAxis: { k: "enum", values: ["X", "Y", "Z"], desc: tr("osa otočení") },
        rotateAngle: N(tr("úhel otočení"), "°"),
        scale: N(tr("měřítko (1 = beze změny)")),
        translateRef: { k: "json", opt: true, desc: tr("posun z bodu do bodu {a: Ref, b: Ref}") },
        rotateAxisDef: { k: "axisDef", opt: true, desc: tr("osa otočení odkazem") },
        centerRef: { k: "ref", opt: true, desc: tr("střed otáčení / měřítka") },
      },
    },
    datum: {
      fields: {
        origin: { k: "vec3", unit: "mm", desc: tr("počátek roviny") },
        normal: { k: "vec3", desc: tr("normála") },
        xDir: { k: "vec3", desc: tr("směr osy X roviny") },
        size: N(tr("velikost zobrazení"), "mm"),
        planeDef: { k: "planeDef", opt: true, desc: tr("asociativní definice (plocha, 3 body, pod úhlem…)") },
      },
    },
    text: {
      cmd: tr("text \"ABC\" výška H hloubka D v x y [z] [gravírovat]"),
      fields: {
        text: { k: "text", desc: tr("nápis"), text: tr("text \"ABC\"") },
        height: N(tr("výška písma"), "mm", tr("výška H")),
        depth: N(tr("hloubka / výška reliéfu"), "mm", tr("hloubka D")),
        plane: { k: "sketchPlane", desc: tr("rovina textu"), text: tr("XY|XZ|YZ, z = odsazení") },
        position: { k: "vec2", unit: "mm", desc: tr("střed textu v rovině"), text: tr("v x y") },
        angle: N(tr("natočení"), "°", tr("úhel a")),
        mode: { k: "enum", values: ["add", "cut"], desc: tr("vystouplý / gravírovaný"), text: tr("gravírovat") },
        positionRef: { k: "ref", opt: true, desc: tr("střed textu odkazem (promítne se do roviny)") },
        planeDef: { k: "planeDef", opt: true, desc: tr("rovina textu definicí") },
      },
    },
    pushPull: { fields: { faces: FACES(), distance: N(tr("posun podél normály (+ ven)"), "mm"), extent: { k: "extent", opt: true, desc: tr("ukončení: k vrcholu, k ploše, odsazeně od plochy") }, faceSigs: SIGS() } },
    deleteFace: { fields: { faces: FACES(tr("odstraněné plochy")), faceSigs: SIGS() } },
    offsetFace: { fields: { faces: FACES(), distance: N(tr("odsazení (+ ven, − dovnitř)"), "mm"), faceSigs: SIGS() } },
    rib: {
      fields: {
        sketchId: SK(tr("skica s otevřenou čarou")),
        thickness: N(tr("tloušťka žebra"), "mm"),
        direction: { k: "enum", values: ["normal", "inPlane"], desc: tr("směr: kolmo na skicu / v rovině skici") },
        flip: B(tr("opačná strana")),
      },
    },
    spring: {
      cmd: tr("pružina D stoupání P závity N|délka L drát d [v x y z | na …] [osa …] [odebrat|průnik|nové]"),
      fields: {
        radius: N(tr("poloměr osy drátu (text zadává průměr D)"), "mm", tr("pružina D")),
        pitch: N(tr("stoupání"), "mm", tr("stoupání P")),
        turns: N(tr("počet závitů"), undefined, tr("závity N | délka L")),
        wire: N(tr("průměr drátu"), "mm", tr("drát d")),
        position: POS(tr("začátek osy")),
        axis: AXIS(),
        mode: MODE(),
        positionRef: POSREF(),
        dirDef: DIRDEF(),
      },
    },
    thicken: { fields: { faces: FACES(), thickness: N(tr("tloušťka"), "mm"), mode: MODE_NO_TEXT(), faceSigs: SIGS() } },
    thread: {
      cmd: tr("závit M18×1,5 délka L [v x y z | na …] [osa …] [vnitřní] [modelovat]"),
      fields: {
        designation: { k: "text", desc: tr("označení (M8, M18×1,5)"), text: tr("závit M8") },
        position: POS(tr("začátek závitu na ose")),
        axis: AXIS(),
        length: N(tr("délka závitu"), "mm", tr("délka L")),
        modeled: B(tr("modelované drážky (jinak kosmetický – jen výkres)"), tr("modelovat")),
        internal: B(tr("vnitřní závit (v díře)"), tr("vnitřní"), true),
        positionRef: POSREF(),
        dirDef: DIRDEF(),
      },
    },
    ext: {
      cmd: tr("prvek <rozšíření> klíč=hodnota … (pole rozšíření: prvek nápověda <rozšíření>)"),
      fields: {
        ext: { k: "text", desc: tr("id rozšíření (sheet.bend, surf.helix…)"), text: tr("prvek <rozšíření>") },
        data: { k: "json", desc: tr("parametry rozšíření – prvek nápověda <rozšíření>"), text: tr("klíč=hodnota") },
      },
    },
    combine: {
      cmd: tr("sloučit <cíl> <nástroj> [odebrat|průnik] [ponechat]"),
      fields: {
        target: { k: "body", desc: tr("cílové těleso"), text: tr("sloučit <cíl> <nástroj>") },
        tool: { k: "body", desc: tr("nástrojové těleso"), text: tr("sloučit <cíl> <nástroj>") },
        op: { k: "enum", values: ["add", "cut", "intersect"], desc: tr("operace"), text: tr("odebrat|průnik") },
        keepTool: B(tr("ponechat nástrojové těleso"), tr("ponechat")),
      },
    },
    splitBodies: {
      cmd: tr("rozdělit XY|XZ|YZ [odsazení N] [jako Název]"),
      fields: {
        plane: PLANE3(tr("rovina rozdělení"), tr("rozdělit XY|XZ|YZ")),
        offset: N(tr("odsazení roviny"), "mm", tr("odsazení N")),
        nameB: { k: "text", opt: true, desc: tr("název tělesa na záporné straně"), text: tr("jako Název") },
        planeDef: { k: "planeDef", opt: true, desc: tr("rovina definicí – má přednost") },
      },
    },
    copyBody: {
      cmd: tr("kopie [těleso N] [posun dx dy dz] [jako Název]"),
      fields: {
        source: { k: "body", desc: tr("zdrojové těleso (prázdné = aktivní)"), text: tr("těleso N") },
        translate: { k: "vec3", unit: "mm", desc: tr("posun kopie"), text: tr("posun dx dy dz") },
        newName: { k: "text", opt: true, desc: tr("název kopie"), text: tr("jako Název") },
      },
    },
    datumAxis: { ex: 'prvek datumAxis def={"kind":"twoPoints","a":{"kind":"vertex","index":0},"b":{"kind":"vertex","index":6}} length=100', fields: { def: { k: "axisDef", desc: tr("definice osy (hrana, válec, 2 body, globální, průsečnice rovin…)") }, length: N(tr("délka zobrazení"), "mm") } },
    datumPoint: { ex: 'prvek datumPoint ref={"kind":"edge","index":4,"at":"center"}', fields: { ref: { k: "ref", desc: tr("bod (vrchol, střed hrany, střed kružnice, odvozený bod…)") } } },
    csys: {
      fields: {
        origin: { k: "ref", desc: tr("počátek (bod odkazem)") },
        xDir: { k: "direction", desc: tr("směr osy X (ortogonalizuje se vůči Z)") },
        zDir: { k: "direction", desc: tr("směr osy Z") },
        size: N(tr("velikost zobrazení"), "mm", undefined, true),
      },
    },
  } satisfies FieldTable;
}

/** Druh hodnoty slovem + ukázka zápisu v `prvek … klíč=hodnota`. */
export function kindInfo(k: FieldKind): { label: string; ex: string } {
  switch (k) {
    case "number":
      return { label: tr("číslo"), ex: "12,5" };
    case "integer":
      return { label: tr("celé číslo"), ex: "4" };
    case "boolean":
      return { label: tr("ano/ne"), ex: tr("ano") };
    case "enum":
      return { label: tr("výčet"), ex: "" };
    case "text":
      return { label: tr("text"), ex: '"…"' };
    case "vec3":
      return { label: tr("vektor x;y;z"), ex: "0;0;20" };
    case "vec2":
      return { label: tr("bod x;y"), ex: "10;5" };
    case "ref":
      return { label: tr("odkaz na bod (JSON Ref)"), ex: '{"kind":"vertex","index":2}' };
    case "faceRef":
      return { label: tr("odkaz na plochu (JSON Ref; F3 = index 2)"), ex: '{"kind":"face","index":2}' };
    case "refs":
      return { label: tr("seznam odkazů (JSON Ref[])"), ex: '[{"kind":"xyz","p":[0,0,10]}]' };
    case "direction":
      return { label: tr("směr (JSON Direction)"), ex: '{"kind":"vector","v":[0,0,-1]}' };
    case "axisDef":
      return { label: tr("osa (JSON AxisDef)"), ex: '{"kind":"edge","ref":{"kind":"edge","index":3}}' };
    case "planeDef":
      return { label: tr("rovina (JSON PlaneDef)"), ex: '{"kind":"face","ref":{"kind":"face","index":2}}' };
    case "extent":
      return { label: tr("ukončení (JSON Extent)"), ex: '{"kind":"throughAll"}' };
    case "from":
      return { label: tr("začátek (JSON StartFrom)"), ex: '{"kind":"offset","d":5}' };
    case "thin":
      return { label: tr("tenká stěna (JSON Thin)"), ex: '{"side":"one","t1":2}' };
    case "sketchPlane":
      return { label: tr("rovina skici (JSON SketchPlane)"), ex: '{"kind":"base","name":"XY","offset":0}' };
    case "sketch":
      return { label: tr("skica (název, id, $last)"), ex: '"Skica 1"' };
    case "sketches":
      return { label: tr("seznam skic"), ex: '["Skica 1","Skica 2"]' };
    case "feature":
      return { label: tr("prvek (název, id, $last)"), ex: "$last" };
    case "features":
      return { label: tr("seznam prvků"), ex: '"Díra 1";"Díra 2"' };
    case "faces":
      return { label: tr("plochy: indexy od 0 (F3 = 2) nebo pravidlo"), ex: tr("2;5 · boční") };
    case "edges":
      return { label: tr("hrany: indexy od 0 (E3 = 2), all nebo pravidlo"), ex: tr("2;5 · svislé") };
    case "indices":
      return { label: tr("seznam indexů od 0"), ex: "0;3" };
    case "map":
      return { label: tr("mapa index → hodnota (JSON)"), ex: '{"0":2,"3":5}' };
    case "sigs":
      return { label: tr("otisky (JSON)"), ex: "" };
    case "json":
      return { label: tr("JSON"), ex: "" };
    case "body":
      return { label: tr("těleso (název)"), ex: '"Těleso 2"' };
  }
}

/** Pole typu v pořadí tabulky. */
export function fieldsOf(type: FeatureType): [string, FieldSpec][] {
  return Object.entries(featureFields()[type].fields as Record<string, FieldSpec>);
}

/** Mezery textových příkazů: pole bez vlastního textového zápisu (jen `prvek` / `upravit` / JSON), bez otisků výběru. */
export function textGaps(): { type: FeatureType; cmd?: string; missing: string[]; total: number }[] {
  const t = featureFields();
  return (Object.keys(t) as FeatureType[]).map((type) => {
    const all = Object.entries(t[type].fields as Record<string, FieldSpec>).filter(([, s]) => s.k !== "sigs");
    return { type, cmd: t[type].cmd, missing: all.filter(([, s]) => !s.text).map(([k]) => k), total: all.length };
  });
}
