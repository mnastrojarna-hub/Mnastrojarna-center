"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Search, ArrowRight, FileText, Users, Factory, FileBox, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { allNavItems } from "@/lib/nav";
import * as mock from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface SearchEntry { id: string; label: string; hint?: string }
interface SearchData { customers: SearchEntry[]; suppliers: SearchEntry[]; drawings: SearchEntry[]; quotes: SearchEntry[] }

const FALLBACK: SearchData = {
  customers: mock.customers.map((c) => ({ id: c.id, label: c.name, hint: c.ico })),
  suppliers: mock.suppliers.map((s) => ({ id: s.id, label: s.name, hint: s.country })),
  drawings: mock.drawings.map((d) => ({ id: d.id, label: d.number, hint: `${d.material} · rev. ${d.revision}` })),
  quotes: mock.quotes.map((q) => ({ id: q.id, label: q.number, hint: q.customer })),
};

interface CommandPaletteContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
}

const CommandPaletteContext = React.createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette() {
  const ctx = React.useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette must be used within CommandPaletteProvider");
  return ctx;
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [data, setData] = React.useState<SearchData>(FALLBACK);
  const loaded = React.useRef(false);
  const router = useRouter();

  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Při prvním otevření načti živá data (operátorský režim → reálné záznamy)
  React.useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    fetch("/api/search")
      .then((r) => r.json())
      .then((d: SearchData) => {
        if (d && (d.customers || d.suppliers || d.drawings || d.quotes)) setData(d);
      })
      .catch(() => {});
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent hideClose className="top-[12%] max-w-xl overflow-hidden p-0">
          <DialogTitle className="sr-only">Globální vyhledávání</DialogTitle>
          <Command className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
            <div className="flex items-center gap-2 border-b px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <Command.Input
                autoFocus
                placeholder="Hledej emaily, zákazníky, výkresy, nabídky… nebo zadej příkaz"
                className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              />
              <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:block">
                ESC
              </kbd>
            </div>
            <Command.List className="max-h-[60vh] overflow-y-auto scrollbar-thin p-2">
              <Command.Empty className="py-8 text-center text-sm text-muted-foreground">
                Nic nenalezeno.
              </Command.Empty>

              <Command.Group heading="Navigace">
                {allNavItems.map((item) => (
                  <Item key={item.href} onSelect={() => go(item.href)} icon={<item.icon />}>
                    {item.title}
                  </Item>
                ))}
              </Command.Group>

              <Command.Group heading="Zákazníci">
                {data.customers.map((c) => (
                  <Item key={c.id} onSelect={() => go("/customers")} icon={<Users />} hint={c.hint}>
                    {c.label}
                  </Item>
                ))}
              </Command.Group>

              <Command.Group heading="Výkresy">
                {data.drawings.map((d) => (
                  <Item key={d.id} onSelect={() => go("/drawings")} icon={<FileBox />} hint={d.hint}>
                    {d.label}
                  </Item>
                ))}
              </Command.Group>

              <Command.Group heading="Nabídky">
                {data.quotes.map((q) => (
                  <Item key={q.id} onSelect={() => go("/quotes")} icon={<FileText />} hint={q.hint}>
                    {q.label}
                  </Item>
                ))}
              </Command.Group>

              <Command.Group heading="Dodavatelé">
                {data.suppliers.map((s) => (
                  <Item key={s.id} onSelect={() => go("/suppliers")} icon={<Factory />} hint={s.hint}>
                    {s.label}
                  </Item>
                ))}
              </Command.Group>

              <Command.Group heading="AI akce">
                <Item onSelect={() => go("/assistant")} icon={<Sparkles />}>
                  Zeptat se AI asistenta…
                </Item>
              </Command.Group>
            </Command.List>
          </Command>
        </DialogContent>
      </Dialog>
    </CommandPaletteContext.Provider>
  );
}

function Item({
  children,
  onSelect,
  icon,
  hint,
}: {
  children: React.ReactNode;
  onSelect: () => void;
  icon: React.ReactNode;
  hint?: string;
}) {
  return (
    <Command.Item
      onSelect={onSelect}
      className={cn(
        "group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm outline-none",
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground",
      )}
    >
      <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>
      <span className="flex-1 truncate">{children}</span>
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-data-[selected=true]:opacity-60" />
    </Command.Item>
  );
}
