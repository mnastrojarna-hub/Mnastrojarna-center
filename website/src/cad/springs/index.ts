/**
 * PRUŽINY – veřejné API (čisté funkce, bez jádra a bez DOM; běží v Node, workeru i v prohlížeči). Jediná cesta importu pro UI,
 * text, výkres a balík motion: `@/cad/springs`.
 *
 * Prvky historie (rozšíření, `{ type: "ext", ext, data }`): `spring.compression` (tlačná, EN 13906-1), `spring.extension`
 * (tažná s očky, EN 13906-2), `spring.torsion` (zkrutná s rameny, EN 13906-3), `spring.disc` (talířová DIN 2093, sloupce).
 * Data = plochá tabulka (klíče = řádky `KINDS[k].rows()`), např. tlačná:
 *   { d: 2, De: 20, L0: 50, n: 8, ends: "ground" | "closed" | "open", material: "SH" | "DH" | "VDSiCr" | "1.4310",
 *     L1?, L2?, F1?, F2?, nu: "0.5" | "0.7" | "1" | "2", hand: "right" | "left",
 *     at: [x, y, z], atRef?: Ref, axis: "Z" | Direction, mode: "new" | "add" | "cut" | "intersect",
 *     len?: number  // délka TVARU (stlačená pružina v sestavě), výpočet zůstává pro L0 – viz springDataAt }
 * Průměr stačí jeden z D / De / Di, závity n nebo nt; síly F1/F2 místo délek L1/L2.
 * Souřadnice prvku: osa pružiny = `axis` (výchozí +Z) z bodu `at`; tlačná: konce v 0 a L (broušené = rovinné plochy kolmé na osu),
 * tažná: vnitřní okraj spodního očka v 0, horního v L0; zkrutná: tělo od 0; talířová: sloupec od 0 do L0.
 *
 * VÝPOČET
 *   springCalc(extOrKind, data): SpringCalc     { ok, issues[{level,key?,text}], v: {R, Ln, Sa, F1, F2, tauk2, sK, fe, mass…},
 *                                                rows: CalcRow[] (spočtené řádky tabulky), title, summary, model }
 *   SpringModel (calc.model / springModelOf(f))  { kind, free = L0, solid = Ln, rate [N/mm | N·mm/°], preload?, massKg, D, d,
 *                                                forceAt(L) [N], torqueAt?(deg) }
 *   KINDS[kind] = { ext, label(), standard, words{cs,en,de}, defaults(), rows(): SpringRow[], calc }
 *   kindOfExt(ext), isSpringExt(ext), SPRING_EXTS, SPRING_KINDS
 *   SPRING_MATERIALS / springMaterial(id) / rmOf(m, d)   G, E, ρ, Rm(d) podle EN 10270-1/-2/-3
 *
 * GEOMETRIE (pro síť v pohybové studii – balík motion; jádro staví ze stejných funkcí)
 *   springPathOf(ext, data, L?, perTurn = 24): SpringPath | null
 *       { pts: Vec3[], tangents: Vec3[], seg: number[], d, clip?: [0, L] }  střednice drátu v souřadnicích prvku (osa +Z);
 *       tlačná v délce L (výchozí data.len ?? L0): závěrné závity zůstanou přiložené, mění se jen stoupání činných závitů;
 *       `clip` = broušené konce – síť zploštit / oříznout rovinami z = 0 a z = L. Pod geometrickým dorazem se nezkracuje.
 *   compressionSpecOf(data, L?) → CoilSpec,  coilPoint(spec, θ), coilDeriv(spec, θ), pitchAt(spec, u), compressionMinLength(spec)
 *   springDataAt(data, L) = { ...data, len: L }   data prvku pro PŘESNOU stavbu v délce L (export, kolize)
 *   springPartGeom(doc) → { base, axis, length, free, solid?, rate?, preload?, ring, featureId, ext } | null
 *       osa a délky první tlačné / tažné pružiny z tabulky v dílu (náhrada springGeom z asm-spring-geom.ts pro nové prvky)
 *
 * DOKUMENT A TEXT
 *   springSummary(f) → "" | souhrn do stavu,  springTablesOf(doc) → [{ featureId, name, ext, calc }],
 *   springTableText(name, ext, data) → řádky protokolu `pružina tabulka`
 */
export * from "./types";
export * from "./materials";
export { calcCompression, compressionDefaults, readCompression, solidLength, bucklingDeflection, bergstrasser, shearStress, endsLabel, ENDS, SUPPORTS } from "./compression";
export { calcExtension, extensionDefaults, readExtension, loopHeight, loopLabel, LOOPS } from "./extension";
export { calcTorsion, torsionDefaults, readTorsion, legLabel, LEGS } from "./torsion";
export { calcDisc, discDefaults, readDisc, almen, DISC_SIZES, discSize, discOuterSizes, type DiscSize } from "./disc";
export { coilPoint, coilDeriv, pitchAt, compressionSpec, compressionMinLength, compressionPath, compressionSegments, extensionPieces, torsionPieces, piecesPath, pathLength, discSection, COIL_GAP, MIN_COIL_GAP, TRANSITION, type CoilSpec, type Ends, type LoopKind, type LegKind, type PathPiece, type SpringPieces } from "./path";
export { compressionRows, extensionRows, torsionRows, discRows, rowsOf, rowVisible, discPresets } from "./rows";
export { KINDS, kindOfExt, isSpringExt, springCalc, springSummary, springResults, springTablesOf, springTableText, rowLine, springModelOf, springDataAt, compressionSpecOf, springPathOf, discOf, springAxisOf, springPartGeom, type KindDef, type SpringTable } from "./registry";
