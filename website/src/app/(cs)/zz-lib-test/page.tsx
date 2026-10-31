"use client";
import dynamic from "next/dynamic";
const LibraryDialog = dynamic(() => import("@/components/cad/library-dialog").then((m) => m.LibraryDialog), { ssr: false });
export default function P() {
  return <LibraryDialog isAssembly onClose={() => {}} onInsertPart={(d) => console.log("PART", d.name)} onInsertComponent={(d) => console.log("COMP", d.name)} initialQuery="ložisko 6205 2RS" />;
}
