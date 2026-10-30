import path from "node:path";
import { Font, StyleSheet } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";

// Roboto (brandové písmo) s podporou českých znaků — registrace z public/fonts.
const ROBOTO_VARIANTS = [
  { file: "Roboto-Light.ttf", fontWeight: 300, fontStyle: "normal" },
  { file: "Roboto-Regular.ttf", fontWeight: 400, fontStyle: "normal" },
  { file: "Roboto-Italic.ttf", fontWeight: 400, fontStyle: "italic" },
  { file: "Roboto-Bold.ttf", fontWeight: 700, fontStyle: "normal" },
] as const;

let registered = false;
let ready: Promise<void> | null = null;

/**
 * Zaregistruje a NAČTE písma a opraví sdílenou mezipaměť glyfů (viz `fixGlyphCodePoints`).
 * Volat (await) před každým renderem dokladu — první volání v procesu písma načte, další jsou zdarma.
 */
export function ensureFonts(): Promise<void> {
  if (!registered) {
    const dir = path.join(process.cwd(), "public", "fonts");
    Font.register({
      family: "Roboto",
      fonts: ROBOTO_VARIANTS.map((v) => ({ src: path.join(dir, v.file), fontWeight: v.fontWeight, fontStyle: v.fontStyle })),
    });
    Font.registerHyphenationCallback(splitLongWord);
    registered = true;
  }
  if (!ready) {
    ready = Promise.all(
      ROBOTO_VARIANTS.map(async (v) => {
        const source = Font.getFont({ fontFamily: "Roboto", fontWeight: v.fontWeight, fontStyle: v.fontStyle });
        await source.load();
        fixGlyphCodePoints(source.data as unknown as GlyphFont | null);
      }),
    ).then(
      () => undefined,
      (err: unknown) => {
        ready = null; // příště zkusit znovu (např. dočasně nedostupný soubor)
        throw err;
      },
    );
  }
  return ready;
}

interface GlyphLike {
  id: number;
  codePoints: number[];
}
interface GlyphFont {
  getGlyph: (id: number, codePoints?: number[]) => GlyphLike | null;
  [GLYPH_FIX]?: true;
}
const GLYPH_FIX = Symbol.for("mnastrojarna.pdf.glyphCodePoints");

/**
 * Oprava „mizejících písmen" (C, Z, Y, R … po dokladu s Č, Ž, Ý, Ř …).
 *
 * fontkit drží pro každé písmo JEDEN objekt glyfu na id (`font._glyphs`) a do něj při prvním
 * vytvoření uloží `codePoints` — znaky, které glyf v textu představuje. Písmo (FontSource.data)
 * je sdílené všemi doklady v procesu. Složené písmeno „Č" je v Robotu glyf ze složek „C" + háček;
 * když doklad obsahuje tučné „Č", ale ne tučné „C", vytvoří podmnožina písma (TTFSubset._addGlyph →
 * font.getGlyph(id) bez znaků) glyf „C" s `codePoints = []`. V dalším dokladu fontkit při sazbě
 * „C" vrátí tento uložený glyf a textkit (@react-pdf) podle `codePoints.length` páruje glyfy se
 * znaky textu — glyf s nula znaky při dělení do řádků vypadne a chybí i v ToUnicode (kopírování).
 *
 * Oprava: `getGlyph` tohoto písma vrací pro sazbu glyf se znaky, které volající skutečně předal —
 * pokud se uložené `codePoints` liší, dostane volající lehký pohled (Object.create) se správnými
 * znaky; data glyfu (obrys, metriky) zůstávají sdílená. Bez znaků (podmnožina, obrysy) beze změny.
 */
export function fixGlyphCodePoints(font: GlyphFont | null | undefined): void {
  if (!font || typeof font.getGlyph !== "function" || font[GLYPH_FIX]) return;
  const original = font.getGlyph.bind(font);
  font.getGlyph = (id: number, codePoints: number[] = []) => {
    const glyph = original(id, codePoints);
    if (!glyph || codePoints.length === 0 || sameCodePoints(glyph.codePoints, codePoints)) return glyph;
    const view = Object.create(glyph) as GlyphLike;
    view.codePoints = codePoints;
    return view;
  };
  font[GLYPH_FIX] = true;
}

