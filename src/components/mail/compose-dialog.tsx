"use client";

import * as React from "react";
import { Loader2, Paperclip, Send, X, FolderOpen, ChevronDown, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RecipientField } from "@/components/mail/recipient-field";
import {
  composeContextAction, prepareMailUploadAction, sendComposedAction, type BlockedAttachment, type ComposeAttachmentRef, type SendComposedResult,
} from "@/app/actions/mail-compose";
import { createClient } from "@/lib/supabase/client";
import {
  forwardBlock, forwardSubject, quoteForReply, replyRecipients, replySubject, splitAddresses,
} from "@/lib/email/threading";
import type { ThreadMessage } from "@/lib/email/mail-types";
import { cn } from "@/lib/utils";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward";

export interface ComposeRequest {
  mode: ComposeMode;
  source?: ThreadMessage | null;
  myAddresses?: string[];
  jobId?: string | null;
  /** Předvyplnění nové zprávy. */
  to?: string[];
  subject?: string;
}

const MODE_TITLE: Record<ComposeMode, string> = { new: "Nová zpráva", reply: "Odpovědět", replyAll: "Odpovědět všem", forward: "Přeposlat" };

interface LocalAttachment {
  key: string;
  ref: ComposeAttachmentRef;
  name: string;
  size: number | null;
  state: "uploading" | "ready" | "error";
  error?: string;
}

