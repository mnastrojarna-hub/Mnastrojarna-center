"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FolderPlus, Loader2, Mail, MailOpen, Sparkles, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createJobFromEmail } from "@/app/actions/mail";
import { cn, relativeTime } from "@/lib/utils";

/** E-mail z pošty pro stránky toku (jen čistá data ze serveru). */
export interface FlowEmail {
  id: string;
  from: string;
  fromEmail: string;
  subject: string;
  preview: string;
  category: string;
  customer: string | null;
  receivedAt: string;
  aiConfidence: number;
  unread: boolean;
  jobId: string | null;
  jobNumber: string | null;
}

const CATEGORY_TONE: Record<string, string> = {
  "Poptávka": "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  "Objednávka": "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  "Potvrzení objednávky": "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300",
};

/**
 * E-maily, které AI v poště rozpoznala (poptávky, objednávky). Z každého jde jedním
 * klikem založit zakázku (AI předvyplní zákazníka, předmět, přílohy), nebo otevřít
 * už propojenou zakázku.
 */
export function FlowMailList({ emails }: { emails: FlowEmail[] }) {
  return (
    <ul className="grid gap-2 lg:grid-cols-2">
      {emails.map((e) => (
        <MailRow key={e.id} email={e} />
      ))}
    </ul>
  );
}

function MailRow({ email: e }: { email: FlowEmail }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<{ id: string; number: string | null } | null>(null);
  const jobId = created?.id ?? e.jobId;
  const jobNumber = created?.number ?? e.jobNumber;

  async function create() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createJobFromEmail(e.id);
      if (!res.ok || !res.id) {
        setError(res.error ?? "Zakázku se nepodařilo založit.");
        return;
      }
      setCreated({ id: res.id, number: res.number ?? null });
      router.push(`/orders/${res.id}`);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border bg-card p-3 shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", e.unread ? "bg-cyan-500 text-white" : "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300")}>
          {e.unread ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={cn("truncate text-sm", e.unread ? "font-semibold" : "font-medium")}>{e.from || e.fromEmail}</span>
            <span className={cn("rounded-full px-1.5 py-0.5 text-[10.5px] font-medium", CATEGORY_TONE[e.category] ?? "bg-muted text-muted-foreground")}>{e.category}</span>
            {e.aiConfidence > 0 && (
              <span title="Jistota AI při zařazení" className="inline-flex items-center gap-0.5 text-[10.5px] text-violet-600 dark:text-violet-400">
                <Sparkles className="h-3 w-3" /> {Math.round(e.aiConfidence * 100)} %
              </span>
            )}
            <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">{relativeTime(e.receivedAt)}</span>
          </div>
          <p className="truncate text-sm font-medium">{e.subject || "(bez předmětu)"}</p>
          {e.preview && <p className="line-clamp-2 text-xs text-muted-foreground">{e.preview}</p>}
          {e.customer && <p className="mt-0.5 text-xs text-muted-foreground">Zákazník: <span className="font-medium text-foreground/80">{e.customer}</span></p>}
        </div>
      </div>
      {error && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/inbox">Otevřít v poště</Link>
        </Button>
        {jobId ? (
          <Button asChild variant="outline" size="sm" className="border-sky-200 text-sky-800 hover:bg-sky-50 dark:border-sky-500/30 dark:text-sky-200 dark:hover:bg-sky-500/10">
            <Link href={`/orders/${jobId}`}>
              Otevřít zakázku{jobNumber ? ` ${jobNumber}` : ""} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : (
          <Button type="button" variant="success" size="sm" onClick={() => void create()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
            Založit zakázku
          </Button>
        )}
      </div>
    </li>
  );
}
