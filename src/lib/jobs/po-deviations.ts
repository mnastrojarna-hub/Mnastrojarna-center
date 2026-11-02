/**
 * Objednávka dodavateli — odchylky od výkresu a přílohy (majitel 2. 11.): „Pokud vystavím objednávku a jsou
 * tam nějaké opravy oproti výkresu, musí se to zanést do textu objednávky i mailu. Musí to k objednávce
 * přikládat všechny výkresy dotyčné položky … stejně tak modely, pokud máme."
 *
 * Čistá logika (klient i server, bez DB — testy v po-deviations.test.ts):
 *  • collectItemDeviations — odchylky položky ze zdrojů zakázky: propsané pokyny zákazníka z e-mailu
 *    (nadřazené výkresu — materiál, rozměr, tolerance, TZ, povrch, kusy…), oprava zakázky (počet kusů),
 *    nová revize výkresu, poznámka „Pro dodavatele" (jen když už není v poznámce položky),
 *  • resolveDeviations — potvrzený seznam z dialogu (vypnuté = off) + nové odchylky ze zdrojů,
 *  • deviationText / deviationMailSection — text do PDF pod položku a krátký souhrn do e-mailu,
 *  • poAttachmentCandidates — přílohy e-mailu: přesně soubory položek objednávky (aktuální revize výkresu
 *    anonymizovaně, 3D model originál s neutrálním názvem, starší revize nezaškrtnuté).
 */

export type DeviationSource = "email" | "oprava" | "revize" | "dodavatel" | "rucne";

export interface PoDeviation {
  /** Stálá identita (potvrzení / vypnutí přežije nové sestavení ze zdrojů). */
  key: string;
  source: DeviationSource;
  /** „Materiál", „Tolerance", „Revize výkresu"… */
  label: string;
  /** Platná hodnota (platí místo výkresu). */
  value: string;
  /** Co uvádí výkres (je-li známo). */
  drawingValue?: string | null;
  /** Předchozí hodnota (oprava, revize). */
  was?: string | null;
  /** Vypnuto v dialogu (nepíše se do PDF ani e-mailu). */
  off?: boolean;
}

export const DEVIATION_SOURCE_LABEL: Record<DeviationSource, string> = {
  email: "z e-mailu zákazníka",
  oprava: "oprava zakázky",
  revize: "nová revize",
  dodavatel: "pro dodavatele",
  rucne: "ručně",
};

export const MAX_DEVIATIONS = 40;

/** Pole pokynů z e-mailu → popisek (shodné s FIELD_LABEL Pošty B; jen položková pole). */
const MAIL_FIELD_LABEL: Record<string, string> = {
  quantity: "Počet kusů",
  material: "Materiál",
  heat: "Tepelné zpracování",
  surface: "Povrchová úprava",
  hardness: "Tvrdost",
  dimension: "Rozměry",
  tolerance: "Tolerance",
  marking: "Označení / popis",
  revision: "Revize výkresu",
};

// ── Zdroje ──────────────────────────────────────────────────
/** job_mail_changes (kind = change). */
export interface MailChangeSource {
  id: string;
  order_item_id: string | null;
  field: string;
  status: string;
  kind?: string | null;
  value_new: string | null;
  drawing_value: string | null;
  created_at: string;
}

/** Oprava zakázky (job_events data.exception = correction → changes). */
export interface CorrectionSource {
  at: string;
  changes: { field: string; from: string | number | null; to: string | number | null }[];
}

/** job_drawing_changes. */
export interface DrawingChangeSource {
  id: string;
  order_item_id: string | null;
  drawing_number?: string | null;
  rev_from: string | null;
  rev_to: string | null;
  file_id?: string | null;
  old_file_id?: string | null;
  created_at: string;
}

export interface ItemSource {
  id: string;
  drawing_number?: string | null;
  revision?: string | null;
  supplier_note?: string | null;
  unit?: string | null;
}

export interface DeviationSources {
  mailChanges: MailChangeSource[];
  corrections: CorrectionSource[];
  drawingChanges: DrawingChangeSource[];
}

