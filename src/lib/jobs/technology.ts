// Technologie položek (čisté funkce; sdílí akce, záložka Technologie a testy).
// Majitel 29. 10.: „technolog může napsat technologický postup ke každé položce. Ale současně jde napsat
// ‚bez technologie, kompletně zadáno' někomu … poznámky, na co dát pozor — ty se budou generovat do
// objednávky. Technologii nebude vždy nutné vypisovat (nepovinná při kompletní dodávce)."

/** Změna technologie jedné položky (jen uvedená pole se mění). */
export interface ItemTechPatch {
  itemId: string;
  procedure?: string | null;
  complete?: boolean;
  completeBy?: string | null;
  supplierNote?: string | null;
}

type Row = Record<string, unknown>;

export const TECH_PROCEDURE_MAX = 8000;
export const SUPPLIER_NOTE_MAX = 1000;

function clean(v: unknown, max: number, multiline = false): string | null {
  if (typeof v !== "string") return null;
  const t = multiline ? v.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim() : v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

/** Popis položky do historie („PR-7075-20", jinak název, jinak „položka 2"). */
export function itemRef(row: { drawing_number?: unknown; name?: unknown; position?: unknown }): string {
  const d = typeof row.drawing_number === "string" ? row.drawing_number.trim() : "";
  const n = typeof row.name === "string" ? row.name.trim() : "";
  const p = typeof row.position === "number" ? row.position + 1 : null;
  return d || n || (p ? `položka ${p}` : "položka");
}

/**
 * Patch řádku order_items + změny do historie (field/label/from/to/fromText/toText) — jen to, co se
 * opravdu mění. Kompletní dodávka bez firmy = jen „kompletně zadáno" (firma se doplní z kroku).
 */
export function techPatchChanges(old: Row, p: ItemTechPatch): { patch: Row; changes: Row[] } {
  const patch: Row = {};
  const changes: Row[] = [];
  const ref = itemRef(old);
  const push = (field: string, col: string, label: string, from: string | null, to: string | null, text?: (v: string | null) => string) => {
    if ((from ?? null) === (to ?? null)) return;
    patch[col] = to;
    const t = text ?? ((v: string | null) => v ?? "—");
    changes.push({ field, label, from, to, fromText: t(from), toText: t(to) });
  };
  if (p.procedure !== undefined) {
    push("tech_procedure", "tech_procedure", `Technologický postup ${ref}`, clean(old.tech_procedure, TECH_PROCEDURE_MAX, true), clean(p.procedure, TECH_PROCEDURE_MAX, true),
      (v) => (v ? (v.length > 160 ? `${v.slice(0, 157)}…` : v) : "—"));
  }
  if (p.complete !== undefined || p.completeBy !== undefined) {
    const wasOn = Boolean(old.tech_complete);
    const on = p.complete !== undefined ? Boolean(p.complete) : wasOn;
    const wasBy = clean(old.tech_complete_by, 300);
    const by = on ? (p.completeBy !== undefined ? clean(p.completeBy, 300) : wasBy) : null;
    if (wasOn !== on || wasBy !== by) {
      patch.tech_complete = on;
      patch.tech_complete_by = by;
      const txt = (o: boolean, b: string | null) => (o ? `Bez technologie — kompletně zadáno${b ? ` ${b}` : ""}` : "Technologie u nás / postup");
      changes.push({ field: "tech_complete", label: `Technologie ${ref}`, from: wasOn ? wasBy ?? true : null, to: on ? by ?? true : null, fromText: txt(wasOn, wasBy), toText: txt(on, by) });
    }
  }
  if (p.supplierNote !== undefined) {
    push("item_note", "supplier_note", `Poznámka pro dodavatele ${ref}`, clean(old.supplier_note, SUPPLIER_NOTE_MAX), clean(p.supplierNote, SUPPLIER_NOTE_MAX));
  }
  return { patch, changes };
}

/** Technologie položky v záložce: stav jedním slovem. */
export type TechState = "postup" | "kompletne" | "chybi";

export function techStateOf(t: { procedure: string | null; complete: boolean } | null | undefined): TechState {
  if (t?.complete) return "kompletne";
  if ((t?.procedure ?? "").trim()) return "postup";
  return "chybi";
}

/** „Bez technologie — kompletně zadáno Hrubý" / „Technologický postup (3 řádky)" / „Bez postupu". */
export function techStateText(t: { procedure: string | null; complete: boolean; completeBy: string | null } | null | undefined): string {
  const s = techStateOf(t);
  if (s === "kompletne") return `Bez technologie — kompletně zadáno${t?.completeBy ? ` ${t.completeBy}` : ""}`;
  if (s === "postup") {
    const lines = (t?.procedure ?? "").split("\n").filter((l) => l.trim()).length;
    return `Technologický postup (${lines} ${lines === 1 ? "řádek" : lines < 5 ? "řádky" : "řádků"})`;
  }
  return "Bez postupu — doplní technolog, nebo „kompletně zadáno“";
}
