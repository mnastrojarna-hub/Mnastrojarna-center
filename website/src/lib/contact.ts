import { SALES } from "@/content/site";

/** Odkaz na e-mail primárního kontaktu (Vít Volný) s předvyplněným předmětem a textem. */
export function mailToSales(subject: string, body?: string) {
  const q = [`subject=${encodeURIComponent(subject)}`, body ? `body=${encodeURIComponent(body)}` : ""].filter(Boolean).join("&");
  return `mailto:${SALES.email}?${q}`;
}

export const callSales = SALES.phoneHref ?? `mailto:${SALES.email}`;
