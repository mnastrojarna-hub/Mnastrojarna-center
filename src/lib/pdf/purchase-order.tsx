import { Document, View, Text } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";
import { styles, C } from "./theme";
import {
  DocPage, BrandHeader, MetaStrip, PartyBlock, TotalsCard, Terms, addressLines, d,
} from "./components";
import { czDate, czk, czNumber, czWeekday, countryName, isPlaceholder, lineTotal, plural, type DocItem } from "./types";
import type { PurchaseOrderData } from "./purchase-types";
import { splitItemNote } from "@/lib/jobs/purchasing";

/**
 * PDF „Objednávka" — naše objednávka vydaná dodavateli. Stejný vzhled jako
 * nabídka / potvrzení (hlavička, pruh údajů, strany, položky, součty).
 * Strany jsou obráceně: Odběratel = my, Dodavatel = kooperant.
 */

function defaultIntro(data: PurchaseOrderData): string {
  const quote = data.supplierQuoteNumber
    ? `na základě Vaší nabídky č. ${data.supplierQuoteNumber}${data.supplierQuoteDate ? ` ze dne ${czDate(data.supplierQuoteDate)}` : ""} `
    : "";
  return `Dobrý den, ${quote}u Vás závazně objednáváme níže uvedené položky. Prosíme o jejich výrobu a dodání v požadovaném termínu a v kvalitě dle výkresové dokumentace.`;
}

function confirmDaysText(days: number): string {
  return `${days} ${plural(days, "pracovního dne", "pracovních dnů", "pracovních dnů")}`;
}

/** Velký odznak s požadovaným termínem dodání. */
function DateBadge({ date, confirmed }: { date?: string; confirmed?: string }) {
  const shown = confirmed ?? date;
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
      <Text style={[styles.metaLabel, { color: C.red, fontWeight: "bold", marginBottom: 4 }]}>
        {confirmed ? "Potvrzený termín dodání" : "Požadovaný termín dodání"}
      </Text>
      {shown ? (
        <>
          <Text style={{ fontSize: 22, fontWeight: "bold", color: C.red, lineHeight: 1.1 }}>{czDate(shown)}</Text>
          <Text style={{ fontSize: 8, color: C.grey, marginTop: 2 }}>{czWeekday(shown)}</Text>
        </>
      ) : (
        <Text style={{ fontSize: 12, fontWeight: "bold", color: C.red, marginTop: 2 }}>dle dohody</Text>
      )}
    </View>
  );
}

// ── Strany: Odběratel (my) | Dodavatel | Dodací adresa ──────
function PartyLabel({ children }: { children: string }) {
  return (
    <View style={styles.partyLabelRow}>
      <View style={styles.partyDot} />
      <Text style={styles.partyLabel}>{children}</Text>
    </View>
  );
}

