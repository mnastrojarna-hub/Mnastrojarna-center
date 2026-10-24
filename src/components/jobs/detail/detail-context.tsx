"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { updateJob } from "@/app/actions/jobs";
import { uploadJobFiles, type UploadPhase } from "@/lib/jobs/upload-client";
import { guessFileKind, JOB_FILE_MAX_BYTES, FILE_KINDS } from "@/lib/jobs/file-kinds";
import type { JobFileKind } from "@/lib/supabase/database.types";
import type { JobFormOptions, JobInput } from "@/lib/jobs/types";
import { ToastProvider, useNotify, type Notify } from "./toast";

/**
 * Sdílený stav karty zakázky: oprávnění, výběrové seznamy, ukládání polí
 * (updateJob + refresh) a fronta nahrávání (hlavička i záložka Dokumenty).
 */

export interface DetailPerms {
  canDelete: boolean;
  margins: boolean;
  aiCapture: boolean;
  /** #25: Obchodníka zakázky mění jen super admin (bez údaje = canDelete, také jen super admin). */
  ownerEditable?: boolean;
}

export type UploadEntryPhase = "ceka" | UploadPhase | "hotovo" | "chyba";

export interface UploadEntry {
  id: string;
  name: string;
  size: number;
  kind: JobFileKind;
  phase: UploadEntryPhase;
  error?: string;
}

export const UPLOAD_PHASE_LABELS: Record<UploadEntryPhase, string> = {
  ceka: "Čeká…",
  zmenseni: "Zmenšuji fotku…",
  nahravani: "Nahrávám…",
  ukladani: "Ukládám…",
  hotovo: "Hotovo",
  chyba: "Chyba",
};

export interface StartUploadOptions {
  /** Druh pro všechny soubory; bez něj server odhadne podle názvu. */
  kind?: JobFileKind;
  /** Nová verze existujícího dokumentu (jen jeden soubor). */
  replaceFileId?: string;
}

interface DetailContextValue {
  jobId: string;
  perms: DetailPerms;
  options: JobFormOptions;
  notify: Notify;
  /** Uloží změny zakázky; vrací chybu nebo null. */
  save: (patch: JobInput) => Promise<string | null>;
  refresh: () => void;
  refreshing: boolean;
  uploads: UploadEntry[];
  startUpload: (files: File[], opts?: StartUploadOptions) => Promise<void>;
  clearUploads: () => void;
}

const DetailContext = React.createContext<DetailContextValue | null>(null);

export function useJobDetail(): DetailContextValue {
  const ctx = React.useContext(DetailContext);
  if (!ctx) throw new Error("useJobDetail mimo JobDetailProvider");
  return ctx;
}

function Inner({
  jobId, perms, options, children,
}: { jobId: string; perms: DetailPerms; options: JobFormOptions; children: React.ReactNode }) {
  const router = useRouter();
  const notify = useNotify();
  const [refreshing, startRefresh] = React.useTransition();
  const [uploads, setUploads] = React.useState<UploadEntry[]>([]);
  const seq = React.useRef(0);

  const refresh = React.useCallback(() => {
    startRefresh(() => router.refresh());
  }, [router]);

  const save = React.useCallback(async (patch: JobInput): Promise<string | null> => {
    try {
      const res = await updateJob(jobId, patch);
      if (!res.ok) return res.error ?? "Uložení se nepovedlo.";
      refresh();
      return null;
    } catch {
      return "Spojení se nepovedlo — zkus to znovu.";
    }
  }, [jobId, refresh]);

  const patchEntry = React.useCallback((id: string, patch: Partial<UploadEntry>) => {
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }, []);

  const startUpload = React.useCallback(async (files: File[], opts: StartUploadOptions = {}) => {
    const list = files.filter(Boolean);
    if (!list.length) return;
    const tooBig = list.filter((f) => f.size > JOB_FILE_MAX_BYTES && !f.type.startsWith("image/"));
    const ok = list.filter((f) => !tooBig.includes(f));
    if (tooBig.length) {
      notify("error", `${tooBig.map((f) => f.name).join(", ")}: soubor je větší než ${Math.round(JOB_FILE_MAX_BYTES / 1024 / 1024)} MB.`);
    }
    if (!ok.length) return;

    const entries: UploadEntry[] = ok.map((f) => {
      seq.current += 1;
      return {
        id: `u${seq.current}`, name: f.name || "soubor", size: f.size,
        kind: opts.kind ?? guessFileKind(f.name || "", f.type), phase: "ceka",
      };
    });
    setUploads((prev) => [...prev.filter((u) => u.phase !== "hotovo"), ...entries]);

    let current = 0;
    const results = await uploadJobFiles(ok, {
      jobId,
      kind: opts.kind,
      replaceFileId: opts.replaceFileId,
      onFile: (i) => {
        current = i;
      },
      onPhase: (phase) => patchEntry(entries[current].id, { phase }),
    });

    results.forEach((r, i) => {
      patchEntry(entries[i].id, r.ok ? { phase: "hotovo", kind: r.file?.kind ?? entries[i].kind } : { phase: "chyba", error: r.error });
    });
    const okCount = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok);
    if (okCount) {
      const first = results.find((r) => r.ok)?.file;
      const kindText = first && okCount === 1 ? ` (${FILE_KINDS[first.kind]?.label ?? "dokument"})` : "";
      notify(
        "success",
        opts.replaceFileId
          ? `Nahrána nová verze${first ? ` v${first.version}` : ""}.`
          : okCount === 1 ? `Dokument nahrán${kindText}.` : `Nahráno ${okCount} dokumentů.`,
      );
      refresh();
      // hotové řádky po chvíli zmizí
      window.setTimeout(() => {
        setUploads((prev) => prev.filter((u) => !entries.some((e) => e.id === u.id) || u.phase === "chyba"));
      }, 4000);
    }
    if (failed.length) {
      notify("error", failed.length === 1 ? (failed[0].error ?? "Nahrání se nepovedlo.") : `${failed.length} souborů se nepodařilo nahrát.`);
    }
  }, [jobId, notify, patchEntry, refresh]);

  const clearUploads = React.useCallback(() => {
    setUploads((prev) => prev.filter((u) => u.phase !== "hotovo" && u.phase !== "chyba"));
  }, []);

  const value = React.useMemo<DetailContextValue>(() => ({
    jobId, perms, options, notify, save, refresh, refreshing, uploads, startUpload, clearUploads,
  }), [jobId, perms, options, notify, save, refresh, refreshing, uploads, startUpload, clearUploads]);

  return <DetailContext.Provider value={value}>{children}</DetailContext.Provider>;
}

export function JobDetailProvider(props: {
  jobId: string;
  perms: DetailPerms;
  options: JobFormOptions;
  children: React.ReactNode;
}) {
  return (
    <ToastProvider>
      <Inner {...props} />
    </ToastProvider>
  );
}
