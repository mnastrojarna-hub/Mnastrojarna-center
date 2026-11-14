/**
 * BALÍK 2 (annot) – stav editoru textu na místě (MTEXT, úprava textu / kóty / odkazu): příkaz v GUI před výzvou
 * „Zadejte text“ ohlásí, co se upravuje (poloha, výška, natočení, rámeček, výchozí obsah); editor v GUI (ui-annot.tsx)
 * po potvrzení uloží výsledek a pošle Enter – příkaz dostane prázdné zadání a vyzvedne výsledek `takeEditorResult()`.
 * Textový režim (agenti) editor nepoužívá – obsah je token výzvy.
 */
import type { Vec2 } from "../model";

export type EditorReq = {
  /** co se upravuje (titulek editoru) */
  title: string;
  /** výchozí obsah (kódy MTEXT) */
  init: string;
  /** bod vložení, výška, natočení [°], šířka rámečku, připojení 1–9 */
  p: Vec2;
  h: number;
  rot: number;
  w: number;
  attach: number;
  /** jednořádkový text (TEXT, tolerance) – Enter potvrdí */
  single?: boolean;
  /** textový styl upravovaného textu (písmo pro tučně / kurzívu v editoru); chybí = aktuální styl */
  style?: string;
  /** úprava mimo příkaz (poklepání): GUI zavolá `apply` místo odeslání Enteru příkazu */
  apply?: (s: string) => void;
};

let pending: EditorReq | null = null;
let result: string | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const editorState = () => pending;
export function openEditor(r: EditorReq) {
  pending = r;
  result = null;
  emit();
}
export function closeEditor() {
  if (!pending) return;
  pending = null;
  emit();
}
/** GUI: potvrzený obsah (příkaz si ho vyzvedne po Enteru) */
export function submitEditor(s: string) {
  result = s;
  pending = null;
  emit();
}
/** příkaz: vyzvedne potvrzený obsah editoru (null = nic) */
export function takeEditorResult(): string | null {
  const r = result;
  result = null;
  return r;
}
export function subscribeEditor(fn: () => void): () => void {
  subs.add(fn);
  return () => void subs.delete(fn);
}
