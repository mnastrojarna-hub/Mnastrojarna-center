"use client";

import * as React from "react";
import { AlertTriangle, ClipboardList, Loader2, PackageCheck, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveItemTechnology, setJobCompleteDelivery } from "@/app/actions/technology";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { techStateOf, techStateText, type ItemTechPatch } from "@/lib/jobs/technology";
import type { JobItem } from "@/lib/jobs/types";
import type { JobOperation } from "@/lib/jobs/production-types";
import { cn } from "@/lib/utils";

/**
 * Technologie položek (záložka „Technologie", majitel 29. 10.): ke každé položce technologický postup
 * technologa (nepovinný), nebo „Bez technologie — kompletně zadáno {firma}" (kompletní dodávka), a
 * „Poznámka pro dodavatele" (pozor popsat na čele, změna materiálu…) — tiskne se do objednávky u položky
 * a shrne se v e-mailu dodavateli.
 */

interface Draft {
  mode: "postup" | "kompletne";
  procedure: string;
  completeBy: string;
  supplierNote: string;
}

function draftOf(it: JobItem, firm: string | null): Draft {
  const t = it.tech;
  return {
    mode: t?.complete ? "kompletne" : "postup",
    procedure: t?.procedure ?? "",
    completeBy: t?.completeBy ?? firm ?? "",
    supplierNote: t?.supplierNote ?? "",
  };
}

function patchOf(it: JobItem, d: Draft): ItemTechPatch {
  const t = it.tech;
  const p: ItemTechPatch = { itemId: it.id };
  if (d.procedure.trim() !== (t?.procedure ?? "").trim()) p.procedure = d.procedure.trim() || null;
  const on = d.mode === "kompletne";
  if (on !== Boolean(t?.complete) || (on && d.completeBy.trim() !== (t?.completeBy ?? "").trim())) {
    p.complete = on;
    p.completeBy = on ? d.completeBy.trim() || null : null;
  }
  if (d.supplierNote.trim() !== (t?.supplierNote ?? "").trim()) p.supplierNote = d.supplierNote.trim() || null;
  return p;
}

function dirty(p: ItemTechPatch): boolean {
  return Object.keys(p).length > 1;
}

/** Firma, které je položka zadaná (krok u dodavatele, který díl dělá) — předvyplní „kompletně zadáno". */
export function itemFirm(itemId: string, ops: JobOperation[]): string | null {
  const live = ops.filter((o) => o.status !== "preskoceno" && !o.inHouse && (o.supplier?.name || o.supplierName));
  const covers = (o: JobOperation) => !o.orderItemIds || o.orderItemIds.includes(itemId);
  const pick = live.find((o) => o.kind === "kompletni_dodavka" && covers(o)) ?? live.find((o) => (o.kind === "vyroba") && covers(o)) ?? live.find(covers);
  return pick ? (pick.supplier?.name ?? pick.supplierName ?? null) : null;
}

const STATE_TONE = {
  postup: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  kompletne: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  chybi: "bg-muted text-muted-foreground",
} as const;

