"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, Check, AlertCircle, Mail, FileUp, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { importOutlookFiles, type ImportFileResult } from "@/app/actions/email-import";
import { debug } from "@/lib/debug/logger";
import { cn } from "@/lib/utils";

/**
 * Nahrání kompletních e-mailových souborů z Outlooku (.msg / .eml).
 * Podporuje výběr více souborů i drag&drop. Každý krok podrobně loguje
 * do spodní debug lišty.
 */
export function OutlookImport() {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const [results, setResults] = React.useState<ImportFileResult[]>([]);
  const [summary, setSummary] = React.useState<string | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setBusy(true);
    setResults([]);
    setSummary(null);

    debug.action(
      "outlook-import",
      `Nahrávám ${files.length} souborů z Outlooku`,
      files.map((f) => ({ name: f.name, type: f.type || "—", sizeKB: Math.round(f.size / 1024) })),
    );

    const fd = new FormData();
    for (const f of files) fd.append("files", f);

    try {
      const res = await importOutlookFiles(fd);
      setResults(res.files);
      const ok = res.files.filter((r) => r.ok).length;
      const fail = res.files.length - ok;
      setSummary(
        res.message ??
          `Zpracováno ${ok} souborů${fail ? `, ${fail} selhalo` : ""}. Uloženo a analyzováno AI: ${res.ingested}.`,
      );
      debug.info("outlook-import", "Import dokončen", res);
      if (res.ingested > 0) router.refresh();
    } catch (err) {
      debug.error("outlook-import", "Import selhal", err);
      setSummary(err instanceof Error ? err.message : "Import selhal.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFiles(e.dataTransfer.files);
        }}
        onClick={() => !busy && inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors",
          dragOver ? "border-primary bg-primary/5" : "hover:border-primary/40 hover:bg-accent/40",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".msg,.eml,.mime,.txt,message/rfc822,application/vnd.ms-outlook"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5" />}
        </div>
        <div className="text-sm font-medium">
          {busy ? "Zpracovávám e-maily…" : "Nahraj soubory z Outlooku (.msg / .eml)"}
        </div>
        <p className="max-w-md text-xs text-muted-foreground">
          <Sparkles className="inline h-3 w-3 text-primary" /> Přetáhni sem celé e-maily exportované z Outlooku.
          AI je automaticky roztřídí, propojí se zákazníkem a připraví návrh odpovědi do fronty.
        </p>
        <Button type="button" size="sm" variant="outline" disabled={busy} className="mt-1">
          <Upload className="h-4 w-4" /> Vybrat soubory
        </Button>
      </div>

      {summary && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="h-3.5 w-3.5" /> {summary}
        </p>
      )}

      {results.length > 0 && (
        <div className="space-y-1.5">
          {results.map((r, i) => (
            <div key={i} className="flex items-start gap-2 rounded-md border p-2 text-xs">
              {r.ok ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{r.fileName}</div>
                {r.ok ? (
                  <div className="truncate text-muted-foreground">
                    {r.subject || "(bez předmětu)"} {r.from && <>· {r.from}</>}
                  </div>
                ) : (
                  <div className="text-destructive">{r.error}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
