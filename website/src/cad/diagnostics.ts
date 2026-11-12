import { tr } from "./i18n";
/**
 * Diagnostika prostředí pro 3D okno a podporu: dostupnost WebGL, prohlížeč, jádro, chyba.
 * Nikdy neobsahuje data dokumentu (geometrii, názvy dílů, historii) – lze ji bez obav poslat e-mailem.
 */

export const CAD_VERSION = "5. vlna (listopad 2026)";

export type WebGLProbe = {
  ok: boolean;
  api: "webgl2" | "webgl" | null;
  vendor: string | null;
  renderer: string | null;
  /** softwarové vykreslování (SwiftShader, llvmpipe…) – funguje, ale pomalu */
  software: boolean;
  reason: string | null;
};

/** Ověří, zda prohlížeč poskytne WebGL kontext (zkouší WebGL 2, pak WebGL 1). Bez vedlejších účinků. */
export function probeWebGL(): WebGLProbe {
  const none = (reason: string): WebGLProbe => ({ ok: false, api: null, vendor: null, renderer: null, software: false, reason });
  if (typeof document === "undefined") return none(tr("mimo prohlížeč"));
  try {
    const c = document.createElement("canvas");
    const attrs: WebGLContextAttributes = { failIfMajorPerformanceCaveat: false, antialias: false, alpha: true };
    const gl2 = c.getContext("webgl2", attrs) as WebGL2RenderingContext | null;
    const gl = gl2 ?? ((c.getContext("webgl", attrs) ?? c.getContext("experimental-webgl", attrs)) as WebGLRenderingContext | null);
    if (!gl) return none(tr("prohlížeč neposkytl WebGL kontext (grafická akcelerace je vypnutá nebo nedostupná)"));
    const dbg = gl.getExtension("WEBGL_debug_renderer_info") as { UNMASKED_VENDOR_WEBGL: number; UNMASKED_RENDERER_WEBGL: number } | null;
    const vendor = String(dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR));
    const renderer = String(dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    const software = /swiftshader|llvmpipe|softpipe|software|disabled/i.test(`${vendor} ${renderer}`);
    try {
      (gl.getExtension("WEBGL_lose_context") as { loseContext: () => void } | null)?.loseContext();
    } catch {
      /* uvolnění zkušebního kontextu není nutné */
    }
    return { ok: true, api: gl2 ? "webgl2" : "webgl", vendor, renderer, software, reason: null };
  } catch (e) {
    return none((e as Error)?.message || tr("chyba při vytváření WebGL kontextu"));
  }
}

