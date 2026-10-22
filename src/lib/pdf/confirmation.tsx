import { Document, View, Text } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";
import { styles, C } from "./theme";
import {
  DocPage, BrandHeader, MetaStrip, Parties, PricedItemsTable, TotalsCard, Terms, NoteBox, People, StampBox, d,
} from "./components";
import { czDate, czWeekday, type ConfirmationData } from "./types";

function defaultIntro(data: ConfirmationData): string {
  const po = data.customerOrderNumber ? ` č. ${data.customerOrderNumber}` : "";
  const date = data.customerOrderDate ? ` ze dne ${czDate(data.customerOrderDate)}` : "";
  return `děkujeme za Vaši objednávku${po}${date}. Potvrzujeme její přijetí a závazně potvrzujeme níže uvedené položky, ceny a termín dodání.`;
}

/** Velký odznak s potvrzeným termínem dodání. */
function DateBadge({ date }: { date?: string }) {
  return (
    <View
      style={{
        width: 168,
        backgroundColor: C.redTint,
        borderWidth: 0.9,
        borderColor: C.redLine,
        borderRadius: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        alignItems: "center",
      }}
    >
      <Text style={[styles.metaLabel, { color: C.red, fontWeight: "bold", marginBottom: 4 }]}>Potvrzený termín dodání</Text>
      {date ? (
        <>
          <Text style={{ fontSize: 22, fontWeight: "bold", color: C.red, lineHeight: 1.1 }}>{czDate(date)}</Text>
          <Text style={{ fontSize: 8, color: C.grey, marginTop: 2 }}>{czWeekday(date)}</Text>
        </>
      ) : (
        <Text style={{ fontSize: 12, fontWeight: "bold", color: C.red, marginTop: 2 }}>upřesníme obratem</Text>
      )}
    </View>
  );
}

export function ConfirmationDocument({ data }: { data: ConfirmationData }) {
  const cur = data.currency || "CZK";
  const intro = data.intro === undefined ? `Dobrý den, ${defaultIntro(data)}` : data.intro;

  return (
    <Document title={`Potvrzení objednávky ${data.number}`} author={COMPANY.name} subject="Potvrzení objednávky">
      <DocPage label={`Potvrzení objednávky ${data.number}`}>
        <BrandHeader title="Potvrzení objednávky" number={data.number} />

        <MetaStrip
          items={[
            { label: "Vystaveno", value: d(data.issueDate) },
            { label: "Vaše objednávka", value: data.customerOrderNumber },
            { label: "Ze dne", value: d(data.customerOrderDate) },
            { label: "Naše zakázka", value: data.jobNumber },
            { label: "Dle nabídky", value: data.quoteNumber },
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
        />

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 20 }} wrap={false}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Text style={[styles.subject, { marginTop: 0 }]}>Vaši objednávku jsme přijali</Text>
            {intro ? <Text style={styles.intro}>{intro}</Text> : null}
          </View>
          <DateBadge date={data.confirmedDeliveryDate} />
        </View>

        <PricedItemsTable items={data.items} currency={cur} />

        <View style={styles.summaryRow} wrap={false}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Terms
              title="Dohodnuté podmínky"
              rows={[
                { k: "Dodací lhůta", v: data.confirmedDeliveryDate ? undefined : data.leadTimeText },
                { k: "Platební podmínky", v: data.paymentTerms },
                { k: "Dodací podmínky", v: data.deliveryTerms },
              ]}
            />
          </View>
          <TotalsCard items={data.items} currency={cur} />
        </View>

        {data.note ? <NoteBox title="Poznámka">{data.note}</NoteBox> : null}

        <View style={styles.signRow} wrap={false}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Text style={[styles.closing, { marginTop: 0 }]}>
              Děkujeme za Vaši důvěru. Případné změny nám prosím oznamte co nejdříve.
            </Text>
            <People
              people={[
                {
                  title: "Vyřizuje",
                  name: data.preparedBy ?? data.contactPerson,
                  sub: [data.contactEmail, data.contactPhone].filter(Boolean).join("  ·  "),
                },
                { title: "Schválil", name: data.approvedBy },
              ]}
            />
          </View>
          <View style={{ width: 168 }}>
            <Text style={styles.signTitle}>Za dodavatele</Text>
            <StampBox />
          </View>
        </View>
      </DocPage>
    </Document>
  );
}
