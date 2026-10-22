import { Document, View, Text } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";
import { styles } from "./theme";
import {
  DocPage, BrandHeader, MetaStrip, Parties, PricedItemsTable, TotalsCard, Terms, NoteBox, People, d,
} from "./components";
import { czDate, type QuoteData } from "./types";

const DEFAULT_INTRO = "děkujeme za Vaši poptávku. Na základě zaslaných podkladů Vám rádi nabízíme:";
const DEFAULT_CLOSING = "Při objednání prosím uveďte číslo nabídky. Těšíme se na spolupráci!";

export function QuoteDocument({ data }: { data: QuoteData }) {
  const cur = data.currency || "CZK";
  const intro = data.intro === undefined ? `Dobrý den, ${DEFAULT_INTRO}` : data.intro;
  const closing = data.closing === undefined ? DEFAULT_CLOSING : data.closing;
  const delivery = data.deliveryDate ? czDate(data.deliveryDate) : data.leadTimeText;

  return (
    <Document title={`Nabídka ${data.number}`} author={COMPANY.name} subject={data.subject ?? "Cenová nabídka"}>
      <DocPage label={`Nabídka ${data.number}`}>
        <BrandHeader title="Cenová nabídka" number={data.number} />

        <MetaStrip
          items={[
            { label: "Vystaveno", value: d(data.issueDate) },
            { label: "Platnost do", value: d(data.validUntil), accent: true },
            { label: "Naše zakázka", value: data.jobNumber },
            { label: "Vaše poptávka", value: data.customerInquiryNumber },
            { label: "Verze", value: data.revision && data.revision > 1 ? String(data.revision) : undefined },
            { label: "Vyřizuje", value: data.contactPerson },
          ]}
        />

        <Parties
          supplier={data.supplier}
          customer={data.customer}
          customerLabel="Zákazník"
          customerFacts={[
            { k: "Č. zákazníka", v: data.customerNumber },
            { k: "Č. dodavatele", v: data.supplierNumberAtCustomer },
            { k: "Kontakt", v: data.customerContact },
          ]}
          customerSmall={[data.customerContactEmail]}
          deliveryAddress={data.deliveryAddress}
        />

        {data.subject ? <Text style={styles.subject}>{data.subject}</Text> : null}
        {intro ? <Text style={data.subject ? styles.intro : [styles.intro, { marginTop: 18 }]}>{intro}</Text> : null}

        <PricedItemsTable items={data.items} currency={cur} />

        <View style={styles.summaryRow} wrap={false}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Terms
              title="Podmínky nabídky"
              rows={[
                { k: "Termín dodání", v: delivery },
                { k: "Platnost nabídky", v: data.validUntil ? `do ${czDate(data.validUntil)}` : undefined },
                { k: "Platební podmínky", v: data.paymentTerms },
                { k: "Dodací podmínky", v: data.deliveryTerms },
              ]}
            />
          </View>
          <TotalsCard items={data.items} currency={cur} />
        </View>

        {data.note ? <NoteBox title="Poznámka">{data.note}</NoteBox> : null}

        <View wrap={false}>
          {closing ? <Text style={styles.closing}>{closing}</Text> : null}
          <People
            people={[
              { title: "Vypracoval", name: data.preparedBy, sub: [data.contactEmail, data.contactPhone].filter(Boolean).join("  ·  ") },
              { title: "Schválil", name: data.approvedBy },
            ]}
          />
        </View>
      </DocPage>
    </Document>
  );
}
