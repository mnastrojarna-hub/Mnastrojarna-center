"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, EyeOff, History, Loader2, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { queueLegacyDrawings, requeueChangedConfig, saveAnonSettings, setAnonMode } from "@/app/actions/drawing-anon";
import { nudgeAnonymize } from "@/lib/anonymize/nudge-client";
import type { AnonSettings } from "@/lib/anonymize/settings";
import type { RedactToggles } from "@/lib/anonymize/rules";
import { cn } from "@/lib/utils";

/**
 * Nastavení → „Anonymizace výkresů" (spec §6.6): vypínač, zdroje, master fotek, režim, přepínače po
 * skupinách, vlastní termíny a výjimky, CRM zákazník, výplně, DPI/MPx, ověření fotek, denní limit
 * a dnešní čerpání, „Přepočítat po změně pravidel" a „Zpracovat staré výkresy (n)". Ukládá jen super admin.
 */

export interface DrawingAnonSettingsProps {
  settings: AnonSettings;
  mode: "full" | "approval";
  runnerWarning: string | null;
  /** Stav zpracování na pozadí, když je vše v pořádku (zelený řádek). */
  runnerOk?: string | null;
  /** AI pro fotky a skeny chybí / je vypnutá („AI klíč chybí — fotky a skeny čekají na ruční kontrolu"). */
  aiWarning?: string | null;
  /** AI pro fotky a skeny funguje. */
  aiOk?: string | null;
  spentTodayUsd: number;
  legacyCount: number;
  changedCount: number;
  reviewCount: number;
  canEdit: boolean;
}

/** Částky v USD jednotně česky („1,23 US$"). */
const USD = new Intl.NumberFormat("cs-CZ", { style: "currency", currency: "USD" });
export const usd = (n: number) => USD.format(Number.isFinite(n) ? n : 0);

const GROUPS: { key: keyof RedactToggles; label: string; hint: string }[] = [
  { key: "company", label: "Název firmy", hint: "v razítku, rámu a tabulce revizí (+ zákazník z CRM kdekoli)" },
  { key: "logo", label: "Logo a otisk razítka", hint: "obrázky a vektorová loga v razítku a rámu" },
  { key: "person_drawn", label: "Kreslil / konstruoval", hint: "jména a iniciály autora výkresu" },
  { key: "person_checked", label: "Kontroloval / schválil", hint: "jména kontrolora a schvalovatele" },
  { key: "person_revisions", label: "Jména v revizích", hint: "iniciály u změn (text změny a data zůstávají)" },
  { key: "signature", label: "Podpisy a parafy", hint: "ručně psané" },
  { key: "path", label: "Cesty na disk", hint: "C:\\…, \\\\server\\…, SharePoint, plot stamp celý" },
  { key: "contact", label: "Kontakty", hint: "adresa, telefon, e-mail, web, IČO, DIČ" },
  { key: "code", label: "QR a čárové kódy", hint: "odkazy do PLM zákazníka" },
  { key: "copyright_owner", label: "Vlastník v ochranné doložce", hint: "text doložky zůstává" },
  { key: "copyright_whole", label: "Celá ochranná doložka", hint: "výchozí vypnuto" },
];

function lines(v: string): string[] {
  return v.split(/\n|;/).map((s) => s.trim()).filter(Boolean);
}

