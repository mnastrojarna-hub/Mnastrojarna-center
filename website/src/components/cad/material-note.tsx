"use client";

/**
 * Hláška pod polem „Označení materiálu (razítko)“ (vlna 22, kolo 6): stejný kód a text jako protokol textového příkazu
 * `materiál …` – ℹ `material.class` (třída rozpoznaná z označení, hustota podle ní), ⚠ `material.density-assumed` (třída se
 * nepoznala nebo nesouhlasí – hustota podle třídy výše je předpoklad). Odvozená ze stavu dokumentu, nikdy ✓.
 */
import { codeText } from "@/cad/engine/codes";
import { designationNote } from "@/cad/material-designation";

export function MaterialNoteLine({ doc }: { doc: { material: string; materialName?: string } }) {
  const note = designationNote(doc.materialName, doc.material);
  if (!note) return null;
  // ⚠ density-assumed i class-conflict (označení jiné třídy – kolo 7); ℹ třída z označení i podtřída téže skupiny (kolo 7b)
  const warn = note.code !== "material.class" && note.code !== "material.class-family";
  return (
    <span data-material-note={note.code} className={`mt-1 block text-[11px] leading-snug ${warn ? "text-[#9a5b00]" : "text-[#5b6875]"}`}>
      {warn ? "⚠ " : "ℹ "}
      {codeText(note.code, ...note.args)}
    </span>
  );
}
