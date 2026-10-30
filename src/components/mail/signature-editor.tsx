"use client";

import * as React from "react";
import {
  AlertCircle, BadgeCheck, Building2, CheckCircle2, ChevronDown, Image as ImageIcon, Loader2, MapPin, Moon, RotateCcw, Save, Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  SIGNATURE_LIMITS, SIGNATURE_LOGO_PATH, SIGNATURE_VARIANTS, SIGNATURE_VARIANT_INFO, formatPhone, isSignatureEmail, renderSignature,
  safeWebHref, sameSignature, type SignatureBlocks, type SignatureCompany, type SignatureSettings, type SignatureVariant,
} from "@/lib/email/signature";
import { cn } from "@/lib/utils";

/**
 * Editor grafického podpisu e-mailu — patří do „Nastavení pošty" (ozubené kolo v Přijaté poště;
 * na mobilu vysouvací panel, na desktopu boční panel / dialog), Můj účet na něj jen odkazuje.
 *
 * První obrazovka je jednoduchá: (schránka) → varianta s živým náhledem (světlý / tmavý režim)
 * → jméno, pozice, telefon → 4 přepínače (logo, fakturační údaje, adresa, certifikace).
 * Zbytek je ve sbaleném „Pokročilé". Komponenta nic nenačítá ani neukládá sama: hodnota přes
 * value / onChange, uložení přes onSave (server action), výchozí podpis přes `defaults`.
 */

export interface SignatureMailboxOption {
  /** Adresa schránky (klíč podpisu); null = společný podpis pro všechny schránky. */
  key: string | null;
  label: string;
}

export type SignatureSaveResult = { ok: boolean; error?: string };

export interface SignatureEditorProps {
  value: SignatureSettings;
  onChange: (next: SignatureSettings) => void;
  /** Výchozí podpis (profil + schránka + firma) pro „Obnovit výchozí". */
  defaults: SignatureSettings;
  /** Firemní údaje do náhledu (živě z Nastavení). */
  company: SignatureCompany;
  /** Uložení (server action). Bez onSave se tlačítko Uložit neukáže. */
  onSave?: (value: SignatureSettings) => Promise<SignatureSaveResult | void> | SignatureSaveResult | void;
  /** Vlastní „Obnovit výchozí" (např. smazat podpis schránky); jinak se do formuláře vrátí `defaults`. */
  onReset?: () => void;
  /**
   * Uložený podpis — stav „Neuložené změny" a vypnuté Uložit bez změn. null = zatím nic uloženo
   * (platí výchozí; Uložit jde vždy). Bez zadání editor stav uložení nesleduje.
   */
  savedValue?: SignatureSettings | null;
  /** Logo v náhledu (výchozí /brand/… z webu aplikace). */
  logoSrc?: string | null;
  /** Schránky — přepínač se ukáže, když jsou aspoň dvě. */
  mailboxes?: SignatureMailboxOption[];
  mailboxKey?: string | null;
  onMailboxChange?: (key: string | null) => void;
  /** split = formulář a náhled vedle sebe (od md), stack = vždy pod sebou (úzký panel). */
  layout?: "split" | "stack";
  disabled?: boolean;
  className?: string;
}

type Theme = "light" | "dark";

const SAMPLE_BODY = "Dobrý den,<br>děkujeme za poptávku — nabídku Vám pošlu do zítřka.";

/**
 * Dokument náhledu (iframe srcdoc): ukázkový začátek zprávy + podpis. Tmavý režim simuluje
 * Outlook / Gmail — barvy textu a pozadí převrácené, obrázky (logo) beze změny.
 */
export function signaturePreviewDocument(signatureHtml: string, theme: Theme): string {
  const dark = theme === "dark";
  return [
    '<!DOCTYPE html><html lang="cs"><head><meta charset="utf-8"><style>',
    `html,body{margin:0;padding:0;background:${dark ? "#1E1E1E" : "#FFFFFF"}}`,
    ".mail{padding:16px 18px 20px;background:#FFFFFF;font-family:Roboto,Arial,Helvetica,sans-serif;font-size:14px;line-height:21px;color:#272425}",
    ".sample{color:#9B9798;margin:0 0 16px}",
    dark ? ".mail{filter:invert(1) hue-rotate(180deg);background:#E1E1E1}.mail img{filter:invert(1) hue-rotate(180deg)}" : "",
    "</style></head><body>",
    `<div class="mail"><p class="sample">${SAMPLE_BODY}</p>${signatureHtml || '<p class="sample" style="font-style:italic">Podpis je vypnutý — do zpráv se nevloží.</p>'}</div>`,
    "</body></html>",
  ].join("");
}

