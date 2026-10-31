"use client";

import Link from "next/link";
import Script from "next/script";
import type { Dict } from "@/content/cs";
import { useEffect, useState } from "react";

const GA_ID = process.env.NEXT_PUBLIC_GA_ID; // např. G-XXXXXXX (GA4) nebo AW-… (Google Ads)
const KEY = "mn-consent-v1";

type Consent = "granted" | "denied";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...a: unknown[]) => void;
  }
}

/** Měření konverzí — bez výslovného souhlasu se analytika nespouští (Consent Mode v2). */
export function track(event: string, params: Record<string, unknown> = {}) {
  try {
    window.gtag?.("event", event, params);
    window.dataLayer?.push({ event, ...params });
  } catch {
    /* ignore */
  }
}

export function Analytics({ t, privacyHref }: { t: Dict["cookie"]; privacyHref: string }) {
  const [consent, setConsent] = useState<Consent | null | "unknown">("unknown");

  useEffect(() => {
    let v: string | null = null;
    try {
      v = localStorage.getItem(KEY);
    } catch {
      /* private mode */
    }
    setConsent(v === "granted" || v === "denied" ? v : null);
  }, []);

  const decide = (v: Consent) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
    setConsent(v);
    window.gtag?.("consent", "update", {
      analytics_storage: v,
      ad_storage: v,
      ad_user_data: v,
      ad_personalization: v,
    });
  };

  return (
    <>
      {GA_ID && consent === "granted" && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
          <Script id="gtag-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;
gtag('consent','default',{analytics_storage:'granted',ad_storage:'granted',ad_user_data:'granted',ad_personalization:'granted'});
gtag('js',new Date());gtag('config','${GA_ID}',{anonymize_ip:true});`}
          </Script>
        </>
      )}
      {GA_ID && consent === null && (
        <div
          role="dialog"
          aria-label={t.aria}
          className="fixed bottom-4 left-4 right-4 z-[60] mx-auto max-w-xl rounded-2xl border border-white/10 bg-ink/95 p-5 text-[14px] text-white/80 shadow-2xl backdrop-blur md:left-auto md:right-6"
        >
          <p>
            {t.text}{" "}
            <Link href={privacyHref} className="underline hover:text-white">
              {t.more}
            </Link>
          </p>
          <div className="mt-4 flex gap-2">
            <button type="button" className="btn-primary !px-5 !py-2 !text-[13px]" onClick={() => decide("granted")}>
              {t.accept}
            </button>
            <button type="button" className="btn-ghost-dark !px-5 !py-2 !text-[13px]" onClick={() => decide("denied")}>
              {t.reject}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
