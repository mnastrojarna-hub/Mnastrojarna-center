"use client";

import * as React from "react";
import { Sparkles, Lock, FileSymlink, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { formatIsoDate } from "@/lib/jobs/field-labels";
import { FILE_KINDS } from "@/lib/jobs/file-kinds";
import { BATCH_TYPES } from "@/lib/jobs/capture-batch";
import type { ChipGroup } from "@/lib/jobs/capture-review";
import type { BatchDocType, DuplicateRef, ItemLinkChoice, ItemOption } from "@/lib/jobs/capture-batch-types";
import { cn } from "@/lib/utils";

/** Barevné dlaždice ikon sekcí (stejná paleta jako formulář zakázky). */
export const TONES = {
  rose: "bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300",
  fuchsia: "bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  orange: "bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-300",
  sky: "bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300",
  violet: "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300",
  amber: "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300",
  emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  teal: "bg-teal-100 text-teal-600 dark:bg-teal-500/15 dark:text-teal-300",
  lime: "bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300",
  blue: "bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300",
  slate: "bg-slate-100 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300",
} as const;

export type Tone = keyof typeof TONES;

/** Barva strany dokladu (text štítku): zákazník sky, my rose, dodavatel lime, ostatní slate. */
export const GROUP_TONE: Record<ChipGroup, string> = {
  zakaznik: "text-sky-700 dark:text-sky-400",
  my: "text-rose-700 dark:text-rose-400",
  dodavatel: "text-lime-700 dark:text-lime-400",
  ostatni: "text-slate-600 dark:text-slate-400",
};

/** Levý pruh karty / sekce v barvě strany. */
export const GROUP_BAR: Record<ChipGroup, string> = {
  zakaznik: "bg-sky-500",
  my: "bg-rose-500",
  dodavatel: "bg-lime-500",
  ostatni: "bg-slate-400",
};

export const GROUP_SIDE_LABEL: Record<ChipGroup, string> = {
  zakaznik: "Od zákazníka",
  my: "Od nás",
  dodavatel: "Od dodavatele",
  ostatni: "Ostatní",
};

/** Štítek „ostatních" podle druhu: výkresy a modely zvlášť (fialově), fotky a jiné soubory šedě. */
export function otherSideLabel(docType: BatchDocType | null | undefined): { label: string; tone: string } | null {
  if (!docType) return null;
  const form = BATCH_TYPES[docType]?.form;
  if (BATCH_TYPES[docType]?.group !== "ostatni") return null;
  if (form === "drawing" || form === "model") return { label: "Výkresy a modely", tone: "text-violet-700 dark:text-violet-300" };
  return { label: "Fotky a jiné", tone: GROUP_TONE.ostatni };
}

/** Štítek strany „OD ZÁKAZNÍKA" / „OD NÁS" / „OD DODAVATELE" v barvě strany (u ostatních podle druhu). */
export function SideBadge({ group, docType, className }: { group: ChipGroup; docType?: BatchDocType | null; className?: string }) {
  const other = group === "ostatni" ? otherSideLabel(docType) : null;
  return (
    <span className={cn("text-[10px] font-bold uppercase tracking-wider", other?.tone ?? GROUP_TONE[group], className)}>
      {other?.label ?? GROUP_SIDE_LABEL[group]}
    </span>
  );
}

/** Chip druhu dokladu v barvě a s ikonou druhu souboru (FILE_KINDS). */
export function TypeChip({
  docType, className, label, as = "span", ...rest
}: { docType: BatchDocType; className?: string; label?: string; as?: "span" | "button" } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const meta = BATCH_TYPES[docType];
  const fk = FILE_KINDS[meta.fileKind];
  const Icon = fk.icon;
  const cls = cn("inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", fk.badge, className);
  const body = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label ?? meta.label}</span>
    </>
  );
  if (as === "button") {
    return <button type="button" className={cn(cls, "transition hover:ring-2 hover:ring-foreground/15")} {...rest}>{body}</button>;
  }
  return <span className={cls}>{body}</span>;
}