function ItemCard({ jobId, item, firm, onSaved }: { jobId: string; item: JobItem; firm: string | null; onSaved: () => void }) {
  const { notify } = useJobDetail();
  const [d, setD] = React.useState<Draft>(() => draftOf(item, firm));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const sig = JSON.stringify(item.tech ?? null);
  const [synced, setSynced] = React.useState(sig);
  if (sig !== synced) {
    setSynced(sig);
    setD(draftOf(item, firm));
  }
  const patch = patchOf(item, d);
  const changed = dirty(patch);
  const state = techStateOf(item.tech);
  const ids = { proc: React.useId(), note: React.useId(), firm: React.useId() };

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await saveItemTechnology(jobId, [patch]);
      if (!r.ok) { setError(r.error ?? "Technologii se nepodařilo uložit."); return; }
      notify("success", `Technologie ${item.drawingNumber || item.name || "položky"} uložena.${r.notice ? ` ${r.notice}` : ""}`);
      onSaved();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-3 rounded-xl border bg-card p-3 sm:p-4" data-testid="tech-item">
      <div className="flex flex-col items-start gap-1.5">
        <div className="min-w-0 max-w-full">
          <p className="break-words text-[15px] font-semibold leading-tight">
            {item.drawingNumber ? <span className="font-mono">{item.drawingNumber}</span> : null}
            {item.drawingNumber && item.name ? " · " : ""}
            {item.name ?? (item.drawingNumber ? "" : "Položka")}
          </p>
          <p className="text-xs text-muted-foreground">{item.quantity} {item.unit}{item.material ? ` · ${item.material}` : ""}</p>
        </div>
        <span className={cn("inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[11px] font-semibold", STATE_TONE[state])} data-testid="tech-state">
          {techStateText(item.tech)}
        </span>
      </div>

      <div role="radiogroup" aria-label="Technologie položky" className="grid grid-cols-2 gap-1.5">
        {(["postup", "kompletne"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={d.mode === m}
            onClick={() => setD({ ...d, mode: m, completeBy: m === "kompletne" && !d.completeBy ? firm ?? "" : d.completeBy })}
            className={cn(
              "flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-center text-sm font-medium transition sm:min-h-9",
              d.mode === m ? "border-foreground/30 bg-foreground/[0.06] ring-1 ring-foreground/20" : "text-muted-foreground hover:bg-accent",
            )}
          >
            {m === "postup" ? <ClipboardList className="h-4 w-4 shrink-0" /> : <PackageCheck className="h-4 w-4 shrink-0" />}
            <span className="min-w-0">{m === "postup" ? "Technologický postup" : "Kompletně zadáno"}</span>
          </button>
        ))}
      </div>

      {d.mode === "postup" ? (
        <div>
          <label htmlFor={ids.proc} className="mb-1 block text-xs font-medium text-muted-foreground">Technologický postup (nepovinné)</label>
          <Textarea id={ids.proc} rows={3} maxLength={8000} value={d.procedure} onChange={(e) => setD({ ...d, procedure: e.target.value })}
            placeholder={"např. 1. soustružit načisto\n2. frézovat drážku\n3. kalit, brousit Ø20h6"} className="text-base sm:text-sm" />
        </div>
      ) : (
        <div>
          <label htmlFor={ids.firm} className="mb-1 block text-xs font-medium text-muted-foreground">Bez technologie — kompletně zadáno firmě</label>
          <Input id={ids.firm} value={d.completeBy} maxLength={300} onChange={(e) => setD({ ...d, completeBy: e.target.value })}
            placeholder="Název firmy" className="h-11 text-base sm:h-10 sm:text-sm" />
          <p className="mt-1 text-[11px] text-muted-foreground">Postup netřeba — díl dodá firma kompletně. Na co dát pozor, napiš do poznámky pro dodavatele.</p>
        </div>
      )}

      <div>
        <label htmlFor={ids.note} className="mb-1 block text-xs font-medium text-muted-foreground">Poznámka pro dodavatele</label>
        <Input id={ids.note} value={d.supplierNote} maxLength={1000} onChange={(e) => setD({ ...d, supplierNote: e.target.value })}
          placeholder="např. pozor popsat na čele · změna materiálu na 1.4301" className="h-11 text-base sm:h-10 sm:text-sm" data-testid="tech-supplier-note" />
        <p className="mt-1 text-[11px] text-muted-foreground">Vytiskne se do objednávky u této položky („Pozor: …“) a shrne v e-mailu dodavateli.</p>
      </div>

      {error && <p role="alert" className="flex items-start gap-1.5 text-sm text-red-600 dark:text-red-400"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>}
      {changed && (
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => setD(draftOf(item, firm))} disabled={busy}>Zahodit</Button>
          <Button type="button" variant="success" className="h-11 sm:h-9" onClick={() => void save()} disabled={busy} data-testid="tech-save">
            {busy ? <Loader2 className="animate-spin" /> : <Save />} Uložit technologii
          </Button>
        </div>
      )}
    </li>
  );
}

/** Firma celé zakázky (krok kompletní dodávky / výroby u dodavatele, který dělá všechny díly). */
export function jobFirm(ops: JobOperation[]): string | null {
  const live = ops.filter((o) => o.status !== "preskoceno" && !o.inHouse && (o.supplier?.name || o.supplierName));
  const all = (o: JobOperation) => !o.orderItemIds;
  const pick = live.find((o) => o.kind === "kompletni_dodavka" && all(o)) ?? live.find((o) => o.kind === "vyroba" && all(o)) ?? live.find(all);
  return pick ? (pick.supplier?.name ?? pick.supplierName ?? null) : null;
}