function sameCodePoints(a: readonly number[] | undefined, b: readonly number[]): boolean {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Slova se nedělí; jen extrémně dlouhé tokeny (kódy, čísla výkresů, URL) dostanou
 * místa zlomu po 8 znacích, aby nepřetekly do vedlejšího sloupce tabulky.
 */
export function splitLongWord(word: string): string[] {
  if (word.length <= 20) return [word];
  const parts: string[] = [];
  for (let i = 0; i < word.length; i += 8) parts.push(word.slice(i, i + 8));
  return parts;
}

export const BRAND = COMPANY.colors;

/** Paleta dokladů — brand + jemné odstíny (čitelné i v černobílém tisku). */
export const C = {
  red: BRAND.red,
  ink: BRAND.anthracite,
  grey: BRAND.grey,
  muted: "#8E8F92",
  line: "#E3E3E6",
  hair: "#EDEDEF",
  tint: "#F6F6F7",
  zebra: "#FAFAFB",
  redTint: "#FDF1F0",
  redLine: "#F6C9C5",
  white: "#FFFFFF",
};

/** Okraje stránky A4 (pt). */
export const PAGE = { top: 40, side: 44, bottom: 70 };

export const styles = StyleSheet.create({
  page: {
    paddingTop: PAGE.top,
    paddingBottom: PAGE.bottom,
    paddingHorizontal: PAGE.side,
    fontFamily: "Roboto",
    fontSize: 8.8,
    color: C.ink,
  },
  // lineHeight NESMÍ být na Page (rozbije texty s render — čísla stran), proto obal obsahu.
  // Bezjednotkový lineHeight se násobí fontSize TOHOTO stylu (výchozí 18) → vždy uvádět i fontSize.
  body: { fontSize: 8.8, lineHeight: 1.4 },

  // ── Hlavička ──
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brandRow: { flexDirection: "row", alignItems: "center" },
  // Wordmark dle logomanuálu: antracit bold + menší „s.r.o.", slogan šedý italic
  brandName: { fontSize: 19, fontWeight: "bold", color: C.ink, lineHeight: 1, letterSpacing: -0.2 },
  brandSuffix: { fontSize: 9, fontWeight: "bold", color: C.ink },
  brandSlogan: { fontSize: 8.2, fontStyle: "italic", color: C.grey, marginTop: 3, marginLeft: 1 },
  docKicker: {
    fontSize: 7,
    lineHeight: 1.2,
    fontWeight: "bold",
    color: C.red,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    textAlign: "right",
  },
  docTitle: { fontSize: 20, fontWeight: "bold", color: C.ink, textAlign: "right", lineHeight: 1.15, marginTop: 3 },
  docNumber: { fontSize: 10.5, color: C.grey, textAlign: "right", marginTop: 2 },
  docNumberStrong: { color: C.ink, fontWeight: "bold" },
  ruleRow: { flexDirection: "row", alignItems: "flex-end", marginTop: 12 },
  ruleAccent: { width: 64, height: 2.5, backgroundColor: C.red },
  ruleLine: { flexGrow: 1, height: 0.75, backgroundColor: C.line },

  // ── Pruh s klíčovými údaji ──
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 12,
    backgroundColor: C.tint,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  metaCell: { paddingVertical: 5, paddingHorizontal: 6 },
  metaLabel: { fontSize: 6.6, lineHeight: 1.25, color: C.muted, textTransform: "uppercase", letterSpacing: 0.7, marginBottom: 2.5 },
  metaValue: { fontSize: 9.2, lineHeight: 1.3, fontWeight: "bold", color: C.ink },

  // ── Strany ──
  parties: { flexDirection: "row", marginTop: 16 },
  party: { flex: 1 },
  partyLabelRow: { flexDirection: "row", alignItems: "center", marginBottom: 5 },
  partyDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.red, marginRight: 5 },
  partyLabel: { fontSize: 6.8, lineHeight: 1.2, color: C.muted, textTransform: "uppercase", letterSpacing: 1, fontWeight: "bold" },
  partyName: { fontSize: 11, fontWeight: "bold", color: C.ink, marginBottom: 2, lineHeight: 1.25 },
  partyLine: { color: C.ink },
  partyFacts: { marginTop: 5 },
  factRow: { flexDirection: "row" },
  factKey: { color: C.muted, width: 62 },
  factVal: { color: C.ink, flex: 1 },
  partySmall: { fontSize: 7.4, color: C.grey, marginTop: 4, lineHeight: 1.35 },

  // ── Úvodní text ──
  subject: { fontSize: 12, lineHeight: 1.3, fontWeight: "bold", color: C.ink, marginTop: 16 },
  intro: { fontSize: 9, color: C.ink, marginTop: 6, lineHeight: 1.5 },

  // ── Tabulka položek ──
  table: { marginTop: 14 },
  th: {
    flexDirection: "row",
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderBottomWidth: 1.2,
    borderColor: C.ink,
  },
  thText: { fontSize: 6.8, lineHeight: 1.25, fontWeight: "bold", color: C.grey, textTransform: "uppercase", letterSpacing: 0.6 },
  tr: {
    flexDirection: "row",
    fontSize: 8.8,
    lineHeight: 1.32,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 0.6,
    borderColor: C.hair,
  },
  trZebra: { backgroundColor: C.zebra },
  cellNum: { color: C.muted, fontSize: 8 },
  cellDrawing: { fontWeight: "bold", color: C.ink },
  cellRev: { fontSize: 7.2, lineHeight: 1.3, color: C.grey, marginTop: 1 },
  cellDesc: { color: C.ink },
  cellSub: { fontSize: 7.4, lineHeight: 1.3, color: C.grey, marginTop: 1.5 },
  cellNote: { fontSize: 7.4, lineHeight: 1.3, color: C.grey, fontStyle: "italic", marginTop: 1.5 },
  cellRight: { textAlign: "right" },
  cellUnit: { color: C.grey },
  cellStrong: { fontWeight: "bold", textAlign: "right" },
  cellMuted: { color: C.grey, textAlign: "right" },
  checkBox: { width: 9, height: 9, borderWidth: 0.9, borderColor: C.muted, borderRadius: 1.5, alignSelf: "center" },

  // ── Součty ──
  summaryRow: { flexDirection: "row", marginTop: 14, alignItems: "flex-start" },
  totalsCard: {
    width: 228,
    marginLeft: "auto",
    backgroundColor: C.tint,
    borderRadius: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  totalLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.6 },
  totalKey: { color: C.grey },
  totalVal: { color: C.ink },
  totalDivider: { height: 0.75, backgroundColor: C.line, marginVertical: 6 },
  totalGrandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  totalGrandLabel: { fontSize: 9.5, fontWeight: "bold", color: C.ink, paddingBottom: 1.5 },
  totalGrandValue: { fontSize: 15, fontWeight: "bold", color: C.red, lineHeight: 1.1 },
  totalHint: { fontSize: 6.8, lineHeight: 1.3, color: C.muted, textAlign: "right", marginTop: 3 },

  // ── Podmínky / poznámky ──
  sectionTitle: {
    fontSize: 6.8,
    lineHeight: 1.2,
    fontWeight: "bold",
    color: C.muted,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 5,
  },
  termRow: { flexDirection: "row", paddingVertical: 2.4, borderBottomWidth: 0.5, borderColor: C.hair },
  termKey: { width: 100, color: C.grey },
  termVal: { flex: 1, color: C.ink, fontWeight: "bold" },
  noteBox: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderLeftWidth: 2.5,
    borderColor: C.red,
    backgroundColor: C.redTint,
    borderTopRightRadius: 4,
    borderBottomRightRadius: 4,
  },
  noteText: { fontSize: 8.4, color: C.ink, lineHeight: 1.5 },
  closing: { marginTop: 12, fontSize: 9, color: C.ink, lineHeight: 1.5 },
  legal: { marginTop: 10, fontSize: 7.2, color: C.muted, lineHeight: 1.45 },

  // ── Podpisy ──
  signRow: { flexDirection: "row", marginTop: 18 },
  signBox: { flex: 1 },
  signTitle: { fontSize: 6.8, lineHeight: 1.2, fontWeight: "bold", color: C.muted, textTransform: "uppercase", letterSpacing: 1 },
  signName: { fontSize: 9, lineHeight: 1.3, fontWeight: "bold", color: C.ink, marginTop: 3 },
  signArea: { height: 34, borderBottomWidth: 0.9, borderColor: C.ink, marginTop: 4 },
  signCaption: { fontSize: 7, lineHeight: 1.3, color: C.muted, marginTop: 3 },
  stampBox: {
    height: 58,
    borderWidth: 0.9,
    borderStyle: "dashed",
    borderColor: C.muted,
    borderRadius: 6,
    marginTop: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  stampText: { fontSize: 7, lineHeight: 1.2, color: C.muted, textTransform: "uppercase", letterSpacing: 1 },

  // ── Patička ──
  footer: {
    position: "absolute",
    bottom: 22,
    left: PAGE.side,
    right: PAGE.side,
    borderTopWidth: 0.75,
    borderColor: C.line,
    paddingTop: 7,
    flexDirection: "row",
    fontSize: 6.7,
    color: C.grey,
  },
  footerCol: { flex: 1, paddingRight: 8, fontSize: 6.7, lineHeight: 1.45 },
  footerStrong: { fontWeight: "bold", color: C.ink },
  footerPage: { width: 58, textAlign: "right", color: C.grey },
  runningHeader: {
    position: "absolute",
    top: 18,
    left: PAGE.side,
    right: PAGE.side,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: C.muted,
  },
});