function PurchaseParties({ data }: { data: PurchaseOrderData }) {
  const foreign = Boolean(data.supplier.country) && countryName(data.supplier.country) !== "Česká republika";
  const buyer = data.buyer;
  const buyerContact = [buyer.email, buyer.phone, buyer.web].filter(Boolean).join("  ·  ");
  const registration = isPlaceholder(buyer.registration) ? undefined : buyer.registration;
  const delivery = data.deliveryAddress ? addressLines(data.deliveryAddress) : [];
  return (
    <View style={styles.parties} wrap={false}>
      <PartyBlock label="Odběratel" party={buyer} showCountry={foreign} small={[buyerContact, registration]} />
      <View style={{ width: 20 }} />
      <PartyBlock
        label="Dodavatel"
        party={data.supplier}
        showCountry={foreign}
        facts={[{ k: "Kontakt", v: data.supplierContact }]}
        small={[[data.supplier.email, data.supplier.phone].filter(Boolean).join("  ·  ")]}
      />
      {delivery.length ? (
        <>
          <View style={{ width: 20 }} />
          <View style={[styles.party, { flex: 0.8 }]}>
            <PartyLabel>Dodací adresa</PartyLabel>
            <Text style={styles.partyName}>{delivery[0]}</Text>
            {delivery.slice(1).map((l, i) => (
              <Text key={i} style={styles.partyLine}>{l}</Text>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

// ── Položky (bez sloupce DPH — nákup se objednává bez DPH) ──
const W = { num: 18, drawing: 78, qty: 58, price: 70, total: 82 };

function PurchaseItemsTable({ items, currency }: { items: DocItem[]; currency: string }) {
  const hasDrawing = items.some((i) => i.drawingNumber);
  return (
    <View style={styles.table}>
      <View style={styles.th} fixed>
        <Text style={[styles.thText, { width: W.num }]}>#</Text>
        {hasDrawing ? <Text style={[styles.thText, { width: W.drawing }]}>Č. výkresu</Text> : null}
        <Text style={[styles.thText, { flex: 1 }]}>Popis</Text>
        <Text style={[styles.thText, styles.cellRight, { width: W.qty }]}>Množství</Text>
        <Text style={[styles.thText, styles.cellRight, { width: W.price }]}>Cena / MJ</Text>
        <Text style={[styles.thText, styles.cellRight, { width: W.total }]}>Celkem bez DPH</Text>
      </View>
      {items.map((it, i) => (
        <View key={i} style={i % 2 === 1 ? [styles.tr, styles.trZebra] : styles.tr} wrap={false}>
          <Text style={[styles.cellNum, { width: W.num }]}>{i + 1}</Text>
          {hasDrawing ? (
            <View style={{ width: W.drawing, paddingRight: 6 }}>
              <Text style={it.drawingNumber ? styles.cellDrawing : { color: C.muted }}>{it.drawingNumber || "—"}</Text>
              {it.revision ? <Text style={styles.cellRev}>rev. {it.revision}</Text> : null}
            </View>
          ) : null}
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.cellDesc}>{it.description}</Text>
            {it.material ? <Text style={styles.cellSub}>Materiál: {it.material}</Text> : null}
            {(() => {
              // poznámka pro dodavatele (Technologie → „Pozor: popsat na čele") zvýrazněná, zbytek poznámky pod ní
              const n = splitItemNote(it.note);
              return (
                <>
                  {n.warning ? <Text style={{ fontSize: 8.2, lineHeight: 1.35, fontWeight: "bold", color: C.red, marginTop: 1.5 }}>Pozor: {n.warning}</Text> : null}
                  {n.rest ? <Text style={styles.cellNote}>{n.rest}</Text> : null}
                </>
              );
            })()}
          </View>
          <Text style={[styles.cellRight, { width: W.qty }]}>
            {czNumber(it.quantity)} <Text style={styles.cellUnit}>{it.unit}</Text>
          </Text>
          <Text style={[styles.cellRight, { width: W.price }]}>{it.unpriced ? "—" : czk(it.unitPrice, currency)}</Text>
          <Text style={[styles.cellStrong, { width: W.total }]}>{it.unpriced ? "—" : czk(lineTotal(it), currency)}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Pokyny pro dodavatele + podpisy ─────────────────────────
function Instructions({ data, hasDrawing }: { data: PurchaseOrderData; hasDrawing: boolean }) {
  const days = data.confirmWithinDays ?? 2;
  const email = data.contactEmail ?? data.buyer.email;
  const points = [
    `Prosíme o potvrzení objednávky a termínu dodání do ${confirmDaysText(days)}${email ? ` na ${email}` : ""}.`,
    `Číslo objednávky ${data.number} uvádějte na dodacím listu i faktuře.`,
    data.workInstruction !== undefined
      ? data.workInstruction || null
      : hasDrawing ? "Vyrábějte dle výkresové dokumentace v uvedené revizi, odchylky předem konzultujte." : null,
  ].filter((p): p is string => Boolean(p));
  return (
    <View
      style={{
        flex: 1,
        borderWidth: 0.9,
        borderColor: C.redLine,
        backgroundColor: C.redTint,
        borderRadius: 6,
        paddingVertical: 8,
        paddingHorizontal: 11,
      }}
    >
      <Text style={[styles.sectionTitle, { color: C.red, marginBottom: 4 }]}>Pokyny pro dodavatele</Text>
      {points.map((p, i) => (
        <View key={i} style={{ flexDirection: "row", marginTop: i ? 3 : 0 }}>
          <Text style={{ width: 12, fontSize: 8.4, lineHeight: 1.4, fontWeight: "bold", color: C.red }}>{i + 1}.</Text>
          <Text style={{ flex: 1, fontSize: 8.4, lineHeight: 1.4, color: C.ink, fontWeight: i === 0 ? "bold" : "normal" }}>
            {p}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Rámeček pro razítko a podpis s popiskem nad a pod ním (volitelně řádek k vyplnění). */
function SignBox({
  title, label, caption, sub, fill,
}: { title: string; label: string; caption?: string; sub?: string; fill?: string }) {
  return (
    <View style={{ width: 122, marginLeft: 10 }}>
      <Text style={styles.signTitle}>{title}</Text>
      <View style={[styles.stampBox, { height: 62 }]}>
        <Text style={styles.stampText}>{label}</Text>
      </View>
      {caption ? <Text style={[styles.signName, { fontSize: 8.4, marginTop: 4 }]}>{caption}</Text> : null}
      {sub ? <Text style={[styles.signCaption, { marginTop: 1 }]}>{sub}</Text> : null}
      {fill ? (
        <View style={{ flexDirection: "row", alignItems: "flex-end", marginTop: 6 }}>
          <Text style={[styles.signCaption, { marginTop: 0 }]}>{fill}</Text>
          <View style={{ flex: 1, height: 8, marginLeft: 4, borderBottomWidth: 0.7, borderColor: C.muted }} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Cena u závazné objednávky bez cen: žádné „Celkem 0,00 Kč" — místo součtu „dle Vaší nabídky / prosíme
 * o nacenění"; u části položek bez ceny je součet jen z naceněných (s upozorněním).
 */
function UnpricedCard({ data }: { data: PurchaseOrderData }) {
  return (
    <View style={[styles.totalsCard, { justifyContent: "center" }]} wrap={false}>
      <Text style={styles.totalGrandLabel}>Cena</Text>
      <Text style={{ fontSize: 10, fontWeight: "bold", color: C.ink, marginTop: 4, lineHeight: 1.35 }}>
        {data.supplierQuoteNumber ? `dle Vaší nabídky č. ${data.supplierQuoteNumber}` : "k nacenění dodavatelem"}
      </Text>
      <Text style={[styles.totalHint, { marginTop: 4 }]}>Prosíme o nacenění v potvrzení objednávky.</Text>
    </View>
  );
}

export function unpricedSummary(items: DocItem[]): { all: boolean; count: number } {
  const count = items.filter((i) => i.unpriced).length;
  return { all: items.length > 0 && count === items.length, count };
}

export function PurchaseOrderDocument({ data }: { data: PurchaseOrderData }) {
  const cur = data.currency || "CZK";
  const intro = data.intro === undefined ? defaultIntro(data) : data.intro;
  const hasDrawing = data.items.some((i) => i.drawingNumber);
  const unpriced = unpricedSummary(data.items);
  const partHint = unpriced.count && !unpriced.all
    ? `Součet bez ${unpriced.count} ${plural(unpriced.count, "položky", "položek", "položek")} bez ceny — prosíme o jejich nacenění v potvrzení.`
    : undefined;
  const totalsHint = [partHint, data.totalsHint].filter(Boolean).join(" · ") || undefined;
  const change = data.revision && data.revision > 1
    ? `Změna č. ${data.revision}${data.revisionDate ? ` · ze dne ${czDate(data.revisionDate)}` : ""}`
    : null;

  return (
    <Document title={`Objednávka ${data.number}${change ? ` (${change})` : ""}`} author={COMPANY.name} subject="Objednávka dodavateli">
      <DocPage label={`Objednávka ${data.number}${change ? ` · změna ${data.revision}` : ""}`}>
        <BrandHeader title="Objednávka" number={data.number} kicker={change ?? "Objednávka dodavateli"} />

        <MetaStrip
          items={[
            { label: "Datum objednávky", value: d(data.issueDate) },
            { label: "Naše zakázka", value: data.jobNumber },
            { label: "Vaše nabídka", value: data.supplierQuoteNumber },
            { label: "Ze dne", value: data.supplierQuoteNumber ? d(data.supplierQuoteDate) : undefined },
            { label: "Vaše potvrzení", value: data.supplierReference },
            { label: "Vyřizuje", value: data.contactPerson },
          ]}
        />

        <PurchaseParties data={data} />

        <View style={{ flexDirection: "row", alignItems: "center", marginTop: 20 }} wrap={false}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Text style={[styles.subject, { marginTop: 0 }]}>Objednáváme u Vás</Text>
            {intro ? <Text style={styles.intro}>{intro}</Text> : null}
          </View>
          <DateBadge date={data.requiredDate} confirmed={data.confirmedDate} />
        </View>

        <PurchaseItemsTable items={data.items} currency={cur} />

        <View style={styles.summaryRow} wrap={false}>
          <View style={{ flex: 1, paddingRight: 24 }}>
            <Terms
              title="Dodací a platební podmínky"
              rows={[
                { k: "Dodací podmínky", v: data.deliveryTerms },
                { k: "Platební podmínky", v: data.paymentTerms },
                { k: "Měna", v: cur !== "CZK" ? cur : undefined },
              ]}
            />
            {data.note ? (
              <View style={{ marginTop: 10 }}>
                <Text style={styles.sectionTitle}>Poznámka</Text>
                <Text style={{ fontSize: 8.4, lineHeight: 1.45, color: C.ink }}>{data.note}</Text>
              </View>
            ) : null}
          </View>
          {unpriced.all ? <UnpricedCard data={data} /> : <TotalsCard items={data.items} currency={cur} hint={totalsHint} />}
        </View>

        <View style={{ flexDirection: "row", alignItems: "flex-start", marginTop: 16 }} wrap={false}>
          <Instructions data={data} hasDrawing={hasDrawing} />
          <SignBox
            title="Za odběratele"
            label="Razítko a podpis"
            caption={data.contactPerson ? `Vystavil: ${data.contactPerson}` : undefined}
            sub={data.contactPhone ? `tel. ${data.contactPhone}` : undefined}
          />
          <SignBox title="Potvrzení dodavatele" label="Datum, razítko a podpis" fill="Potvrzený termín:" />
        </View>
      </DocPage>
    </Document>
  );
}
