import { View, Text, Svg, Rect, Line, Path, G, Defs, ClipPath } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";
import { styles, BRAND } from "./theme";
import type { PartyInfo } from "./types";

/**
 * Symbol frézy dle logomanuálu — šrafovaný štít v korporátní červené
 * s odlétajícími třískami vlevo dole (vektorová rekreace shodná s UI logem).
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Defs>
        <ClipPath id="mn-shield-pdf">
          <Path d="M6 4 h21 a3 3 0 0 1 3 3 v15.5 a3 3 0 0 1 -0.9 2.15 L20 36 l-9.1 -11.35 A3 3 0 0 1 10 22.5 V4 Z" />
        </ClipPath>
      </Defs>
      <G clipPath="url(#mn-shield-pdf)">
        <Rect x={0} y={0} width={40} height={40} fill={BRAND.red} />
        <Line x1={-6} y1={14} x2={20} y2={-12} stroke="#ffffff" strokeWidth={3.1} />
        <Line x1={-6} y1={22} x2={28} y2={-12} stroke="#ffffff" strokeWidth={3.1} />
        <Line x1={-6} y1={30} x2={36} y2={-12} stroke="#ffffff" strokeWidth={3.1} />
        <Line x1={-2} y1={36} x2={40} y2={-6} stroke="#ffffff" strokeWidth={3.1} />
        <Line x1={6} y1={40} x2={44} y2={2} stroke="#ffffff" strokeWidth={3.1} />
      </G>
      {/* Odlétající třísky */}
      <Path d="M3 28 l3 1.4 -2.6 1.9 Z" fill={BRAND.red} />
      <Path d="M1.5 31.5 l2.6 0.6 -1.7 1.9 Z" fill={BRAND.red} />
    </Svg>
  );
}

export function BrandHeader({ title, number }: { title: string; number: string }) {
  return (
    <View>
      <View style={styles.headerRow}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <LogoMark />
          <View>
            <Text>
              <Text style={styles.brandName}>{COMPANY.name.replace(/\s*s\.r\.o\.?$/i, "")}</Text>
              <Text style={styles.brandSuffix}> s.r.o.</Text>
            </Text>
            <Text style={styles.brandSlogan}>{COMPANY.slogan}</Text>
          </View>
        </View>
        <View>
          <Text style={styles.docTitle}>{title}</Text>
          <Text style={styles.docNumber}>{number}</Text>
        </View>
      </View>
      {/* Korporátní červená linka pod hlavičkou */}
      <View style={styles.headerRule} />
    </View>
  );
}

export function PartyBlock({ label, party }: { label: string; party: PartyInfo }) {
  return (
    <View style={styles.partyBox}>
      <Text style={styles.partyLabel}>{label}</Text>
      <Text style={styles.partyName}>{party.name}</Text>
      {party.street ? <Text>{party.street}</Text> : null}
      {party.zip || party.city ? <Text>{[party.zip, party.city].filter(Boolean).join(" ")}</Text> : null}
      {party.country ? <Text>{party.country}</Text> : null}
      <View style={{ marginTop: 4 }}>
        {party.ico ? <Text>IČO: {party.ico}</Text> : null}
        {party.dic ? <Text>DIČ: {party.dic}</Text> : null}
      </View>
    </View>
  );
}

export function DocFooter() {
  const a = COMPANY.address;
  return (
    <View style={styles.footer} fixed>
      <Text>
        {COMPANY.name}, {a.street}, {a.zip} {a.city} · IČO {COMPANY.ico} · DIČ {COMPANY.dic}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Strana ${pageNumber}/${totalPages}`} />
    </View>
  );
}

/** Vystavovatel dokladu — čte se až při generování (po refreshCompanyFromSettings). */
export function supplierParty(): PartyInfo {
  return {
    name: COMPANY.name,
    street: COMPANY.address.street,
    zip: COMPANY.address.zip,
    city: COMPANY.address.city,
    country: COMPANY.address.country,
    ico: COMPANY.ico,
    dic: COMPANY.dic,
  };
}
