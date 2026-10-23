"use client";

import * as React from "react";
import {
  ArrowDownWideNarrow, ArrowUpNarrowWide, Building2, CalendarClock, CircleCheckBig, Columns3, Factory, Filter, History,
  Loader2, MapPin, ReceiptText, Rows3, Search, Truck, UserRound, Wrench, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { Combobox, type ComboOption } from "@/components/jobs/book/combobox";
import { useBookNav } from "@/components/jobs/book/book-nav";
import {
  BOOK_SORTS, DEADLINE_FILTERS, DELIVERY_FILTERS, PAYMENT_FILTERS, RESET_FILTERS, activeFilterCount, deliveryLabel, MAX_QUERY,
  type BookView,
} from "@/components/jobs/book/book-params";
import { useAccess } from "@/components/access-provider";
import { OPERATION_KINDS, isOperationKind } from "@/lib/jobs/operations";
import type { ProductionFilterCounts } from "@/lib/jobs/production-types";
import type { JobDeadlineFilter, JobFormOptions, JobPaymentFilter, JobSort } from "@/lib/jobs/types";
import type { DeliveryState } from "@/lib/jobs/flow-status";
import { cn } from "@/lib/utils";

/**
 * Lišta knihy: hledání (s prodlevou, do URL), filtry obchodník / zpracovává /
 * zákazník / termín / výroba (operace, kde) / dodání / platba / kdo posunul stav, řazení a přepínač
 * Řádky | Tabule. Na mobilu jsou filtry schované pod tlačítkem „Filtry"
 * (s počtem aktivních).
 */
export function BookToolbar({ options, production }: { options: JobFormOptions; production?: ProductionFilterCounts | null }) {
  const { params, navigate, pending } = useBookNav();
  const { userId } = useAccess();
  const [showFilters, setShowFilters] = React.useState(false);

  // hledání: lokální text, do URL s prodlevou 300 ms
  const [text, setText] = React.useState(params.q);
  const [lastSent, setLastSent] = React.useState(params.q);
  if (params.q !== lastSent) {
    // změna zvenku (Zrušit filtry, zpět v prohlížeči)
    setLastSent(params.q);
    setText(params.q);
  }
  React.useEffect(() => {
    const q = text.trim();
    if (q === params.q.trim()) return;
    const t = setTimeout(() => {
      setLastSent(q);
      navigate({ q }, { replace: true });
    }, 300);
    return () => clearTimeout(t);
  }, [text, params.q, navigate]);

  const customerOptions = React.useMemo<ComboOption[]>(
    () => options.customers.map((c) => ({
      value: c.id,
      label: c.name,
      hint: [c.customerNumber, c.ico ? `IČ ${c.ico}` : null].filter(Boolean).join(" · ") || undefined,
    })),
    [options.customers],
  );

  const filters = activeFilterCount({ ...params, q: "" });
  const sortMeta = BOOK_SORTS.find((s) => s.key === params.sort) ?? BOOK_SORTS[0];
  const people = options.users;

  const peopleOptions = (allLabel: string, current: string) => (
    <>
      <option value="">{allLabel}</option>
      {current && current !== userId && !people.some((u) => u.id === current) && <option value={current}>Vybraný uživatel</option>}
      {userId && people.some((u) => u.id === userId) && <option value={userId}>Já</option>}
      {people.filter((u) => u.id !== userId).map((u) => (
        <option key={u.id} value={u.id}>{u.name}</option>
      ))}
    </>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {/* hledání */}
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={text}
            maxLength={MAX_QUERY}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && text) {
                e.preventDefault();
                setText("");
              }
            }}
            placeholder="Hledat číslo, zákazníka, obj. zákazníka, výkres…"
            aria-label="Hledat v knize zakázek"
            className={cn(
              "h-10 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm shadow-sm transition-colors placeholder:text-muted-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              "[&::-webkit-search-cancel-button]:hidden",
              params.q && "border-primary/40",
            )}
          />
          {pending && text.trim() !== "" ? (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          ) : text ? (
            <button
              type="button"
              onClick={() => setText("")}
              aria-label="Vymazat hledání"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* mobil: filtry pod tlačítkem */}
        <Button
          type="button"
          variant={filters ? "secondary" : "outline"}
          className="h-10 shrink-0 lg:hidden"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-controls="book-filters"
        >
          <Filter />
          <span className="hidden sm:inline">Filtry</span>
          {filters > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold leading-5 text-primary-foreground">{filters}</span>
          )}
        </Button>

        <ViewToggle view={params.view} onChange={(view) => navigate({ view })} />
      </div>

      <div
        id="book-filters"
        className={cn(
          "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center",
          !showFilters && "hidden lg:flex",
        )}
      >
        <NativeSelect
          aria-label="Obchodník"
          icon={<UserRound />}
          value={params.owner}
          active={params.owner !== ""}
          onChange={(e) => navigate({ owner: e.target.value })}
          wrapperClassName="lg:w-40"
        >
          {peopleOptions("Všichni obchodníci", params.owner)}
        </NativeSelect>

        <NativeSelect
          aria-label="Zpracovává"
          icon={<Wrench />}
          value={params.assignee}
          active={params.assignee !== ""}
          onChange={(e) => navigate({ assignee: e.target.value })}
          wrapperClassName="lg:w-40"
        >
          {peopleOptions("Zpracovává kdokoli", params.assignee)}
        </NativeSelect>

        <Combobox
          aria-label="Zákazník"
          options={customerOptions}
          value={params.customer || null}
          onChange={(v) => navigate({ customer: v ?? "" })}
          placeholder="Všichni zákazníci"
          emptyText="Žádný takový zákazník"
          icon={<Building2 />}
          active={params.customer !== ""}
          className="lg:w-48"
        />

        <NativeSelect
          aria-label="Termín"
          icon={<CalendarClock />}
          value={params.deadline ?? ""}
          active={params.deadline !== null}
          onChange={(e) => navigate({ deadline: (e.target.value || null) as JobDeadlineFilter | null })}
          wrapperClassName="lg:w-36"
        >
          <option value="">Termín: vše</option>
          {DEADLINE_FILTERS.map((d) => (
            <option key={d.key} value={d.key}>{d.label}</option>
          ))}
        </NativeSelect>

        <ProductionFilters production={production ?? null} />

        <NativeSelect
          aria-label="Platba"
          icon={params.payment === "zaplaceno" ? <CircleCheckBig className="!text-green-600" /> : <ReceiptText className={params.payment === "po_splatnosti" ? "!text-red-600" : undefined} />}
          value={params.payment ?? ""}
          active={params.payment !== null}
          onChange={(e) => navigate({ payment: (e.target.value || null) as JobPaymentFilter | null })}
          wrapperClassName="lg:w-40"
        >
          <option value="">Platba: vše</option>
          {PAYMENT_FILTERS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Dodání"
          icon={<Truck className={params.delivery.length ? "!text-green-600" : undefined} />}
          value={params.delivery[0] ?? ""}
          active={params.delivery.length > 0}
          onChange={(e) => navigate({ delivery: e.target.value ? [e.target.value as DeliveryState] : [] })}
          wrapperClassName="lg:w-40"
        >
          <option value="">Dodání: vše</option>
          {DELIVERY_FILTERS.map((d) => (
            <option key={d} value={d}>{deliveryLabel(d)}</option>
          ))}
        </NativeSelect>

        <NativeSelect
          aria-label="Změnil stav"
          icon={<History />}
          value={params.changedBy}
          active={params.changedBy !== ""}
          onChange={(e) => navigate({ changedBy: e.target.value })}
          wrapperClassName="lg:w-44"
        >
          {peopleOptions("Změnil: kdokoli", params.changedBy)}
        </NativeSelect>

        <div className="flex items-center gap-1 sm:col-span-2 lg:col-span-1">
          <NativeSelect
            aria-label="Řazení"
            value={params.sort}
            onChange={(e) => navigate({ sort: e.target.value as JobSort })}
            wrapperClassName="flex-1 lg:w-40 lg:flex-none"
          >
            {BOOK_SORTS.map((s) => (
              <option key={s.key} value={s.key}>Řadit: {s.label}</option>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => navigate({ dir: params.dir === "asc" ? "desc" : "asc" })}
            title={params.dir === "asc" ? "Vzestupně — přepnout" : "Sestupně — přepnout"}
            aria-label={`Směr řazení podle „${sortMeta.label}": ${params.dir === "asc" ? "vzestupně" : "sestupně"}`}
          >
            {params.dir === "asc" ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
          </Button>
        </div>

        {(filters > 0 || params.q) && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setText("");
              navigate(RESET_FILTERS);
            }}
            className="justify-start text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-500/10 lg:justify-center"
          >
            <X /> Zrušit filtry
          </Button>
        )}
      </div>
    </div>
  );
}