function fmtSize(n: number | null | undefined): string {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`;
}

/** Výchozí text (podpis + citace / přeposlaná zpráva) — čistá funkce. */
export function initialBody(req: ComposeRequest, signature: string): string {
  const sig = signature.trim() ? `\n\n-- \n${signature.trim()}` : "";
  const src = req.source;
  if (!src || req.mode === "new") return sig ? `${sig}\n` : "";
  const q = { fromName: src.fromName, fromEmail: src.fromEmail, toEmail: src.toEmail, ccEmail: src.ccEmail, subject: src.subject, receivedAt: src.receivedAt, body: src.body };
  return req.mode === "forward" ? `${sig}\n\n${forwardBlock(q)}\n` : `${sig}\n\n${quoteForReply(q)}\n`;
}

/** Okno psaní: nová zpráva, odpověď, odpovědět všem, přeposlání (s původními přílohami). */
export function ComposeDialog({ request, onClose, onSent, onQueued, onOpenSettings }: {
  request: ComposeRequest | null;
  onClose: () => void;
  onSent: (r: SendComposedResult) => void;
  /** Odeslání selhalo, zpráva čeká ve frontě K odeslání (Pošta ukáže lištu). */
  onQueued?: (r: SendComposedResult) => void;
  /** Otevřít Nastavení pošty (chyba hesla / SMTP). */
  onOpenSettings?: () => void;
}) {
  const [outboxId, setOutboxId] = React.useState<string | null>(null);
  const [needsSettings, setNeedsSettings] = React.useState(false);
  /** Výkresy zákazníka, které adresát nesmí dostat bez anonymizace. */
  const [blocked, setBlocked] = React.useState<{ items: BlockedAttachment[]; canOriginal: boolean } | null>(null);
  const isBlocked = (a: LocalAttachment) => Boolean(blocked?.items.some((b) => a.ref.kind === (b.kind ?? "job") && b.ref === a.ref.ref));
  const sendWithout = () => {
    const rest = atts.filter((a) => !isBlocked(a));
    setAtts(rest);
    void send(rest);
  };
  const sendOriginals = () => {
    if (!window.confirm("Poslat ORIGINÁL výkresu zákazníka bez anonymizace? Adresát uvidí zákazníka a projektanta. Zapíše se do auditu.")) return;
    const next = atts.map((a) => (isBlocked(a) ? { ...a, ref: { ...a.ref, original: true } } : a));
    setAtts(next);
    void send(next);
  };
  const open = Boolean(request);
  const [to, setTo] = React.useState<string[]>([]);
  const [cc, setCc] = React.useState<string[]>([]);
  const [bcc, setBcc] = React.useState<string[]>([]);
  const [showCc, setShowCc] = React.useState(false);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [atts, setAtts] = React.useState<LocalAttachment[]>([]);
  const [from, setFrom] = React.useState<string | null>(null);
  const [fromError, setFromError] = React.useState<string | null>(null);
  const [jobFiles, setJobFiles] = React.useState<{ id: string; filename: string; sizeBytes: number | null }[]>([]);
  const [showJobFiles, setShowJobFiles] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!request) return;
    const src = request.source ?? null;
    const mine = request.myAddresses ?? [];
    setError(null);
    setSending(false);
    setOutboxId(null);
    setNeedsSettings(false);
    setBlocked(null);
    setFrom(null);
    setFromError(null);
    setShowJobFiles(false);
    if (src && (request.mode === "reply" || request.mode === "replyAll")) {
      const r = replyRecipients({ direction: src.direction, fromEmail: src.fromEmail, toEmail: src.toEmail, ccEmail: src.ccEmail }, mine, request.mode === "replyAll");
      setTo(r.to);
      setCc(r.cc);
      setShowCc(r.cc.length > 0);
      setSubject(replySubject(src.subject));
    } else if (src && request.mode === "forward") {
      setTo([]);
      setCc([]);
      setShowCc(false);
      setSubject(forwardSubject(src.subject));
    } else {
      setTo(request.to ?? []);
      setCc([]);
      setShowCc(false);
      setSubject(request.subject ?? "");
    }
    setBcc([]);
    setAtts(
      request.mode === "forward" && src
        ? src.attachments.map((a) => ({ key: `o-${a.id}`, ref: { kind: "original" as const, ref: a.id, filename: a.filename }, name: a.filename, size: a.sizeBytes, state: "ready" as const }))
        : [],
    );
    setBody(initialBody(request, ""));
    let alive = true;
    void composeContextAction({ sourceEmailId: src?.id ?? null, jobId: request.jobId ?? src?.jobId ?? null }).then((ctx) => {
      if (!alive) return;
      setFrom(ctx.from ?? null);
      setFromError(ctx.fromError ?? (ctx.ok ? null : ctx.error ?? null));
      setJobFiles(ctx.jobFiles ?? []);
      if (ctx.signature) setBody((b) => (b === initialBody(request, "") ? initialBody(request, ctx.signature ?? "") : b));
    });
    return () => {
      alive = false;
    };
  }, [request]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      const key = `u-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setAtts((a) => [...a, { key, ref: { kind: "upload", ref: "", filename: file.name, contentType: file.type || undefined }, name: file.name, size: file.size, state: "uploading" }]);
      const prep = await prepareMailUploadAction({ filename: file.name, size: file.size, contentType: file.type });
      if (!prep.ok || !prep.path || !prep.token) {
        setAtts((a) => a.map((x) => (x.key === key ? { ...x, state: "error", error: prep.error ?? "Nahrání selhalo." } : x)));
        continue;
      }
      const { error: upErr } = await createClient().storage.from("documents").uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type || "application/octet-stream", upsert: false });
      setAtts((a) => a.map((x) => (x.key === key ? (upErr ? { ...x, state: "error", error: upErr.message } : { ...x, state: "ready", ref: { ...x.ref, ref: prep.path! } }) : x)));
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const addJobFile = (f: { id: string; filename: string; sizeBytes: number | null }) => {
    if (atts.some((a) => a.ref.kind === "job" && a.ref.ref === f.id)) return;
    setAtts((a) => [...a, { key: `j-${f.id}`, ref: { kind: "job", ref: f.id, filename: f.filename }, name: f.filename, size: f.sizeBytes, state: "ready" }]);
  };

  const send = async (list: LocalAttachment[] = atts) => {
    if (!request) return;
    setError(null);
    setBlocked(null);
    if (list.some((a) => a.state === "uploading")) return setError("Počkej, až se nahrají přílohy.");
    if (!to.length) return setError("Doplň adresáta (Komu).");
    setSending(true);
    const res = await sendComposedAction({
      mode: request.mode,
      sourceEmailId: request.source?.id ?? null,
      to: to.join(", "),
      cc: cc.join(", "),
      bcc: bcc.join(", "),
      subject,
      body,
      attachments: list.filter((a) => a.state === "ready").map((a) => a.ref),
      jobId: request.jobId ?? null,
      outboxId,
    }).catch((e: unknown) => ({ ok: false, error: e instanceof Error ? e.message : "Odeslání selhalo." }) as SendComposedResult);
    setSending(false);
    if (!res.ok) {
      setNeedsSettings(Boolean(res.needsSettings));
      if (res.blocked?.length) {
        setBlocked({ items: res.blocked, canOriginal: Boolean(res.canSendOriginal) });
        return;
      }
      if (res.queued && res.outboxId) {
        setOutboxId(res.outboxId);
        onQueued?.(res);
        return setError(`${res.error ?? "Odeslání selhalo."} Zpráva se neztratí — čeká v „K odeslání“. Oprav nastavení schránky a klikni v Poště na Přijmout a odeslat (nebo tady znovu Odeslat).`);
      }
      return setError(res.error ?? "Odeslání selhalo.");
    }
    onSent(res);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !sending && onClose()}>
      <DialogContent
        hideClose
        className="inset-0 top-0 flex h-[100dvh] max-w-none translate-x-0 flex-col rounded-none sm:inset-auto sm:left-1/2 sm:top-[5%] sm:h-auto sm:max-h-[90vh] sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-xl"
        data-testid="compose-dialog"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <DialogTitle className="flex-1">{request ? MODE_TITLE[request.mode] : ""}</DialogTitle>
          <Button size="icon-sm" variant="ghost" onClick={onClose} disabled={sending} aria-label="Zavřít">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto px-4 py-3">
          <p className="text-xs text-muted-foreground" data-testid="compose-from">
            {from ? <>Odešle se z <b className="text-foreground">{from}</b></> : fromError ? <span className="text-destructive">{fromError}</span> : "Zjišťuji, odkud se odešle…"}
          </p>
          <RecipientField id="compose-to" label="Komu" value={to} onChange={setTo} autoFocus={request?.mode === "new" || request?.mode === "forward"} />
          {showCc ? (
            <>
              <RecipientField id="compose-cc" label="Kopie" value={cc} onChange={setCc} />
              <RecipientField id="compose-bcc" label="Skrytá" value={bcc} onChange={setBcc} />
            </>
          ) : (
            <button type="button" onClick={() => setShowCc(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ChevronDown className="h-3.5 w-3.5" /> Kopie / skrytá kopie
            </button>
          )}
          <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Předmět" aria-label="Předmět" />
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={12}
            className="min-h-[14rem] font-[inherit] text-sm leading-relaxed"
            aria-label="Text zprávy"
            autoFocus={request?.mode === "reply" || request?.mode === "replyAll"}
            onFocus={(e) => { if (request?.mode !== "new" && e.currentTarget.selectionStart === e.currentTarget.value.length) e.currentTarget.setSelectionRange(0, 0); }}
          />
          {atts.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" data-testid="compose-attachments">
              {atts.map((a) => (
                <li key={a.key} className={cn("inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-xs", a.state === "error" && "border-destructive text-destructive")}>
                  {a.state === "uploading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />}
                  <span className="truncate">{a.name}</span>
                  {a.size ? <span className="text-muted-foreground">{fmtSize(a.size)}</span> : null}
                  {a.error && <span>— {a.error}</span>}
                  <button type="button" onClick={() => setAtts((x) => x.filter((y) => y.key !== a.key))} aria-label={`Odebrat přílohu ${a.name}`} className="rounded p-0.5 hover:bg-accent">
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} data-testid="compose-file" />
            <Button type="button" size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <Paperclip className="h-4 w-4" /> Přiložit soubor
            </Button>
            {jobFiles.length > 0 && (
              <Button type="button" size="sm" variant="outline" onClick={() => setShowJobFiles((s) => !s)}>
                <FolderOpen className="h-4 w-4" /> Z dokumentů zakázky
              </Button>
            )}
          </div>
          {showJobFiles && (
            <ul className="max-h-40 divide-y overflow-y-auto rounded-md border text-sm" data-testid="compose-job-files">
              {jobFiles.map((f) => (
                <li key={f.id}>
                  <button type="button" onClick={() => addJobFile(f)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-accent">
                    <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{f.filename}</span>
                    <span className="text-xs text-muted-foreground">{fmtSize(f.sizeBytes)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && (
            <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2.5 py-2 text-sm text-destructive" role="alert" data-testid="compose-error">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> <span className="min-w-0 break-words">{error}</span>
            </p>
          )}
          {blocked && (
            <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100" role="alert" data-testid="compose-blocked">
              <p className="flex items-start gap-1.5 font-medium">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Adresát není zákazník{blocked.items.every((b) => (b.kind ?? "job") === "job") ? " zakázky" : ""} — výkres zákazníka smí dostat jen anonymizovaný.</span>
              </p>
              <ul className="space-y-1 pl-6 text-xs">
                {blocked.items.map((b) => <li key={b.ref} className="break-words" data-testid="compose-blocked-item" data-reason={b.reason}>{b.message}</li>)}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" className="bg-background" onClick={sendWithout} disabled={sending} data-testid="compose-send-without">
                  Odeslat bez {blocked.items.length === 1 ? "tohoto výkresu" : "těchto výkresů"}
                </Button>
                {blocked.canOriginal && (
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={sendOriginals} disabled={sending} data-testid="compose-send-original">
                    Poslat originál (super admin, zapíše se do auditu)
                  </Button>
                )}
              </div>
            </div>
          )}
          {error && needsSettings && onOpenSettings && (
            <Button type="button" size="sm" variant="outline" onClick={() => { onClose(); onOpenSettings(); }} data-testid="compose-open-settings">
              Otevřít Nastavení pošty
            </Button>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <span className="mr-auto text-xs text-muted-foreground">{recipientsLabel(splitAddresses([...to, ...cc, ...bcc].join(",")).length)}</span>
          <Button variant="ghost" onClick={onClose} disabled={sending}>Zrušit</Button>
          <Button variant="send" onClick={() => void send()} disabled={sending || !to.length} data-testid="compose-send">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Odeslat
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function recipientsLabel(n: number): string {
  return `${n} ${n === 1 ? "adresát" : n >= 2 && n <= 4 ? "adresáti" : "adresátů"}`;
}
