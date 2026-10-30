import { Document, View, Text } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";
import { styles, C } from "./theme";
import {
  DocPage, BrandHeader, MetaStrip, Parties, DeliveryItemsTable, NoteBox, SignatureLine, d,
} from "./components";
import { czNumber, plural, type DeliveryNoteData } from "./types";

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ marginRight: 22 }}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue}>{value}</Text>
    </View>
  );
}

export function DeliveryNoteDocument({ data }: { data: DeliveryNoteData }) {
  const count = data.items.length;
  // Součet kusů jen když mají všechny položky stejnou jednotku
  const units = [...new Set(data.items.map((i) => i.unit))];
  const sumQty = units.length === 1 ? data.items.reduce((s, i) => s + i.quantity, 0) : null;

  return (
    <Document title={`Dodací list ${data.number}`} author={COMPANY.name} subject="Dodací list">
      <DocPage label={`Dodací list ${data.number}`}>
        <BrandHeader title="Dodací list" number={data.number} />

        <MetaStrip
          items={[
            { label: "Vystaveno", value: d(data.issueDate) },
            { label: "Dodávka", value: data.deliveryLabel, accent: true },
            { label: "Naše zakázka", value: data.jobNumber },
            { label: "Vaše objednávka", value: data.customerOrderNumber },
            { label: "K objednávce", value: data.customerOrderNumber ? undefined : data.orderNumber },
            { label: "Doprava", value: data.transport },
            { label: "Vyřizuje", value: data.contactPerson },
          ]}
        />

        <Parties
          supplier={data.supplier}
          customer={data.customer}
          customerFacts={[
            { k: "Č. zákazníka", v: data.customerNumber },
            { k: "Č. dodavatele", v: data.supplierNumberAtCustomer },
            { k: "Kontakt", v: data.customerContact },
          ]}
          customerSmall={[data.customerContactEmail]}
          deliveryAddress={data.deliveryAddress}
          deliveryLabel="Místo dodání"
        />

        <DeliveryItemsTable items={data.items} />

        <View
          style={{
            flexDirection: "row",
            marginTop: 12,
            paddingVertical: 8,
            paddingHorizontal: 12,
            backgroundColor: C.tint,
            borderRadius: 6,
          }}
          wrap={false}
        >
          <SummaryPill label="Počet položek" value={`${count} ${plural(count, "položka", "položky", "položek")}`} />
          {sumQty !== null ? <SummaryPill label="Celkem" value={`${czNumber(sumQty)} ${units[0]}`} /> : null}
          {data.packages ? (
            <SummaryPill
              label="Balení"
              value={`${czNumber(data.packages)} ${plural(data.packages, "balík", "balíky", "balíků")}`}
            />
          ) : null}
          {data.weightKg ? <SummaryPill label="Hmotnost" value={`${czNumber(data.weightKg)} kg`} /> : null}
          {data.remainingText ? <SummaryPill label="Zbývá dodat" value={data.remainingText} /> : null}
        </View>

        {data.note ? <NoteBox title="Poznámka">{data.note}</NoteBox> : null}

        <View wrap={false}>
          <Text style={[styles.legal, { marginTop: 16 }]}>
            Zboží prosím zkontrolujte při převzetí. Případné vady nebo nesoulad v množství uveďte na tomto dodacím listu a
            neprodleně nám je oznamte.
          </Text>
          <View style={styles.signRow}>
            <SignatureLine title="Předal (dodavatel)" name={data.preparedBy} caption="Datum, jméno a podpis" />
            <View style={{ width: 28 }} />
            <SignatureLine title="Převzal (odběratel)" caption="Datum, jméno, podpis a razítko" />
          </View>
        </View>
      </DocPage>
    </Document>
  );
}