/** Výroba: aktuální operace (barva druhu) a kde se zakázka nachází — s počty aktivních zakázek. */
function ProductionFilters({ production }: { production: ProductionFilterCounts | null }) {
  const { params, navigate } = useBookNav();
  const steps = production?.steps ?? [];
  const locations = production?.locations ?? [];
  const kind = isOperationKind(params.step) ? OPERATION_KINDS[params.step] : null;
  const StepIcon = kind?.icon ?? (params.step === "hotovo" ? CircleCheckBig : Factory);
  const stepKnown = !params.step || steps.some((s) => s.key === params.step);
  const locKnown = !params.location || locations.some((l) => l.name === params.location);
  if (!steps.length && !locations.length && !params.step && !params.location) return null;

  return (
    <>
      <NativeSelect
        aria-label="Výroba: operace"
        icon={<StepIcon className={cn(kind?.text, params.step === "hotovo" && "!text-green-600")} />}
        value={params.step}
        active={params.step !== ""}
        onChange={(e) => navigate({ step: e.target.value })}
        wrapperClassName="lg:w-48"
      >
        <option value="">Výroba: všechny operace</option>
        {!stepKnown && <option value={params.step}>{kind?.label ?? (params.step === "hotovo" ? "Výroba hotová" : params.step)} (0)</option>}
        {steps.map((s) => (
          <option key={s.key} value={s.key}>{s.label} ({s.count})</option>
        ))}
      </NativeSelect>

      {(locations.length > 0 || params.location) && (
        <NativeSelect
          aria-label="Kde: firma"
          icon={<MapPin className={params.location ? "!text-sky-600" : undefined} />}
          value={params.location}
          active={params.location !== ""}
          onChange={(e) => navigate({ location: e.target.value })}
          wrapperClassName="lg:w-44"
        >
          <option value="">Kde: kdekoli</option>
          {!locKnown && <option value={params.location}>{params.location} (0)</option>}
          {locations.map((l) => (
            <option key={l.name} value={l.name}>{l.name} ({l.count})</option>
          ))}
        </NativeSelect>
      )}
    </>
  );
}

function ViewToggle({ view, onChange }: { view: BookView; onChange: (v: BookView) => void }) {
  const item = (v: BookView, label: string, Icon: typeof Rows3) => (
    <button
      type="button"
      onClick={() => onChange(v)}
      aria-pressed={view === v}
      title={label}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
  return (
    <div role="group" aria-label="Zobrazení" className="flex h-10 shrink-0 items-center gap-0.5 rounded-lg bg-muted p-1">
      {item("radky", "Řádky", Rows3)}
      {item("tabule", "Tabule", Columns3)}
    </div>
  );
}
