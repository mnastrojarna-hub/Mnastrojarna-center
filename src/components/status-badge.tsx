import { Badge } from "@/components/ui/badge";
import type { BadgeProps } from "@/components/ui/badge";

const emailCategoryVariant: Record<string, BadgeProps["variant"]> = {
  Poptávka: "default",
  Objednávka: "success",
  "Nabídka dodavatele": "secondary",
  "Potvrzení objednávky": "success",
  Faktura: "warning",
  Upomínka: "warning",
  Reklamace: "destructive",
  "Technická dokumentace": "secondary",
  Spam: "muted",
};

const orderStatusVariant: Record<string, BadgeProps["variant"]> = {
  Přijato: "secondary",
  Nacenění: "warning",
  Objednáno: "default",
  "Ve výrobě": "default",
  Expedováno: "success",
  Dokončeno: "muted",
};

const quoteStatusVariant: Record<string, BadgeProps["variant"]> = {
  "Návrh AI": "secondary",
  "Ke schválení": "warning",
  Odesláno: "default",
  Přijato: "success",
  Zamítnuto: "destructive",
};

export function CategoryBadge({ category }: { category: string }) {
  return <Badge variant={emailCategoryVariant[category] ?? "secondary"}>{category}</Badge>;
}

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge variant={orderStatusVariant[status] ?? "secondary"}>{status}</Badge>;
}

export function QuoteStatusBadge({ status }: { status: string }) {
  return <Badge variant={quoteStatusVariant[status] ?? "secondary"}>{status}</Badge>;
}
