import type { ReactNode } from "react";
import { Page, View, Text, Svg, Rect, Line, Path, G, Defs, ClipPath, Polygon } from "@react-pdf/renderer";
import { COMPANY } from "@/lib/company";
import { styles, C, PAGE } from "./theme";
import { qrMatrix, qrRuns } from "./qr";
import {
  computeTotals, czk, czNumber, czDate, countryName, isPlaceholder, lineTotal,
  type PartyInfo, type DocItem, type DeliveryItem,
} from "./types";

// ── Logo ────────────────────────────────────────────────────

// Geometrie dle logomanuálu (štít frézy se 3 šikmými drážkami + odlétající třísky), viewBox 720×665.
const LOGO_W = 720;
const LOGO_H = 665;
const SHIELD =
  "M351 19 Q351 7 363 7 L702 7 Q714 7 714 19 L714 474 Q714 490 702 502 L524 659 L364 575 Q351 568 351 558 Z";
const GROOVES: [number, number, number, number][] = [
  [334, 236.6, 734, 58.1],
  [334, 391.6, 734, 213.1],
  [334, 541.6, 734, 365.1],
];
const CHIPS = [
  "84,399 134,392 124,455",
  "6,515 44,477 136,589",
  "249,550 296,527 329,605",
  "102,621 276,625 103,661",
  "359,634 426,659 354,659",
];

/**
 * Symbol frézy dle logomanuálu — štít v korporátní červené se šikmými drážkami
 * a odlétajícími třískami vlevo dole. `size` = výška v pt.
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <Svg width={(size * LOGO_W) / LOGO_H} height={size} viewBox={`0 0 ${LOGO_W} ${LOGO_H}`}>
      <Defs>
        <ClipPath id="mn-shield-pdf">
          <Path d={SHIELD} />
        </ClipPath>
      </Defs>
      <G clipPath="url(#mn-shield-pdf)">
        <Rect x={340} y={0} width={380} height={665} fill={C.red} />
        {GROOVES.map(([x1, y1, x2, y2], i) => (
          <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.white} strokeWidth={50} />
        ))}
      </G>
      {CHIPS.map((points, i) => (
        <Polygon key={i} points={points} fill={C.red} />
      ))}
    </Svg>
  );
}

/** Wordmark bez právní formy („Mnástrojárna"). */
export function brandWordmark(): string {
  const base = COMPANY.name.replace(/\s*,?\s*s\.\s*r\.\s*o\.?\s*$/i, "").trim();
  return base.toLowerCase() === "mnástrojárna" ? "Mnástrojárna" : base || "Mnástrojárna";
}

/** Hlavička dokladu: logo + wordmark vlevo, druh dokladu a číslo vpravo, červená linka. */
export function BrandHeader({
  title,
  number,
  kicker,
  numberLabel = "č.",
}: {
  title: string;
  number: string;
  kicker?: string;
  numberLabel?: string;
}) {
  return (
    <View>
      <View style={styles.headerRow}>
        <View style={styles.brandRow}>
          <LogoMark size={34} />
          <View style={{ marginLeft: 8 }}>
            <Text>
              <Text style={styles.brandName}>{brandWordmark()}</Text>
              <Text style={styles.brandSuffix}> s.r.o.</Text>
            </Text>
            <Text style={styles.brandSlogan}>{COMPANY.slogan}</Text>
          </View>
        </View>
        <View style={{ maxWidth: 250 }}>
          {kicker ? <Text style={styles.docKicker}>{kicker}</Text> : null}
          <Text style={styles.docTitle}>{title}</Text>
          <Text style={styles.docNumber}>
            {numberLabel} <Text style={styles.docNumberStrong}>{number}</Text>
          </Text>
        </View>
      </View>
      <View style={styles.ruleRow}>
        <View style={styles.ruleAccent} />
        <View style={styles.ruleLine} />
      </View>
    </View>
  );
}

/**
 * Stránka A4 dokladu: obsah + zkrácená hlavička od 2. strany + patička se stránkováním.
 * S `watermark` (#25 neschválená nabídka) šikmý vodoznak přes každou stranu a červený pruh na 1. straně.
 */