export function SignatureEditor({
  value, onChange, defaults, company, onSave, onReset, savedValue, logoSrc, mailboxes, mailboxKey = null, onMailboxChange,
  layout = "split", disabled = false, className,
}: SignatureEditorProps) {
  const uid = React.useId();
  const id = (k: string) => `${uid}-${k}`;
  const [theme, setTheme] = React.useState<Theme>("light");
  const [advanced, setAdvanced] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [status, setStatus] = React.useState<{ ok: boolean; text: string } | null>(null);

  const logo = logoSrc === undefined ? SIGNATURE_LOGO_PATH : logoSrc;
  const rendered = React.useMemo(() => renderSignature(value, { company, logoSrc: logo }), [value, company, logo]);
  // změna proti uloženému (nic uloženo → proti výchozímu); bez uloženého jde Uložit vždy —
  // i nezměněný výchozí podpis tím nahradí starý textový podpis
  const changed = !sameSignature(value, savedValue ?? defaults);
  const canSave = savedValue ? changed : true;
  const compact = value.variant === "kompaktni";

  const patch = (p: Partial<SignatureSettings>) => {
    setStatus(null);
    onChange({ ...value, ...p });
  };
  const toggle = (k: keyof SignatureBlocks, on: boolean) => patch({ show: { ...value.show, [k]: on } });

  const reset = () => {
    setStatus(null);
    if (onReset) onReset();
    else onChange({ ...defaults, show: { ...defaults.show }, links: [...defaults.links] });
  };

  const save = async () => {
    if (!onSave) return;
    setSaving(true);
    setStatus(null);
    try {
      const r = await onSave(value);
      setStatus(r && r.ok === false ? { ok: false, text: r.error ?? "Uložení se nepovedlo." } : { ok: true, text: "Podpis uložen." });
    } catch {
      setStatus({ ok: false, text: "Spojení se nepovedlo — zkus to znovu." });
    } finally {
      setSaving(false);
    }
  };

  const emailBad = Boolean(value.email.trim()) && !isSignatureEmail(value.email.trim());
  const webBad = Boolean(value.web.trim()) && !safeWebHref(value.web);
  const links = value.links.length < SIGNATURE_LIMITS.links ? [...value.links, ""] : value.links;
  const setLink = (i: number, v: string) => {
    const next = [...links];
    next[i] = v;
    patch({ links: next.filter((l, j) => l.trim() || j < next.length - 1).slice(0, SIGNATURE_LIMITS.links) });
  };

  const split = layout === "split";

  return (
    <div className={cn("space-y-5", className)} data-testid="signature-editor">
      <div className={cn("grid gap-5", split && "md:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] md:gap-x-8")}>
        {/* 1) Schránka + varianta */}
        <div className="min-w-0 space-y-4">
          {mailboxes && mailboxes.length > 1 && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium" id={id("mb")}>Podpis pro schránku</p>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-labelledby={id("mb")} data-testid="signature-mailboxes">
                {mailboxes.map((m) => {
                  const on = m.key === mailboxKey;
                  return (
                    <button
                      key={m.key ?? "*"}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={disabled}
                      onClick={() => onMailboxChange?.(m.key)}
                      className={cn(
                        "max-w-full truncate rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                        on ? "border-primary/40 bg-primary/10 text-primary" : "bg-background text-foreground/80 hover:bg-accent",
                      )}
                    >
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-sm font-medium" id={id("variant")}>Vzhled</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-labelledby={id("variant")} data-testid="signature-variants">
              {SIGNATURE_VARIANTS.map((v) => {
                const on = value.variant === v;
                return (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={disabled}
                    onClick={() => patch({ variant: v })}
                    data-variant={v}
                    className={cn(
                      "group flex flex-col items-center gap-2 rounded-xl border bg-background p-2.5 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      on ? "border-primary ring-1 ring-primary" : "hover:border-foreground/25 hover:bg-accent/50",
                    )}
                  >
                    <VariantThumb variant={v} active={on} />
                    <span className={cn("text-xs font-semibold sm:text-sm", on ? "text-primary" : "text-foreground/80")}>{SIGNATURE_VARIANT_INFO[v].label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">{SIGNATURE_VARIANT_INFO[value.variant].hint}</p>
          </div>
        </div>

        {/* 2) Živý náhled (desktop: vpravo, přilepený) */}
        <div className={cn("min-w-0", split && "md:col-start-2 md:row-span-2 md:row-start-1 md:self-start md:sticky md:top-4")}>
          <SignaturePreview html={rendered.html} theme={theme} onTheme={setTheme} />
        </div>

        {/* 3) Údaje + přepínače + pokročilé */}
        <div className="min-w-0 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={id("name")} label="Jméno a příjmení" className="sm:col-span-2">
              <Input
                id={id("name")} value={value.fullName} autoComplete="name" maxLength={SIGNATURE_LIMITS.fullName} disabled={disabled}
                placeholder="Jan Novák" onChange={(e) => patch({ fullName: e.target.value })} className={INPUT}
              />
            </Field>
            <Field id={id("role")} label="Pozice" hint="nepovinné">
              <Input
                id={id("role")} value={value.role} autoComplete="organization-title" maxLength={SIGNATURE_LIMITS.role} disabled={disabled}
                placeholder="např. obchod" onChange={(e) => patch({ role: e.target.value })} className={INPUT}
              />
            </Field>
            <Field id={id("phone")} label="Telefon">
              <Input
                id={id("phone")} type="tel" inputMode="tel" autoComplete="tel" value={value.phone} maxLength={SIGNATURE_LIMITS.phone} disabled={disabled}
                placeholder="+420 777 123 456" onChange={(e) => patch({ phone: e.target.value })}
                onBlur={() => value.phone && formatPhone(value.phone) !== value.phone && patch({ phone: formatPhone(value.phone) })}
                className={INPUT}
              />
            </Field>
          </div>

          <div className="divide-y rounded-xl border" data-testid="signature-toggles">
            <ToggleRow id={id("t-logo")} icon={ImageIcon} label="Logo firmy" checked={value.show.logo} disabled={disabled} onChange={(on) => toggle("logo", on)} />
            <ToggleRow
              id={id("t-company")} icon={Building2} label="Fakturační údaje" hint="firma, sídlo, IČO, DIČ"
              checked={value.show.company} disabled={disabled || compact} onChange={(on) => toggle("company", on)}
            />
            <ToggleRow
              id={id("t-address")} icon={MapPin} label="Doručovací adresa" hint={company.correspondenceAddress}
              checked={value.show.address} disabled={disabled || compact} onChange={(on) => toggle("address", on)}
            />
            <ToggleRow
              id={id("t-cert")} icon={BadgeCheck} label="Certifikace" hint={company.certifications.join(", ")}
              checked={value.show.certifications} disabled={disabled || compact} onChange={(on) => toggle("certifications", on)}
            />
            {compact && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Firemní údaje ukazují varianty Firemní a Vizitka — Kompaktní je bez nich.</p>
            )}
          </div>

          {/* Pokročilé */}
          <div className="rounded-xl border">
            <button
              type="button"
              onClick={() => setAdvanced((a) => !a)}
              aria-expanded={advanced}
              aria-controls={id("adv")}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-medium hover:bg-accent/50"
              data-testid="signature-advanced-toggle"
            >
              <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", advanced && "rotate-180")} />
              Pokročilé
              <span className="ml-auto truncate text-xs font-normal text-muted-foreground">pozdrav, e-mail, web, odkazy, poznámka</span>
            </button>
            {advanced && (
              <div id={id("adv")} className="space-y-3 border-t px-3 pb-3 pt-3" data-testid="signature-advanced">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id={id("closing")} label="Pozdrav" hint="prázdné = bez pozdravu">
                    <Input
                      id={id("closing")} value={value.closing} maxLength={SIGNATURE_LIMITS.closing} disabled={disabled}
                      placeholder="S pozdravem" onChange={(e) => patch({ closing: e.target.value })} className={INPUT}
                    />
                  </Field>
                  <Field id={id("phone2")} label="Další telefon">
                    <Input
                      id={id("phone2")} type="tel" inputMode="tel" value={value.phone2} maxLength={SIGNATURE_LIMITS.phone} disabled={disabled}
                      placeholder="pevná linka" onChange={(e) => patch({ phone2: e.target.value })}
                      onBlur={() => value.phone2 && formatPhone(value.phone2) !== value.phone2 && patch({ phone2: formatPhone(value.phone2) })}
                      className={INPUT}
                    />
                  </Field>
                  <Field id={id("email")} label="E-mail v podpisu" error={emailBad ? "Neplatný e-mail — v podpisu se neukáže." : undefined}>
                    <Input
                      id={id("email")} type="email" inputMode="email" autoComplete="email" value={value.email} maxLength={SIGNATURE_LIMITS.email}
                      disabled={disabled} placeholder="jmeno@mnastrojarna.cz" onChange={(e) => patch({ email: e.target.value })} className={INPUT}
                      aria-invalid={emailBad || undefined}
                    />
                  </Field>
                  <Field id={id("web")} label="Web" error={webBad ? "Neplatná adresa webu." : undefined}>
                    <Input
                      id={id("web")} inputMode="url" value={value.web} maxLength={SIGNATURE_LIMITS.web} disabled={disabled}
                      placeholder={company.web || "www.mnastrojarna.cz"} onChange={(e) => patch({ web: e.target.value })} className={INPUT}
                      aria-invalid={webBad || undefined}
                    />
                  </Field>
                </div>
                <fieldset className="space-y-1.5">
                  <legend className="text-sm font-medium">Odkazy <span className="font-normal text-muted-foreground">(LinkedIn, Facebook …)</span></legend>
                  {links.map((l, i) => {
                    const bad = Boolean(l.trim()) && !safeWebHref(l);
                    return (
                      <div key={i} className="space-y-1">
                        <Input
                          value={l} inputMode="url" maxLength={SIGNATURE_LIMITS.link} disabled={disabled}
                          aria-label={`Odkaz ${i + 1}`} placeholder="https://www.linkedin.com/in/…"
                          onChange={(e) => setLink(i, e.target.value)} className={INPUT} aria-invalid={bad || undefined}
                        />
                        {bad && <p className="text-xs text-destructive">Neplatný odkaz — v podpisu se neukáže.</p>}
                      </div>
                    );
                  })}
                </fieldset>
                <Field id={id("note")} label="Krátká poznámka" hint="pod podpisem, max. 3 řádky">
                  <Textarea
                    id={id("note")} value={value.note} rows={2} maxLength={SIGNATURE_LIMITS.note} disabled={disabled}
                    placeholder="Např. V pátek jsem na cestě, v naléhavých věcech volejte." onChange={(e) => patch({ note: e.target.value })}
                    className={cn(INPUT, "h-auto min-h-[3.5rem]")}
                  />
                </Field>
                <div className="divide-y rounded-lg border">
                  <ToggleRow id={id("t-slogan")} label="Slogan pod logem" hint={company.slogan} checked={value.show.slogan} disabled={disabled} onChange={(on) => toggle("slogan", on)} />
                  <ToggleRow
                    id={id("t-enabled")} label="Vkládat podpis do zpráv" hint="vypnuto = zprávy z této schránky bez podpisu"
                    checked={value.enabled} disabled={disabled} onChange={(on) => patch({ enabled: on })}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Akce */}
      {/* mobil: stav na vlastním řádku, tlačítka přes celou šířku (Uložit široké); od sm vše v řádku */}
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-col gap-2 border-t bg-background px-1 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center">
        <div className="min-w-0 text-sm sm:mr-auto" aria-live="polite" data-testid="signature-status">
          {status ? (
            <span className={cn("inline-flex items-center gap-1", status.ok ? "text-success" : "text-destructive")}>
              {status.ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
              {status.text}
            </span>
          ) : savedValue !== undefined && changed ? (
            <span className="text-muted-foreground">Neuložené změny</span>
          ) : savedValue === null ? (
            <span className="text-muted-foreground">Zatím výchozí podpis</span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" onClick={reset} disabled={disabled || saving} className="shrink-0" data-testid="signature-reset">
            <RotateCcw className="h-4 w-4" /> Obnovit výchozí
          </Button>
          {onSave && (
            <Button
              type="button" variant="success" onClick={() => void save()} disabled={disabled || saving || !canSave}
              className="h-10 flex-1 sm:h-9 sm:flex-none" data-testid="signature-save"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Uložit podpis
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 16 px na mobilu (iOS jinak při psaní přibližuje), kompaktní od sm. */
const INPUT = "h-10 text-base sm:h-9 sm:text-sm";

function Field({ id, label, hint, error, className, children }: {
  id: string; label: string; hint?: string; error?: string; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <label htmlFor={id} className="flex items-baseline gap-1.5 text-sm font-medium">
        {label}
        {hint && <span className="truncate text-xs font-normal text-muted-foreground">{hint}</span>}
      </label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function ToggleRow({ id, icon: Icon, label, hint, checked, disabled, onChange }: {
  id: string; icon?: React.ComponentType<{ className?: string }>; label: string; hint?: string; checked: boolean; disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className={cn("flex items-center gap-3 px-3 py-2.5", disabled && "opacity-60")}>
      {Icon && (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Icon className="h-4 w-4" />
        </span>
      )}
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block truncate text-xs text-muted-foreground">{hint}</span>}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

/** Náhled podpisu v izolovaném iframe (bez skriptů; výška podle obsahu). */
function SignaturePreview({ html, theme, onTheme }: { html: string; theme: Theme; onTheme: (t: Theme) => void }) {
  const ref = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(220);
  const doc = React.useMemo(() => signaturePreviewDocument(html, theme), [html, theme]);

  const measure = React.useCallback(() => {
    const d = ref.current?.contentDocument;
    if (d?.documentElement) setHeight(Math.max(140, Math.ceil(d.documentElement.scrollHeight)));
  }, []);

  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm" data-testid="signature-preview" data-theme={theme}>
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        <span className="flex gap-1" aria-hidden>
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-foreground/15" />
        </span>
        <span className="text-xs font-medium text-muted-foreground">Náhled</span>
        <div className="ml-auto inline-flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Režim náhledu">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={theme === t}
              onClick={() => onTheme(t)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                theme === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "light" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              {t === "light" ? "Světlý" : "Tmavý"}
            </button>
          ))}
        </div>
      </div>
      <iframe
        ref={ref}
        title="Náhled podpisu"
        sandbox="allow-same-origin"
        srcDoc={doc}
        onLoad={measure}
        className="block w-full border-0"
        style={{ height, background: theme === "dark" ? "#1E1E1E" : "#FFFFFF" }}
      />
    </div>
  );
}

/** Miniatura rozložení varianty (schéma, ne skutečný podpis). */
function VariantThumb({ variant, active }: { variant: SignatureVariant; active: boolean }) {
  const ink = active ? "bg-foreground/70" : "bg-foreground/45";
  const soft = "bg-foreground/15";
  const mark = <span className="h-2.5 w-2.5 shrink-0 rounded-[2px] bg-primary" />;
  const logo = (
    <span className="flex items-center gap-0.5">
      {mark}
      <span className={cn("h-1.5 w-6 rounded-full", ink)} />
    </span>
  );
  return (
    <span className="flex h-11 w-full max-w-[5.5rem] flex-col justify-center gap-1 rounded-md bg-muted/60 px-2" aria-hidden>
      {variant === "vizitka" ? (
        <span className="flex items-center gap-1.5">
          {logo}
          <span className="h-6 w-px shrink-0 bg-primary" />
          <span className="flex flex-1 flex-col gap-0.5">
            <span className={cn("h-1.5 w-8 rounded-full", ink)} />
            <span className={cn("h-1 w-6 rounded-full", soft)} />
            <span className={cn("h-1 w-7 rounded-full", soft)} />
          </span>
        </span>
      ) : (
        <>
          <span className={cn("h-1.5 w-10 rounded-full", ink)} />
          {logo}
          <span className={cn("h-1 w-14 rounded-full", soft)} />
          {variant === "firemni" && <span className="h-1 w-12 rounded-full bg-foreground/10" />}
        </>
      )}
    </span>
  );
}
