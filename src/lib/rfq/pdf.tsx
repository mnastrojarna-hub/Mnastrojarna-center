import "server-only";
import { createElement, type ReactElement } from "react";
import { Document, View, Text, renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";
import { ensureFonts, styles, C } from "@/lib/pdf/theme";
import { BrandHeader, DocPage, MetaStrip, PartyBlock, d, fitFontSize } from "@/lib/pdf/components";
import { czDate, czNumber, czWeekday, type PartyInfo } from "@/lib/pdf/types";

/**
 * PDF „Poptávka" (PD-2026-004) — naše poptávka dodavateli. Jen naše firma (žádný zákazník, žádná jeho čísla
 * ani název zakázky), položky s NAŠÍM číslem položky, číslem výkresu, revizí, materiálem a poptávanými
 * množstvími (varianty), požadovaný termín a „odpověď do". Stejný vzhled jako objednávka dodavateli.
 * Jedno PDF pro všechny dodavatele kola (nikoho nejmenuje — každý ho dostane samostatným e-mailem).
 */

export interface RfqPdfItem {
  ref: string;
  drawingNumber: string | null;
  revision: string | null;
  name: string | null;
  material: string | null;
  unit: string;
  quantities: number[];
}

export interface RfqPdfData {
  number: string;
  issueDate: string;
  buyer: PartyInfo;
  /** „výrobu dílů" / „tepelné zpracování". */
  what: string;
  items: RfqPdfItem[];
  requiredDate: string | null;
  replyBy: string | null;
  note: string | null;
  contactPerson: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  drawingCount: number;
}

const W = { ref: 74, drawing: 92, qty: 92 };

function DateBadge({ label, date }: { label: string; date: string | null }) {
  return (
    <View style={{ width: 150, backgroundColor: C.redTint, borderWidth: 0.9, borderColor: C.redLine, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, alignItems: "center", marginLeft: 8 }}>
      <Text style={[styles.metaLabel, { color: C.red, fontWeight: "bold", marginBottom: 3 }]}>{label}</Text>
      {date ? (
        <>
          <Text style={{ fontSize: 18, fontWeight: "bold", color: C.red, lineHeight: 1.1 }}>{czDate(date)}</Text>
          <Text style={{ fontSize: 8, color: C.grey, marginTop: 2 }}>{czWeekday(date)}</Text>
        </>
      ) : (
        <Text style={{ fontSize: 11, fontWeight: "bold", color: C.red }}>dle dohody</Text>
      )}
    </View>
  );
}

function ItemsTable({ items }: { items: RfqPdfItem[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.th} fixed>
        <Text style={[styles.thText, { width: W.ref }]}>Naše č. pol.</Text>
        <Text style={[styles.thText, { width: W.drawing }]}>Č. výkresu</Text>
        <Text style={[styles.thText, { flex: 1 }]}>Popis</Text>
        <Text style={[styles.thText, styles.cellRight, { width: W.qty }]}>Množství</Text>
      </View>
      {items.map((it, i) => (
        <View key={i} style={i % 2 === 1 ? [styles.tr, styles.trZebra] : styles.tr} wrap={false}>
          <Text style={[styles.cellNum, { width: W.ref, fontSize: fitFontSize(it.ref, W.ref - 4, 8.4) }]}>{it.ref}</Text>
          <View style={{ width: W.drawing, paddingRight: 6 }}>
            <Text style={it.drawingNumber ? [styles.cellDrawing, { fontSize: fitFontSize(it.drawingNumber, W.drawing - 6, 8.8) }] : { color: C.muted }}>{it.drawingNumber || "—"}</Text>
            {it.revision ? <Text style={styles.cellRev}>rev. {it.revision}</Text> : null}
          </View>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.cellDesc}>{it.name || "Díl dle výkresu"}</Text>
            {it.material ? <Text style={styles.cellSub}>Materiál: {it.material}</Text> : null}
          </View>
          <View style={{ width: W.qty, alignItems: "flex-end" }}>
            {it.quantities.map((q, k) => (
              <Text key={k} style={k === 0 ? styles.cellStrong : [styles.cellRight, { fontSize: 8.2 }]}>
                {czNumber(q)} <Text style={styles.cellUnit}>{it.unit}</Text>
              </Text>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function RfqDocument({ data }: { data: RfqPdfData }) {
  const variants = data.items.some((i) => i.quantities.length > 1);
  const email = data.contactEmail ?? data.buyer.email;
  const points = [
    `Prosíme o cenovou nabídku${data.replyBy ? ` do ${czDate(data.replyBy)}` : ""}${email ? ` na ${email}` : ""}: cena za kus${variants ? " pro každé uvedené množství" : ""}, dodací lhůta a platnost nabídky.`,
    `Do nabídky uveďte číslo poptávky ${data.number} a naše čísla položek.`,
    data.drawingCount ? "Výroba dle přiložené výkresové dokumentace v uvedené revizi, odchylky předem konzultujte." : "Výkresovou dokumentaci zašleme na vyžádání.",
  ];
  return (
    <Document title={`Poptávka ${data.number}`} author={COMPANY.name} subject="Poptávka dodavateli">
      <DocPage label={`Poptávka ${data.number}`}>
        <BrandHeader title="Poptávka" number={data.number} kicker="Poptávka dodavateli" />
        <MetaStrip
          items={[
            { label: "Datum poptávky", value: d(data.issueDate) },
            { label: "Odpověď do", value: d(data.replyBy) },
            { label: "Vyřizuje", value: data.contactPerson ?? undefined },
            { label: "Telefon", value: data.contactPhone ?? undefined },
          ]}
        />
        <View style={styles.parties} wrap={false}>
          <PartyBlock label="Poptávající" party={data.buyer} small={[[data.buyer.email, data.buyer.phone, data.buyer.web].filter(Boolean).join("  ·  ")]} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 18 }} wrap={false}>
          <View style={{ flex: 1, paddingRight: 16 }}>
            <Text style={[styles.subject, { marginTop: 0 }]}>Poptáváme u Vás</Text>
            <Text style={styles.intro}>
              {`Dobrý den, poptáváme u Vás ${data.what} níže uvedených položek dle výkresové dokumentace a v uvedených množstvích.`}
            </Text>
          </View>
          <DateBadge label="Požadovaný termín dodání" date={data.requiredDate} />
        </View>
        <ItemsTable items={data.items} />
        {data.note ? (
          <View style={{ marginTop: 12 }} wrap={false}>
            <Text style={styles.sectionTitle}>Poznámka</Text>
            <Text style={{ fontSize: 8.4, lineHeight: 1.45, color: C.ink }}>{data.note}</Text>
          </View>
        ) : null}
        <View style={{ marginTop: 14, borderWidth: 0.9, borderColor: C.redLine, backgroundColor: C.redTint, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 11 }} wrap={false}>
          <Text style={[styles.sectionTitle, { color: C.red, marginBottom: 4 }]}>Pokyny pro dodavatele</Text>
          {points.map((p, i) => (
            <View key={i} style={{ flexDirection: "row", marginTop: i ? 3 : 0 }}>
              <Text style={{ width: 12, fontSize: 8.4, lineHeight: 1.4, fontWeight: "bold", color: C.red }}>{i + 1}.</Text>
              <Text style={{ flex: 1, fontSize: 8.4, lineHeight: 1.4, color: C.ink, fontWeight: i === 0 ? "bold" : "normal" }}>{p}</Text>
            </View>
          ))}
        </View>
      </DocPage>
    </Document>
  );
}

type DocEl = ReactElement<DocumentProps>;

export async function renderRfqPdf(data: RfqPdfData): Promise<Buffer> {
  await ensureFonts(); // await: oprava sdílené mezipaměti glyfů (viz theme.tsx)
  return renderToBuffer(createElement(RfqDocument, { data }) as unknown as DocEl);
}
