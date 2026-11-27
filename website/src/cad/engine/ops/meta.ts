/** `název …`, `materiál …`, `barva #hex`, `druh …` (druh položky kusovníku dílu): vlastnosti dokumentu. */
import { tr } from "../../i18n";
import { MATERIALS } from "@/lib/mesh-metrics";
import { runOf } from "../run-doc";
import { coded, say, type OpHandler } from "./util";
import { supplyWord } from "../../bom-model";
import { designationNote } from "../../material-designation";
import { classifyNote, docNameIssue, titleDataLabel, titleHint } from "../../drawing-notes-rules";
import { scopedError, scopedText } from "../codes";

export const metaOp: OpHandler<"meta"> = async (op, ctx) => {
  const r = runOf(ctx);
  if (op.patch.supply !== undefined) {
    // druh položky kusovníku dílu (vlna 22, bod 19): vyráběný / normálie / nakupovaný + údaje; null = výchozí podle původu
    if (r.doc.kind === "assembly") throw new Error(tr("druh: v sestavě se zadává komponentě – sestava komponenta \"…\" druh vyráběný|normálie|nakupovaný"));
    const sp = Object.keys(op.patch.supply).length ? op.patch.supply : null; // {} = výchozí druh podle původu
    const { supply: _s, ...rest } = r.doc;
    void _s;
    r.doc = sp ? { ...rest, supply: sp } : rest;
    r.changed = true;
    const extra = sp ? [sp.catalog ? tr("katalog „{0}“", sp.catalog) : "", sp.vendor ? tr("výrobce „{0}“", sp.vendor) : "", sp.size ? tr("rozměr „{0}“", sp.size) : "", sp.grade ? tr("třída „{0}“", sp.grade) : ""].filter(Boolean) : [];
    say(ctx, sp?.kind ? tr("✓ druh dílu „{0}“: {1}{2}", r.doc.name, supplyWord(sp.kind), extra.length ? ` · ${extra.join(" · ")}` : "") : tr("✓ druh dílu „{0}“: výchozí podle původu", r.doc.name));
    return;
  }
  const { supply: _ignored, ...patch } = op.patch;
  void _ignored;
  // D3 / D5: označení materiálu s dalšími údaji razítka („1.2379 kalený na 58-60 HRC“) se rozdělí – materiál do modelu,
  // tvrdost / tepelné zpracování … do razítka všech listů (ℹ); bez výkresu ✗ s radou (razítko ještě není kam zapsat)
  const moved: string[] = [];
  if (typeof patch.materialName === "string" && patch.materialName.trim()) {
    const cls = classifyNote(patch.materialName);
    const mat = cls?.parts.find((p) => p.key === "material");
    const other = cls?.parts.filter((p) => p.key !== "material") ?? [];
    if (other.length) {
      if (!mat || cls!.mixed) throw scopedError("drawing.note-title-data", tr("materiál"), tr("„{0}“ není označení materiálu – obsahuje {1}; zadejte materiál samotný (materiál 1.2379) a ostatní do razítka: {2}", patch.materialName, other.map((p) => titleDataLabel(p.key)).join(", "), titleHint(other)));
      if (!r.doc.drawings?.length) throw scopedError("drawing.note-title-data", tr("materiál"), tr("„{0}“: {1} nepatří do označení materiálu – zadejte materiál {2} a po založení výkresu {3}", patch.materialName, other.map((p) => titleDataLabel(p.key)).join(", "), mat.value, titleHint(other)));
      const { titleValueProblem } = await import("../../agent-title");
      for (const p of other) {
        const bad = titleValueProblem(p.key, p.value);
        if (bad) throw scopedError("drawing.note-title-data", tr("materiál"), tr("„{0}“: {1} – zapište ho přímo: {2}", patch.materialName, bad, titleHint([p])));
      }
      patch.materialName = mat.value;
      r.doc = { ...r.doc, drawings: r.doc.drawings.map((s) => ({ ...s, meta: { ...s.meta, ...Object.fromEntries(other.map((p) => [p.key, p.value])), by: { ...(((s.meta as { by?: Record<string, string> }).by) ?? {}), ...Object.fromEntries(other.map((p) => [p.key, "agent"])) } } })) };
      moved.push(...other.map((p) => `${titleDataLabel(p.key)} „${p.value}“`));
    }
  }
  r.doc = { ...r.doc, ...patch, ...(patch.materialName !== undefined ? { materialBy: "agent" as const } : {}), ...(patch.name !== undefined ? { nameBy: "agent" as const } : {}) };
  if (moved.length) coded(ctx, "drawing.note-to-title", { text: scopedText("drawing.note-to-title", tr("materiál"), tr("„{0}“ → materiál „{1}“, {2} (údaje razítka se do označení materiálu nepíšou)", op.patch.materialName ?? "", patch.materialName ?? "", moved.join(", "))) });
  const nameBad = typeof patch.name === "string" ? docNameIssue(patch.name) : null;
  if (nameBad) coded(ctx, nameBad.code, { text: scopedText(nameBad.code, tr("název dílu"), nameBad.text) });
  r.changed = true;
  const d = r.doc;
  if (patch.materialName !== undefined) {
    // jedno pravidlo s komponentou sestavy a polem označení v GUI (material-designation.ts): rozpoznaná třída = ℹ, jinak ⚠
    const cls = MATERIALS.find((x) => x.id === d.material) ?? MATERIALS[0];
    const note = designationNote(patch.materialName, d.material);
    if (note?.code === "material.class") {
      // označení s rozpoznanou třídou: hustota podle třídy (EN AW-6082 → hliník) – ℹ material.class (5.2 č. 37)
      say(ctx, tr("✓ materiál „{0}“ = označení do razítka, třída „{1}“ ({2} g/cm³)", patch.materialName, cls.label, cls.density));
      coded(ctx, "material.class", { args: note.args });
    } else if (note) {
      // jen označení: hustota zůstane podle dosavadní třídy – PŘEDPOKLAD, ne ověřený výsledek: → (ℹ msg.note) + ⚠ (nikdy ✓ vedle ⚠,
      // vlna 22 kolo 6); hmotnost v měření, kusovníku i razítku z ní (5.2 č. 37)
      say(ctx, tr("→ materiál „{0}“ uložen jako označení do razítka – třída se z něj nepoznala, hustota zůstává podle třídy „{1}“ ({2} g/cm³); pro jinou hustotu zadejte: materiál {3}", patch.materialName, cls.label, cls.density, MATERIALS.map((x) => x.id).join("|")));
      coded(ctx, "material.density-assumed", { args: note.args });
    }
  } else if (op.patch.material !== undefined) {
    const cls = MATERIALS.find((x) => x.id === op.patch.material);
    const label = cls ? `${cls.label} (${cls.density} g/cm³)` : op.patch.material;
    // označení do razítka zůstává (jako nabídka Materiál v GUI); patří-li jiné třídě (`materiál nerez` po ČSN 11 423), hustota
    // označení odporuje → „→“ + ⚠ material.class-conflict, ne ✓ (bod 22g, kolo 7 – dřív ✓ a v razítku ocel s hustotou nerezu)
    const note = d.materialName ? designationNote(d.materialName, d.material) : null;
    if (note?.code === "material.class-conflict") {
      say(ctx, tr("→ materiál = {0} · označení „{1}“ v razítku zůstává", label, d.materialName!));
      coded(ctx, note.code, { args: note.args });
    } else if (note?.code === "material.density-assumed") {
      // neznámé označení (Hardox 400) + zadaná třída: hustota podle výslovně zadané třídy, označení zůstává
      say(ctx, tr("✓ materiál = {0} · označení „{1}“ v razítku zůstává", label, d.materialName!));
    } else say(ctx, tr("✓ materiál = {0}", label));
  } else if (!nameBad) say(ctx, `✓ ${Object.entries(op.patch).map(([k, v]) => `${k === "name" ? tr("název") : tr("barva")} = ${v}`).join(", ")}`);
};
