"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface QuickField {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
}

export function QuickAddDialog({
  triggerLabel,
  title,
  fields,
  action,
}: {
  triggerLabel: string;
  title: string;
  fields: QuickField[];
  action: (values: Record<string, string>) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await action(values);
    setBusy(false);
    if (res.ok) {
      setValues({});
      setOpen(false);
      router.refresh();
    } else {
      setError(res.error ?? "Chyba");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="top-[12%] p-5">
        <DialogTitle className="mb-3">{title}</DialogTitle>
        <form onSubmit={submit} className="space-y-3">
          {fields.map((f) => (
            <div key={f.name} className="space-y-1.5">
              <label htmlFor={f.name} className="text-sm font-medium">
                {f.label}{f.required && <span className="text-destructive"> *</span>}
              </label>
              <Input
                id={f.name}
                type={f.type ?? "text"}
                placeholder={f.placeholder}
                required={f.required}
                value={values[f.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
              />
            </div>
          ))}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Zrušit</Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Uložit
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
