"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileBox, Sparkles, Loader2, Check, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { uploadDrawing } from "@/app/actions/drawings";

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
    const fd = new FormData();
    fd.append("file", file);
    const res = await uploadDrawing(fd);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
    if (res.ok) {
      setMsg({ ok: true, text: `Výkres ${res.number} přečten AI a uložen do archivu.` });
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
