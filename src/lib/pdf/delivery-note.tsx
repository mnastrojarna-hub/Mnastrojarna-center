import { Document, Page, View, Text } from "@react-pdf/renderer";
import { styles } from "./theme";
import { BrandHeader, PartyBlock, DocFooter } from "./components";
import { czDate, type DeliveryNoteData } from "./types";

export function DeliveryNoteDocument({ data }: { data: DeliveryNoteData }) {
  return (
    <Document title={`Dodací list ${data.number}`} author="MNástrojárna s.r.o.">
      <Page size="A4" style={styles.page}>
        <BrandHeader title="DODACÍ LIST" number={data.number} />

        <View style={styles.partiesRow}>
          <PartyBlock label="Dodavatel" party={data.supplier} />
          <PartyBlock label="Odběratel" party={data.customer} />
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaBox}>
            <View style={styles.metaLine}><Text style={styles.metaKey}>Datum vystavení</Text><Text style={styles.metaVal}>{czDate(data.issueDate)}</Text></View>
            {data.orderNumber ? (
              <View style={styles.metaLine}><Text style={styles.metaKey}>K objednávce</Text><Text style={styles.metaVal}>{data.orderNumber}</Text></View>
            ) : null}
          </View>
          <View style={styles.metaBox}>
            {data.deliveryAddress ? (
              <>
                <Text style={styles.metaKey}>Místo dodání</Text>
                <Text style={styles.metaVal}>{data.deliveryAddress}</Text>
              </>
            ) : null}
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={styles.cDesc}>Označení dodávky</Text>
            <Text style={styles.cQty}>Množství</Text>
            <Text style={styles.cUnit}>MJ</Text>
          </View>
          {data.items.map((it, i) => (
            <View key={i} style={styles.tr} wrap={false}>
              <Text style={styles.cDesc}>{it.description}</Text>
              <Text style={styles.cQty}>{it.quantity}</Text>
              <Text style={styles.cUnit}>{it.unit}</Text>
            </View>
          ))}
        </View>

        {data.note ? <Text style={styles.note}>{data.note}</Text> : null}

        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 48 }}>
          <View style={{ width: 200, borderTopWidth: 1, borderColor: "#999", paddingTop: 4 }}>
            <Text style={styles.metaKey}>Vystavil (dodavatel)</Text>
          </View>
          <View style={{ width: 200, borderTopWidth: 1, borderColor: "#999", paddingTop: 4 }}>
            <Text style={styles.metaKey}>Převzal (odběratel)</Text>
          </View>
        </View>

        <DocFooter />
      </Page>
    </Document>
  );
}