export function DocPage({ label, watermark, banner, children }: { label: string; watermark?: string; banner?: string; children: ReactNode }) {
  return (
    <Page size="A4" style={styles.page}>
      <RunningHeader label={label} />
      {watermark && banner ? (
        <View style={{ backgroundColor: C.red, borderRadius: 3, paddingVertical: 5, paddingHorizontal: 9, marginBottom: 8 }}>
          <Text style={{ color: "#FFFFFF", fontSize: 9.5, fontWeight: 700 }}>{banner}</Text>
        </View>
      ) : null}
      <View style={styles.body}>{children}</View>
      <DocFooter />
      {watermark ? <Watermark text={watermark} /> : null}
    </Page>
  );
}

/** Šikmý vodoznak přes celou stranu (fixed = na každé straně). */
export function Watermark({ text }: { text: string }) {
  return (
    <View fixed style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
      <Text
        style={{
          // A4 = 595 pt na šířku: 24 znaků po 40 pt otočených o −30° se vejde i s okraji (54 pt ořízlo krajní písmena)
          fontFamily: "Roboto", fontWeight: 700, fontSize: 40, color: C.red, opacity: 0.14,
          transform: "rotate(-30deg)", textAlign: "center", width: 595,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/** Zkrácená hlavička na 2. a další stránce. */
export function RunningHeader({ label }: { label: string }) {
  return (
    <View style={styles.runningHeader} fixed>
      <Text render={({ pageNumber }) => (pageNumber > 1 ? COMPANY.name : "")} />
      <Text render={({ pageNumber }) => (pageNumber > 1 ? label : "")} />
    </View>
  );
}

// ── Pruh s klíčovými údaji ──────────────────────────────────

export interface MetaItem {
  label: string;
  value?: string | null;
  /** Zvýraznit červeně (splatnost, termín). */
  accent?: boolean;
}

/** Šířka obsahu A4 mezi okraji (pt). */
const CONTENT_W = 595 - 2 * PAGE.side;

/**
 * Písmo, aby se kód bez mezer (číslo výkresu, zakázky, objednávky) vešel na JEDEN řádek sloupce —
 * dlouhý kód se dřív přelil do vedlejšího sloupce / usekl první znaky („VYK-…" → „YK-…"). Odhad šířky
 * tučného Roboto 0,66 em na znak (velká písmena, číslice, pomlčky) s rezervou. Pod `min` se už
 * nezmenšuje (extrémně dlouhý kód pak zalomí splitLongWord).
 */
export function fitFontSize(text: string | null | undefined, width: number, base: number, min = 5.4): number {
  const t = String(text ?? "").trim();
  if (!t || /\s/.test(t)) return base;
  const len = [...t].length;
  if (len * 0.66 * base <= width) return base;
  return Math.max(min, Math.floor((width / (len * 0.66)) * 10) / 10);
}

export function MetaStrip({ items }: { items: MetaItem[] }) {
  const shown = items.filter((i) => i.value && String(i.value).trim());
  if (!shown.length) return null;
  const cols = shown.length <= 6 ? shown.length : Math.ceil(shown.length / 2);
  const width = `${100 / cols}%`;
  // obsah buňky: šířka pruhu bez vnitřního okraje pruhu a buňky
  const cellW = (CONTENT_W - 16) / cols - 12;
  return (
    <View style={styles.meta} wrap={false}>
      {shown.map((m, i) => {
        const size = fitFontSize(m.value, cellW, 9.2);
        return (
          <View key={i} style={[styles.metaCell, { width }]}>
            <Text style={styles.metaLabel}>{m.label}</Text>
            <Text style={[styles.metaValue, ...(size !== 9.2 ? [{ fontSize: size }] : []), ...(m.accent ? [{ color: C.red }] : [])]}>{m.value}</Text>
          </View>
        );
      })}
    </View>
  );
}

// ── Strany dokladu ──────────────────────────────────────────

export interface Fact {
  k: string;
  v?: string | null;
}

function Facts({ facts }: { facts: Fact[] }) {
  const shown = facts.filter((f) => f.v && String(f.v).trim());
  if (!shown.length) return null;
  return (
    <View style={styles.partyFacts}>
      {shown.map((f, i) => (
        <View key={i} style={styles.factRow}>
          <Text style={styles.factKey}>{f.k}</Text>
          <Text style={styles.factVal}>{f.v}</Text>
        </View>
      ))}
    </View>
  );
}

function PartyLabel({ children }: { children: string }) {
  return (
    <View style={styles.partyLabelRow}>
      <View style={styles.partyDot} />
      <Text style={styles.partyLabel}>{children}</Text>
    </View>
  );
}

export function PartyBlock({
  label,
  party,
  facts = [],
  small = [],
  showCountry = false,
}: {
  label: string;
  party: PartyInfo;
  facts?: Fact[];
  small?: (string | undefined | null)[];
  showCountry?: boolean;
}) {
  const cityLine = [party.zip, party.city].filter(Boolean).join(" ");
  const smallLines = small.filter((s): s is string => Boolean(s && s.trim()));
  return (
    <View style={styles.party}>
      <PartyLabel>{label}</PartyLabel>
      <Text style={styles.partyName}>{party.name}</Text>
      {party.street ? <Text style={styles.partyLine}>{party.street}</Text> : null}
      {cityLine ? <Text style={styles.partyLine}>{cityLine}</Text> : null}
      {showCountry && party.country ? <Text style={styles.partyLine}>{countryName(party.country)}</Text> : null}
      {party.ico || party.dic ? (
        <Text style={{ marginTop: 5 }}>
          {party.ico ? <Text style={{ color: C.muted }}>IČO </Text> : null}
          {party.ico ?? ""}
          {party.ico && party.dic ? "     " : ""}
          {party.dic ? <Text style={{ color: C.muted }}>DIČ </Text> : null}
          {party.dic ?? ""}
        </Text>
      ) : null}
      <Facts facts={facts} />
      {smallLines.length ? <Text style={styles.partySmall}>{smallLines.join("\n")}</Text> : null}
    </View>
  );
}

/** Rozdělí adresu na řádky („\n", jinak čárky). */
export function addressLines(address: string): string[] {
  const parts = address.includes("\n") ? address.split("\n") : address.split(/,\s*/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

export interface PartiesProps {
  supplier: PartyInfo;
  customer: PartyInfo;
  customerLabel?: string;
  customerFacts?: Fact[];
  customerSmall?: (string | undefined | null)[];
  deliveryAddress?: string;
  deliveryLabel?: string;
}

/** Dodavatel (my) | Odběratel | volitelně Dodací adresa. */
export function Parties({
  supplier,
  customer,
  customerLabel = "Odběratel",
  customerFacts = [],
  customerSmall = [],
  deliveryAddress,
  deliveryLabel = "Dodací adresa",
}: PartiesProps) {
  // Země jen u zahraničního odběratele (pak u obou stran)
  const foreign = Boolean(customer.country) && countryName(customer.country) !== "Česká republika";
  const contact = [supplier.email, supplier.phone, supplier.web].filter(Boolean).join("  ·  ");
  const registration = isPlaceholder(supplier.registration) ? undefined : supplier.registration;
  const delivery = deliveryAddress ? addressLines(deliveryAddress) : [];
  return (
    <View style={styles.parties} wrap={false}>
      <PartyBlock label="Dodavatel" party={supplier} showCountry={foreign} small={[contact, registration]} />
      <View style={{ width: 20 }} />
      <PartyBlock
        label={customerLabel}
        party={customer}
        showCountry={foreign}
        facts={customerFacts}
        small={customerSmall}
      />
      {delivery.length ? (
        <>
          <View style={{ width: 20 }} />
          <View style={[styles.party, { flex: 0.8 }]}>
            <PartyLabel>{deliveryLabel}</PartyLabel>
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

// ── Tabulka položek ─────────────────────────────────────────

// výkres 84 pt: číslo výkresu „VYK-12345-A" se vejde celé (dřív 72 pt → přetékalo do popisu)
const W = { num: 18, drawing: 84, qty: 52, price: 64, vat: 30, total: 76, check: 52 };

function ItemText({ it }: { it: DocItem | DeliveryItem }) {
  return (
    <View style={{ flex: 1, paddingRight: 8 }}>
      <Text style={styles.cellDesc}>{it.description}</Text>
      {it.material ? <Text style={styles.cellSub}>Materiál: {it.material}</Text> : null}
      {it.note ? <Text style={styles.cellNote}>{it.note}</Text> : null}
    </View>
  );
}

function DrawingCell({ it, width }: { it: DocItem | DeliveryItem; width: number }) {
  // celé číslo výkresu na jednom řádku (zákazník podle něj páruje díl) — dlouhé menším písmem
  const size = fitFontSize(it.drawingNumber, width - 6, 8.8);
  return (
    <View style={{ width, paddingRight: 6 }}>
      <Text style={it.drawingNumber ? [styles.cellDrawing, ...(size !== 8.8 ? [{ fontSize: size }] : [])] : { color: C.muted }}>{it.drawingNumber || "—"}</Text>
      {it.revision ? <Text style={styles.cellRev}>rev. {it.revision}</Text> : null}
    </View>
  );
}

function QtyCell({ it, width }: { it: { quantity: number; unit: string }; width: number }) {
  return (
    <Text style={[styles.cellRight, { width }]}>
      {czNumber(it.quantity)} <Text style={styles.cellUnit}>{it.unit}</Text>
    </Text>
  );
}

/** Položky s cenami (nabídka, potvrzení, faktura). Hlavička se opakuje na každé stránce. */
export function PricedItemsTable({ items, currency }: { items: DocItem[]; currency: string }) {
  const hasDrawing = items.some((i) => i.drawingNumber);
  return (
    <View style={styles.table}>
      <View style={styles.th} fixed>
        <Text style={[styles.thText, { width: W.num }]}>#</Text>
        {hasDrawing ? <Text style={[styles.thText, { width: W.drawing }]}>Výkres</Text> : null}
        <Text style={[styles.thText, { flex: 1 }]}>Popis</Text>
        <Text style={[styles.thText, styles.cellRight, { width: W.qty }]}>Množství</Text>
        <Text style={[styles.thText, styles.cellRight, { width: W.price }]}>Cena / MJ</Text>
        <Text style={[styles.thText, styles.cellRight, { width: W.vat }]}>DPH</Text>
        <Text style={[styles.thText, styles.cellRight, { width: W.total }]}>Celkem bez DPH</Text>
      </View>
      {items.map((it, i) => (
        <View key={i} style={i % 2 === 1 ? [styles.tr, styles.trZebra] : styles.tr} wrap={false}>
          <Text style={[styles.cellNum, { width: W.num }]}>{i + 1}</Text>
          {hasDrawing ? <DrawingCell it={it} width={W.drawing} /> : null}
          <ItemText it={it} />
          <QtyCell it={it} width={W.qty} />
          <Text style={[styles.cellRight, { width: W.price }]}>{it.unpriced ? "—" : czk(it.unitPrice, currency)}</Text>
          <Text style={[styles.cellMuted, { width: W.vat }]}>{czNumber(it.vatRate)} %</Text>
          <Text style={[styles.cellStrong, { width: W.total }]}>{it.unpriced ? "—" : czk(lineTotal(it), currency)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Položky dodacího listu — bez cen, se sloupcem pro kontrolu při převzetí. */
export function DeliveryItemsTable({ items }: { items: DeliveryItem[] }) {
  const hasDrawing = items.some((i) => i.drawingNumber);
  const drawingW = 96;
  const qtyW = 74;
  return (
    <View style={styles.table}>
      <View style={styles.th} fixed>
        <Text style={[styles.thText, { width: W.num }]}>#</Text>
        {hasDrawing ? <Text style={[styles.thText, { width: drawingW }]}>Výkres</Text> : null}
        <Text style={[styles.thText, { flex: 1 }]}>Popis</Text>
        <Text style={[styles.thText, styles.cellRight, { width: qtyW, paddingRight: 4 }]}>Množství</Text>
        <Text style={[styles.thText, { width: W.check, textAlign: "center" }]}>Kontrola</Text>
      </View>
      {items.map((it, i) => (
        <View key={i} style={i % 2 === 1 ? [styles.tr, styles.trZebra] : styles.tr} wrap={false}>
          <Text style={[styles.cellNum, { width: W.num }]}>{i + 1}</Text>
          {hasDrawing ? <DrawingCell it={it} width={drawingW} /> : null}
          <ItemText it={it} />
          <View style={{ width: qtyW, paddingRight: 4 }}>
            <Text style={[styles.cellRight, { fontWeight: "bold" }]}>
              {czNumber(it.quantity)} <Text style={[styles.cellUnit, { fontWeight: "normal" }]}>{it.unit}</Text>
            </Text>
            {it.ordered !== undefined && it.deliveredTotal !== undefined && !(it.quantity === it.ordered && it.deliveredTotal === it.ordered) ? (
              // dílčí / konečná dodávka: kolik je dodáno celkem (i s touto dodávkou) z objednaného
              <>
                <Text style={[styles.cellSub, { textAlign: "right" }]}>celkem dodáno</Text>
                <Text style={[styles.cellSub, { textAlign: "right" }]}>{czNumber(it.deliveredTotal)} z {czNumber(it.ordered)} {it.unit}</Text>
              </>
            ) : it.ordered !== undefined && it.ordered !== it.quantity ? (
              <Text style={[styles.cellSub, { textAlign: "right" }]}>z {czNumber(it.ordered)} {it.unit}</Text>
            ) : null}
          </View>
          <View style={{ width: W.check, alignItems: "center" }}>
            <View style={styles.checkBox} />
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Součty ──────────────────────────────────────────────────

export function TotalsCard({
  items,
  currency,
  grandLabel = "Celkem s DPH",
  hint,
}: {
  items: DocItem[];
  currency: string;
  grandLabel?: string;
  hint?: string;
}) {
  const { breakdown, subtotal, total } = computeTotals(items);
  const multi = breakdown.length > 1;
  return (
    <View style={styles.totalsCard} wrap={false}>
      <View style={styles.totalLine}>
        <Text style={styles.totalKey}>Celkem bez DPH</Text>
        <Text style={styles.totalVal}>{czk(subtotal, currency)}</Text>
      </View>
      {breakdown.map((r) => (
        <View key={r.rate}>
          {multi ? (
            <View style={styles.totalLine}>
              <Text style={styles.totalKey}>Základ {czNumber(r.rate)} %</Text>
              <Text style={styles.totalVal}>{czk(r.base, currency)}</Text>
            </View>
          ) : null}
          <View style={styles.totalLine}>
            <Text style={styles.totalKey}>DPH {czNumber(r.rate)} %</Text>
            <Text style={styles.totalVal}>{czk(r.vat, currency)}</Text>
          </View>
        </View>
      ))}
      <View style={styles.totalDivider} />
      <View style={styles.totalGrandRow}>
        <Text style={styles.totalGrandLabel}>{grandLabel}</Text>
        <Text style={styles.totalGrandValue}>{czk(total, currency)}</Text>
      </View>
      {hint ? <Text style={styles.totalHint}>{hint}</Text> : null}
    </View>
  );
}

/** Rekapitulace DPH po sazbách (faktura). */
export function VatRecap({ items, currency }: { items: DocItem[]; currency: string }) {
  const { breakdown } = computeTotals(items);
  const col = { flex: 1, textAlign: "right" as const };
  return (
    <View wrap={false}>
      <Text style={styles.sectionTitle}>Rekapitulace DPH</Text>
      <View style={[styles.termRow, { borderBottomWidth: 0.9, borderColor: C.line }]}>
        <Text style={[styles.thText, { width: 50 }]}>Sazba</Text>
        <Text style={[styles.thText, col]}>Základ</Text>
        <Text style={[styles.thText, col]}>DPH</Text>
        <Text style={[styles.thText, col]}>Celkem</Text>
      </View>
      {breakdown.map((r, i) => (
        <View key={r.rate} style={i === breakdown.length - 1 ? [styles.termRow, { borderBottomWidth: 0 }] : styles.termRow}>
          <Text style={{ width: 50, color: C.grey }}>{czNumber(r.rate)} %</Text>
          <Text style={col}>{czk(r.base, currency)}</Text>
          <Text style={col}>{czk(r.vat, currency)}</Text>
          <Text style={col}>{czk(r.base + r.vat, currency)}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Podmínky, poznámky, podpisy ─────────────────────────────

export function Terms({ title, rows }: { title?: string; rows: Fact[] }) {
  const shown = rows.filter((r) => r.v && String(r.v).trim());
  if (!shown.length) return null;
  return (
    <View wrap={false}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      {shown.map((r, i) => (
        <View key={i} style={i === shown.length - 1 ? [styles.termRow, { borderBottomWidth: 0 }] : styles.termRow}>
          <Text style={styles.termKey}>{r.k}</Text>
          <Text style={styles.termVal}>{r.v}</Text>
        </View>
      ))}
    </View>
  );
}

export function NoteBox({ title, children }: { title?: string; children: ReactNode }) {
  // Krátká poznámka se nedělí; dlouhá (např. text průvodního e-mailu) smí přetéct na další stranu
  const long = typeof children === "string" && children.length > 600;
  return (
    <View style={styles.noteBox} wrap={long}>
      {title ? <Text style={[styles.sectionTitle, { color: C.red, marginBottom: 3 }]}>{title}</Text> : null}
      <Text style={styles.noteText}>{children}</Text>
    </View>
  );
}

/** Podpisová linka s popiskem (Vypracoval, Předal, Převzal…). */
export function SignatureLine({
  title,
  name,
  caption = "Datum a podpis",
}: {
  title: string;
  name?: string;
  caption?: string;
}) {
  return (
    <View style={styles.signBox}>
      <Text style={styles.signTitle}>{title}</Text>
      {/* Řádek se jménem vždy (i prázdný), aby linky vedle sebe lícovaly */}
      <View style={{ height: 15 }}>{name ? <Text style={styles.signName}>{name}</Text> : null}</View>
      <View style={styles.signArea} />
      <Text style={styles.signCaption}>{caption}</Text>
    </View>
  );
}

/** Kdo doklad vypracoval / schválil — kompaktně, bez podpisových linek. */
export function People({ people }: { people: { title: string; name?: string; sub?: string }[] }) {
  const shown = people.filter((p) => p.name);
  if (!shown.length) return null;
  return (
    <View style={{ flexDirection: "row", marginTop: 10 }}>
      {shown.map((p, i) => (
        <View key={i} style={{ marginRight: 40, paddingLeft: 8, borderLeftWidth: 1.5, borderColor: C.line }}>
          <Text style={styles.signTitle}>{p.title}</Text>
          <Text style={styles.signName}>{p.name}</Text>
          {p.sub ? <Text style={styles.signCaption}>{p.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export function StampBox({ title = "Razítko a podpis" }: { title?: string }) {
  return (
    <View style={styles.stampBox}>
      <Text style={styles.stampText}>{title}</Text>
    </View>
  );
}

// ── QR Platba ───────────────────────────────────────────────

/** QR kód jako vektor (Svg + Rect po řádkových bězích), s tichou zónou. */
export function QrCode({ text, size = 84 }: { text: string; size?: number }) {
  const m = qrMatrix(text);
  const quiet = 2;
  const n = m.size + quiet * 2;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
      <Rect x={0} y={0} width={n} height={n} fill={C.white} />
      {qrRuns(m).map((r, i) => (
        <Rect key={i} x={r.x + quiet} y={r.y + quiet} width={r.w} height={1.02} fill="#000000" />
      ))}
    </Svg>
  );
}

// ── Patička ─────────────────────────────────────────────────

export function DocFooter() {
  const a = COMPANY.address;
  const reg = isPlaceholder(COMPANY.registration) ? null : COMPANY.registration;
  const bank = COMPANY.bank;
  const hasBank = Boolean(bank.accountNumber || bank.iban);
  return (
    <View style={styles.footer} fixed>
      <View style={styles.footerCol}>
        <Text style={styles.footerStrong}>{COMPANY.name}</Text>
        <Text>{[a.street, [a.zip, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")}</Text>
        {reg ? <Text>{reg}</Text> : null}
      </View>
      <View style={styles.footerCol}>
        <Text>
          IČO {COMPANY.ico}
          {COMPANY.dic ? `  ·  DIČ ${COMPANY.dic}` : ""}
        </Text>
        {COMPANY.web ? <Text>{COMPANY.web}</Text> : null}
        <Text>{[COMPANY.email, COMPANY.phone ? `tel. ${COMPANY.phone}` : ""].filter(Boolean).join("  ·  ")}</Text>
      </View>
      {hasBank ? (
        <View style={styles.footerCol}>
          {bank.accountNumber ? (
            <Text>
              Účet {bank.accountNumber}
              {bank.bankName ? `, ${bank.bankName}` : ""}
            </Text>
          ) : null}
          {bank.iban ? <Text>IBAN {bank.iban}</Text> : null}
        </View>
      ) : null}
      <Text style={styles.footerPage} render={({ pageNumber, totalPages }) => `Strana ${pageNumber} / ${totalPages}`} />
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
    email: COMPANY.email || undefined,
    phone: COMPANY.phone || undefined,
    web: COMPANY.web || undefined,
    registration: isPlaceholder(COMPANY.registration) ? undefined : COMPANY.registration,
  };
}

/** Datum pro zobrazení (prázdné → undefined, aby se položka vynechala). */
export function d(value?: string | null): string | undefined {
  return value ? czDate(value) : undefined;
}
