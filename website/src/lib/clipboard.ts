/**
 * Zkopíruje text do schránky (Clipboard API, záložně skryté textové pole). Vrací true při úspěchu.
 *
 * Záložní cesta musí na chvíli přesunout fokus do skrytého pole (`select()`); potom se fokus i výběr textu vrátí tam,
 * kde byly – jinak by např. konzole po „sdílet“ přišla o fokus a další psaný příkaz by skončil ve zkratkách stránky.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    let restore = () => {};
    try {
      const prev = document.activeElement as (HTMLElement & { selectionStart?: number | null; selectionEnd?: number | null; setSelectionRange?: (a: number, b: number) => void }) | null;
      const range = prev && typeof prev.selectionStart === "number" && typeof prev.selectionEnd === "number" ? [prev.selectionStart, prev.selectionEnd] : null;
      restore = () => {
        try {
          if (!prev || prev === document.body || !prev.isConnected) return;
          prev.focus({ preventScroll: true });
          if (range) prev.setSelectionRange?.(range[0], range[1]);
        } catch {
          /* prvek fokus nepřijme */
        }
      };
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.setAttribute("aria-hidden", "true");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } finally {
        ta.remove();
        restore();
      }
      return ok;
    } catch {
      restore();
      return false;
    }
  }
}