function clean(v: unknown, max = 400): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Krátký stabilní otisk textu (klíč poznámky „Pro dodavatele"). */
export function textKey(s: string): string {
  let h = 5381;
  for (const ch of fold(s)) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

function qtyText(v: string | number | null | undefined, unit: string): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? `${String(n).replace(".", ",")} ${unit}` : clean(v, 40) || null;
}

/** „Pokyn z e-mailu 2. 11.: …" → jen pokyn (předpona z Pošty B se do objednávky nepíše). */
function stripMailPrefix(s: string): string {
  return s.replace(/^pokyn z e-mailu[^:]*:\s*/i, "").trim();
}

/**
 * Odchylky jedné položky zakázky ze zdrojů (pořadí: revize, e-mail, oprava, pro dodavatele).
 *  • e-mail: jen propsané změny (status applied — nahrazené novější „superseded" ne); revize z e-mailu
 *    splyne s revizí výkresu (stejný klíč),
 *  • oprava zakázky: poslední oprava počtu kusů položky; jen když množství objednávky odpovídá opravě,
 *  • revize: poslední změna revize položky, která je stále aktuální,
 *  • pro dodavatele: poznámka z Technologie, pokud ji poznámka řádku objednávky ještě nenese.
 */
export function collectItemDeviations(
  item: ItemSource,
  src: DeviationSources,
  line: { quantity?: number | null; note?: string | null; unit?: string | null } = {},
): PoDeviation[] {
  const out: PoDeviation[] = [];
  const unit = clean(line.unit ?? item.unit ?? "ks", 20) || "ks";
  const add = (d: PoDeviation) => {
    if (!d.value || out.some((x) => x.key === d.key)) return;
    out.push(d);
  };

  // revize výkresu (aktuální)
  const cur = clean(item.revision, 40).toUpperCase();
  const revs = src.drawingChanges
    .filter((c) => c.order_item_id === item.id && clean(c.rev_to, 40))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const lastRev = revs[revs.length - 1];
  if (lastRev && (!cur || clean(lastRev.rev_to, 40).toUpperCase() === cur)) {
    const to = clean(lastRev.rev_to, 40);
    add({ key: `rev:${to.toUpperCase()}`, source: "revize", label: "Revize výkresu", value: to, was: clean(lastRev.rev_from, 40) || null });
  }

  // pokyny zákazníka z e-mailu (nadřazené výkresu)
  const mails = src.mailChanges
    .filter((m) => m.order_item_id === item.id && m.status === "applied" && (m.kind ?? "change") === "change" && MAIL_FIELD_LABEL[m.field])
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const m of mails) {
    const value = stripMailPrefix(clean(m.value_new, 400));
    if (!value) continue;
    const drawing = clean(m.drawing_value, 200) || null;
    if (m.field === "revision") {
      if (cur && value.toUpperCase() !== cur) continue;
      add({ key: `rev:${value.toUpperCase()}`, source: "revize", label: "Revize výkresu", value, was: drawing });
      continue;
    }
    // počet kusů: odchylka od výkresu jen když výkres kusy uvádí (jinak platí množství řádku)
    if (m.field === "quantity" && !drawing) continue;
    add({ key: `email:${m.id}`, source: "email", label: MAIL_FIELD_LABEL[m.field], value, drawingValue: drawing });
  }

  // oprava zakázky — počet kusů (jen technická hodnota; ceny a termíny sem nepatří)
  const corr = [...src.corrections].sort((a, b) => a.at.localeCompare(b.at));
  let lastQty: { at: string; from: string | number | null; to: string | number | null } | null = null;
  for (const c of corr) {
    for (const ch of c.changes ?? []) {
      if (ch && ch.field === `item:${item.id}:quantity`) lastQty = { at: c.at, from: ch.from, to: ch.to };
    }
  }
  if (lastQty) {
    const to = Number(lastQty.to);
    const lineQty = line.quantity ?? null;
    const mailQty = out.some((d) => d.source === "email" && d.label === MAIL_FIELD_LABEL.quantity);
    if (Number.isFinite(to) && to > 0 && !mailQty && (lineQty === null || Math.abs(lineQty - to) < 1e-9)) {
      add({ key: `oprava:${lastQty.at}:qty`, source: "oprava", label: "Počet kusů", value: qtyText(to, unit) ?? "", was: qtyText(lastQty.from, unit) });
    }
  }

  // poznámka pro dodavatele z Technologie (když ji řádek objednávky ještě nenese)
  const sn = clean(item.supplier_note, 400).replace(/^pozor[:\s,–-]*/i, "").trim();
  if (sn && !fold(line.note ?? "").includes(fold(sn))) {
    add({ key: `pozn:${textKey(sn)}`, source: "dodavatel", label: "Pokyn", value: sn });
  }
  return out;
}

