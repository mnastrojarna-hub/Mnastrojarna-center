"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { handoffFiles } from "@/lib/file-handoff";
import { CAD_EXT } from "@/lib/occt";
import { track } from "./analytics";
import { Dropzone } from "./dropzone";
import { Icon } from "./icons";

const CadViewer = dynamic(() => import("./cad-viewer").then((m) => m.CadViewer), {
  ssr: false,
  loading: () => <div className="h-[52vh] min-h-[340px] animate-pulse rounded-2xl bg-white/5" />,
});

/** Veřejný nástroj: 3D prohlížeč STEP/IGES/STL → přímé napojení na poptávku. */
export function CadTool() {
  const [file, setFile] = useState<File | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-5">
      {!file ? (
        <Dropzone
          dark
          multiple={false}
          accept={CAD_EXT.map((e) => "." + e).join(",")}
          title="Přetáhněte sem 3D model nebo klikněte pro výběr"
          hint="STEP / STP, IGES / IGS nebo STL. Soubor se zpracuje jen ve vašem prohlížeči – nikam se neodesílá."
          onFiles={(f) => {
            setFile(f[0]);
            track("cad_viewer_open", { ext: f[0].name.split(".").pop() });
          }}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 font-mono text-sm text-white/70">
              <Icon name="cube" className="h-4 w-4 text-brand" /> {file.name}
              <span className="text-white/35">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={() => setFile(null)} className="btn-ghost-dark !px-4 !py-2 !text-[13px]">
                Jiný soubor
              </button>
              <button
                type="button"
                onClick={() => {
                  handoffFiles([file]);
                  track("cad_viewer_to_rfq");
                  router.push("/poptavka?z=3d");
                }}
                className="btn-primary !px-5 !py-2 !text-[13px]"
              >
                Poptat výrobu tohoto dílu <Icon name="arrow" className="h-4 w-4" />
              </button>
            </div>
          </div>
          <CadViewer file={file} />
          <p className="text-[12px] text-white/40">
            Hmotnost je orientační, vypočtená z objemu modelu a tabulkové hustoty materiálu. Pro přesné nacenění pošlete i výkres
            s tolerancemi.
          </p>
        </>
      )}
    </div>
  );
}
