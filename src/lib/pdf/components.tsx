import { View, Text, Svg, Rect, Line } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";
import { styles, BRAND } from "./theme";
import type { PartyInfo } from "./types";

export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Rect x={4} y={4} width={32} height={32} rx={9} fill={BRAND.red} />
      <Line x1={11} y1={27} x2={28} y2={10} stroke="#ffffff" strokeWidth={3} />
      <Line x1={16} y1={29} x2={30} y2={15} stroke="#ffffff" strokeWidth={3} />
      <Line x1={8} y1={22} x2={22} y2={8} stroke="#ffffff" strokeWidth={3} />
    </Svg>
  );
}

export function BrandHeader({ title, number }: { title: string; number: string }) {
  return (
    <View style={styles.headerRow}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <LogoMark />
        <View>
          <Text style={styles.brandName}>{COMPANY.name}</Text>
          <Text style={styles.brandSlogan}>{COMPANY.slogan}</Text>
        </View>
      </View>
      <View>
        <Text style={styles.docTitle}>{title}</Text>
        <Text style={styles.docNumber}>{number}</Text>
      </View>
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