// ── Potvrzený seznam ────────────────────────────────────────
function isSource(v: unknown): v is DeviationSource {
  return v === "email" || v === "oprava" || v === "revize" || v === "dodavatel" || v === "rucne";
}

/** Vyčistí seznam z klienta / DB (neplatné položky zahodí); null = automaticky. */
export function cleanDeviations(raw: unknown): PoDeviation[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: PoDeviation[] = [];
  for (const r of raw.slice(0, MAX_DEVIATIONS)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const value = clean(o.value, 400);
    const label = clean(o.label, 80) || "Odchylka";
    const source = isSource(o.source) ? o.source : "rucne";
    const key = clean(o.key, 120) || `rucne:${textKey(`${label}:${value}`)}`;
    if (!value || out.some((x) => x.key === key)) continue;
    const drawingValue = clean(o.drawingValue, 200);
    const was = clean(o.was, 200);
    out.push({ key, source, label, value, ...(drawingValue ? { drawingValue } : {}), ...(was ? { was } : {}), ...(o.off === true ? { off: true } : {}) });
  }
  return out;
}

/**
 * Platný seznam: potvrzený (z dialogu) + nové odchylky ze zdrojů, které v potvrzeném ještě nejsou
 * (např. pozdější pokyn z e-mailu nebo nová revize). Bez potvrzení = vše ze zdrojů.
 */
export function resolveDeviations(auto: PoDeviation[], stored: PoDeviation[] | null | undefined): PoDeviation[] {
  if (!stored) return auto.map((d) => ({ ...d }));
  const keys = new Set(stored.map((d) => d.key));
  return [...stored.map((d) => ({ ...d })), ...auto.filter((d) => !keys.has(d.key)).map((d) => ({ ...d }))];
}

export function activeDeviations(list: PoDeviation[] | null | undefined): PoDeviation[] {
  return (list ?? []).filter((d) => !d.off && d.value.trim());
}

// ── Texty ───────────────────────────────────────────────────
/** „Materiál: 1.4301 (na výkresu 11 523)", „Revize výkresu: C (nahrazuje rev. B)". */
export function deviationText(d: Pick<PoDeviation, "label" | "value" | "drawingValue" | "was" | "source">): string {
  const v = d.value.trim();
  if (d.source === "revize") return `Platí revize výkresu ${v}${d.was ? ` (nahrazuje rev. ${d.was})` : ""}`;
  const tail = d.drawingValue ? ` (na výkresu: ${d.drawingValue})` : d.was ? ` (dříve ${d.was})` : "";
  return `${d.label}: ${v}${tail}`;
}

/** Řádky do PDF pod položku (jen zapnuté). */
export function deviationLines(list: PoDeviation[] | null | undefined): string[] {
  return activeDeviations(list).map(deviationText);
}

export interface ItemDeviationsRef {
  /** Číslo výkresu, jinak název položky. */
  ref: string;
  lines: string[];
}

/** Souhrn do e-mailu (krátce, po položkách). */
export function deviationMailSection(items: ItemDeviationsRef[], address: "ty" | "vy" | null | undefined): string[] {
  const list = items.filter((i) => i.lines.length);
  if (!list.length) return [];
  const out = [`Pozor — u těchto položek platí odchylky od výkresu (${address === "ty" ? "vyráběj" : "vyrábějte"} podle nich, mají přednost před výkresem):`];
  for (const i of list.slice(0, 30)) out.push(`– ${i.ref}: ${i.lines.join("; ")}`);
  return out;
}

