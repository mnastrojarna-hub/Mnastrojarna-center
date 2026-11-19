/**
 * Provedení `výkres vygenerované …` (parser cad/agent-drawing-gen.ts) nad aktivním listem: volba listu `genEdit` (skryté
 * `off`, posunuté `move` v mm listu y dolů – stejně jako výběr myší, cad/drawing-boxsel.ts). Přepočet listu ověří, že klíč
 * na listu je; přehled klíčů a úprav pro protokol a `výkres stav`.
 */
import { GEN_KEY, type GenCmd } from "./agent-drawing-gen";
import { genEditCount, hideGenerated, moveGenerated, GEN_PREFIX } from "./drawing-boxsel";
import type { DrawingOptions, DrawingResult, GenEdit } from "./drawing";
import { tr } from "./i18n";
import type { DrawingDoc } from "./types";

type Ctx = { sheet: () => DrawingDoc; put: (s: DrawingDoc) => void; compute: () => Promise<DrawingResult> };
const fmtN = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",").replace(/^-/, "−");
/** popis klíče pro protokol */
export function genKeyText(k: string): string {
  const m = /^dim:(.+):([tl])$/.exec(k);
  if (m) return tr("{0} (kóta celkového rozměru {1})", k, m[2] === "t" ? tr("nahoře") : tr("vlevo"));
  return tr("{0} (pozice)", k);
}

/** úpravy listu jako text: „skryté dim:front:t · posunuté pos:3 [5; −3]“ (posun v mm listu, y nahoru); prázdné = žádné */
export function genEditText(g: GenEdit | undefined): string {
  const off = g?.off ?? [];
  const mv = Object.entries(g?.move ?? {});
  return [off.length ? tr("skryté {0}", off.join(", ")) : "", mv.length ? tr("posunuté {0}", mv.map(([k, d]) => `${k} [${fmtN(d[0])}; ${fmtN(-d[1])}]`).join(", ")) : ""].filter(Boolean).join(" · ");
}

/** Provede `výkres vygenerované …` nad aktivním listem. */
export async function applyGenCmd(ctx: Ctx, cmd: GenCmd): Promise<{ log: string[]; changed: boolean; open: boolean }> {
  const o = () => ctx.sheet().options as Partial<DrawingOptions>;
  const setGen = (g: GenEdit | undefined) => {
    const next = { ...ctx.sheet().options } as Record<string, unknown>;
    if (g && genEditCount(g)) next.genEdit = g;
    else delete next.genEdit;
    ctx.put({ ...ctx.sheet(), options: next });
  };
  const res = await ctx.compute();
  const gen = o().genEdit;
  // klíče na listu: vygenerované objekty výpočtu + skryté (skryté se nekreslí, ve výpočtu nejsou)
  const onSheet = [...new Set([...(res.generated ?? []).map((g) => g.id), ...(gen?.off ?? [])])];
  const known = (k: string) => {
    if (!onSheet.includes(k)) throw new Error(tr("„{0}“ na listu není – vygenerované objekty listu: {1}", k, onSheet.join(", ") || tr("žádné (kóty celkových rozměrů jen u voleb kótovat celkově / základní, pozice jen u sestavy s balónky)")));
  };
  switch (cmd.act) {
    case "list": {
      const edits = genEditText(gen);
      return { log: [tr("Vygenerované objekty listu: {0}", onSheet.map(genKeyText).join(" · ") || "—"), tr("Upravené: {0}", edits || "—")], changed: false, open: false };
    }
    case "hide": {
      cmd.keys.forEach(known);
      setGen(hideGenerated(gen, cmd.keys.map((k) => GEN_PREFIX + k)));
      return { log: [tr("✓ vygenerované skryté: {0}", cmd.keys.join(", "))], changed: true, open: true };
    }
    case "show": {
      cmd.keys.forEach(known);
      setGen({ ...gen, off: (gen?.off ?? []).filter((k) => !cmd.keys.includes(k)) });
      return { log: [tr("✓ vygenerované zobrazené: {0}", cmd.keys.join(", "))], changed: true, open: true };
    }
    case "move": {
      const k = cmd.keys[0];
      known(k);
      // mm listu y nahoru (jako ostatní posuny textem) → list výkresu y dolů
      const next = moveGenerated(gen, [GEN_PREFIX + k], [cmd.d![0], -cmd.d![1]]);
      setGen(next);
      const d = next?.move?.[k] ?? [0, 0];
      return { log: [tr("✓ vygenerované {0} posunuto: celkem [{1}; {2}] mm listu{3}", k, fmtN(d[0]), fmtN(-d[1]), k.startsWith("dim:") ? tr(" (kóta jen kolmo k sobě)") : "")], changed: true, open: true };
    }
    case "restore": {
      if (!cmd.keys.length) {
        const n = genEditCount(gen);
        setGen(undefined);
        return { log: [tr("✓ vygenerované objekty na výchozím místě ({0} obnoveno)", n)], changed: n > 0, open: true };
      }
      const move = { ...(gen?.move ?? {}) };
      for (const k of cmd.keys) delete move[k];
      setGen({ ...(gen?.off ? { off: gen.off.filter((k) => !cmd.keys.includes(k)) } : {}), ...(Object.keys(move).length ? { move } : {}) });
      return { log: [tr("✓ vygenerované obnoveno: {0}", cmd.keys.join(", "))], changed: true, open: true };
    }
  }
}
