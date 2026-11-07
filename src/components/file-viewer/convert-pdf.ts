/** Klient převodu výkresu DXF / DWG na PDF (server: /api/jobs/files/<id>/pdf). */

export type ConvertPdfResult =
  | { ok: true; skipped: boolean; file: { id: string; filename: string; version?: number }; sheet?: string }
  | { ok: false; error: string };

export async function convertDrawingToPdf(fileId: string, opts: { skipIfConverted?: boolean } = {}): Promise<ConvertPdfResult> {
  try {
    const res = await fetch(`/api/jobs/files/${encodeURIComponent(fileId)}/pdf${opts.skipIfConverted ? "?skip=1" : ""}`, {
      method: "POST", credentials: "same-origin",
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      /* tělo není JSON */
    }
    if (!res.ok) {
      const msg = typeof body.error === "string" ? body.error : `Převod se nepovedl (chyba ${res.status}).`;
      return { ok: false, error: res.status === 401 ? "Přihlášení vypršelo — obnov stránku a přihlas se znovu." : msg };
    }
    const file = body.file as { id: string; filename: string; version?: number } | undefined;
    if (!file?.id) return { ok: false, error: "Převod se nepovedl (neočekávaná odpověď serveru)." };
    return { ok: true, skipped: body.skipped === true, file, sheet: typeof body.sheet === "string" ? body.sheet : undefined };
  } catch {
    return { ok: false, error: "Spojení se nepovedlo — zkontroluj internet a zkus to znovu." };
  }
}
