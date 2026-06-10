import path from "node:path";
import { Font, StyleSheet } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";

// Roboto (brandové písmo) s podporou českých znaků — registrace z public/fonts.
let registered = false;
export function ensureFonts() {
  if (registered) return;
  const dir = path.join(process.cwd(), "public", "fonts");
  Font.register({
    family: "Roboto",
    fonts: [
      { src: path.join(dir, "Roboto-Light.ttf"), fontWeight: 300 },
      { src: path.join(dir, "Roboto-Regular.ttf"), fontWeight: "normal" },
      { src: path.join(dir, "Roboto-Italic.ttf"), fontStyle: "italic" },
      { src: path.join(dir, "Roboto-Bold.ttf"), fontWeight: "bold" },
    ],
  });
  Font.registerHyphenationCallback((word) => [word]); // bez dělení slov
  registered = true;
}

export const BRAND = COMPANY.colors;

export const styles = StyleSheet.create({
  page: {
    paddingTop: 36,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontFamily: "Roboto",
    fontSize: 9,
    color: BRAND.anthracite,
    lineHeight: 1.4,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  // Wordmark dle logomanuálu: antracit bold + menší „s.r.o.", slogan šedý italic
  brandName: { fontSize: 17, fontWeight: "bold", color: BRAND.anthracite, lineHeight: 1 },
  brandSuffix: { fontSize: 9, fontWeight: "bold", color: BRAND.anthracite },
  brandSlogan: { fontSize: 8, fontStyle: "italic", color: BRAND.grey, marginTop: 3 },
  // Červená korporátní linka oddělující hlavičku
  headerRule: { marginTop: 14, height: 2.5, backgroundColor: BRAND.red },
  docTitle: { fontSize: 18, fontWeight: "bold", color: BRAND.anthracite, textAlign: "right", lineHeight: 1.2 },
  docNumber: { fontSize: 11, color: BRAND.grey, textAlign: "right", marginTop: 6, lineHeight: 1 },

  partiesRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 24, gap: 24 },
  partyBox: { flex: 1 },
  partyLabel: { fontSize: 8, color: BRAND.grey, textTransform: "uppercase", marginBottom: 4, letterSpacing: 1 },
  partyName: { fontSize: 11, fontWeight: "bold" },

  metaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 18, gap: 24 },
  metaBox: { flex: 1, padding: 10, backgroundColor: "#F7F7F8", borderRadius: 4 },
  metaLine: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  metaKey: { color: BRAND.grey },
  metaVal: { fontWeight: "bold" },

  table: { marginTop: 22, borderTopWidth: 1, borderColor: "#E5E5E7" },
  th: {
    flexDirection: "row",
    backgroundColor: BRAND.anthracite,
    color: "#fff",
    paddingVertical: 6,
    paddingHorizontal: 6,
    fontSize: 8,
    textTransform: "uppercase",
  },
  tr: { flexDirection: "row", paddingVertical: 6, paddingHorizontal: 6, borderBottomWidth: 1, borderColor: "#EEE" },
  cDesc: { flex: 4 },
  cQty: { flex: 1.2, textAlign: "right" },
  cUnit: { flex: 1, textAlign: "center" },
  cPrice: { flex: 1.6, textAlign: "right" },
  cVat: { flex: 1, textAlign: "right" },
  cTotal: { flex: 1.8, textAlign: "right" },

  totals: { marginTop: 14, alignSelf: "flex-end", width: 240 },
  totalLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalGrand: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 2,
    borderColor: BRAND.red,
  },
  totalGrandLabel: { fontSize: 12, fontWeight: "bold" },
  totalGrandValue: { fontSize: 12, fontWeight: "bold", color: BRAND.red },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: BRAND.grey,
    borderTopWidth: 1,
    borderColor: "#E5E5E7",
    paddingTop: 6,
  },
  note: { marginTop: 16, fontSize: 8, color: BRAND.grey },
  sectionTitle: { fontSize: 9, fontWeight: "bold", marginTop: 16, marginBottom: 4 },
});
