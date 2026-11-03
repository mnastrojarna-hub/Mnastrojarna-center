/**
 * PDF z CAD programu (Producer / Creator / Title v metadatech) — čistá logika bez pdf.js, aby ji mohla
 * použít i pošta (druh přílohy bez AI) a nevedla tak do rendereru anonymizace.
 */

export const CAD_PRODUCERS = /autocad|autodesk|solidworks|inventor|catia|siemens nx|unigraphics|\bnx\b|creo|pro\/?engineer|solid ?edge|draftsight|bricscad|zwcad|progecad|fusion ?360|onshape|thinkdesign|topsolid|vectorworks|microstation|kompas|t-flex|hicad|me10|cocreate|caddy|eplan|tebis|cimatron|visi|alibre|freecad|librecad|qcad|ares commander|gstarcad|plot ?station|hp-gl|plotter|dwg ?trueview|teigha|open design/i;

export function looksLikeCadProducer(info: Record<string, unknown> | null | undefined): boolean {
  if (!info) return false;
  const s = [info.Producer, info.Creator, info.Title].filter((v) => typeof v === "string").join(" ");
  return CAD_PRODUCERS.test(s);
}
