/**
 * Dodací listy k dodávkám (čisté funkce, bez DB — sdílí server, dialog i testy).
 *
 * Každé „Zapsat dodání" s dodacím listem = vlastní DL (vlastní číslo z řady DL-RRRR-NNN) jen
 * s tím, co odešlo TEĎ (rozdíl dodáno celkem před / po). Částečná dodávka → DL s dílčími množstvími,
 * zbytek → další DL. Ceny na dodacím listu nikdy nejsou.
 */

/** Položka zakázky pro výpočet dodávky. */
export interface DeliveryItemFacts {
  id: string;
  quantity: number;
  deliveredQuantity?: number | null;
  deliveryClosed?: boolean | null;
}

/** Řádek dodávky z dialogu: kolik bylo dodáno celkem při otevření (from) a kolik bude po dodávce (to). */
export interface DeliveryRowInput {
  itemId: string;
  from: number;
  to: number;
}

/** Řádek dodacího listu jedné dodávky. */
export interface DeliveryLine {
  itemId: string;
  /** Dodáno teď (= to − from). */
  quantity: number;
  /** Objednáno celkem. */
  ordered: number;
  /** Dodáno celkem po této dodávce. */
  deliveredTotal: number;
}

export const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** Položka je hotová (dodáno vše, nebo uzavřena s menším množstvím). */
export function itemDelivered(i: DeliveryItemFacts): boolean {
  return Boolean(i.deliveryClosed) || round3(Number(i.deliveredQuantity ?? 0)) >= round3(Number(i.quantity));
}

/** Zbývá dodat (nikdy záporné; uzavřená položka 0). */
export function remainingQty(i: DeliveryItemFacts): number {
  if (i.deliveryClosed) return 0;
  return Math.max(0, round3(Number(i.quantity) - Number(i.deliveredQuantity ?? 0)));
}

/** Řádky DL z dodávky: jen položky, u kterých teď něco odešlo (zvýšení dodaného množství). */
export function deliveryLines(items: DeliveryItemFacts[], rows: DeliveryRowInput[]): DeliveryLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: DeliveryLine[] = [];
  for (const r of rows) {
    const it = byId.get(r.itemId);
    if (!it) continue;
    const qty = round3(Number(r.to) - Number(r.from));
    if (!(qty > 0)) continue;
    out.push({ itemId: it.id, quantity: qty, ordered: Number(it.quantity), deliveredTotal: round3(Number(r.to)) });
  }
  // pořadí jako na zakázce
  const order = new Map(items.map((i, idx) => [i.id, idx]));
  return out.sort((a, b) => (order.get(a.itemId) ?? 0) - (order.get(b.itemId) ?? 0));
}

/** Je po dodávce vše dodáno (všechny položky hotové)? */
export function deliveryCompletes(items: DeliveryItemFacts[], rows: DeliveryRowInput[]): boolean {
  const to = new Map(rows.map((r) => [r.itemId, Number(r.to)]));
  return items.length > 0 && items.every((i) => itemDelivered({ ...i, deliveredQuantity: to.get(i.id) ?? i.deliveredQuantity }));
}

/** Předvyplnění dialogu „DL na zbývající položky": u každé otevřené položky celý zbytek. */
export function remainingRows(items: DeliveryItemFacts[]): DeliveryRowInput[] {
  return items
    .filter((i) => remainingQty(i) > 0)
    .map((i) => {
      const from = round3(Number(i.deliveredQuantity ?? 0));
      return { itemId: i.id, from, to: round3(from + remainingQty(i)) };
    });
}

/**
 * Dodávky zapsané bez dodacího listu (starší dodání, nezaškrtnuté „Vystavit dodací list"): řádky
 * „od 0 do dodáno dosud" — DL na zboží, které už odešlo (ne na objednané množství).
 */
export function deliveredRows(items: DeliveryItemFacts[]): DeliveryRowInput[] {
  return items
    .filter((i) => round3(Number(i.deliveredQuantity ?? 0)) > 0)
    .map((i) => ({ itemId: i.id, from: 0, to: round3(Number(i.deliveredQuantity ?? 0)) }));
}

/**
 * Dodané zboží, které ještě nemá dodací list: u každé položky dodáno celkem − množství na vystavených
 * DL (documented, podle řádků DL navázaných na položku). Řádky „od zdokumentovaného do dodaného".
 * documented = null (starší DL bez vazby na položky) → nic (nejde poznat, co DL už pokrývá).
 */
