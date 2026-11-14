/** Výkres CAD, který jde převést na PDF (DXF / DWG) — podle názvu souboru (klient i server). */
export function isCadDrawingName(filename: string | null | undefined): boolean {
  return /\.(dxf|dwg)$/i.test(String(filename ?? "").trim());
}

/** Poznámka převedeného PDF (zobrazí se u dokumentu; klient podle ní pozná výkres, který PDF už má). */
export function convertNote(sourceName: string): string {
  return `Převedeno z ${sourceName}`;
}

/** Adresa dokumentu zakázky → jeho id (/api/jobs/files/<uuid>). */
export function jobFileIdFromHref(href: string | null | undefined): string | null {
  const m = /^\/api\/jobs\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#]|$)/i.exec(String(href ?? ""));
  return m ? m[1].toLowerCase() : null;
}

/** Název PDF: stejný základ jako výkres; zabraný jiným dokumentem → „(z DXF)". */
export function pdfNameFor(sourceName: string, taken: (name: string) => boolean): string {
  const base = sourceName.replace(/\.(dxf|dwg)$/i, "") || "vykres";
  const plain = `${base}.pdf`;
  if (!taken(plain)) return plain;
  const ext = (/\.(dxf|dwg)$/i.exec(sourceName)?.[1] ?? "CAD").toUpperCase();
  const alt = `${base} (z ${ext}).pdf`;
  if (!taken(alt)) return alt;
  for (let i = 2; i < 100; i++) if (!taken(`${base} (z ${ext} ${i}).pdf`)) return `${base} (z ${ext} ${i}).pdf`;
  return `${base} (z ${ext} ${Date.now()}).pdf`;
}

/** Poznámka PDF upraveného výkresu (smazané prvky / skryté hladiny v prohlížeči; originál beze změny). */
export function editedNote(sourceName: string, deleted: number, layers: number): string {
  const parts: string[] = [];
  if (deleted) parts.push(`smazáno prvků: ${deleted}`);
  if (layers) parts.push(`změněné hladiny: ${layers}`);
  return `Upravená kopie z ${sourceName}${parts.length ? ` (${parts.join(", ")})` : ""} — originál beze změny`;
}

export function isEditedNote(note: string | null | undefined): boolean {
  return String(note ?? "").startsWith("Upravená kopie z ");
}

/** Název PDF upraveného výkresu: „<základ> (upraveno).pdf". */
export function editedPdfName(sourceName: string): string {
  return `${sourceName.replace(/\.(dxf|dwg)$/i, "") || "vykres"} (upraveno).pdf`;
}
