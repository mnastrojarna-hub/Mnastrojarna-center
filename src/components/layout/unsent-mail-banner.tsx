import Link from "next/link";
import { MailWarning } from "lucide-react";
import type { UnsentMailItem } from "@/lib/data/unsent-mail";
import { UnsentMailRetry } from "./unsent-mail-retry";

/**
 * Výrazná lišta na každé stránce: e-mail, který po kliknutí na „Odeslat" neodešel (majitel 23. 11.: „nesmí
 * zapadnout"). Zmizí sama, jakmile e-mail odejde nebo ho autor zruší.
 */
export function UnsentMailBanner({ items }: { items: UnsentMailItem[] }) {
  if (!items.length) return null;
  const n = items.length;
  const word = n === 1 ? "e-mail neodešel" : n < 5 ? "e-maily neodešly" : "e-mailů neodešlo";
  return (
    <div role="alert" data-testid="unsent-mail-banner" className="border-b border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-100">
      {items.some((it) => it.mine) && <UnsentMailRetry />}
      <div className="mx-auto flex max-w-7xl items-start gap-2">
        <MailWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <strong>{n} {word}</strong>
          <span className="text-rose-800/80 dark:text-rose-200/80"> — systém je zkouší odeslat znovu; když to nejde, oprav příčinu (schránka, adresa) nebo odešli znovu.</span>
          <ul className="mt-1 space-y-0.5">
            {items.slice(0, 5).map((it) => (
              <li key={`${it.source}-${it.id}`} className="truncate">
                <Link href={it.href} className="font-medium underline-offset-2 hover:underline">{it.subject}</Link>
                {it.to && <span className="text-rose-800/80 dark:text-rose-200/80"> → {it.to}</span>}
                {it.reason && <span className="text-rose-800/80 dark:text-rose-200/80"> · {it.reason}</span>}
              </li>
            ))}
            {n > 5 && <li className="text-rose-800/80 dark:text-rose-200/80">…a další ({n - 5})</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
