"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileBox, Sparkles, Loader2, Check, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { createDrawingUpload, registerDrawing } from "@/app/actions/drawings";
import { nudgeAnonymize } from "@/lib/anonymize/nudge-client";
import { createClient } from "@/lib/supabase/client";
import { downscaleImage } from "@/lib/jobs/upload-client";

/** Velká fotka: AI čte zmenšenou kopii (originál v plném rozlišení zůstává v archivu pro anonymizaci). */
const AI_COPY_FROM_BYTES = 3_500_000;

/**
 * Nahrání výkresu do archivu: originál jde z prohlížeče PŘÍMO do Supabase Storage (podepsaná URL — žádné
 * bajty přes server action / funkci Vercelu), pak registerDrawing (AI metadata, duplicity, záznam) a hned
 * šťouchnutí do anonymizace.
 */
async function uploadArchiveDrawing(file: File): Promise<Awaited<ReturnType<typeof registerDrawing>>> {
  const mimeType = (file.type || (/\.pdf$/i.test(file.name) ? "application/pdf" : "")).toLowerCase();
  const wantsAiCopy = mimeType.startsWith("image/") && file.size > AI_COPY_FROM_BYTES;
  const prep = await createDrawingUpload({ filename: file.name, size: file.size, mimeType, aiCopy: wantsAiCopy });
  if (!prep.ok || !prep.path || !prep.token || !prep.bucket) return { ok: false, error: prep.error ?? "Nahrání se nepodařilo připravit." };
  const storage = createClient().storage.from(prep.bucket);
  const { error } = await storage.uploadToSignedUrl(prep.path, prep.token, file, { contentType: mimeType, upsert: false });
  if (error) return { ok: false, error: `Nahrání selhalo: ${error.message}` };
  let aiPath: string | null = null;
  if (wantsAiCopy && prep.aiPath && prep.aiToken) {
    const small = await downscaleImage(file);
    if (small !== file) {
      const up = await storage.uploadToSignedUrl(prep.aiPath, prep.aiToken, small, { contentType: "image/jpeg", upsert: false });
      if (!up.error) aiPath = prep.aiPath;
    }
  }
  return registerDrawing({ path: prep.path, filename: file.name, mimeType, aiPath });
}

export function DrawingUpload() {
  const router = useRouter();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMsg(null);
    let res: Awaited<ReturnType<typeof registerDrawing>>;
    try {
      res = await uploadArchiveDrawing(file);
    } catch {
      res = { ok: false, error: "Nahrání selhalo — zkontroluj připojení a zkus to znovu." };
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (res.ok) {
      setMsg({ ok: true, text: `Výkres ${res.number} přečten AI a uložen do archivu.${res.anonStatus === "pending" ? " Kopie pro dodavatele se anonymizuje…" : ""}` });
      // anonymizace hned po nahrání (zpracuje route na serveru)
      if (res.id && res.anonStatus === "pending") void nudgeAnonymize({ table: "drawings", fileIds: [res.id] });
      router.refresh();
    } else {
      setMsg({ ok: false, text: res.error ?? "Chyba uploadu." });
    }
  };

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={onFile}
          className="hidden"
          data-testid="drawing-upload-input"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex flex-col items-center gap-2"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            {busy ? <Loader2 className="h-6 w-6 animate-spin" /> : <FileBox className="h-6 w-6" />}
          </div>
          <div className="text-sm font-medium">{busy ? "AI čte výkres…" : "Nahrát výkres (PDF/obrázek)"}</div>
        </button>
        <p className="max-w-sm text-xs text-muted-foreground">
          <Sparkles className="inline h-3 w-3 text-primary" /> AI automaticky vytáhne číslo výkresu,
          revizi, materiál, rozměry i množství a uloží do archivu.
        </p>
        {msg && (
          <p className={`flex items-center gap-1 text-xs ${msg.ok ? "text-success" : "text-destructive"}`}>
            {msg.ok ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />} {msg.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