/** Údaj doplněný z jiného dokladu dávky („z faktury FV-118") — modře, vedle fialové „vyplnila AI". */
export function SourceMark({ label, className }: { label: string; className?: string }) {
  return (
    <span title={`Doplněno ${label}`} className={cn("inline-flex min-w-0 items-center gap-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400", className)}>
      <FileSymlink className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  );
}

/** Pole vyplněné AI (✨ + fuchsiový nádech) — člověk má hlavně tohle zkontrolovat. */
export const AI_FIELD = "border-fuchsia-300 bg-fuchsia-50/70 focus-visible:ring-fuchsia-400 dark:border-fuchsia-500/40 dark:bg-fuchsia-500/10";
/** Údaj doplněný z jiného dokladu dávky (modře). */
export const SOURCE_FIELD = "border-blue-300 bg-blue-50/60 focus-visible:ring-blue-400 dark:border-blue-500/40 dark:bg-blue-500/10";
/** Údaj, který zakázka už má (nepřepisuje se). */
export const LOCKED_FIELD = "cursor-not-allowed border-dashed bg-muted/60 text-muted-foreground";

export function Section({
  icon: Icon,
  tone,
  title,
  hint,
  action,
  children,
  className,
  id,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: Tone;
  title: string;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("rounded-2xl border bg-card p-3 shadow-sm sm:p-4", className)}>
      <div className="mb-3 flex items-start gap-2.5">
        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", TONES[tone])}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{title}</h3>
          {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function AiMark({ className, label = "vyplnila AI" }: { className?: string; label?: string }) {
  return (
    <span
      title="Vyplnila AI — zkontroluj"
      className={cn("inline-flex items-center gap-0.5 text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-400", className)}
    >
      <Sparkles className="h-3 w-3" />
      <span className="sr-only sm:not-sr-only">{label}</span>
    </span>
  );
}

export function LockedMark({ className }: { className?: string }) {
  return (
    <span title="Zakázka už tento údaj má — nepřepisuje se" className={cn("inline-flex items-center gap-0.5 text-[10px] text-muted-foreground", className)}>
      <Lock className="h-3 w-3" />
      <span className="sr-only sm:not-sr-only">už v zakázce</span>
    </span>
  );
}

/** Jistota AI jako barevný proužek (zelená ≥ 85 %, oranžová ≥ 60 %, jinak červená). */
export function ConfidenceMeter({ value, className }: { value: number; className?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  const tone = pct >= 85 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  const text = pct >= 85 ? "text-emerald-700 dark:text-emerald-400" : pct >= 60 ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400";
  const label = pct >= 85 ? "jistá" : pct >= 60 ? "spíš jistá" : "nejistá";
  return (
    <div className={cn("flex items-center gap-2", className)} title={`Jistota AI ${pct} %`}>
      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Jistota AI">
        <div className={cn("h-full rounded-full transition-all", tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className={cn("text-xs font-semibold tabular-nums", text)}>{pct} %</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/** Skóre shody zakázky jako barevná pilulka. */
export function ScorePill({ score }: { score: number }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const tone = s >= 90 ? TONES.emerald : s >= 60 ? TONES.sky : TONES.slate;
  return <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums", tone)}>shoda {s} %</span>;
}

export function FieldLabel({ htmlFor, children, extra }: { htmlFor: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
      <span className="truncate">{children}</span>
      {extra}
    </label>
  );
}

/** Segmentový přepínač (zákazník: existující / nový / bez). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className,
}: {
  value: T;
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn("inline-flex w-full max-w-full rounded-lg bg-muted p-0.5 sm:w-auto", className)}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              // úzký mobil: popisek se zalomí místo přetečení
              "flex min-h-9 min-w-0 flex-1 basis-0 items-center justify-center gap-1.5 rounded-md px-1.5 py-1 text-center text-xs font-medium leading-tight transition sm:min-h-0 sm:basis-auto sm:flex-none sm:whitespace-nowrap sm:px-3 sm:py-1.5",
              on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0 break-words">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Výběrový list (na mobilu zespodu přes šířku, na počítači uprostřed) — změna druhu,
 * akce stránky, „Sloučit s…", „Patří k…". Vnořený dialog: Escape zavře jen list.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        data-testid={testId}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "bottom-0 top-auto max-h-[85dvh] max-w-lg overflow-y-auto rounded-b-none rounded-t-2xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] scrollbar-thin",
          "sm:bottom-auto sm:top-[12%] sm:rounded-2xl",
        )}
      >
        <DialogTitle className="pr-10 leading-snug">{title}</DialogTitle>
        {description && <div className="mt-1 text-xs text-muted-foreground">{description}</div>}
        <div className="mt-3">{children}</div>
      </DialogContent>
    </Dialog>
  );
}

/** Přepínač s popiskem a nápovědou (účinky dokladu: potvrzení DL, vítězná nabídka…). */
export function ToggleRow({
  id, label, hint, checked, onChange, disabled,
}: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border p-2.5", checked && "border-emerald-200 bg-emerald-50/50 dark:border-emerald-500/30 dark:bg-emerald-500/5")}>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className="mt-0.5" />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer text-sm">
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </label>
    </div>
  );
}

/** Doklad už byl dřív uložený — neukládat znovu / uložit jako novou verzi. */
export function DuplicateNotice({
  dup, value, onChange,
}: {
  dup: DuplicateRef;
  value: "skip" | "version" | null;
  onChange: (v: "skip" | "version") => void;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <p className="flex items-start gap-1.5">
        <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span>Už je u {dup.jobNumber}{dup.date ? ` (${formatIsoDate(dup.date) ?? dup.date})` : ""}{dup.what ? ` — ${dup.what}` : ""}</span>
      </p>
      <div role="radiogroup" aria-label="Duplicitní doklad" className="mt-2 flex flex-wrap gap-1.5">
        {([["skip", "Neukládat znovu"], ["version", "Uložit jako novou verzi"]] as const).map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "rounded-full border px-3 py-1.5 font-medium transition",
              value === v ? "border-transparent bg-amber-600 text-white" : "bg-background text-foreground hover:bg-accent",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Vazba výkresu / modelu na položku jako hodnota <select>. */
export function linkKey(l: ItemLinkChoice): string {
  if (l.mode === "item") return `item:${l.itemId}`;
  if (l.mode === "docItem") return `docItem:${l.itemKey}`;
  return l.mode;
}

export function parseLinkKey(v: string): ItemLinkChoice {
  if (v.startsWith("item:")) return { mode: "item", itemId: v.slice(5) };
  if (v.startsWith("docItem:")) return { mode: "docItem", itemKey: v.slice(8) };
  return v === "add" ? { mode: "add" } : { mode: "none" };
}

/** Výběr položky zakázky, ke které výkres / model patří (+ založit novou / bez vazby). */
export function ItemLinkSelect({
  id, value, options, onChange, disabled,
}: {
  id: string;
  value: ItemLinkChoice;
  options: ItemOption[];
  onChange: (l: ItemLinkChoice) => void;
  disabled?: boolean;
}) {
  const list = [...options];
  const keys = new Set(list.map((o) => linkKey(o.link)));
  if (!keys.has("add")) list.push({ link: { mode: "add" }, label: "Založit novou položku", drawingNumber: "", revision: "" });
  if (!keys.has("none")) list.push({ link: { mode: "none" }, label: "Bez vazby na položku", drawingNumber: "", revision: "" });
  const current = linkKey(value);
  if (!list.some((o) => linkKey(o.link) === current)) list.unshift({ link: value, label: "Vybraná položka", drawingNumber: "", revision: "" });
  return (
    <NativeSelect id={id} value={current} disabled={disabled} onChange={(e) => onChange(parseLinkKey(e.target.value))}>
      {list.map((o) => (
        <option key={linkKey(o.link)} value={linkKey(o.link)}>
          {o.label}{o.drawingNumber && !o.label.includes(o.drawingNumber) ? ` · ${o.drawingNumber}` : ""}{o.revision ? ` rev. ${o.revision}` : ""}
        </option>
      ))}
    </NativeSelect>
  );
}
