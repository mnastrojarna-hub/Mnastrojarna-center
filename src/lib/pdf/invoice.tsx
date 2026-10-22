import { Document, View, Text } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";
import { styles, C } from "./theme";
import {
  DocPage, BrandHeader, MetaStrip, Parties, PricedItemsTable, TotalsCard, VatRecap, NoteBox, QrCode, d,
  type Fact,
} from "./components";
import { buildSpdString, spdVariableSymbol } from "./qr";
import { computeTotals, czk, czDate, type InvoiceData } from "./types";

function PayRow({ k, v, strong, w = 76 }: { k: string; v?: string; strong?: boolean; w?: number }) {
  if (!v) return null;
  return (
    <View style={{ flexDirection: "row", paddingVertical: 1.6 }}>
      <Text style={{ width: w, color: C.grey }}>{k}</Text>
      <Text style={{ flex: 1, fontWeight: strong ? "bold" : "normal", color: C.ink }}>{v}</Text>
    </View>
  );
}

/** Platební údaje + QR Platba (jen se skutečným IBANem a v CZK). */
function PaymentBox({ data, total }: { data: InvoiceData; total: number }) {
  const cur = data.currency || "CZK";
  const vs = spdVariableSymbol(data.variableSymbol) ?? data.variableSymbol;
  const spd =
    data.bank?.iban && cur.toUpperCase() === "CZK"
      ? buildSpdString({
          iban: data.bank.iban,
          bic: data.bank.swift,
          amount: total,
          currency: cur,
          variableSymbol: data.variableSymbol,
          dueDate: data.dueDate,
          message: `Faktura ${data.number}`,
        })
      : null;
  return (
    <View
      style={{
        flexDirection: "row",
        marginTop: 14,
        borderWidth: 0.9,
        borderColor: C.line,
        borderRadius: 8,
      }}
      wrap={false}
    >
      <View style={{ width: 3, backgroundColor: C.red, borderRadius: 1.5, marginVertical: 12, marginLeft: 10 }} />
      <View style={{ flex: 1, paddingVertical: 10, paddingLeft: 11, paddingRight: 14 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 6 }}>
          <Text style={[styles.sectionTitle, { marginBottom: 2 }]}>Platební údaje</Text>
          <Text>
            <Text style={{ fontSize: 7.5, color: C.grey }}>K úhradě  </Text>
            <Text style={{ fontSize: 14, fontWeight: "bold", color: C.red }}>{czk(total, cur)}</Text>
          </Text>
        </View>
        <View style={{ flexDirection: "row", borderTopWidth: 0.6, borderColor: C.hair, paddingTop: 5 }}>
          <View style={{ flex: 1.2, paddingRight: 12 }}>
            <PayRow w={56} k="Číslo účtu" v={data.bank?.accountNumber} strong />
            <PayRow w={56} k="Banka" v={data.bank?.bankName} />
            <PayRow w={56} k="IBAN" v={data.bank?.iban} />
            <PayRow w={56} k="BIC / SWIFT" v={data.bank?.swift} />
            {!data.bank?.accountNumber && !data.bank?.iban ? <PayRow k="Způsob úhrady" v={data.paymentMethod} /> : null}
          </View>
          <View style={{ flex: 1 }}>
            <PayRow k="Variabilní symbol" v={vs} strong />
            {data.constantSymbol ? <PayRow k="Konst. symbol" v={data.constantSymbol} /> : null}
            <PayRow k="Splatnost" v={czDate(data.dueDate)} strong />
            {data.bank?.accountNumber || data.bank?.iban ? <PayRow k="Způsob úhrady" v={data.paymentMethod} /> : null}
          </View>
        </View>
      </View>
      {spd ? (
        <View
          style={{
            width: 100,
            alignItems: "center",
            justifyContent: "center",
            borderLeftWidth: 0.9,
            borderColor: C.line,
            paddingVertical: 6,
          }}
        >
          <QrCode text={spd} size={78} />
          <Text style={{ fontSize: 6.8, fontWeight: "bold", color: C.ink, letterSpacing: 0.4 }}>QR Platba</Text>
        </View>
      ) : null}
    </View>
  );
}

export function InvoiceDocument({ data }: { data: InvoiceData }) {
  const cur = data.currency || "CZK";
  const { total } = computeTotals(data.items);
  const refs: Fact[] = [
    { k: "Č. zákazníka", v: data.customerNumber },
    { k: "Č. dodavatele", v: data.supplierNumberAtCustomer },
    { k: "Kontakt", v: data.customerContact },
  ];

  return (
    <Document title={`Faktura ${data.number}`} author={COMPANY.name} subject="Faktura — daňový doklad">
      <DocPage label={`Faktura ${data.number}`}>
        <BrandHeader kicker="Daňový doklad" title="Faktura" number={data.number} />

        <MetaStrip
          items={[
            { label: "Vystaveno", value: d(data.issueDate) },
            { label: "DUZP", value: d(data.taxableDate) },
            { label: "Splatnost", value: d(data.dueDate), accent: true },
            { label: "Var. symbol", value: spdVariableSymbol(data.variableSymbol) ?? data.variableSymbol },
            { label: "Naše zakázka", value: data.jobNumber },
            { label: "Vaše objednávka", value: data.customerOrderNumber },
          ]}
        />

        <Parties
          supplier={data.supplier}
          customer={data.customer}
          customerFacts={refs}
          customerSmall={[data.customerContactEmail]}
          deliveryAddress={data.deliveryAddress}
          deliveryLabel="Místo dodání"
        />

        <PricedItemsTable items={data.items} currency={cur} />

        <View style={styles.summaryRow} wrap={false}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <VatRecap items={data.items} currency={cur} />
          </View>
          <TotalsCard items={data.items} currency={cur} grandLabel="K úhradě" />
        </View>

        <PaymentBox data={data} total={total} />

        {data.note ? <NoteBox>{data.note}</NoteBox> : null}

        <View wrap={false}>
          <Text style={styles.legal}>
            Daňový doklad vystavený dle zákona č. 235/2004 Sb., o dani z přidané hodnoty. Evidenční číslo dokladu{" "}
            {data.number}.
            {data.customerOrderNumber
              ? ` Plnění dle Vaší objednávky č. ${data.customerOrderNumber}${data.customerOrderDate ? ` ze dne ${czDate(data.customerOrderDate)}` : ""}.`
              : ""}
            {data.deliveryNoteNumber ? ` Dodáno dodacím listem č. ${data.deliveryNoteNumber}.` : ""}
          </Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 8 }}>
            <Text style={{ fontSize: 9, lineHeight: 1.3, color: C.ink }}>Děkujeme za Vaši objednávku a těšíme se na další spolupráci.</Text>
            {data.preparedBy ? (
              <Text style={{ fontSize: 7.4, lineHeight: 1.3, color: C.muted }}>
                Vystavil: <Text style={{ color: C.ink, fontWeight: "bold" }}>{data.preparedBy}</Text>
                {data.contactEmail ? `  ·  ${data.contactEmail}` : ""}
              </Text>
            ) : null}
          </View>
        </View>
      </DocPage>
    </Document>
  );
}
