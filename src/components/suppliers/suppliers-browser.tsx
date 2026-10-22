"use client";

import * as React from "react";
import {
  BadgeCheck, ClipboardList, Clock, Factory, Globe, Mail, MapPin, Phone, Search, SearchX, Star, UserRound, X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { FriendlyEmpty } from "@/components/customers/friendly-empty";
import { avatarToneFor, initialsOf, websiteHref } from "@/components/customers/model";
import { SupplierDialog, type SupplierSuggestions } from "@/components/suppliers/supplier-dialog";
import { StarRating } from "@/components/suppliers/tag-input";
import { filterSuppliers, tagSuggestions, tagTone, type SupplierView } from "@/components/suppliers/model";
import { plural } from "@/lib/jobs/deadlines";
import { cn } from "@/lib/utils";

/**
 * Adresář dodavatelů (kooperace): hledání podle názvu, technologie i materiálu,
 * barevné chipy technologií jako filtr, karty s hodnocením a dodací lhůtou.
 */
export function SuppliersBrowser({ suppliers, initialQuery = "" }: { suppliers: SupplierView[]; initialQuery?: string }) {
  const [q, setQ] = React.useState(initialQuery);
  const [tech, setTech] = React.useState<string | null>(null);
  const [topRated, setTopRated] = React.useState(false);

  const suggestions = React.useMemo<SupplierSuggestions>(() => ({
    technologies: tagSuggestions(suppliers, "technologies"),
    materials: tagSuggestions(suppliers, "materials"),
    certifications: tagSuggestions(suppliers, "certifications"),
  }), [suppliers]);
  const techChips = suggestions.technologies.slice(0, 14);
  const shown = React.useMemo(
    () => filterSuppliers(suppliers, { q, technology: tech, minRating: topRated ? 4 : undefined }),
    [suppliers, q, tech, topRated],
  );

  if (suppliers.length === 0) {
    return (
      <FriendlyEmpty
        icon={<Factory />}
        tone="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
        title="Zatím žádní dodavatelé"
        actions={<SupplierDialog size="lg" />}
      >
        <p>
          Přidej kooperanty — kalírny, frézárny, povrchové úpravy, dodavatele materiálu. U každého zapiš technologie
          a materiály, ať pak jedním hledáním najdeš, kdo co umí.
        </p>
      </FriendlyEmpty>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border bg-card p-2.5 shadow-sm sm:p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Hledej název, technologii, materiál (1.2343), certifikaci…"
              className="h-10 pl-9 pr-9"
              aria-label="Hledat dodavatele"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
                aria-label="Vymazat hledání"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setTopRated((v) => !v)}
            aria-pressed={topRated}
            className={cn(
              "inline-flex h-10 items-center justify-center gap-1.5 rounded-md border px-3 text-sm font-medium transition",
              topRated ? "border-amber-400 bg-amber-400 text-amber-950" : "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300",
            )}
          >
            <Star className={cn("h-4 w-4", topRated && "fill-current")} /> Jen 4★ a lepší
          </button>
        </div>
        {techChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5" aria-label="Filtr technologie">
            {techChips.map((t) => {
              const active = tech?.toLocaleLowerCase("cs") === t.toLocaleLowerCase("cs");
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTech(active ? null : t)}
                  aria-pressed={active}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium transition",
                    active ? "bg-foreground text-background shadow-sm" : cn(tagTone(t), "hover:brightness-95"),
                  )}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <FriendlyEmpty
          compact
          icon={<SearchX />}
          tone="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          title="Nikdo tomu neodpovídá"
          actions={
            <Button variant="outline" size="sm" onClick={() => { setQ(""); setTech(null); setTopRated(false); }}>
              Zrušit hledání a filtry
            </Button>
          }
        >
          Zkus jinou technologii nebo materiál — nebo přidej nového dodavatele.
        </FriendlyEmpty>
      ) : (
        <>
          <p className="px-1 text-xs text-muted-foreground">
            {shown.length === suppliers.length
              ? `${suppliers.length} ${plural(suppliers.length, "dodavatel", "dodavatelé", "dodavatelů")}`
              : `${shown.length} z ${suppliers.length} dodavatelů`}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((s) => (
              <SupplierCard key={s.id} supplier={s} suggestions={suggestions} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SupplierCard({ supplier: s, suggestions }: { supplier: SupplierView; suggestions: SupplierSuggestions }) {
  const web = websiteHref(s.website);
  return (
    <li className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm transition hover:border-orange-500/40 hover:shadow-md">
      <div className="flex items-start gap-3">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold", avatarToneFor(s.name))}>
          {initialsOf(s.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{s.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
            <StarRating value={s.rating} />
            {s.leadDays !== null && (
              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 text-sky-500" />{`${s.leadDays} ${plural(s.leadDays, "den", "dny", "dní")}`}</span>
            )}
            {s.country !== "CZ" && <span className="rounded bg-muted px-1.5 font-medium">{s.country}</span>}
          </div>
        </div>
        <SupplierDialog supplier={s} suggestions={suggestions} iconOnly variant="ghost" />
      </div>

      {s.technologies.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {s.technologies.map((t) => (
            <span key={t} className={cn("rounded-full px-2 py-0.5 text-xs font-medium", tagTone(t))}>{t}</span>
          ))}
        </div>
      )}
      {(s.materials.length > 0 || s.certifications.length > 0) && (
        <div className="flex flex-wrap gap-1">
          {s.materials.map((m) => (
            <span key={m} className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{m}</span>
          ))}
          {s.certifications.map((c) => (
            <span key={c} className="inline-flex items-center gap-0.5 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
              <BadgeCheck className="h-3 w-3" />{c}
            </span>
          ))}
        </div>
      )}
      {s.technologies.length === 0 && s.materials.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Doplň technologie a materiály, ať dodavatele najdeš hledáním.
        </p>
      )}

      <div className="mt-auto space-y-1 border-t pt-2.5 text-xs">
        {s.contactPerson && (
          <div className="flex items-center gap-1.5 font-medium"><UserRound className="h-3.5 w-3.5 text-sky-500" />{s.contactPerson}</div>
        )}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {s.email && (
            <a href={`mailto:${s.email}`} className="inline-flex min-w-0 items-center gap-1 text-sky-700 hover:underline dark:text-sky-400">
              <Mail className="h-3 w-3 shrink-0" /><span className="truncate">{s.email}</span>
            </a>
          )}
          {s.phone && (
            <a href={`tel:${s.phone.replace(/\s/g, "")}`} className="inline-flex items-center gap-1 text-emerald-700 hover:underline dark:text-emerald-400">
              <Phone className="h-3 w-3" />{s.phone}
            </a>
          )}
          {web && (
            <a href={web} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-indigo-700 hover:underline dark:text-indigo-400">
              <Globe className="h-3 w-3" />web
            </a>
          )}
        </div>
        {s.address && (
          <div className="flex items-center gap-1.5 text-muted-foreground"><MapPin className="h-3 w-3 text-violet-500" />{s.address}</div>
        )}
        {s.totalJobs > 0 && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <ClipboardList className="h-3 w-3 text-orange-500" />
            {`${s.totalJobs} ${plural(s.totalJobs, "zakázka", "zakázky", "zakázek")}`}
            {s.activeJobs > 0 && <span className="font-semibold text-orange-700 dark:text-orange-300">{`· ${s.activeJobs} v běhu`}</span>}
          </div>
        )}
        {s.note && <p className="line-clamp-2 text-muted-foreground">{s.note}</p>}
      </div>
    </li>
  );
}