export type Browser = "chrome" | "edge" | "firefox" | "safari" | "other";
export function browserOf(ua: string): Browser {
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\//.test(ua) || /CriOS\//.test(ua)) return "chrome";
  if (/Safari\//.test(ua) && /Version\//.test(ua)) return "safari";
  return "other";
}

export type RenderFailure = { error: Error; probe: WebGLProbe; lost?: boolean };

/** Česky: příčina a postup, co zkusit. */
export function explainRenderFailure(f: RenderFailure, ua = typeof navigator === "undefined" ? "" : navigator.userAgent): { title: string; cause: string; steps: string[]; note: string } {
  const b = browserOf(ua);
  const remote = /Citrix|VMware|VirtualBox|Hyper-V|RDP/i.test(ua);
  const steps: string[] = [];
  if (b === "chrome" || b === "edge") {
    steps.push(tr("{0}: Nastavení → Systém → zapněte „Použít grafickou akceleraci, je-li k dispozici“ a prohlížeč restartujte. Stav grafiky ukáže adresa {1} (řádek WebGL musí být „Hardware accelerated“ nebo alespoň „Software only“).", b === "edge" ? "Edge" : "Chrome", b === "edge" ? "edge://gpu" : "chrome://gpu"));
  } else if (b === "firefox") {
    steps.push(tr("Firefox: Nastavení → Obecné → Výkon → zapněte „Použít doporučená nastavení výkonu“ (hardwarová akcelerace); v about:config musí být webgl.disabled = false. Stav ukáže about:support → Grafika."));
  } else if (b === "safari") {
    steps.push(tr("Safari: aktualizujte macOS / iOS – WebGL je v Safari 16 a novějším zapnuté standardně. Ve starších verzích: Vývoj → Experimentální funkce → WebGL."));
  } else {
    steps.push(tr("Zapněte v prohlížeči hardwarovou (grafickou) akceleraci a prohlížeč restartujte."));
  }
  steps.push(tr("Pracujete-li přes vzdálenou plochu (RDP), Citrix nebo ve virtuálním stroji, otevřete CAD přímo na počítači s grafickou kartou – vzdálené relace WebGL často neposkytují."));
  steps.push(tr("Aktualizujte ovladač grafické karty (Windows Update nebo web výrobce: NVIDIA, AMD, Intel) a restartujte počítač."));
  steps.push(tr("Zkuste jiný prohlížeč v aktuální verzi: Chrome, Edge, Firefox nebo Safari."));
  steps.push(tr("Nebo jiné zařízení – WebGL zvládá i běžný notebook či telefon z posledních let."));
  const cause = f.lost
    ? tr("Grafický kontext WebGL byl během práce ztracen – nejčastěji po probuzení počítače, při přetížení grafické paměti, pádu ovladače grafiky nebo příliš mnoha otevřených 3D oknech.")
    : !f.probe.ok
      ? tr("Prohlížeč neposkytl WebGL, tedy hardwarově akcelerovanou grafiku, kterou 3D zobrazení potřebuje ({0}). Nejčastější příčiny: vypnutá grafická akcelerace v prohlížeči, vzdálená plocha nebo virtuální stroj bez grafické karty, zastaralý ovladač grafiky, firemní zásady prohlížeče.{1}", f.probe.reason ?? tr("bez bližšího důvodu"), remote ? tr(" Podle identifikace prohlížeče jde o vzdálenou nebo virtuální relaci.") : "")
      : tr("WebGL je dostupné ({0}), ale 3D vykreslování se nepodařilo spustit: {1}. Může jít o vyčerpanou grafickou paměť nebo příliš mnoho otevřených 3D oken.", f.probe.renderer ?? f.probe.api, f.error.message);
  return {
    title: f.lost ? tr("3D okno přestalo fungovat") : tr("3D okno nelze spustit"),
    cause,
    steps,
    note: tr("Ostatní části programu fungují dál: nabídky, nápověda, nastavení, otevření a uložení souborů, 2D skica i výkresy. Jen se nezobrazí 3D model."),
  };
}

const yes = (v: unknown) => (v ? "ano" : "ne");

/** Text diagnostiky pro podporu – bez dat dokumentu. */
export function collectDiagnostics(o: { error?: Error | null; probe?: WebGLProbe; core?: string; lost?: boolean } = {}): string {
  const n = typeof navigator === "undefined" ? null : navigator;
  const w = typeof window === "undefined" ? null : window;
  const probe = o.probe ?? probeWebGL();
  const nav = n as (Navigator & { deviceMemory?: number; userAgentData?: { platform?: string } }) | null;
  const lines = [
    tr("Mnástrojárna CAD – diagnostika (bez dat dokumentu)"),
    tr("Verze CADu: {0}", CAD_VERSION),
    tr("Čas: {0}", new Date().toISOString()),
    `Adresa: ${w ? w.location.origin + w.location.pathname : "–"}`,
    tr("Prohlížeč: {0} ({1})", n?.userAgent ?? "–", browserOf(n?.userAgent ?? "")),
    tr("Platforma: {0} · jazyk {1} · jader CPU {2} · paměť {3}", nav?.userAgentData?.platform || nav?.platform || "–", n?.language ?? "–", n?.hardwareConcurrency ?? "–", nav?.deviceMemory ? `${nav.deviceMemory} GB` : "–"),
    tr("Obrazovka: {0} · okno {1} · DPR {2} · dotyk {3}", w ? `${w.screen.width}×${w.screen.height}` : "–", w ? `${w.innerWidth}×${w.innerHeight}` : "–", w?.devicePixelRatio ?? "–", yes(n && n.maxTouchPoints > 0)),
    `WebGL: ${probe.ok ? `dostupné (${probe.api}) · ${probe.renderer ?? "?"} · ${probe.vendor ?? "?"}` : `nedostupné – ${probe.reason ?? "?"}`}`,
    tr("Softwarové vykreslování: {0}", yes(probe.software)),
    `WebAssembly: ${yes(typeof WebAssembly !== "undefined")} · SharedArrayBuffer: ${yes(typeof SharedArrayBuffer !== "undefined")} · crossOriginIsolated: ${yes(w && (w as Window & { crossOriginIsolated?: boolean }).crossOriginIsolated)}`,
    tr("Jádro OCCT: {0}", o.core ?? "–"),
    `Online: ${yes(n?.onLine ?? true)} · cookies: ${yes(n?.cookieEnabled)}`,
  ];
  if (o.lost) lines.push(tr("Událost: WebGL kontext ztracen"));
  if (o.error) {
    lines.push(tr("Chyba: {0}", o.error.message || String(o.error)));
    const st = (o.error.stack ?? "").split("\n").slice(1, 4).map((l) => "  " + l.trim());
    lines.push(...st);
  }
  return lines.join("\n");
}