// ── Přílohy e-mailu objednávky ──────────────────────────────
export type PoAttachmentRole = "drawing" | "model" | "old";

export interface PoFileSource {
  id: string;
  kind: string | null;
  filename: string;
  order_item_id: string | null;
  archived: boolean;
  replaced_by?: string | null;
  created_at?: string | null;
  size?: number | null;
  /** Je to 3D model (STEP, IGES, STL, CAD)? */
  model: boolean;
  /** Stav pro dodavatele (pickShareFile). */
  status: "ready" | "pending" | "blocked";
  message?: string | null;
  /** Přípona skutečně odesílaného souboru (anonymizovaná kopie / originál modelu). */
  ext: string;
}

export interface PoLineRef {
  index: number;
  orderItemId: string | null;
  drawingNumber: string | null;
  revision: string | null;
  label: string;
}

export interface PoAttachmentCandidate {
  fileId: string;
  role: PoAttachmentRole;
  /** Řádky objednávky, ke kterým soubor patří. */
  lines: number[];
  /** Neutrální název přílohy (nikdy původní — často nese zákazníka). */
  name: string;
  size: number | null;
  status: "ready" | "pending" | "blocked";
  message: string | null;
  /** Výchozí zaškrtnutí. */
  checked: boolean;
  /** Revize, kterou soubor nese (stará revize). */
  revision?: string | null;
}

export interface PoAttachmentPlan {
  candidates: PoAttachmentCandidate[];
  /** Řádky bez výkresu (varování v dialogu). */
  missingDrawing: { index: number; label: string }[];
}

export function normDrawing(v: string | null | undefined): string {
  return String(v ?? "").toUpperCase().replace(/[\s.\-/_]/g, "");
}

/** Bezpečný název: „VK-2291_C.pdf" / „VK-2291_B-neplatna.pdf" / „OV-2026-004-V1.pdf". */
export function poNeutralName(input: { drawingNumber?: string | null; revision?: string | null; suffix?: string; ext: string; poNumber: string; index: number }): string {
  // eslint-disable-next-line no-control-regex
  const c = (s: string | null | undefined) => String(s ?? "").normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").replace(/\s+/g, "_").replace(/^[._-]+|[._-]+$/g, "").slice(0, 60);
  const ext = c(input.ext).replace(/^\.+/, "").toLowerCase().slice(0, 8) || "pdf";
  const num = c(input.drawingNumber);
  const rev = c(input.revision).slice(0, 12);
  const base = num ? `${num}${rev ? `_${rev}` : ""}` : `${c(input.poNumber) || "objednavka"}-V${Math.max(1, input.index)}`;
  return `${base}${input.suffix ? `-${c(input.suffix)}` : ""}.${ext}`;
}

/**
 * Přílohy e-mailu objednávky: soubory jen těch dílů, které objednávka obsahuje (vazba order_item_id, jinak
 * číslo výkresu v názvu souboru). Aktuální výkres a 3D model zaškrtnuté, starší revize (nahrazený výkres)
 * nabídnuté nezaškrtnuté. `focusItems` (změna po nové revizi) = zaškrtnout jen soubory těchto dílů.
 */