export function undocumentedRows(items: DeliveryItemFacts[], documented: ReadonlyMap<string, number> | null): DeliveryRowInput[] {
  if (!documented) return [];
  return items
    .map((i) => ({ itemId: i.id, from: round3(documented.get(i.id) ?? 0), to: round3(Number(i.deliveredQuantity ?? 0)) }))
    .filter((r) => r.to > r.from);
}

/** Dodávka bez DL před touto (dodáno dříve víc, než pokrývají vystavené DL) — pořadí dodávky +1. */
export function hadUndocumentedBefore(
  items: DeliveryItemFacts[], rows: DeliveryRowInput[], documented: ReadonlyMap<string, number> | null,
): boolean {
  if (!documented) return false;
  const from = new Map(rows.map((r) => [r.itemId, Number(r.from)]));
  return items.some((i) => round3(from.get(i.id) ?? Number(i.deliveredQuantity ?? 0)) > round3(documented.get(i.id) ?? 0));
}

/** Označení DL na dříve dodané zboží (dodávka zapsaná bez DL, zakázka už jiné DL má). */
export const CATCH_UP_LABEL = "dříve dodané zboží";

/** Množství do pole formuláře s desetinnou čárkou („12,5"), jako zbytek českého UI. */
export function qtyInput(n: number): string {
  return String(round3(n)).replace(".", ",");
}

/** „1. dodávka", „2. dodávka — konečná"; jediná kompletní dodávka bez označení. */
export function deliveryLabel(seq: number, final: boolean): string | undefined {
  if (seq <= 1 && final) return undefined;
  return `${seq}. ${final ? "dodávka — konečná" : "dílčí dodávka"}`;
}

const DL_NUMBER_RE = /DL-\d{4}-\d{3,}/;

/** Číslo dodacího listu z názvu / souboru dokumentu („Dodaci_list_DL-2026-070.pdf" → „DL-2026-070"). */
export function deliveryNoteNumberOf(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = t ? DL_NUMBER_RE.exec(t) : null;
    if (m) return m[0];
  }
  return null;
}

/** Název dokumentu DL k dodávce: „Dodací list DL-2026-070 · 2. dílčí dodávka" (jediná kompletní: „· dodávka"). */
export function deliveryNoteTitle(number: string, label?: string): string {
  return `Dodací list ${number} · ${label ?? "dodávka"}`;
}

const DELIVERY_TITLE_RE = / · (\d+\. (dílčí dodávka|dodávka — konečná)|dodávka|dříve dodané zboží)$/;

/** Dokument zakázky je dodací list k dodávce (vystavený při „Zapsat dodání"), ne DL celé zakázky. */
export function isDeliveryNoteFile(f: { kind: string; title?: string | null; archived?: boolean }): boolean {
  return f.kind === "dodaci_list" && !f.archived && DELIVERY_TITLE_RE.test(f.title ?? "");
}

/** Soubor dodacího listu, jak ho znají Dokumenty zakázky (druh, původ, vystavitel, zámek). */
export interface DeliveryNoteFileFacts {
  id: string;
  kind: string;
  title?: string | null;
  filename: string;
  archived?: boolean;
  createdAt: string;
  issuer?: string | null;
  origin?: string | null;
  locked?: unknown;
}

/** NÁŠ vystavený dodací list (ne DL dodavatele nahraný k nákupu, ne zamčený soubor). */
export function isOwnDeliveryNote(f: DeliveryNoteFileFacts): boolean {
  return f.kind === "dodaci_list" && !f.archived && f.issuer !== "dodavatel" && f.origin === "generated" && !f.locked;
}

/** Vystavené dodací listy zakázky (aktuální verze, jen naše), nejnovější první. */
export function currentDeliveryNotes(files: DeliveryNoteFileFacts[]): { id: string; filename: string; number: string; label: string | null; createdAt: string }[] {
  return files
    .filter(isOwnDeliveryNote)
    .map((f) => {
      const number = deliveryNoteNumberOf(f.title, f.filename) ?? f.filename;
      const label = (f.title ?? "").split(" · ").slice(1).join(" · ") || null;
      return { id: f.id, filename: f.filename, number, label: label === "dodávka" ? null : label, createdAt: f.createdAt };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
