"use client";

import * as React from "react";
import { X, Building2, Factory, UserRound, Contact } from "lucide-react";
import { searchRecipientsAction, type RecipientSuggestion } from "@/app/actions/mail-compose";
import { splitAddresses } from "@/lib/email/threading";
import { cn } from "@/lib/utils";

const KIND_ICON = { "zákazník": Building2, dodavatel: Factory, kolega: UserRound, kontakt: Contact } as const;
const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Pole adresátů (Komu / Kopie / Skrytá kopie): adresy jako štítky, našeptávač z kontaktů zákazníků,
 * dodavatelů a kolegů. Hodnota = adresy oddělené čárkou.
 */
export function RecipientField({
  label, value, onChange, autoFocus, id,
}: {
  label: string;
  value: string[];
  onChange: (v: string[]) => void;
  autoFocus?: boolean;
  id: string;
}) {
  const [text, setText] = React.useState("");
  const [items, setItems] = React.useState<RecipientSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const seq = React.useRef(0);

  React.useEffect(() => {
    const q = text.trim();
    if (q.length < 2) { setItems([]); return; }
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const res = await searchRecipientsAction(q).catch(() => []);
      if (my === seq.current) { setItems(res.filter((r) => !value.includes(r.email))); setActive(0); setOpen(true); }
    }, 200);
    return () => clearTimeout(t);
  }, [text, value]);

  const commit = (raw: string) => {
    const found = splitAddresses(raw);
    const bare = raw.trim();
    const add = found.length ? found : bare && EMAIL_RE.test(bare) ? [bare.toLowerCase()] : [];
    if (add.length) onChange([...value, ...add.filter((a) => !value.includes(a))]);
    setText(add.length || !bare ? "" : raw);
    setOpen(false);
  };

  const invalid = text.trim() && !EMAIL_RE.test(text.trim()) && !open;
  return (
    <div className="relative">
      <div className={cn("flex min-h-10 flex-wrap items-center gap-1 rounded-md border bg-background px-2 py-1 focus-within:ring-2 focus-within:ring-ring", invalid && "border-amber-400")}>
        <label htmlFor={id} className="w-14 shrink-0 text-xs text-muted-foreground">{label}</label>
        {value.map((a) => (
          <span key={a} className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs" data-testid="recipient-chip">
            <span className="truncate">{a}</span>
            <button type="button" onClick={() => onChange(value.filter((x) => x !== a))} aria-label={`Odebrat ${a}`} className="rounded-full p-0.5 hover:bg-background">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          autoFocus={autoFocus}
          value={text}
          onChange={(e) => {
            const v = e.target.value;
            if (/[,;\n]/.test(v)) commit(v.replace(/[,;\n]+$/, ""));
            else setText(v);
          }}
          onKeyDown={(e) => {
            if (open && items.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setActive((i) => (i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length);
            } else if (e.key === "Enter" || e.key === "Tab") {
              if (open && items[active]) { e.preventDefault(); commit(items[active].email); }
              else if (text.trim()) { if (e.key === "Enter") e.preventDefault(); commit(text); }
            } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
            else if (e.key === "Escape") setOpen(false);
          }}
          onBlur={() => setTimeout(() => { if (text.trim()) commit(text); setOpen(false); }, 150)}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none"
          placeholder={value.length ? "" : "e-mail nebo jméno…"}
          autoComplete="off"
          inputMode="email"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-list`}
        />
      </div>
      {open && items.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg" data-testid="recipient-suggestions">
          {items.map((s, i) => {
            const Icon = KIND_ICON[s.kind];
            return (
              <li key={s.email}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => { e.preventDefault(); commit(s.email); }}
                  className={cn("flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm", i === active ? "bg-accent" : "hover:bg-accent")}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{s.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{s.email} · {s.kind}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