/** „Celá zakázka kompletně zadána {firma}" jedním ťuknutím (všechny položky najednou) — nebo zrušení. */
function WholeJobComplete({ jobId, items, ops, onSaved }: { jobId: string; items: JobItem[]; ops: JobOperation[]; onSaved: () => void }) {
  const { notify } = useJobDetail();
  const firm0 = jobFirm(ops);
  const allDone = items.length > 0 && items.every((i) => i.tech?.complete);
  const by = allDone ? [...new Set(items.map((i) => (i.tech?.completeBy ?? "").trim()).filter(Boolean))] : [];
  const [open, setOpen] = React.useState(false);
  const [firm, setFirm] = React.useState(firm0 ?? "");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const id = React.useId();
  if (!items.length) return null;

  async function run(name: string | null) {
    setBusy(true);
    setError(null);
    try {
      const r = await setJobCompleteDelivery(jobId, name);
      if (!r.ok) { setError(r.error ?? "Nepodařilo se uložit."); return; }
      notify("success", name ? `Celá zakázka: kompletně zadáno ${name}.` : "Kompletní zadání celé zakázky zrušeno.");
      setOpen(false);
      onSaved();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  if (allDone) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="tech-whole-job">
        <span className="inline-flex max-w-full items-start gap-1 rounded-2xl bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
          <PackageCheck className="mt-px h-3.5 w-3.5 shrink-0" /> <span className="min-w-0 break-words">Celá zakázka kompletně zadána{by.length === 1 ? ` ${by[0]}` : ""}</span>
        </span>
        <button type="button" disabled={busy} onClick={() => void run(null)} className="min-h-8 font-semibold text-muted-foreground hover:text-foreground hover:underline disabled:opacity-60">
          Zrušit
        </button>
        {error && <span role="alert" className="text-red-600 dark:text-red-400">{error}</span>}
      </div>
    );
  }
  return (
    <div className="space-y-2" data-testid="tech-whole-job">
      {!open ? (
        <Button type="button" variant="outline" className="h-auto min-h-11 w-full justify-start gap-1.5 whitespace-normal py-2 text-left sm:min-h-9 sm:w-auto" onClick={() => (firm0 ? void run(firm0) : setOpen(true))} disabled={busy} data-testid="tech-whole-job-btn">
          {busy ? <Loader2 className="animate-spin" /> : <PackageCheck />} <span className="min-w-0 break-words">{firm0 ? `Celá zakázka kompletně zadána ${firm0}` : "Celá zakázka kompletně zadána…"}</span>
        </Button>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor={id} className="mb-1 block text-xs font-medium text-muted-foreground">Kompletně zadáno firmě (všechny položky)</label>
            <Input id={id} value={firm} maxLength={300} onChange={(e) => setFirm(e.target.value)} placeholder="Název firmy" className="h-11 text-base sm:h-10 sm:text-sm" />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={() => setOpen(false)} disabled={busy}>Zrušit</Button>
            <Button type="button" variant="success" className="h-11 sm:h-10" onClick={() => void run(firm.trim() || null)} disabled={busy || !firm.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Save />} Uložit
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function TechnologySection({ jobId, items, ops, onSaved }: { jobId: string; items: JobItem[]; ops: JobOperation[]; onSaved: () => void }) {
  const done = items.filter((i) => techStateOf(i.tech) !== "chybi").length;
  const notes = items.filter((i) => (i.tech?.supplierNote ?? "").trim()).length;
  return (
    <section aria-label="Technologie položek" className="rounded-2xl border bg-muted/30 p-3 sm:p-4" data-testid="technology-section">
      <header className="mb-3 space-y-2">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold">
            Technologie položek{" "}
            <span className="font-normal text-muted-foreground">· {done}/{items.length} {done === 1 ? "vyplněna" : "vyplněno"}{notes ? ` · ${notes} ${notes === 1 ? "poznámka" : notes < 5 ? "poznámky" : "poznámek"} pro dodavatele` : ""}</span>
          </h3>
          <p className="text-xs text-muted-foreground">Postup technologa ke každé položce, nebo „kompletně zadáno“ (postup pak netřeba). Poznámky pro dodavatele jdou do objednávky.</p>
        </div>
        <WholeJobComplete jobId={jobId} items={items} ops={ops} onSaved={onSaved} />
      </header>
      {items.length ? (
        <ul className="grid gap-3 2xl:grid-cols-2">
          {items.map((it) => <ItemCard key={it.id} jobId={jobId} item={it} firm={itemFirm(it.id, ops)} onSaved={onSaved} />)}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">Zakázka zatím nemá položky — přidej je v záložce Položky.</p>
      )}
    </section>
  );
}