export function poAttachmentPlan(
  lines: PoLineRef[],
  files: PoFileSource[],
  opts: { poNumber: string; drawingChanges?: DrawingChangeSource[]; focusItems?: string[] | null } = { poNumber: "" },
): PoAttachmentPlan {
  const changes = opts.drawingChanges ?? [];
  const lineOf = (f: PoFileSource): PoLineRef[] => {
    const byItem = f.order_item_id ? lines.filter((l) => l.orderItemId && l.orderItemId === f.order_item_id) : [];
    if (byItem.length) return byItem;
    if (f.order_item_id) {
      // soubor patří jinému dílu zakázky — nikdy (ani podle názvu)
      return [];
    }
    const flat = normDrawing(f.filename);
    return lines.filter((l) => {
      const n = normDrawing(l.drawingNumber);
      return n.length >= 3 && flat.includes(n);
    });
  };
  const current = new Set(files.filter((f) => !f.archived).map((f) => f.id));
  const out: PoAttachmentCandidate[] = [];
  const names = new Set<string>();
  const uniq = (n: string) => {
    let name = n;
    for (let i = 2; names.has(name.toLowerCase()); i++) name = n.replace(/(\.[^.]+)?$/, `-${i}$1`);
    names.add(name.toLowerCase());
    return name;
  };
  const focus = opts.focusItems && opts.focusItems.length ? new Set(opts.focusItems) : null;
  const sorted = [...files].sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  let idx = 0;
  for (const f of sorted) {
    if (f.kind !== "vykres" && f.kind !== "model_3d" && !f.model) continue;
    const ls = lineOf(f);
    if (!ls.length) continue;
    const l = ls[0];
    idx++;
    let role: PoAttachmentRole;
    let revision: string | null = l.revision;
    if (!f.archived) role = f.model ? "model" : "drawing";
    else {
      // starší revize: nahrazená novým výkresem (replaced_by) nebo zapsaná u změny revize
      const ch = changes.find((c) => c.old_file_id === f.id);
      const replaced = (f.replaced_by && current.has(f.replaced_by)) || Boolean(ch);
      if (!replaced || f.model) continue;
      role = "old";
      revision = ch ? clean(ch.rev_from, 40) || null : null;
    }
    const inFocus = !focus || ls.some((x) => x.orderItemId && focus.has(x.orderItemId));
    out.push({
      fileId: f.id,
      role,
      lines: ls.map((x) => x.index),
      name: uniq(poNeutralName({
        drawingNumber: l.drawingNumber, revision: role === "old" ? revision : l.revision, suffix: role === "old" ? "neplatna" : undefined,
        ext: f.ext, poNumber: opts.poNumber, index: idx,
      })),
      size: f.size ?? null,
      status: f.status,
      message: f.message ?? null,
      checked: role !== "old" && f.status !== "blocked" && inFocus,
      ...(role === "old" ? { revision } : {}),
    });
  }
  const missingDrawing = lines
    .filter((l) => !out.some((c) => c.role === "drawing" && c.lines.includes(l.index)))
    .map((l) => ({ index: l.index, label: l.label }));
  // po položkách: aktuální výkres, 3D model, starší revize (stabilně — v rámci role podle nahrání)
  const rank: Record<PoAttachmentRole, number> = { drawing: 0, model: 1, old: 2 };
  const ordered = out
    .map((c, i) => ({ c, i }))
    .sort((a, b) => Math.min(...a.c.lines) - Math.min(...b.c.lines) || rank[a.c.role] - rank[b.c.role] || a.i - b.i)
    .map((x) => x.c);
  return { candidates: ordered, missingDrawing };
}

/** Výběr z klienta: jen soubory z plánu (nic cizího); undefined = výchozí zaškrtnutí. */
export function pickPoAttachments(plan: PoAttachmentPlan, chosen: string[] | null | undefined): PoAttachmentCandidate[] {
  if (!chosen) return plan.candidates.filter((c) => c.checked);
  const want = new Set(chosen.map((x) => String(x).toLowerCase()));
  return plan.candidates.filter((c) => want.has(c.fileId.toLowerCase()) && c.status !== "blocked");
}

/** Řádek do e-mailu o přiložených výkresech (a nahrazené revizi). */
export function attachmentMailLines(
  picked: Pick<PoAttachmentCandidate, "role" | "name">[],
  revisions: { ref: string; to: string; from: string | null }[],
  address: "ty" | "vy" | null | undefined,
): string[] {
  const out: string[] = [];
  const drawings = picked.filter((p) => p.role === "drawing").length;
  const models = picked.filter((p) => p.role === "model").length;
  if (drawings || models) {
    const what = [drawings ? "výkresy" : "", models ? "3D modely" : ""].filter(Boolean).join(" a ");
    out.push(`${address === "ty" ? "V příloze ti posílám" : "V příloze dále zasíláme"} ${what} k objednaným položkám.`);
  }
  for (const r of revisions) {
    out.push(`Výkres ${r.ref}: platí nová revize ${r.to}${r.from ? ` — revize ${r.from} je nahrazena a neplatí` : ""}.`);
  }
  return out;
}
