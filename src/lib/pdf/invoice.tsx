import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "./theme";
import { BrandHeader, PartyBlock, DocFooter } from "./components";
import { computeTotals, czk, czDate, type InvoiceData } from "./types";

export function InvoiceDocument({ data }: { data: InvoiceData }) {
  const { breakdown, subtotal, vatTotal, total } = computeTotals(data.items);
  const cur = data.currency;

  return (
    <Document title={`Faktura ${data.number}`} author="MNástrojárna s.r.o.">
      <Page size="A4" style={styles.page}>
        <BrandHeader title="FAKTURA — daňový doklad" number={data.number} />

        <View style={styles.partiesRow}>
          <PartyBlock label="Dodavatel" party={data.supplier} />
          <PartyBlock label="Odběratel" party={data.customer} />
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaBox}>
            <Meta k="Variabilní symbol" v={data.variableSymbol} />
            <Meta k="Datum vystavení" v={czDate(data.issueDate)} />
            <Meta k="DUZP" v={czDate(data.taxableDate)} />
            <Meta k="Datum splatnosti" v={czDate(data.dueDate)} />
          </View>
          <View style={styles.metaBox}>
            <Meta k="Způsob úhrady" v={data.paymentMethod} />
            {data.bank?.accountNumber ? <Meta k="Číslo účtu" v={data.bank.accountNumber} /> : null}
            {data.bank?.iban ? <Meta k="IBAN" v={data.bank.iban} /> : null}
            {data.bank?.bankName ? <Meta k="Banka" v={data.bank.bankName} /> : null}
          </View>
        </View>

        {/* Položky */}
        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cDesc}>Označení dodávky</Text>
            <Text style={styles.cQty}>Množství</Text>
            <Text style={styles.cUnit}>MJ</Text>
            <Text style={styles.cPrice}>Cena/MJ</Text>
            <Text style={styles.cVat}>DPH %</Text>
            <Text style={styles.cTotal}>Celkem bez DPH</Text>
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

        {/* Rekapitulace DPH */}
        <Text style={styles.sectionTitle}>Rekapitulace DPH</Text>
        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cDesc}>Sazba</Text>
            <Text style={styles.cTotal}>Základ</Text>
            <Text style={styles.cTotal}>DPH</Text>
            <Text style={styles.cTotal}>Celkem</Text>
          </View>
          {breakdown.map((r) => (
            <View key={r.rate} style={styles.tr}>
              <Text style={styles.cDesc}>{r.rate} %</Text>
              <Text style={styles.cTotal}>{czk(r.base, cur)}</Text>
              <Text style={styles.cTotal}>{czk(r.vat, cur)}</Text>
              <Text style={styles.cTotal}>{czk(r.base + r.vat, cur)}</Text>
            </View>
          ))}
        </View>

        {/* Součty */}
        <View style={styles.totals}>
          <View style={styles.totalLine}>
            <Text>Základ daně</Text>
            <Text>{czk(subtotal, cur)}</Text>
          </View>
          <View style={styles.totalLine}>
            <Text>DPH celkem</Text>
            <Text>{czk(vatTotal, cur)}</Text>
          </View>
          <View style={styles.totalGrand}>
            <Text style={styles.totalGrandLabel}>K úhradě</Text>
            <Text style={styles.totalGrandValue}>{czk(total, cur)}</Text>
          </View>
        </View>

        {data.note ? <Text style={styles.note}>{data.note}</Text> : null}
        <Text style={styles.note}>
          Vystaveno v souladu se zákonem č. 235/2004 Sb., o dani z přidané hodnoty.
        </Text>

        <DocFooter />
      </Page>
    </Document>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.metaLine}>
      <Text style={styles.metaKey}>{k}</Text>
      <Text style={styles.metaVal}>{v}</Text>
    </View>
  );
}