function Row({ label, hint, checked, onChange, disabled, id }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id: string }) {
  return (
    <div className="flex min-h-11 items-center gap-3 py-1.5">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

export function DrawingAnonSettings(p: DrawingAnonSettingsProps) {
  const router = useRouter();
  const [s, setS] = React.useState<AnonSettings>(p.settings);
  const [terms, setTerms] = React.useState(p.settings.extraTerms.join("\n"));
  const [keep, setKeep] = React.useState(p.settings.keepTerms.join("\n"));
  const [mode, setMode] = React.useState(p.mode);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const dis = !p.canEdit || busy !== null;
  const set = <K extends keyof AnonSettings>(k: K, v: AnonSettings[K]) => setS((x) => ({ ...x, [k]: v }));
  const setRedact = (k: keyof RedactToggles, v: boolean) => setS((x) => ({ ...x, redact: { ...x.redact, [k]: v } }));

  async function run(key: string, fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>, ok: (r: Record<string, unknown>) => string) {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      if (!r.ok) setMsg({ tone: "err", text: r.error ?? "Nepovedlo se." });
      else {
        setMsg({ tone: "ok", text: ok(r) });
        // zařazené výkresy zpracuje route na serveru hned (akce samy nevykreslují)
        const ids = Array.isArray(r.ids) ? (r.ids as string[]) : [];
        if (ids.length) void nudgeAnonymize({ fileIds: ids });
        router.refresh();
      }
    } catch {
      setMsg({ tone: "err", text: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      setBusy(null);
    }
  }

  const save = () => run("save", () => saveAnonSettings({ ...s, extraTerms: lines(terms), keepTerms: lines(keep) }) as never, () => "Nastavení anonymizace uloženo.");

  return (
    <div className="space-y-5" data-testid="anon-settings">
      {p.runnerWarning ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" data-testid="anon-runner-status" data-tone="warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {p.runnerWarning}
        </p>
      ) : p.runnerOk ? (
        <p className="flex items-start gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100" data-testid="anon-runner-status" data-tone="ok">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" /> {p.runnerOk}
        </p>
      ) : null}
      {p.aiWarning ? (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" data-testid="anon-ai-status" data-tone="warn">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {p.aiWarning}
        </p>
      ) : p.aiOk ? (
        <p className="flex items-start gap-2 text-sm text-muted-foreground" data-testid="anon-ai-status" data-tone="ok">
          <EyeOff className="mt-0.5 h-4 w-4 shrink-0" /> {p.aiOk}
        </p>
      ) : null}
      {!p.canEdit && <p className="text-sm text-muted-foreground">Nastavení mění jen super admin — tady ho vidíš jen pro informaci.</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-1 rounded-xl border p-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><EyeOff className="h-4 w-4 text-primary" /> Kdy anonymizovat</h3>
          <Row id="anon-enabled" label="Anonymizace výkresů zapnutá" hint="Hlavní vypínač — bez něj nic automaticky neběží" checked={s.enabled} onChange={(v) => set("enabled", v)} disabled={dis} />
          <Row id="anon-email" label="Výkresy z e-mailu" hint="přílohy poptávek a objednávek" checked={s.autoEmail} onChange={(v) => set("autoEmail", v)} disabled={dis || !s.enabled} />
          <Row id="anon-capture" label="Vyfocené výkresy" hint="dávka i jednotlivá fotka" checked={s.autoCapture} onChange={(v) => set("autoCapture", v)} disabled={dis || !s.enabled} />
          <Row id="anon-upload" label="Ručně nahrané soubory" hint="dokumenty zakázky" checked={s.autoUpload} onChange={(v) => set("autoUpload", v)} disabled={dis || !s.enabled} />
          <Row id="anon-hires" label="Fotky v plném rozlišení (master)" hint="ostřejší anonymizace, víc mobilních dat" checked={s.hiresCapture} onChange={(v) => set("hiresCapture", v)} disabled={dis} />
          <div className="pt-2">
            <span className="mb-1 block text-sm font-medium">Režim</span>
            <div className="inline-flex rounded-lg border p-0.5" role="radiogroup" aria-label="Režim anonymizace">
              {(["full", "approval"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  disabled={dis}
                  onClick={() => run("mode", async () => { const r = await setAnonMode(m); if (r.ok) setMode(m); return r; }, () => (m === "full" ? "Plná automatika: jisté výsledky jdou rovnou ven." : "Se schválením: každý výkres zkontroluje člověk."))}
                  className={cn("min-h-10 rounded-md px-3 text-xs font-semibold", mode === m ? "bg-foreground text-background" : "text-muted-foreground")}
                >
                  {m === "full" ? "Plná automatika" : "Se schválením"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Při jakékoli nejistotě jde výkres vždy „Ke kontrole“ — ven jen to, co prošlo.</p>
          </div>
        </section>

        <section className="rounded-xl border p-4">
          <h3 className="mb-1 text-sm font-semibold">Co se maže</h3>
          <div className="divide-y">
            {GROUPS.map((g) => (
              <Row key={g.key} id={`anon-r-${g.key}`} label={g.label} hint={g.hint} checked={s.redact[g.key]} onChange={(v) => setRedact(g.key, v)} disabled={dis} />
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Vždy zůstává: číslo výkresu, revize, název dílu, materiál, kóty, tolerance, drsnosti, poznámky, normy, data.</p>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Termíny</h3>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Vždy smazat (vlastní termíny)</span>
            <Textarea rows={4} value={terms} onChange={(e) => setTerms(e.target.value)} disabled={dis} placeholder={"jeden název nebo výraz na řádek"} className="text-base placeholder:italic sm:text-sm" />
            <span className="block text-xs text-muted-foreground">Jeden na řádek — zkratky a značky zákazníků, které pravidla nemusí poznat.</span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Nikdy nemazat (výjimky)</span>
            <Textarea rows={3} value={keep} onChange={(e) => setKeep(e.target.value)} disabled={dis} className="text-base sm:text-sm" />
            <span className="block text-xs text-muted-foreground">Naše firma a výrobci dílů (SKF, Bosch…). Normy (ISO, DIN, ČSN) chrání pravidla sama.</span>
          </label>
          <Row id="anon-crm" label="Zákazník zakázky z CRM" hint="jméno, aliasy a kontaktní osoby se smažou kdekoli na výkrese" checked={s.includeCrmCustomer} onChange={(v) => set("includeCrmCustomer", v)} disabled={dis} />
        </section>

        <section className="space-y-3 rounded-xl border p-4">
          <h3 className="text-sm font-semibold">Výstup a náklady</h3>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-sm font-medium">Výplň PDF</span>
              <select className="h-11 w-full rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm" value={s.fillPdf} disabled={dis} onChange={(e) => set("fillPdf", e.target.value as AnonSettings["fillPdf"])}>
                <option value="white">bílá</option>
                <option value="black">černá</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Výplň fotek</span>
              <select className="h-11 w-full rounded-md border bg-background px-2 text-base sm:h-9 sm:text-sm" value={s.fillPhoto} disabled={dis} onChange={(e) => set("fillPhoto", e.target.value as AnonSettings["fillPhoto"])}>
                <option value="background">barva papíru</option>
                <option value="white">bílá</option>
                <option value="black">černá</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Rozlišení PDF (DPI)</span>
              <Input type="number" inputMode="numeric" min={100} max={600} value={s.maxDpi} disabled={dis} onChange={(e) => set("maxDpi", Number(e.target.value))} className="h-11 text-base sm:h-9 sm:text-sm" />
            </label>
            <label className="space-y-1">
              <span className="text-sm font-medium">Strop MPx / strana</span>
              <Input type="number" inputMode="numeric" min={4} max={60} value={s.maxMpx} disabled={dis} onChange={(e) => set("maxMpx", Number(e.target.value))} className="h-11 text-base sm:h-9 sm:text-sm" />
            </label>
          </div>
          <Row id="anon-verify" label="Ověřit fotky druhým čtením" hint="AI výsledek přepíše a zkontroluje, že nic nezůstalo" checked={s.verifyPhotos} onChange={(v) => set("verifyPhotos", v)} disabled={dis} />
          <label className="block space-y-1">
            <span className="text-sm font-medium">Denní limit AI pro automatiku (USD)</span>
            <Input type="number" inputMode="decimal" min={0} max={1000} step={0.5} value={s.dailyUsd} disabled={dis} onChange={(e) => set("dailyUsd", Number(e.target.value))} className="h-11 text-base sm:h-9 sm:text-sm" />
            <span className="block text-xs text-muted-foreground">
              Dnes utraceno <strong>{usd(p.spentTodayUsd)}</strong> z {usd(s.dailyUsd)} · ruční anonymizace limit neblokuje. Fotka ≈ {usd(0.4)}, PDF ≈ {usd(0.2)}.
            </span>
          </label>
        </section>
      </div>

      {msg && (
        <p role={msg.tone === "err" ? "alert" : "status"} className={cn("rounded-lg px-3 py-2 text-sm", msg.tone === "err" ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200")}>{msg.text}</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button onClick={() => void save()} disabled={dis} className="min-h-11 sm:min-h-9" data-testid="anon-settings-save">
          {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Uložit nastavení
        </Button>
        <Button variant="outline" disabled={dis || p.changedCount === 0} className="min-h-11 sm:min-h-9"
          onClick={() => void run("requeue", requeueChangedConfig as never, (r) => `Přepočítá se ${(r as { queued?: number }).queued ?? 0} výkresů (ruční úpravy zůstanou).`)}>
          {busy === "requeue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Přepočítat po změně pravidel ({p.changedCount})
        </Button>
        <Button variant="outline" disabled={dis || p.legacyCount === 0} className="min-h-11 sm:min-h-9"
          onClick={() => void run("legacy", queueLegacyDrawings as never, (r) => `Zpracuje se ${(r as { queued?: number }).queued ?? 0} starých výkresů (v rámci denního limitu).`)}>
          {busy === "legacy" ? <Loader2 className="h-4 w-4 animate-spin" /> : <History className="h-4 w-4" />} Zpracovat staré výkresy ({p.legacyCount})
        </Button>
        {p.reviewCount > 0 && <a href="/inquiries#anonymizace" className="text-sm font-medium text-amber-700 underline-offset-2 hover:underline dark:text-amber-300">{p.reviewCount} ke kontrole →</a>}
      </div>
    </div>
  );
}
