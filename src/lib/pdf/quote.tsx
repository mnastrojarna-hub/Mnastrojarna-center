import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "./theme";
import { BrandHeader, PartyBlock, DocFooter } from "./components";
import { computeTotals, czk, czDate, type QuoteData } from "./types";

export function QuoteDocument({ data }: { data: QuoteData }) {
  const { subtotal, vatTotal, total } = computeTotals(data.items);
  const cur = data.currency;

  return (
    <Document title={`Nabídka ${data.number}`} author="MNástrojárna s.r.o.">
      <Page size="A4" style={styles.page}>
        <BrandHeader title="CENOVÁ NABÍDKA" number={data.number} />

        <View style={styles.partiesRow}>
          <PartyBlock label="Dodavatel" party={data.supplier} />
          <PartyBlock label="Zákazník" party={data.customer} />
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaBox}>
            <View style={styles.metaLine}><Text style={styles.metaKey}>Datum vystavení</Text><Text style={styles.metaVal}>{czDate(data.issueDate)}</Text></View>
            {data.validUntil ? (
              <View style={styles.metaLine}><Text style={styles.metaKey}>Platnost do</Text><Text style={styles.metaVal}>{czDate(data.validUntil)}</Text></View>
            ) : null}
          </View>
          <View style={styles.metaBox} />
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cDesc}>Položka</Text>
            <Text style={styles.cQty}>Množství</Text>
            <Text style={styles.cUnit}>MJ</Text>
            <Text style={styles.cPrice}>Cena/MJ</Text>
            <Text style={styles.cVat}>DPH %</Text>
            <Text style={styles.cTotal}>Celkem</Text>
          </View>
          {data.items.map((it, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <Text style={styles.cDesc}>{it.description}</Text>
              <Text style={styles.cQty}>{it.quantity}</Text>
              <Text style={styles.cUnit}>{it.unit}</Text>
              <Text style={styles.cPrice}>{czk(it.unitPrice, cur)}</Text>
              <Text style={styles.cVat}>{it.vatRate} %</Text>
              <Text style={styles.cTotal}>{czk(it.quantity * it.unitPrice, cur)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalLine}><Text>Bez DPH</Text><Text>{czk(subtotal, cur)}</Text></View>
          <View style={styles.totalLine}><Text>DPH</Text><Text>{czk(vatTotal, cur)}</Text></View>
          <View style={styles.totalGrand}>
            <Text style={styles.totalGrandLabel}>Celkem s DPH</Text>
            <Text style={styles.totalGrandValue}>{czk(total, cur)}</Text>
          </View>
        </View>

        {data.note ? <Text style={styles.note}>{data.note}</Text> : null}
        <Text style={styles.note}>Nabídka je nezávazná, ceny jsou orientační do potvrzení objednávky.</Text>

        <DocFooter />
      </Page>
    </Document>
  );
}
