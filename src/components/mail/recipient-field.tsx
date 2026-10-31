"use client";

import * as React from "react";
import { X, Building2, Factory, UserRound, Contact, MessagesSquare, AlertTriangle } from "lucide-react";
import { searchRecipientsAction, type RecipientSuggestion } from "@/app/actions/mail-compose";
import { splitPasted, suggestionDetail } from "@/lib/contacts/suggest";
import { cn } from "@/lib/utils";

const KIND_ICON = {
  "zákazník": Building2, dodavatel: Factory, kolega: UserRound, kontakt: Contact, konverzace: MessagesSquare,
} as const;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;

/** Souvislost pole (zákazník / dodavatel / zakázka) — jejich adresy se nabídnou nahoře i bez psaní. */
export interface RecipientContext {
  customerId?: string | null;
  supplierId?: string | null;
  jobId?: string | null;
}

/** Jména k adresám vybraným z našeptávače (štítek ukáže „Pavel Novák"). */
const NAMES = new Map<string, string>();

export function isValidRecipient(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

/** „Jan <JAN@a.cz>" → „jan@a.cz"; neplatný text zůstane, jak je (štítek se zvýrazní). */
export function normalizeToken(raw: string): string {
  const t = raw.trim();
  const m = /<([^<>]+)>\s*$/.exec(t);
  const a = (m ? m[1] : t).trim();
  if (EMAIL_RE.test(a)) {
    const e = a.toLowerCase();
    const name = m ? t.slice(0, m.index).replace(/^["'\s]+|["'\s]+$/g, "") : "";
    if (name && !NAMES.has(e)) NAMES.set(e, name);
    return e;
  }
  return t;
}

/** Text adres oddělených čárkou / středníkem → štítky (bez duplicit). */
export function tokensOf(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? "").split(/[,;\n]+/)) {
    if (!raw.trim()) continue;
    const t = normalizeToken(raw);
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out;
}

/** Načítání návrhů (debounce, poslední vyhrává) — sdílí pole adresátů i jednoduché pole e-mailu. */
function useSuggestions(text: string, enabled: boolean, context: RecipientContext | null | undefined, exclude: string[]) {
  const [items, setItems] = React.useState<RecipientSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  /** Pro jaký text je seznam načtený (Enter nesmí vzít návrh ke staršímu textu). */
  const [itemsFor, setItemsFor] = React.useState<string | null>(null);
  /** Uživatel vybírá šipkami. */
  const [navigated, setNavigated] = React.useState(false);
  const seq = React.useRef(0);
  const ctxKey = `${context?.customerId ?? ""}|${context?.supplierId ?? ""}|${context?.jobId ?? ""}`;
  const excludeKey = exclude.join(",");
  const ctxRef = React.useRef(context);
  ctxRef.current = context;

  React.useEffect(() => {
    if (!enabled) {
      seq.current++;
      setOpen(false);
      return;
    }
    const q = text.trim();
    if (q.length === 1) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const ex = excludeKey ? excludeKey.split(",") : [];
      const res = await searchRecipientsAction(q, { ...(ctxRef.current ?? {}), exclude: ex }).catch(() => [] as RecipientSuggestion[]);
      if (my !== seq.current) return;
      const list = res.filter((r) => !ex.includes(r.email));
      for (const r of list) if (r.name && r.name !== r.email && (r.kind === "kontakt" || r.kind === "kolega" || r.kind === "konverzace")) NAMES.set(r.email, r.name);
      setItems(list);
      setItemsFor(q);
      setActive(0);
      setNavigated(false);
      setOpen(list.length > 0);
    }, q ? 180 : 60);
    return () => clearTimeout(t);
  }, [text, enabled, ctxKey, excludeKey]);

  return { items, itemsFor, open, setOpen, active, setActive, navigated, setNavigated };
}

