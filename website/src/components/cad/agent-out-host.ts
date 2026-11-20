/**
 * Výstupy pro `window.mncad` v aplikaci (agent-api-host.ts): `window.mncad.save(název)` a poslední sdílený odkaz.
 * Textové výstupní příkazy (`uložit`, `export`, `výkres export`, `skica export`, `sdílet`, `odkaz`) provádí engine
 * (cad/engine/ops/out.ts – stejně v prohlížeči i v CLI, soubory jdou hostiteli `host.files`, v aplikaci stažení bez dialogu
 * přes `writeSaved`); zde zůstává jen to, co volá API aplikace mimo textové příkazy.
 */
import { tr } from "@/cad/i18n";
import { fileLogLine, formatLabel, FORMAT_EXT, outFileName, type OutFileInfo } from "@/cad/agent-out";
import { codeText } from "@/cad/engine/codes";
import { plainName, projectFile } from "@/cad/engine/files";
import type { CadDoc } from "@/cad/types";
import { writeSaved } from "@/lib/save-file";

export { lastShareLink, rememberLink, type LastLink } from "@/cad/engine/share-out";

/** co uložení potřebuje od aplikace (podmnožina ApiHost) */
export type OutHost = {
  /** dokument byl uložen (neuložené změny = žádné) */
  markSaved?: (d: CadDoc) => void;
};

/** projekt .mncad do Stažených bez dialogu (`window.mncad.save`); kontrola: soubor jde zpět přečíst jako projekt */
export async function saveProjectFile(d: CadDoc, name: string | undefined, host?: OutHost, what = tr("uloženo")): Promise<OutFileInfo> {
  const p = projectFile(d, outFileName(name, plainName(d.name), FORMAT_EXT.mncad));
  await writeSaved({ name: p.name, handle: null }, p.data as BlobPart, p.mime);
  host?.markSaved?.(d);
  const log = [fileLogLine(what, p.name, p.data.length, formatLabel("mncad")), tr("  ✓ kontrola: projekt jde znovu otevřít – „{0}“, {1} {2}", p.docName, p.count, p.asm ? tr("komponent") : tr("prvků"))];
  const warning = p.lost.length ? codeText("out.lost-imports", p.lost.join(", ")) : undefined;
  if (warning) log.push(`⚠ ${warning}`);
  return { name: p.name, mime: p.mime, bytes: p.data.length, format: "mncad", log, modelRev: p.modelRev, ...(warning ? { warning } : {}) };
}