function SuggestionList({ id, items, active, onPick, onHover }: {
  id: string; items: RecipientSuggestion[]; active: number; onPick: (s: RecipientSuggestion) => void; onHover: (i: number) => void;
}) {
  return (
    <ul
      id={`${id}-list`}
      role="listbox"
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto overscroll-contain rounded-md border bg-popover p-1 shadow-lg"
      data-testid="recipient-suggestions"
    >
      {items.map((s, i) => {
        const Icon = KIND_ICON[s.kind] ?? Contact;
        const detail = suggestionDetail(s);
        return (
          <li key={s.email}>
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              data-testid="recipient-suggestion"
              data-email={s.email}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(s)}
              onMouseEnter={() => onHover(i)}
              className={cn("flex min-h-11 w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm", i === active ? "bg-accent" : "hover:bg-accent")}
            >
              <Icon className={cn("h-4 w-4 shrink-0", s.related ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  <span className="font-medium">{s.name}</span>
                  {s.name !== s.email && <span className="text-muted-foreground"> · {s.email}</span>}
                </span>
                {detail && <span className="block truncate text-xs text-muted-foreground">{detail}</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Pole adresátů (Komu / Kopie / Skrytá kopie / příjemce dokladu): adresy jako štítky, našeptávač
 * z kontaktních osob zákazníků a dodavatelů (jméno, firma, pozice, účel), kolegů a z konverzací v poště.
 * Šipky + Enter / Tab, dotyk, vložení víc adres najednou, volné psaní. Neplatná adresa = oranžový štítek.
 */
export function RecipientField({
  label, value, onChange, autoFocus, id, context, disabled, placeholder, single, onPicked,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  autoFocus?: boolean;
  id: string;
  context?: RecipientContext | null;
  disabled?: boolean;
  placeholder?: string;
  /** Jen jedna adresa (např. e-mail kontaktní osoby) — výběr nahradí předchozí. */
  single?: boolean;
  /** Vybráno z našeptávače (jméno, firma…) — formulář si může doplnit jméno. */
  onPicked?: (s: RecipientSuggestion) => void;
}) {
  const [text, setText] = React.useState("");
  const [focused, setFocused] = React.useState(false);
  /** Prázdné pole po kliknutí: nabídnout adresy (související se zakázkou / nejčastější) — jen než je vybraná první. */
  const [browse, setBrowse] = React.useState(false);
  const typing = text.trim().length >= 2;
  const { items, itemsFor, open, setOpen, active, setActive, navigated, setNavigated } = useSuggestions(
    typing ? text : "", focused && !disabled && (typing || browse), context, value,
  );
  const inputRef = React.useRef<HTMLInputElement>(null);

  const add = (list: string[], keepText = "") => {
    const tokens = list.map(normalizeToken).filter(Boolean);
    if (tokens.length) {
      if (single) onChange([tokens[tokens.length - 1]]);
      else onChange([...value, ...tokens.filter((a) => !value.some((v) => v.toLowerCase() === a.toLowerCase()))]);
    }
    setText(keepText);
  };

  const commit = (raw: string) => {
    const bare = raw.trim();
    if (!bare) { setText(""); return; }
    const { emails, rest } = splitPasted(bare);
    if (emails.length && !rest.length) add(emails);
    else if (emails.length) add(emails, rest.join(", "));
    else add([bare]); // volný text, který adresou není → oranžový štítek (odeslání ho odmítne)
    setOpen(false);
    setBrowse(false);
  };

  const pick = (s: RecipientSuggestion) => {
    if (s.name && s.name !== s.email) NAMES.set(s.email, s.name);
    add([s.email]);
    onPicked?.(s);
    setOpen(false);
    setBrowse(false);
    inputRef.current?.focus();
  };

  const remove = (a: string) => onChange(value.filter((x) => x !== a));
  const showPlaceholder = !value.length || (single && !value.length);

  return (
    <div className="relative" data-recipient-field={label} data-value={value.join(", ")}>
      <div
        className={cn(
          "flex min-h-10 flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1 focus-within:ring-2 focus-within:ring-ring",
          disabled && "opacity-60",
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <label htmlFor={id} className="shrink-0 pr-1 text-xs text-muted-foreground sm:w-14">{label}</label>
        {value.map((a) => {
          const ok = isValidRecipient(a);
          const name = ok ? NAMES.get(a.toLowerCase()) : null;
          return (
            <span
              key={a}
              className={cn(
                "inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                ok ? "bg-muted" : "bg-amber-100 text-amber-900 ring-1 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-200",
              )}
              data-testid="recipient-chip"
              data-invalid={ok ? undefined : "1"}
              title={ok ? a : "Neplatná e-mailová adresa — oprav ji nebo odeber"}
            >
              {!ok && <AlertTriangle className="h-3 w-3 shrink-0" />}
              {name ? <span className="truncate"><b className="font-medium">{name}</b> <span className="text-muted-foreground">{a}</span></span> : <span className="truncate">{a}</span>}
              {!disabled && (
                <button type="button" onClick={(e) => { e.stopPropagation(); remove(a); }} aria-label={`Odebrat ${a}`} className="rounded-full p-0.5 hover:bg-background">
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          );
        })}
        <input
          ref={inputRef}
          id={id}
          autoFocus={autoFocus}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;\n]/.test(v)) commit(v.replace(/[,;\n]+$/, ""));
            else setText(v);
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (!/[,;\n]/.test(pasted) && splitPasted(pasted).emails.length <= 1) return;
            e.preventDefault();
            commit(`${text}${pasted}`);
          }}
          onFocus={() => { setFocused(true); setBrowse(!value.length); }}
          onKeyDown={(e) => {
            if (open && items.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setNavigated(true);
              setActive((i) => (navigated ? (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length : e.key === "ArrowDown" ? 0 : items.length - 1));
            } else if (e.key === "ArrowDown" && !open && !text.trim()) {
              // šipka dolů v prázdném poli = ukázat nabídku (i když už adresa je)
              e.preventDefault();
              setBrowse(true);
            } else if (e.key === "Enter" || e.key === "Tab") {
              // návrh jen když patří k napsanému textu (ne starý seznam) a celou adresu nenapsal sám — leda šipkami vybral
              const fresh = open && items[active] && itemsFor === text.trim();
              const typedFull = isValidRecipient(text);
              if (fresh && (!typedFull || navigated)) { e.preventDefault(); pick(items[active]); }
              else if (open && items[active] && !text.trim() && navigated && e.key === "Enter") { e.preventDefault(); pick(items[active]); }
              else if (text.trim()) { if (e.key === "Enter") e.preventDefault(); commit(text); }
            } else if (e.key === "Backspace" && !text && value.length) remove(value[value.length - 1]);
            else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
          }}
          onBlur={() => {
            setFocused(false);
            setOpen(false);
            if (text.trim()) commit(text);
          }}
          className="min-w-[8rem] flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:italic placeholder:text-muted-foreground"
          placeholder={showPlaceholder ? placeholder ?? "e-mail nebo jméno…" : ""}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
        />
      </div>
      {open && items.length > 0 && <SuggestionList id={id} items={items} active={active} onPick={pick} onHover={setActive} />}
    </div>
  );
}

/**
 * Jedno pole e-mailu ve formuláři (kontaktní osoba, zákazník, dodavatel) — vypadá jako běžný vstup,
 * nabízí adresy z pošty a adresáře; výběrem se dá doplnit i jméno / telefon (onPicked).
 */
export function EmailSuggestInput({
  id, value, onChange, onPicked, context, placeholder, className, autoFocus, disabled, "aria-label": ariaLabel,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  onPicked?: (s: RecipientSuggestion) => void;
  context?: RecipientContext | null;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [focused, setFocused] = React.useState(false);
  const [typed, setTyped] = React.useState(false);
  // návrhy jen při psaní (prázdné pole s kontextem = adresy firmy), ne nad hotovou uloženou adresou
  const query = typed ? value : "";
  const { items, open, setOpen, active, setActive, navigated, setNavigated, itemsFor } = useSuggestions(query, focused && !disabled && (typed || !value), context, value ? [value.toLowerCase()] : []);
  const pick = (s: RecipientSuggestion) => {
    onChange(s.email);
    onPicked?.(s);
    setTyped(false);
    setOpen(false);
  };
  return (
    <div className="relative">
      <input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={autoFocus}
        disabled={disabled}
        aria-label={ariaLabel}
        value={value}
        placeholder={placeholder}
        onChange={(e) => { onChange(e.target.value); setTyped(true); }}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); setOpen(false); }}
        onKeyDown={(e) => {
          if (open && items.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setNavigated(true);
            setActive((i) => (navigated ? (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length : e.key === "ArrowDown" ? 0 : items.length - 1));
          } else if (e.key === "Enter" && open && items[active] && (navigated || (itemsFor === value.trim() && !isValidRecipient(value)))) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:italic placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
      />
      {open && items.length > 0 && <SuggestionList id={id} items={items} active={active} onPick={pick} onHover={setActive} />}
    </div>
  );
}

/**
 * Totéž pole nad textovou hodnotou („a@b.cz, c@d.cz") — dialogy dokladů, objednávek, fronty schvalování.
 * Hodnota = štítky spojené „, " (neplatné zůstanou, aby je kontrola před odesláním ohlásila).
 */
export function RecipientInput({
  value, onChange, ...rest
}: Omit<React.ComponentProps<typeof RecipientField>, "value" | "onChange"> & { value: string; onChange: (v: string) => void }) {
  const tokens = React.useMemo(() => tokensOf(value), [value]);
  return <RecipientField {...rest} value={tokens} onChange={(list) => onChange(list.join(", "))} />;
}
